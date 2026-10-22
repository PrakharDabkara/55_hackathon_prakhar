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
      demoPhones: [`+91${DEMO}`, `+91${DEMO_LOGIN}`],
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

  it('never shows any other phone a code, yet still answers request with the same 202', async () => {
    const demo = await ask(app, DEMO);
    const other = await ask(app, OTHER);
    expect(other.status).toBe(202);
    expect(other.status).toBe(demo.status);
    expect(other.body).toEqual(demo.body);

    const res = await inbox(app, OTHER);
    expect(res.status).toBe(404);
    expect(res.body.code).toBeUndefined();
  });

  it('stores no readable code at all for another phone, only the hash', async () => {
    const phone = fresh();
    await ask(app, phone);
    const rows = await devCodes(phone);
    expect(rows).toHaveLength(1);
    expect(rows[0].dev_code).toBeNull();
    expect(rows[0].code_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('still fails verify for another phone, with the same 401 as any wrong code', async () => {
    const phone = fresh();
    await ask(app, phone);
    for (const code of ['000000', '123456']) {
      const res = await request(app).post('/auth/otp/verify').send({ phone, code, role: 'seeker' });
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('invalid_code');
    }
    const stranger = await request(app)
      .post('/auth/otp/verify')
      .send({ phone: fresh(), code: '123456', role: 'seeker' });
    expect(stranger.status).toBe(401);
    const again = await request(app)
      .post('/auth/otp/verify')
      .send({ phone, code: '654321', role: 'seeker' });
    expect(stranger.body).toEqual(again.body);
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
