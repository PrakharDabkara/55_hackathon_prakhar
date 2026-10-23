import { mkdtempSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../api/src/app.js';
import { loadSeedCatalog, seedCatalog } from '../../api/src/modules/catalog/index.js';
import { createRealtime, type Realtime } from '../../api/src/modules/realtime/index.js';
import { testConfig, TEST_ADMIN_TOKEN } from '../../api/src/testing/config.js';
import { ORIGIN } from '../../api/src/testing/fixtures.js';
import { loginAs } from '../../api/src/testing/login.js';
import { startPostgres, type TestDatabase } from '../../api/src/testing/startPostgres.js';
import { startRedis } from '../../api/src/testing/startRedis.js';
import { waitFor } from '../../api/src/testing/waitFor.js';
import { startWorkers, type Workers } from '../../api/src/workers/index.js';
import { runSimulator, type Simulator } from './simulator.ts';

const quiet = pino({ level: 'silent' });

describe('the simulator against a real API', () => {
  let testDb: TestDatabase;
  let redis: Awaited<ReturnType<typeof startRedis>>;
  let realtime: Realtime;
  let workers: Workers;
  let server: Server;
  let app: ReturnType<typeof createApp>;
  let base: string;
  let phone = 9_870_000_000;
  const stateFile = path.join(mkdtempSync(path.join(tmpdir(), 'sim-e2e-')), 'state.json');
  const running: Simulator[] = [];

  beforeAll(async () => {
    [testDb, redis] = await Promise.all([startPostgres(), startRedis()]);
    await seedCatalog(testDb.pool, loadSeedCatalog());
    const config = testConfig({
      workersEnabled: true,
      redisUrl: redis.url,
      adminToken: TEST_ADMIN_TOKEN,
    });
    realtime = createRealtime({ redisUrl: redis.url, logger: quiet, heartbeatMs: 200 });
    workers = startWorkers({
      config,
      db: testDb.pool,
      logger: quiet,
      events: realtime.events,
    }) as Workers;
    app = createApp({
      config,
      logger: quiet,
      db: testDb.pool,
      requestHooks: workers.hooks,
      realtime,
    });
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }, 300_000);

  afterAll(async () => {
    await Promise.all(running.map((s) => s.stop()));
    server?.closeAllConnections();
    await workers?.close();
    await realtime?.close();
    await testDb?.stop();
    await redis?.stop();
  });

  /**
   * New shops are caught up on every live request (ADR-0038), so requests that earlier tests left
   * running would be asked of them and answered, and counted in the simulator's totals.
   */
  const endLeftoverRequests = () =>
    testDb.pool.query(
      `UPDATE requests SET state = 'CLOSED' WHERE state IN ('OPEN', 'PINGING', 'ANSWERED')`,
    );

  const options = (lines: string[]) => ({
    target: base,
    adminToken: TEST_ADMIN_TOKEN,
    count: 20,
    speed: 2000, // 5-90 s becomes 2.5-45 ms
    seed: 11,
    // Every asked shop answers: this test is about the wiring, not about chance. (Seed 11 makes 5
    // shops that sell flour; with random replies all of them staying quiet was a rare failure.)
    eager: true,
    centre: ORIGIN,
    radiusM: 1500,
    stateFile,
    log: (line: string) => void lines.push(line),
  });
  const simulated = async () =>
    (
      await testDb.pool.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM shops WHERE is_simulated`,
      )
    ).rows[0]?.n;

  it('creates 20 shops, and a request is answered by simulated shops through the real endpoint', async () => {
    const lines: string[] = [];
    const sim = await runSimulator(options(lines));
    running.push(sim);
    expect(await simulated()).toBe(20);
    // The answered path needs shops that carry the item: guaranteed by the fixed seed, and checked.
    const sellers = await testDb.pool.query(
      `SELECT 1 FROM shops WHERE is_simulated AND 'grocery' = ANY(categories)`,
    );
    expect(sellers.rowCount).toBeGreaterThanOrEqual(3);

    const seeker = await loginAs(app, 'seeker', String(phone++));
    const asked = await request(app)
      .post('/requests')
      .set({ Authorization: `Bearer ${seeker.token}` })
      .send({ q: 'aata', lat: ORIGIN.lat, lng: ORIGIN.lng });
    expect(asked.body.state).toBe('PINGING');

    const view = await waitFor(
      async () =>
        (
          await request(app)
            .get(`/requests/${asked.body.id}`)
            .set({ Authorization: `Bearer ${seeker.token}` })
        ).body,
      (b) => b.state === 'ANSWERED',
      20_000,
    );
    expect(view.state).toBe('ANSWERED');

    // The answers are real: stored on pings of simulated shops, with prices near the reference.
    await waitFor(
      async () => sim.stats().answered,
      (n) => n >= 2,
      10_000,
    );
    const { rows } = await testDb.pool.query<{ state: string; price_paise: number | null }>(
      `SELECT p.state, p.price_paise FROM pings p JOIN shops s ON s.id = p.shop_id
        WHERE p.request_id = $1 AND s.is_simulated AND p.state IN ('YES', 'NO')`,
      [asked.body.id],
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows.filter((x) => x.price_paise !== null)) {
      expect(r.price_paise).toBeGreaterThanOrEqual(25000 * 0.7 - 50);
      expect(r.price_paise).toBeLessThanOrEqual(25000 * 1.3 + 50);
    }
    expect(view.results.some((r: { source: string }) => r.source === 'live')).toBe(true);

    // One line per answer. The API stores an answer before the simulator sees the response and
    // logs it, so wait for the simulator to catch up with the rows read above.
    const answerLines = () => lines.filter((l) => /\b(yes|no)\b/.test(l) && /ping/.test(l));
    await waitFor(
      async () => ({ logged: answerLines().length, answered: sim.stats().answered }),
      (s) => s.logged >= rows.length && s.answered >= rows.length,
      10_000,
    );
    expect(answerLines().length).toBeGreaterThanOrEqual(rows.length);
    expect(sim.stats().answered).toBeGreaterThanOrEqual(rows.length);
  }, 60_000);

  it('reuses the shops from the state file instead of making new ones', async () => {
    await Promise.all(running.splice(0).map((s) => s.stop()));
    const before = (await testDb.pool.query(`SELECT id FROM shops WHERE is_simulated ORDER BY id`))
      .rows;
    const lines: string[] = [];
    const sim = await runSimulator(options(lines));
    running.push(sim);
    const after = (await testDb.pool.query(`SELECT id FROM shops WHERE is_simulated ORDER BY id`))
      .rows;
    expect(after).toEqual(before);
    expect(lines.join('\n')).toMatch(/reusing 20 shops/i);
  }, 60_000);

  it('starts over when the state file does not match (more shops asked for)', async () => {
    await Promise.all(running.splice(0).map((s) => s.stop()));
    const lines: string[] = [];
    const sim = await runSimulator({ ...options(lines), count: 25 });
    running.push(sim);
    expect(await simulated()).toBe(25);
    expect(lines.join('\n')).toMatch(/creating 25 shops/i);
  }, 60_000);

  it('stops cleanly on stop(): the stream closes and no more answers are sent', async () => {
    const sim = running[0] as Simulator;
    await waitFor(
      async () => realtime.connectionCount(),
      (n) => n >= 1,
    );
    await sim.stop();
    running.splice(0);
    await waitFor(
      async () => realtime.connectionCount(),
      (n) => n === 0,
      5000,
    );
    expect(realtime.connectionCount()).toBe(0);
    const answered = sim.stats().answered;
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(sim.stats().answered).toBe(answered);
    await sim.stop(); // twice is fine
  }, 60_000);

  it('can be told to make grocery shops only and to answer every ping with a yes', async () => {
    await Promise.all(running.splice(0).map((s) => s.stop()));
    await endLeftoverRequests();
    const sim = await runSimulator({
      ...options([]),
      count: 5,
      seed: 21,
      categories: ['grocery'],
      eager: true,
      stateFile: path.join(path.dirname(stateFile), 'eager.json'),
    });
    running.push(sim);
    const cats = await testDb.pool.query(`SELECT categories FROM shops WHERE is_simulated`);
    expect(cats.rows).toHaveLength(5);
    for (const r of cats.rows) expect(r.categories).toEqual(['grocery']);

    const seeker = await loginAs(app, 'seeker', String(phone++));
    const asked = await request(app)
      .post('/requests')
      .set({ Authorization: `Bearer ${seeker.token}` })
      .send({ q: 'namak', lat: ORIGIN.lat, lng: ORIGIN.lng });
    expect(asked.body.state).toBe('PINGING');
    // This request's own pings, not the simulator's running totals: catch-up pings for other
    // requests (and their answers) count in `stats()` too.
    const mine = () =>
      testDb.pool
        .query<{ state: string }>(`SELECT state FROM pings WHERE request_id = $1`, [asked.body.id])
        .then((r) => r.rows.map((p) => p.state));
    const states = await waitFor(
      mine,
      (rows) => rows.length >= 5 && rows.every((state) => state === 'YES'),
      30_000,
    );
    expect(states).toEqual(['YES', 'YES', 'YES', 'YES', 'YES']);
    expect(sim.stats()).toMatchObject({ no: 0, skipped: 0 });
  }, 60_000);

  it('explains itself when the server refuses the admin token', async () => {
    let message = '';
    try {
      await runSimulator({
        ...options([]),
        adminToken: `${TEST_ADMIN_TOKEN}x`,
        stateFile: path.join(path.dirname(stateFile), 'other.json'),
      });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/ADMIN_TOKEN/);
    expect(message).not.toContain(TEST_ADMIN_TOKEN);
  }, 60_000);

  it("a shop outside the item's category says no, a shop inside it says yes (every shop answers)", async () => {
    await Promise.all(running.splice(0).map((s) => s.stop()));
    await endLeftoverRequests();
    const lines: string[] = [];
    const sim = await runSimulator({
      ...options(lines),
      count: 12,
      seed: 31,
      categories: ['hardware', 'stationery'],
      eager: true,
      stateFile: path.join(path.dirname(stateFile), 'categories.json'),
    });
    running.push(sim);
    const seeker = await loginAs(app, 'seeker', String(phone++));
    const ask = async (q: string) =>
      (
        await request(app)
          .post('/requests')
          .set({ Authorization: `Bearer ${seeker.token}` })
          .send({ q, lat: ORIGIN.lat, lng: ORIGIN.lng })
      ).body.id as string;
    const answers = async (requestId: string, wanted: number) => {
      await waitFor(
        async () =>
          (
            await testDb.pool.query(
              `SELECT 1 FROM pings WHERE request_id = $1 AND state IN ('YES', 'NO')`,
              [requestId],
            )
          ).rowCount,
        (n) => (n ?? 0) >= wanted,
        15_000,
      );
      return (
        await testDb.pool.query<{ state: string; categories: string[] }>(
          `SELECT p.state, s.categories FROM pings p JOIN shops s ON s.id = p.shop_id
            WHERE p.request_id = $1 AND p.state IN ('YES', 'NO')`,
          [requestId],
        )
      ).rows;
    };

    // Flour is a grocery item and there is no grocery shop: the nearest shops are asked anyway,
    // and each of them, having no flour, says no.
    const flour = await answers(await ask('aata'), 3);
    expect(flour.length).toBeGreaterThanOrEqual(3);
    for (const row of flour) {
      expect(row.categories).not.toContain('grocery');
      expect(row.state).toBe('NO');
    }

    // Chart paper is a stationery item: the stationery shops say yes, the others say no.
    const paper = await answers(await ask('chart paper'), 3);
    const inside = paper.filter((r) => r.categories.includes('stationery'));
    expect(inside.length).toBeGreaterThanOrEqual(1);
    for (const row of inside) expect(row.state).toBe('YES');
    for (const row of paper.filter((r) => !r.categories.includes('stationery')))
      expect(row.state).toBe('NO');
  }, 60_000);
  it('takes a fresh order for a simulated shop (starts ACCEPTED), sets it out, and the customer confirms receipt', async () => {
    await Promise.all(running.splice(0).map((s) => s.stop()));
    await endLeftoverRequests();
    const lines: string[] = [];
    const sim = await runSimulator({
      ...options(lines),
      count: 20,
      seed: 31,
      eager: true,
      stateFile: path.join(path.dirname(stateFile), 'orders.json'),
    });
    running.push(sim);
    const auth = (u: { token: string }) => ({ Authorization: `Bearer ${u.token}` });
    const seeker = await loginAs(app, 'seeker', String(phone++));
    const asked = await request(app)
      .post('/requests')
      .set(auth(seeker))
      .send({ q: 'aata', lat: ORIGIN.lat, lng: ORIGIN.lng });
    const answered = await waitFor(
      async () =>
        (
          await testDb.pool.query<{ shop_id: string }>(
            `SELECT p.shop_id FROM pings p JOIN shops s ON s.id = p.shop_id
              WHERE p.request_id = $1 AND p.state = 'YES' AND s.is_simulated LIMIT 1`,
            [asked.body.id],
          )
        ).rows[0],
      (row) => row !== undefined,
      20_000,
    );
    // Make that shop's yes a delivery offer, as a shop that says "Ghar bhej denge" would have.
    await testDb.pool.query(
      `UPDATE pings SET delivers = true, delivery_fee_paise = 2000, delivery_minutes = 30
        WHERE request_id = $1 AND shop_id = $2`,
      [asked.body.id, answered?.shop_id],
    );
    const placed = await request(app).post('/orders').set(auth(seeker)).send({
      shopId: answered?.shop_id,
      requestId: asked.body.id,
      addressText: 'Flat 4B, Sapna Apartments, Vijay Nagar',
    });
    expect(placed.status).toBe(201);

    const seen: string[] = [];
    await waitFor(
      async () => {
        const state = (await request(app).get(`/orders/${placed.body.id}`).set(auth(seeker))).body
          .state as string;
        if (seen.at(-1) !== state) seen.push(state);
        return state;
      },
      (state) => state === 'OUT_FOR_DELIVERY',
      30_000,
    );
    // The shop no longer marks it delivered: only the customer's Received does (Delivery v2).
    const received = await request(app)
      .post(`/orders/${placed.body.id}/received`)
      .set(auth(seeker));
    expect(received.body.state).toBe('DELIVERED');
    expect(placed.body.state).toBe('ACCEPTED');
    expect(seen).not.toContain('DECLINED');
    // One line per step, and the simulator never saw the address: it is told an id and a shop.
    const orderLines = lines.filter((l) => /order/i.test(l));
    expect(orderLines.join('\n')).toMatch(/out for delivery/);
    expect(orderLines.join('\n')).not.toMatch(/marked delivered|moved .* delivered/);
    expect(lines.join('')).not.toContain('Sapna');
  }, 60_000);

  it('answers a shopping-list parchi line by line, with (list h/t) in the log (ADR-0055)', async () => {
    await Promise.all(running.splice(0).map((s) => s.stop()));
    await endLeftoverRequests();
    const lines: string[] = [];
    const sim = await runSimulator({
      ...options(lines),
      count: 6,
      seed: 41,
      categories: ['grocery'],
      eager: true,
      stateFile: path.join(path.dirname(stateFile), 'lists.json'),
    });
    running.push(sim);
    const seeker = await loginAs(app, 'seeker', String(phone++));
    const auth = { Authorization: `Bearer ${seeker.token}` };
    const sorted = await request(app)
      .post('/lists/sort')
      .set(auth)
      .send({ lines: ['chini', 'namak', 'tractor spare bolt'] });
    expect(sorted.status).toBe(201);
    const sent = await request(app)
      .post(`/lists/${sorted.body.id}/send`)
      .set(auth)
      .send({ lat: ORIGIN.lat, lng: ORIGIN.lng });
    expect(sent.body.shopsAsked).toBeGreaterThanOrEqual(3);

    const view = await waitFor(
      async () => (await request(app).get(`/lists/${sorted.body.id}`).set(auth)).body,
      (b) => b.shopsAnswered >= b.shopsAsked,
      30_000,
    );
    expect(view.shopsAnswered).toBe(view.shopsAsked);
    // Every answer is whole rupees per line, and a line a shop has carries a price.
    const stored = await testDb.pool.query<{ have: boolean; price_paise: number | null }>(
      `SELECT lpl.have, lpl.price_paise FROM list_ping_lines lpl
         JOIN list_pings lp ON lp.id = lpl.list_ping_id WHERE lp.list_id = $1`,
      [sorted.body.id],
    );
    expect(stored.rowCount).toBeGreaterThan(0);
    for (const r of stored.rows) {
      expect(r.have).not.toBeNull();
      if (r.have) expect((r.price_paise as number) % 100).toBe(0);
      else expect(r.price_paise).toBeNull();
    }
    const listLines = lines.filter((l) => /\(list \d+\/\d+\)/.test(l));
    expect(listLines.length).toBeGreaterThanOrEqual(view.shopsAsked);
    expect(listLines[0]).toMatch(/shop [0-9a-f]{8} {2}(yes|no) .*ping [0-9a-f]{8} {2}\+/);
  }, 60_000);
});
