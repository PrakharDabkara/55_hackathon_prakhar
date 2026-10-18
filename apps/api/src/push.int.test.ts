import type { Pool } from 'pg';
import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { createRealtime } from './modules/realtime/index.js';
import { testConfig } from './testing/config.js';
import { loginAs } from './testing/login.js';
import { startPostgres, type TestDatabase } from './testing/startPostgres.js';

const VAPID = {
  publicKey: 'BPublicKey-for-tests',
  privateKey: 'private-for-tests',
  subject: 'mailto:ops@example.com',
};
const subscription = (n = 1, over: Record<string, unknown> = {}) => ({
  endpoint: `https://fcm.googleapis.com/fcm/send/device-${n}`,
  keys: {
    p256dh:
      'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM',
    auth: 'tBHItJI5svbpez7KI4CCXg',
  },
  ...over,
});

// ADR-0034: subscribing, unsubscribing and what the server will not accept.
describe('push subscriptions', () => {
  let testDb: TestDatabase;
  let pool: Pool;
  let app: ReturnType<typeof createApp>;
  let offApp: ReturnType<typeof createApp>;
  let phone = 9_896_000_000;
  let userA: { token: string; userId: string };
  let userB: { token: string; userId: string };
  const quiet = pino({ level: 'silent' });
  const auth = (u: { token: string }) => ({ Authorization: `Bearer ${u.token}` });
  const subscribe = (u: { token: string }, body: unknown) =>
    request(app)
      .post('/push/subscribe')
      .set(auth(u))
      .send(body as object);
  const rows = async () =>
    (await pool.query(`SELECT * FROM push_subscriptions ORDER BY created_at`)).rows;

  beforeAll(async () => {
    testDb = await startPostgres();
    pool = testDb.pool;
    const realtime = createRealtime({ redisUrl: null, logger: quiet });
    app = createApp({ config: testConfig({ vapid: VAPID }), logger: quiet, db: pool, realtime });
    offApp = createApp({ config: testConfig({ vapid: null }), logger: quiet, db: pool, realtime });
    userA = await loginAs(app, 'seeker', String(phone++));
    userB = await loginAs(app, 'shop', String(phone++));
  }, 300_000);
  afterAll(async () => {
    await testDb?.stop();
  });
  beforeEach(async () => {
    await pool.query('TRUNCATE push_subscriptions');
  });

  it('tells the app the public key (and only the public key) when push is on', async () => {
    const res = await request(app).get('/push/config');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ enabled: true, publicKey: VAPID.publicKey });
    expect(JSON.stringify(res.body)).not.toContain(VAPID.privateKey);
  });

  it('says push is off, without a key, when VAPID is not set', async () => {
    const res = await request(offApp).get('/push/config');
    expect(res.body).toEqual({ enabled: false });
    const sub = await request(offApp).post('/push/subscribe').set(auth(userA)).send(subscription());
    expect(sub.status).toBe(503);
    expect(sub.body.error.code).toBe('push_disabled');
  });

  it('needs a login for subscribe and unsubscribe', async () => {
    expect((await request(app).post('/push/subscribe').send(subscription())).status).toBe(401);
    expect((await request(app).post('/push/unsubscribe').send({ endpoint: 'x' })).status).toBe(401);
  });

  describe('subscribe', () => {
    it('stores the subscription for the user', async () => {
      const res = await subscribe(userA, subscription(1));
      expect(res.status).toBe(204);
      const stored = await rows();
      expect(stored).toHaveLength(1);
      expect(stored[0]).toMatchObject({
        user_id: userA.userId,
        endpoint: subscription(1).endpoint,
        last_success_at: null,
      });
      expect(stored[0].created_at).toBeInstanceOf(Date);
    });

    it('is idempotent: the same endpoint twice is one row, with the newest keys', async () => {
      await subscribe(userA, subscription(1));
      await subscribe(userA, subscription(1, { keys: { p256dh: 'newkey', auth: 'newauth' } }));
      const stored = await rows();
      expect(stored).toHaveLength(1);
      expect(stored[0]).toMatchObject({ p256dh: 'newkey', auth: 'newauth' });
    });

    it('moves a device to whoever logged in on it last', async () => {
      await subscribe(userA, subscription(1));
      await subscribe(userB, subscription(1));
      const stored = await rows();
      expect(stored).toHaveLength(1);
      expect(stored[0].user_id).toBe(userB.userId);
    });

    it('keeps several devices per user, but no more than 10', async () => {
      for (let n = 1; n <= 12; n++)
        expect((await subscribe(userA, subscription(n))).status).toBe(204);
      const stored = await rows();
      expect(stored).toHaveLength(10);
      // The oldest two went.
      expect(stored.map((r) => r.endpoint)).not.toContain(subscription(1).endpoint);
      expect(stored.map((r) => r.endpoint)).toContain(subscription(12).endpoint);
    });

    it('refuses an endpoint that is not https on a known push service (the server posts to it)', async () => {
      const bad = [
        'http://fcm.googleapis.com/fcm/send/x',
        'https://evil.example.com/hook',
        'https://169.254.169.254/latest/meta-data',
        'https://localhost:6379/',
        'https://fcm.googleapis.com.evil.example/x',
        'https://user:pw@fcm.googleapis.com/x',
        'not a url',
      ];
      for (const endpoint of bad) {
        const res = await subscribe(userA, subscription(1, { endpoint }));
        expect(res.status, endpoint).toBe(400);
      }
      expect(await rows()).toHaveLength(0);
    });

    it('accepts the endpoints Chrome, Firefox, Safari and Edge give out', async () => {
      const good = [
        'https://fcm.googleapis.com/fcm/send/abc',
        'https://updates.push.services.mozilla.com/wpush/v2/abc',
        'https://web.push.apple.com/abc',
        'https://wns2-par02p.notify.windows.com/w/?token=abc',
      ];
      for (const endpoint of good) {
        const res = await subscribe(userA, subscription(1, { endpoint }));
        expect(res.status, endpoint).toBe(204);
      }
    });

    it('refuses missing or oversized keys and a body that is not a subscription', async () => {
      for (const body of [
        {},
        { endpoint: subscription().endpoint },
        { endpoint: subscription().endpoint, keys: { p256dh: 'k' } },
        { endpoint: subscription().endpoint, keys: { p256dh: 'k'.repeat(300), auth: 'a' } },
        { endpoint: `https://fcm.googleapis.com/${'x'.repeat(3000)}`, keys: subscription().keys },
        'nope',
      ]) {
        expect((await subscribe(userA, body)).status).toBe(400);
      }
    });
  });

  describe('unsubscribe', () => {
    it('removes this device only', async () => {
      await subscribe(userA, subscription(1));
      await subscribe(userA, subscription(2));
      const res = await request(app)
        .post('/push/unsubscribe')
        .set(auth(userA))
        .send({ endpoint: subscription(1).endpoint });
      expect(res.status).toBe(204);
      expect((await rows()).map((r) => r.endpoint)).toEqual([subscription(2).endpoint]);
    });

    it("cannot remove someone else's device, and unknown devices are not an error", async () => {
      await subscribe(userA, subscription(1));
      const res = await request(app)
        .post('/push/unsubscribe')
        .set(auth(userB))
        .send({ endpoint: subscription(1).endpoint });
      expect(res.status).toBe(204);
      expect(await rows()).toHaveLength(1);
    });
  });

  it("forgets a user's devices when the user is deleted", async () => {
    const gone = await loginAs(app, 'seeker', String(phone++));
    await subscribe(gone, subscription(9));
    await pool.query('DELETE FROM users WHERE id = $1', [gone.userId]);
    expect(await rows()).toHaveLength(0);
  });
});
