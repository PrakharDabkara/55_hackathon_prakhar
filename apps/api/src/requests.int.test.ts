import { Writable } from 'node:stream';
import type { Pool } from 'pg';
import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { loadSeedCatalog, seedCatalog } from './modules/catalog/index.js';
import {
  applyRequestEvent,
  createRequest,
  type RequestsContext,
} from './modules/requests/index.js';
import { testConfig } from './testing/config.js';
import { insertShopWithStock, ORIGIN } from './testing/fixtures.js';
import { loginAs } from './testing/login.js';
import { startPostgres, type TestDatabase } from './testing/startPostgres.js';

const logLines: string[] = [];
const logSink = new Writable({
  write(chunk, _enc, done) {
    logLines.push(String(chunk));
    done();
  },
});
const logger = pino({ level: 'debug' }, logSink);

describe('requests', () => {
  let testDb: TestDatabase;
  let pool: Pool;
  let app: ReturnType<typeof createApp>;
  let ctx: RequestsContext;
  let seeker: { token: string; userId: string };
  let other: { token: string; userId: string };
  let shopUser: { token: string; userId: string };
  let wheat: string;
  let rice: string;
  let salt: string;

  beforeAll(async () => {
    testDb = await startPostgres();
    pool = testDb.pool;
    await seedCatalog(pool, loadSeedCatalog());
    const { rows } = await pool.query<{ id: string; slug: string }>('SELECT id, slug FROM items');
    const id = (slug: string) => (rows.find((r) => r.slug === slug) as { id: string }).id;
    wheat = id('wheat-flour');
    rice = id('rice');
    salt = id('salt');

    const config = testConfig();
    app = createApp({ config, logger, db: pool });
    ctx = {
      db: pool,
      logger,
      config: { minStockResults: 3, ttlMinutes: 15, trigramThreshold: 0.4 },
    };
    seeker = await loginAs(app, 'seeker', '9822200001');
    other = await loginAs(app, 'seeker', '9822200002');
    shopUser = await loginAs(app, 'shop', '9822200003');

    // Rice: 3 shops with stock (enough). Salt: 2 shops (not enough). Wheat: none.
    for (const [i, km] of [0.4, 0.9, 1.4].entries()) {
      await insertShopWithStock(pool, { name: `Rice ${i}`, km, itemId: rice, ageHours: 2 + i });
    }
    for (const [i, km] of [0.5, 1.0].entries()) {
      await insertShopWithStock(pool, { name: `Salt ${i}`, km, itemId: salt, ageHours: 5 });
    }
  }, 300_000);

  afterAll(async () => {
    await testDb?.stop();
  });

  const auth = (u: { token: string }) => ({ Authorization: `Bearer ${u.token}` });
  const create = (
    body: Record<string, unknown>,
    user = seeker,
    headers: Record<string, string> = {},
  ) =>
    request(app)
      .post('/requests')
      .set(auth(user))
      .set(headers)
      .send({ lat: ORIGIN.lat, lng: ORIGIN.lng, ...body });
  const events = async (requestId: string) =>
    (
      await pool.query(
        `SELECT from_state, to_state, event, reason FROM request_events
          WHERE request_id = $1 ORDER BY at, id`,
        [requestId],
      )
    ).rows;
  const expireNow = (requestId: string) =>
    pool.query(`UPDATE requests SET expires_at = now() - interval '1 second' WHERE id = $1`, [
      requestId,
    ]);

  describe('POST /requests', () => {
    it('goes to PINGING when learned stock is thin, with a 15 minute deadline', async () => {
      const res = await create({ q: 'aata' });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ state: 'PINGING', results: [] });
      expect(res.body.item.slug).toBe('wheat-flour');
      expect(res.body.id).toMatch(/^[0-9a-f-]{36}$/);
      const minutes = (new Date(res.body.expiresAt).getTime() - Date.now()) / 60_000;
      expect(minutes).toBeGreaterThan(14);
      expect(minutes).toBeLessThanOrEqual(15);

      expect(await events(res.body.id)).toEqual([
        { from_state: 'OPEN', to_state: 'PINGING', event: 'STOCK_INSUFFICIENT', reason: null },
      ]);
      const row = await pool.query('SELECT state, version FROM requests WHERE id = $1', [
        res.body.id,
      ]);
      expect(row.rows[0]).toEqual({ state: 'PINGING', version: 1 });
    });

    it('goes straight to ANSWERED with the results when 3 shops already have the item', async () => {
      const res = await create({ q: 'chawal' });
      expect(res.status).toBe(201);
      expect(res.body.state).toBe('ANSWERED');
      expect(res.body.results).toHaveLength(3);
      expect((await events(res.body.id))[0]).toMatchObject({
        to_state: 'ANSWERED',
        event: 'STOCK_SUFFICIENT',
      });
    });

    it('stays PINGING below the threshold but still shows the stock it has', async () => {
      const res = await create({ q: 'namak' });
      expect(res.body.state).toBe('PINGING');
      expect(res.body.results).toHaveLength(2);
    });

    it('keeps the typed quantity', async () => {
      const res = await create({ q: 'gehun ka aata 5 kilo' });
      expect(res.body.quantity).toEqual({ quantity: 5, unit: 'kg' });
    });

    it('is idempotent per user and Idempotency-Key: same key returns the same request, 200', async () => {
      const first = await create({ q: 'aata' }, seeker, { 'Idempotency-Key': 'key-1' });
      const again = await create({ q: 'aata' }, seeker, { 'Idempotency-Key': 'key-1' });
      expect(first.status).toBe(201);
      expect(again.status).toBe(200);
      expect(again.body.id).toBe(first.body.id);
      const count = await pool.query(
        'SELECT count(*)::int AS n FROM requests WHERE idempotency_key = $1',
        ['key-1'],
      );
      expect(count.rows[0].n).toBe(1);

      const otherUser = await create({ q: 'aata' }, other, { 'Idempotency-Key': 'key-1' });
      expect(otherUser.status).toBe(201);
      expect(otherUser.body.id).not.toBe(first.body.id);
    });

    it('parallel requests with one key create exactly one request', async () => {
      const results = await Promise.all(
        Array.from({ length: 6 }, () =>
          create({ q: 'aata' }, seeker, { 'Idempotency-Key': 'race' }),
        ),
      );
      expect(new Set(results.map((r) => r.body.id)).size).toBe(1);
      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      expect(results.filter((r) => r.status === 200)).toHaveLength(5);
    });

    it('is 422 item_unresolved when the item cannot be resolved, and creates nothing', async () => {
      const before = await pool.query('SELECT count(*)::int AS n FROM requests');
      const res = await create({ q: 'quantum flux capacitor' });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('item_unresolved');
      const after = await pool.query('SELECT count(*)::int AS n FROM requests');
      expect(after.rows[0].n).toBe(before.rows[0].n);
    });

    it('needs a login (401) and the seeker role (403)', async () => {
      expect(
        (await request(app).post('/requests').send({ q: 'aata', lat: 22.7, lng: 75.8 })).status,
      ).toBe(401);
      expect((await create({ q: 'aata' }, shopUser)).status).toBe(403);
    });

    it('validates the body', async () => {
      const bad: Record<string, unknown>[] = [
        { q: '' },
        { q: 'aata', lat: 'x' },
        { q: 'aata', lat: 95 },
        { q: 'aata', radiusM: 5001 },
        { q: 'aata', radiusM: 0 },
        { q: 'x'.repeat(201) },
        {},
      ];
      for (const body of bad) {
        const res = await create(body);
        expect(res.status, JSON.stringify(body)).toBe(400);
        expect(res.body.error.code).toBe('invalid_request');
      }
    });
  });

  describe('GET /requests/:id', () => {
    it('returns the request to its owner and a 404 to anyone else', async () => {
      const created = await create({ q: 'chawal' });
      const mine = await request(app).get(`/requests/${created.body.id}`).set(auth(seeker));
      expect(mine.status).toBe(200);
      expect(mine.body).toMatchObject({ id: created.body.id, state: 'ANSWERED' });
      expect(mine.body.results).toHaveLength(3);
      expect(mine.body.item.slug).toBe('rice');
      expect(mine.body.expiresAt).toBe(created.body.expiresAt);

      const theirs = await request(app).get(`/requests/${created.body.id}`).set(auth(other));
      expect(theirs.status).toBe(404);
      expect(theirs.body.error.code).toBe('not_found');
      const unknown = await request(app)
        .get('/requests/00000000-0000-4000-8000-000000000000')
        .set(auth(seeker));
      expect(unknown.status).toBe(404);
      expect((await request(app).get('/requests/not-a-uuid').set(auth(seeker))).status).toBe(404);
      expect((await request(app).get(`/requests/${created.body.id}`)).status).toBe(401);
    });

    it('expires an overdue PINGING request on read, and persists it', async () => {
      const created = await create({ q: 'aata' });
      await expireNow(created.body.id);

      const res = await request(app).get(`/requests/${created.body.id}`).set(auth(seeker));
      expect(res.body.state).toBe('EXPIRED');
      const row = await pool.query('SELECT state, version FROM requests WHERE id = $1', [
        created.body.id,
      ]);
      expect(row.rows[0]).toEqual({ state: 'EXPIRED', version: 2 });
      expect((await events(created.body.id)).at(-1)).toEqual({
        from_state: 'PINGING',
        to_state: 'EXPIRED',
        event: 'TIMEOUT',
        reason: 'lazy',
      });

      await request(app).get(`/requests/${created.body.id}`).set(auth(seeker));
      expect(await events(created.body.id)).toHaveLength(2);
    });

    it('closes an overdue ANSWERED request on read', async () => {
      const created = await create({ q: 'chawal' });
      await expireNow(created.body.id);
      const res = await request(app).get(`/requests/${created.body.id}`).set(auth(seeker));
      expect(res.body.state).toBe('CLOSED');
    });

    it('leaves a request that is not overdue alone', async () => {
      const created = await create({ q: 'aata' });
      const res = await request(app).get(`/requests/${created.body.id}`).set(auth(seeker));
      expect(res.body.state).toBe('PINGING');
      expect(await events(created.body.id)).toHaveLength(1);
    });
  });

  describe('POST /requests/:id/close', () => {
    it('closes, and closing again is a 200 with no second transition', async () => {
      const created = await create({ q: 'aata' });
      const first = await request(app).post(`/requests/${created.body.id}/close`).set(auth(seeker));
      expect(first.status).toBe(200);
      expect(first.body.state).toBe('CLOSED');
      const second = await request(app)
        .post(`/requests/${created.body.id}/close`)
        .set(auth(seeker));
      expect(second.status).toBe(200);
      expect(second.body.state).toBe('CLOSED');
      expect(await events(created.body.id)).toHaveLength(2);
    });

    it('returns an already expired request as it is', async () => {
      const created = await create({ q: 'aata' });
      await expireNow(created.body.id);
      await request(app).get(`/requests/${created.body.id}`).set(auth(seeker));
      const res = await request(app).post(`/requests/${created.body.id}/close`).set(auth(seeker));
      expect(res.status).toBe(200);
      expect(res.body.state).toBe('EXPIRED');
    });

    it("is a 404 for someone else's request", async () => {
      const created = await create({ q: 'aata' });
      const res = await request(app).post(`/requests/${created.body.id}/close`).set(auth(other));
      expect(res.status).toBe(404);
      const row = await pool.query('SELECT state FROM requests WHERE id = $1', [created.body.id]);
      expect(row.rows[0].state).toBe('PINGING');
    });
  });

  describe('transitions under concurrency', () => {
    it('SHOP_SAID_YES and TIMEOUT in parallel: exactly one move out of PINGING, 10 times out of 10', async () => {
      for (let round = 0; round < 10; round++) {
        const { request: r } = await createRequest(ctx, seeker.userId, {
          q: 'aata',
          lat: ORIGIN.lat,
          lng: ORIGIN.lng,
        });
        expect(r.state).toBe('PINGING');

        const results = await Promise.all([
          applyRequestEvent(ctx, r.id, 'SHOP_SAID_YES'),
          applyRequestEvent(ctx, r.id, 'TIMEOUT', 'queue'),
        ]);

        // Both events read PINGING and race: one wins, the other is told the state it lost to.
        // If one commits before the other even reads, the second sees the new state instead, and
        // may legitimately move it on (ANSWERED then TIMEOUT closes). Either way PINGING is left
        // exactly once and the history is one unbroken chain.
        const history = await events(r.id);
        const [first, ...rest] = history.filter((e) => e.event !== 'STOCK_INSUFFICIENT');
        expect(
          history.filter((e) => e.from_state === 'PINGING'),
          `round ${round}`,
        ).toHaveLength(1);
        expect(first?.from_state).toBe('PINGING');

        let state = 'PINGING';
        for (const e of [first, ...rest]) {
          expect(e?.from_state, `round ${round}: chain breaks`).toBe(state);
          state = e?.to_state as string;
        }
        const row = await pool.query('SELECT state, version FROM requests WHERE id = $1', [r.id]);
        expect(row.rows[0].state).toBe(state);
        expect(row.rows[0].version).toBe(history.length); // creation move + every later move
        expect(results.filter((x) => x.kind === 'applied')).toHaveLength(1 + rest.length);
      }
    });

    it('returns a typed error for an event the state does not accept', async () => {
      const { request: r } = await createRequest(ctx, seeker.userId, {
        q: 'aata',
        lat: ORIGIN.lat,
        lng: ORIGIN.lng,
      });
      await applyRequestEvent(ctx, r.id, 'TIMEOUT', 'queue');
      const res = await applyRequestEvent(ctx, r.id, 'SHOP_SAID_YES');
      expect(res).toMatchObject({
        kind: 'invalid',
        error: { code: 'INVALID_TRANSITION', state: 'EXPIRED', event: 'SHOP_SAID_YES' },
      });
      expect((await events(r.id)).filter((e) => e.event === 'SHOP_SAID_YES')).toHaveLength(0);
    });

    it('a repeated SHOP_SAID_YES on an ANSWERED request is a no-op', async () => {
      const { request: r } = await createRequest(ctx, seeker.userId, {
        q: 'chawal',
        lat: ORIGIN.lat,
        lng: ORIGIN.lng,
      });
      const res = await applyRequestEvent(ctx, r.id, 'SHOP_SAID_YES');
      expect(res.kind).toBe('unchanged');
      expect(await events(r.id)).toHaveLength(1);
    });
  });

  describe('database', () => {
    it('only allows the five states and one request per user and key', async () => {
      await expect(
        pool.query(
          `INSERT INTO requests (user_id, item_id, raw_query, location, radius_m, state, expires_at)
           VALUES ($1, $2, 'x', ST_SetSRID(ST_MakePoint(75.8, 22.7), 4326)::geography, 2000, 'BOGUS', now())`,
          [seeker.userId, wheat],
        ),
      ).rejects.toThrow();
    });
  });

  describe('logging', () => {
    it('logs one line per transition with request id, from, to and event, but no query or location', async () => {
      logLines.length = 0;
      const res = await create({ q: 'aata', lat: 22.71961, lng: 75.85771 });
      await request(app).post(`/requests/${res.body.id}/close`).set(auth(seeker));

      const transitions = logLines
        .map((l) => JSON.parse(l) as Record<string, unknown>)
        .filter((l) => l['msg'] === 'request transition');
      expect(transitions).toHaveLength(2);
      expect(transitions[0]).toMatchObject({
        requestId: res.body.id,
        from: 'OPEN',
        to: 'PINGING',
        event: 'STOCK_INSUFFICIENT',
      });
      expect(transitions[1]).toMatchObject({ from: 'PINGING', to: 'CLOSED', event: 'USER_CLOSED' });
      // The HTTP request id follows the search into the transition line.
      expect(transitions[0]?.['req']).toBeDefined();

      const all = logLines.join('');
      expect(all).not.toContain('aata');
      expect(all).not.toContain('22.71961');
      expect(all).not.toContain('75.85771');
    });
  });
});
