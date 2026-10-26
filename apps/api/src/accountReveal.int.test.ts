import { Writable } from 'node:stream';
import type { Pool } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { createLogger } from './logger.js';
import { createRealtime } from './modules/realtime/index.js';
import { testConfig } from './testing/config.js';
import { loginAs } from './testing/login.js';
import { startPostgres, type TestDatabase } from './testing/startPostgres.js';

const PHONE = '9876543217';

// App round 3 (A-09, an exception to ADR-0054 decision 5): the owner can ask for their own full
// number, one explicit request at a time. It is never cached, never logged and rate limited.
describe('POST /account/phone/reveal', () => {
  let testDb: TestDatabase;
  let pool: Pool;
  let app: ReturnType<typeof createApp>;
  const lines: string[] = [];

  beforeAll(async () => {
    testDb = await startPostgres();
    pool = testDb.pool;
    const sink = new Writable({
      write(chunk, _enc, done) {
        lines.push(String(chunk));
        done();
      },
    });
    const logger = createLogger('trace', sink);
    app = createApp({
      config: testConfig(),
      logger,
      db: pool,
      realtime: createRealtime({ redisUrl: null, logger }),
    });
  }, 300_000);
  afterAll(async () => {
    await testDb?.stop();
  });

  const reveal = (token?: string, body: object = {}) =>
    request(app)
      .post('/account/phone/reveal')
      .set(token ? { Authorization: `Bearer ${token}` } : {})
      .send(body);

  it('gives the owner their full number, formatted, and says never to store it', async () => {
    const me = await loginAs(app, 'seeker', PHONE);
    const res = await reveal(me.token);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ phone: '+91 98765 43217' });
    expect(res.headers['cache-control']).toMatch(/no-store/);
  });

  it('needs a login, takes no body, and has no way to ask for somebody else', async () => {
    const me = await loginAs(app, 'seeker', '9876543218');
    expect((await reveal()).status).toBe(401);
    expect((await reveal(me.token, { userId: 'someone-else' })).status).toBe(400);
    const other = await loginAs(app, 'shop', '9876543219');
    expect((await reveal(other.token)).body).toEqual({ phone: '+91 98765 43219' });
    expect((await reveal(me.token)).body).toEqual({ phone: '+91 98765 43218' });
  });

  it('the Account route still only ever returns the partly hidden number', async () => {
    const me = await loginAs(app, 'seeker', '9876543210');
    const res = await request(app)
      .get('/account')
      .set({ Authorization: `Bearer ${me.token}` });
    expect(res.body.phoneMasked).toBe('+91 98••• ••210');
    expect(JSON.stringify(res.body)).not.toMatch(/9876543210|98765 43210/);
  });

  it('is limited to 10 tries an hour per person, and the refusal is not cached either', async () => {
    const me = await loginAs(app, 'seeker', '9876543211');
    for (let i = 0; i < 10; i++) expect((await reveal(me.token)).status).toBe(200);
    const refused = await reveal(me.token);
    expect(refused.status).toBe(429);
    expect(refused.body.error.code).toBe('rate_limited');
    expect(refused.headers['cache-control']).toMatch(/no-store/);
    expect(JSON.stringify(refused.body)).not.toMatch(/9876543211/);
    // Somebody else is not affected.
    const you = await loginAs(app, 'seeker', '9876543212');
    expect((await reveal(you.token)).status).toBe(200);
  });

  it('never writes a revealed number to a log, in any form', async () => {
    const me = await loginAs(app, 'seeker', '9876543213');
    await reveal(me.token);
    await reveal(me.token, { extra: 1 });
    const all = lines.join('\n');
    expect(all).toContain('/account/phone/reveal');
    for (const form of ['9876543213', '98765 43213', '98765-43213', '+919876543213']) {
      expect(all, form).not.toContain(form);
    }
  });
});
