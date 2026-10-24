import type { Pool } from 'pg';
import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { testConfig, TEST_ADMIN_TOKEN } from './testing/config.js';
import { startPostgres, type TestDatabase } from './testing/startPostgres.js';

// Obviously fake numbers: 90000 00xxx.
const DEMO = '9000000001';
const DEMO_LOGIN = '9000000003';
const OTHER = '9000000002';
const PUBLIC_SHOP = '9000000102';
const PUBLIC_CUSTOMER = '9000000202';
const quiet = pino({ level: 'silent' });

describe('demo mode: codes exist only for DEMO_PHONES (ADR-0058)', () => {
  let testDb: TestDatabase;
  let pool: Pool;
  let app: ReturnType<typeof createApp>;
  let open: ReturnType<typeof createApp>;
  let nth = 0;
  const fresh = () => `90000${String(10_000 + nth++)}`;

  beforeAll(async () => {
    testDb = await startPostgres();
    pool = testDb.pool;
    const base = {
      adminToken: TEST_ADMIN_TOKEN,
      demoPhones: [`+91${DEMO}`, `+91${DEMO_LOGIN}`, `+91${PUBLIC_SHOP}`, `+91${PUBLIC_CUSTOMER}`],
      publicDemoShopPhones: [`+91${PUBLIC_SHOP}`],
      publicDemoCustomerPhones: [`+91${PUBLIC_CUSTOMER}`],
    };
    app = createApp({
      config: testConfig({ ...base, otpInboxOpen: false }),
      logger: quiet,
      db: pool,
    });
    open = createApp({
      config: testConfig({ ...base, otpInboxOpen: true }),
      logger: quiet,
      db: pool,
    });
  }, 300_000);

  afterAll(async () => {
    await testDb?.stop();
  });

  const ask = (target: typeof app, phone: string) =>
    request(target).post('/auth/otp/request').send({ phone });
  const inbox = (target: typeof app, phone: string) =>
    request(target).get('/dev/otp-inbox').query({ phone });
  const devCodes = async (phone: string) =>
    (
      await pool.query('SELECT dev_code, code_hash FROM otp_codes WHERE phone = $1', [
        `+91${phone}`,
      ])
    ).rows;

  it('shows a demo phone its code', async () => {
    expect((await ask(app, DEMO)).status).toBe(202);
    const res = await inbox(app, DEMO);
    expect(res.status).toBe(200);
    expect(res.body.code).toMatch(/^\d{6}$/);
  });

  it('lets a demo phone log in with that code', async () => {
    await ask(app, DEMO_LOGIN);
    const { code } = (await inbox(app, DEMO_LOGIN)).body;
    const res = await request(app)
      .post('/auth/otp/verify')
      .send({ phone: DEMO_LOGIN, code, role: 'seeker' });
    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('seeker');
  });

  it('tells a non-demo phone it is demo mode straight away, and stores no code for it', async () => {
    const phone = fresh();
    const res = await ask(app, phone);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('demo_mode');
    expect(await devCodes(phone)).toHaveLength(0);
  });

  it('never shows a non-demo phone a code', async () => {
    const res = await inbox(app, OTHER);
    expect(res.status).toBe(404);
    expect(res.body.code).toBeUndefined();
  });

  it('fails verify for a phone nobody asked a code for, like any wrong code', async () => {
    const stranger = await request(app)
      .post('/auth/otp/verify')
      .send({ phone: fresh(), code: '123456', role: 'seeker' });
    expect(stranger.status).toBe(401);
    expect(stranger.body.error.code).toBe('invalid_code');
    expect(stranger.body.error.attemptsLeft).toBeUndefined();
  });

  it('says how many tries are left after a wrong code, and stops saying it once locked', async () => {
    await ask(app, DEMO);
    const left: unknown[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await request(app)
        .post('/auth/otp/verify')
        .send({ phone: DEMO, code: '000000', role: 'seeker' });
      expect(res.status).toBe(401);
      left.push(res.body.error.attemptsLeft);
    }
    expect(left).toEqual([4, 3, 2, 1, 0, undefined]);
  });

  it('does not serve a leftover plain code for a non-demo phone', async () => {
    const phone = fresh();
    await pool.query(
      `INSERT INTO otp_codes (phone, code_hash, dev_code, expires_at)
       VALUES ($1, $2, '111111', now() + interval '5 minutes')`,
      [`+91${phone}`, 'a'.repeat(64)],
    );
    expect((await inbox(app, phone)).status).toBe(404);
  });

  it('with OTP_INBOX_OPEN (tests only) every phone gets a code', async () => {
    const phone = fresh();
    expect((await ask(open, phone)).status).toBe(202);
    expect((await inbox(open, phone)).status).toBe(200);
  });

  describe('GET /auth/demo-numbers', () => {
    const numbers = (target: typeof app, role: string) =>
      request(target).get('/auth/demo-numbers').query({ role });

    it('lists only the public shop numbers for shops, with no login', async () => {
      const res = await numbers(app, 'shop');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ demo: true, numbers: [PUBLIC_SHOP] });
    });

    it('lists only the public customer numbers for seekers', async () => {
      const res = await numbers(app, 'seeker');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ demo: true, numbers: [PUBLIC_CUSTOMER] });
    });

    it('never shows a demo number that is not public', async () => {
      for (const role of ['shop', 'seeker']) {
        const text = JSON.stringify((await numbers(app, role)).body);
        expect(text).not.toContain(DEMO);
        expect(text).not.toContain(DEMO_LOGIN);
      }
    });

    it('rejects an unknown role and extra query fields', async () => {
      expect((await numbers(app, 'admin')).status).toBe(400);
      expect((await request(app).get('/auth/demo-numbers')).status).toBe(400);
      expect(
        (await request(app).get('/auth/demo-numbers').query({ role: 'shop', phone: DEMO })).status,
      ).toBe(400);
    });

    it('is limited per IP like the inbox', async () => {
      const limited = createApp({
        config: testConfig({
          adminToken: TEST_ADMIN_TOKEN,
          demoPhones: [`+91${PUBLIC_SHOP}`],
          publicDemoShopPhones: [`+91${PUBLIC_SHOP}`],
          otpIpLimits: { request: 100, verify: 100, inbox: 2 },
        }),
        logger: quiet,
        db: pool,
      });
      expect((await numbers(limited, 'shop')).status).toBe(200);
      expect((await numbers(limited, 'shop')).status).toBe(200);
      const third = await numbers(limited, 'shop');
      expect(third.status).toBe(429);
      expect(third.headers['retry-after']).toBeDefined();
    });
  });

  it('refuses all-same-digit and non-Indian numbers with the same message', async () => {
    for (const phone of ['9999999999', '1234567890']) {
      const res = await ask(app, phone);
      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain("That doesn't look like an Indian mobile number.");
    }
  });

  describe('phone login can never produce an admin', () => {
    it('refuses role admin in the request', async () => {
      const res = await request(app)
        .post('/auth/otp/verify')
        .send({ phone: DEMO_LOGIN, code: '123456', role: 'admin' });
      expect(res.status).toBe(400);
    });

    it('gives a seeker or a shop the role it asked for, even for a demo phone, with ADMIN_TOKEN set', async () => {
      for (const role of ['seeker', 'shop'] as const) {
        const phone = fresh();
        const login = createApp({
          config: testConfig({ adminToken: TEST_ADMIN_TOKEN, otpInboxOpen: true }),
          logger: quiet,
          db: pool,
        });
        await ask(login, phone);
        const { code } = (await inbox(login, phone)).body;
        const res = await request(login).post('/auth/otp/verify').send({ phone, code, role });
        expect(res.body.user.role).toBe(role);
      }
    });

    it('cannot be talked into admin through an existing account, or by the database', async () => {
      await expect(
        pool.query(`INSERT INTO users (phone, role) VALUES ('+919000099999', 'admin')`),
      ).rejects.toThrow(/users_role_check/);
    });

    it('a session from phone login is refused by every admin route', async () => {
      const phone = fresh();
      await ask(open, phone);
      const { code } = (await inbox(open, phone)).body;
      const { token } = (
        await request(open).post('/auth/otp/verify').send({ phone, code, role: 'seeker' })
      ).body;
      const adminApp = createApp({
        config: testConfig({ adminToken: TEST_ADMIN_TOKEN }),
        logger: quiet,
        db: pool,
      });
      const res = await request(adminApp)
        .get('/admin/ai/stats')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(404);
    });
  });
});
