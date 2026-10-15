import path from 'node:path';
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { GenericContainer } from 'testcontainers';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { CATEGORIES } from '@kahanmilega/shared';
import { runner } from 'node-pg-migrate';
import { Pool } from 'pg';
import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import type { Config } from './config/config.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const IMAGE = 'kahanmilega-postgres:test';

const config: Config = {
  nodeEnv: 'test',
  port: 0,
  logLevel: 'debug',
  databaseUrl: 'postgres://unused',
  otpMode: 'simulated',
  gitSha: 'test',
};

const logLines: string[] = [];
const logSink = new Writable({
  write(chunk, _enc, done) {
    logLines.push(String(chunk));
    done();
  },
});

// Each test uses its own phone so rate limits and codes never collide.
let phoneCounter = 0;
const nextPhone = () => `98000${String(10000 + phoneCounter++)}`;

describe('identity and shops API', () => {
  let container: StartedPostgreSqlContainer;
  let pool: Pool;
  let app: ReturnType<typeof createApp>;

  beforeAll(async () => {
    await GenericContainer.fromDockerfile(path.join(repoRoot, 'infra/postgres')).build(IMAGE, {
      deleteOnExit: false,
    });
    container = await new PostgreSqlContainer(IMAGE).start();
    const databaseUrl = container.getConnectionUri();
    await runner({
      databaseUrl,
      dir: path.join(repoRoot, 'apps/api/migrations'),
      direction: 'up',
      migrationsTable: 'pgmigrations',
      log: () => {},
    });
    pool = new Pool({ connectionString: databaseUrl });
    app = createApp({ config, logger: pino({ level: 'debug' }, logSink), db: pool });
  }, 300_000);

  afterAll(async () => {
    await pool?.end();
    await container?.stop();
  });

  async function inboxCode(phone: string): Promise<string> {
    const res = await request(app).get('/dev/otp-inbox').query({ phone });
    expect(res.status).toBe(200);
    return res.body.code as string;
  }

  async function login(role: 'seeker' | 'shop', phone = nextPhone()) {
    const req = await request(app).post('/auth/otp/request').send({ phone });
    expect(req.status).toBe(202);
    const code = await inboxCode(phone);
    const res = await request(app).post('/auth/otp/verify').send({ phone, code, role });
    expect(res.status).toBe(200);
    return { token: res.body.token as string, user: res.body.user, phone, code };
  }

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const shopBody = {
    name: 'Sharma Hardware',
    lat: 22.7196,
    lng: 75.8577,
    categories: ['hardware', 'electrical'],
  };

  describe('error format', () => {
    it('answers unknown routes and bad JSON as {error:{code,message}}', async () => {
      const missing = await request(app).get('/nope');
      expect(missing.status).toBe(404);
      expect(missing.body.error).toMatchObject({ code: 'not_found' });

      const bad = await request(app)
        .post('/auth/otp/request')
        .set('Content-Type', 'application/json')
        .send('{oops');
      expect(bad.status).toBe(400);
      expect(bad.body.error.code).toBe('invalid_request');
    });
  });

  describe('POST /auth/otp/request', () => {
    it('accepts an Indian mobile in any common form and stores +91XXXXXXXXXX', async () => {
      const res = await request(app).post('/auth/otp/request').send({ phone: '+91 97000-11111' });
      expect(res.status).toBe(202);
      const { rows } = await pool.query('SELECT phone FROM otp_codes WHERE phone = $1', [
        '+919700011111',
      ]);
      expect(rows).toHaveLength(1);
    });

    it('rejects a bad phone with 400', async () => {
      for (const phone of ['12345', '+14155550123', undefined]) {
        const res = await request(app).post('/auth/otp/request').send({ phone });
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('invalid_request');
      }
    });

    it('stores only a hash of the code, expiring in 5 minutes', async () => {
      const phone = nextPhone();
      await request(app).post('/auth/otp/request').send({ phone });
      const code = await inboxCode(phone);
      expect(code).toMatch(/^\d{6}$/);
      const { rows } = await pool.query(
        `SELECT code_hash, expires_at - created_at AS ttl FROM otp_codes WHERE phone = $1`,
        [`+91${phone}`],
      );
      expect(rows[0].code_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(rows[0].code_hash).not.toContain(code);
      expect(rows[0].ttl).toEqual({ minutes: 5 });
    });

    it('allows 3 requests per phone per 10 minutes, then 429', async () => {
      const phone = nextPhone();
      for (let i = 0; i < 3; i++) {
        const res = await request(app).post('/auth/otp/request').send({ phone });
        expect(res.status).toBe(202);
      }
      const res = await request(app).post('/auth/otp/request').send({ phone });
      expect(res.status).toBe(429);
      expect(res.body.error.code).toBe('rate_limited');

      // Another phone is unaffected, and the window slides.
      const other = await request(app).post('/auth/otp/request').send({ phone: nextPhone() });
      expect(other.status).toBe(202);
      await pool.query(
        `UPDATE otp_codes SET created_at = now() - interval '11 minutes' WHERE phone = $1`,
        [`+91${phone}`],
      );
      const again = await request(app).post('/auth/otp/request').send({ phone });
      expect(again.status).toBe(202);
    });
  });

  describe('GET /dev/otp-inbox', () => {
    it('is 404 when there is no unexpired code, and 400 without a valid phone', async () => {
      const none = await request(app).get('/dev/otp-inbox').query({ phone: nextPhone() });
      expect(none.status).toBe(404);
      const bad = await request(app).get('/dev/otp-inbox').query({ phone: 'abc' });
      expect(bad.status).toBe(400);
    });

    it('returns the latest code and hides expired ones', async () => {
      const phone = nextPhone();
      await request(app).post('/auth/otp/request').send({ phone });
      await request(app).post('/auth/otp/request').send({ phone });
      const latest = await pool.query(
        `SELECT dev_code FROM otp_codes WHERE phone = $1 ORDER BY created_at DESC, id DESC LIMIT 1`,
        [`+91${phone}`],
      );
      expect(await inboxCode(phone)).toBe(latest.rows[0].dev_code);

      await pool.query(`UPDATE otp_codes SET expires_at = now() - interval '1 second'`);
      const res = await request(app).get('/dev/otp-inbox').query({ phone });
      expect(res.status).toBe(404);
    });
  });

  describe('POST /auth/otp/verify', () => {
    it('logs in, creates the user with the given role, and returns a token once', async () => {
      const { token, user, phone } = await login('shop');
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(user).toMatchObject({ phone: `+91${phone}`, role: 'shop' });
      expect(user.id).toMatch(/^[0-9a-f-]{36}$/);

      const { rows } = await pool.query(
        'SELECT token_hash, expires_at - created_at AS ttl FROM sessions',
      );
      expect(rows.map((r) => r.token_hash)).not.toContain(token);
      expect(rows.every((r) => /^[0-9a-f]{64}$/.test(r.token_hash))).toBe(true);
      expect(rows.some((r) => r.ttl.days === 30)).toBe(true);
    });

    it('keeps the stored role when an existing user logs in again', async () => {
      const first = await login('shop');
      const again = await login('seeker', first.phone);
      expect(again.user.id).toBe(first.user.id);
      expect(again.user.role).toBe('shop');
    });

    it('rejects a role outside seeker|shop', async () => {
      const phone = nextPhone();
      await request(app).post('/auth/otp/request').send({ phone });
      const code = await inboxCode(phone);
      for (const role of ['admin', 'root', undefined]) {
        const res = await request(app).post('/auth/otp/verify').send({ phone, code, role });
        expect(res.status).toBe(400);
      }
    });

    it('is single use', async () => {
      const { phone, code } = await login('seeker');
      const res = await request(app).post('/auth/otp/verify').send({ phone, code, role: 'seeker' });
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('invalid_code');
    });

    it('rejects an expired code', async () => {
      const phone = nextPhone();
      await request(app).post('/auth/otp/request').send({ phone });
      const code = await inboxCode(phone);
      await pool.query(
        `UPDATE otp_codes SET expires_at = now() - interval '1 second' WHERE phone = $1`,
        [`+91${phone}`],
      );
      const res = await request(app).post('/auth/otp/verify').send({ phone, code, role: 'seeker' });
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('invalid_code');
    });

    it('kills the code after 5 wrong attempts, even for the right code', async () => {
      const phone = nextPhone();
      await request(app).post('/auth/otp/request').send({ phone });
      const code = await inboxCode(phone);
      const wrong = code === '000000' ? '111111' : '000000';
      for (let i = 0; i < 5; i++) {
        const res = await request(app)
          .post('/auth/otp/verify')
          .send({ phone, code: wrong, role: 'seeker' });
        expect(res.status).toBe(401);
      }
      const res = await request(app).post('/auth/otp/verify').send({ phone, code, role: 'seeker' });
      expect(res.status).toBe(401);
    });

    it('still accepts the right code after fewer than 5 wrong attempts', async () => {
      const phone = nextPhone();
      await request(app).post('/auth/otp/request').send({ phone });
      const code = await inboxCode(phone);
      const wrong = code === '000000' ? '111111' : '000000';
      for (let i = 0; i < 4; i++) {
        await request(app).post('/auth/otp/verify').send({ phone, code: wrong, role: 'seeker' });
      }
      const res = await request(app).post('/auth/otp/verify').send({ phone, code, role: 'seeker' });
      expect(res.status).toBe(200);
    });

    it('rejects a code that was never requested', async () => {
      const res = await request(app)
        .post('/auth/otp/verify')
        .send({ phone: nextPhone(), code: '123456', role: 'seeker' });
      expect(res.status).toBe(401);
    });
  });

  describe('auth middleware and logout', () => {
    it('returns 401 without a bearer token, with a bad one, and after logout', async () => {
      expect((await request(app).get('/shops/me')).status).toBe(401);
      const bad = await request(app).get('/shops/me').set(auth('not-a-token'));
      expect(bad.status).toBe(401);
      expect(bad.body.error.code).toBe('unauthorized');

      const { token } = await login('shop');
      expect((await request(app).post('/auth/logout').set(auth(token))).status).toBe(204);
      expect((await request(app).get('/shops/me').set(auth(token))).status).toBe(401);
      expect((await request(app).post('/auth/logout')).status).toBe(401);
    });

    it('returns 401 for an expired session', async () => {
      const { token } = await login('shop');
      await pool.query(`UPDATE sessions SET expires_at = now() - interval '1 second'`);
      expect((await request(app).get('/shops/me').set(auth(token))).status).toBe(401);
    });
  });

  describe('shops', () => {
    it('runs the full flow: request → inbox → verify → create shop → /shops/me', async () => {
      const { token, phone } = await login('shop');
      const created = await request(app).post('/shops').set(auth(token)).send(shopBody);
      expect(created.status).toBe(201);
      expect(created.body).toMatchObject({ ...shopBody, phone: `+91${phone}` });
      expect(created.body.lat).toBeCloseTo(shopBody.lat, 6);
      expect(created.body.lng).toBeCloseTo(shopBody.lng, 6);

      const me = await request(app).get('/shops/me').set(auth(token));
      expect(me.status).toBe(200);
      expect(me.body.id).toBe(created.body.id);
      expect(me.body.name).toBe('Sharma Hardware');
    });

    it('forbids a seeker (403) and an anonymous caller (401)', async () => {
      const { token } = await login('seeker');
      const res = await request(app).post('/shops').set(auth(token)).send(shopBody);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('forbidden');
      expect((await request(app).post('/shops').send(shopBody)).status).toBe(401);
      expect((await request(app).get('/shops/me').set(auth(token))).status).toBe(403);
    });

    it('allows one shop per owner (409)', async () => {
      const { token } = await login('shop');
      expect((await request(app).post('/shops').set(auth(token)).send(shopBody)).status).toBe(201);
      const second = await request(app).post('/shops').set(auth(token)).send(shopBody);
      expect(second.status).toBe(409);
      expect(second.body.error.code).toBe('shop_exists');
    });

    it('validates the body', async () => {
      const { token } = await login('shop');
      const bad: unknown[] = [
        { ...shopBody, name: '  ' },
        { ...shopBody, lat: 91 },
        { ...shopBody, lng: 181 },
        { ...shopBody, categories: [] },
        { ...shopBody, categories: ['grocery', 'hardware', 'electrical'] },
        { ...shopBody, categories: ['pharmacy'] },
        { ...shopBody, categories: ['grocery', 'grocery'] },
        { name: 'No location', categories: ['grocery'] },
      ];
      for (const body of bad) {
        const res = await request(app).post('/shops').set(auth(token)).send(body);
        expect(res.status, JSON.stringify(body)).toBe(400);
        expect(res.body.error.code).toBe('invalid_request');
      }
    });

    it('GET /shops/me is 404 before a shop exists', async () => {
      const { token } = await login('shop');
      const res = await request(app).get('/shops/me').set(auth(token));
      expect(res.status).toBe(404);
      expect(
        (await request(app).patch('/shops/me').set(auth(token)).send({ name: 'x' })).status,
      ).toBe(404);
    });

    it('PATCH /shops/me updates name, categories and location', async () => {
      const { token } = await login('shop');
      await request(app).post('/shops').set(auth(token)).send(shopBody);

      const renamed = await request(app)
        .patch('/shops/me')
        .set(auth(token))
        .send({ name: 'Sharma & Sons' });
      expect(renamed.status).toBe(200);
      expect(renamed.body).toMatchObject({
        name: 'Sharma & Sons',
        categories: shopBody.categories,
      });

      const moved = await request(app)
        .patch('/shops/me')
        .set(auth(token))
        .send({ lat: 22.75, lng: 75.9, categories: ['grocery'] });
      expect(moved.status).toBe(200);
      expect(moved.body.categories).toEqual(['grocery']);
      expect(moved.body.lat).toBeCloseTo(22.75, 6);
      expect(moved.body.lng).toBeCloseTo(75.9, 6);
      expect(moved.body.name).toBe('Sharma & Sons');
    });

    it('PATCH /shops/me rejects an empty body, half a location and bad categories', async () => {
      const { token } = await login('shop');
      await request(app).post('/shops').set(auth(token)).send(shopBody);
      for (const body of [{}, { lat: 22.7 }, { lng: 75.8 }, { categories: ['pharmacy'] }]) {
        const res = await request(app).patch('/shops/me').set(auth(token)).send(body);
        expect(res.status, JSON.stringify(body)).toBe(400);
      }
    });
  });

  describe('database constraints', () => {
    it('accepts every shared category and rejects others', async () => {
      const insert = (categories: string[]) =>
        pool.query(
          `INSERT INTO shops (name, phone, categories, location)
           VALUES ('c', '+910000000000', $1, ST_SetSRID(ST_MakePoint(75.8, 22.7), 4326)::geography)`,
          [categories],
        );
      for (const c of CATEGORIES) await expect(insert([c])).resolves.toBeDefined();
      await expect(insert(['pharmacy'])).rejects.toThrow();
      await expect(insert([])).rejects.toThrow();
      await expect(insert(['grocery', 'hardware', 'electrical'])).rejects.toThrow();
    });
  });

  describe('logging', () => {
    it('never logs OTP codes, tokens or full phone numbers', async () => {
      logLines.length = 0;
      const { token, code, phone } = await login('shop');
      await request(app).post('/shops').set(auth(token)).send(shopBody);
      await request(app).get('/shops/me').set(auth(token));
      await request(app).get('/dev/otp-inbox').query({ phone });
      await request(app).post('/auth/logout').set(auth(token));

      const logs = logLines.join('');
      expect(logs.length).toBeGreaterThan(0);
      expect(logs).not.toContain(token);
      expect(logs).not.toContain(phone);
      expect(logs).not.toContain(`"${code}"`);
      expect(logs).toContain(phone.slice(-4));
    });
  });
});
