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
import { testConfig } from '../../api/src/testing/config.js';
import { ORIGIN } from '../../api/src/testing/fixtures.js';
import { loginAs } from '../../api/src/testing/login.js';
import { startPostgres, type TestDatabase } from '../../api/src/testing/startPostgres.js';
import { startRedis } from '../../api/src/testing/startRedis.js';
import { waitFor } from '../../api/src/testing/waitFor.js';
import { startWorkers, type Workers } from '../../api/src/workers/index.js';
import { runSimulator, type Simulator } from './simulator.ts';

const ADMIN_PHONE = '9810000200';
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
      // A second admin: a phone may ask for only 3 login codes per 10 minutes.
      adminPhones: [`+91${ADMIN_PHONE}`, '+919810000202'],
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

  const options = (lines: string[]) => ({
    target: base,
    adminPhone: ADMIN_PHONE,
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

    // One line per answer.
    const answerLines = lines.filter((l) => /\b(yes|no)\b/.test(l) && /ping/.test(l));
    expect(answerLines.length).toBeGreaterThanOrEqual(rows.length);
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
    const sim = await runSimulator({
      ...options([]),
      adminPhone: '9810000202',
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
    await waitFor(
      async () => sim.stats().answered,
      (n) => n >= 5,
      15_000,
    );
    expect(sim.stats()).toMatchObject({ yes: 5, no: 0, skipped: 0 });
  }, 60_000);

  it('explains itself when the phone is not an admin', async () => {
    await expect(
      runSimulator({
        ...options([]),
        adminPhone: '9810000201',
        stateFile: path.join(path.dirname(stateFile), 'other.json'),
      }),
    ).rejects.toThrow(/ADMIN_PHONES/);
  }, 60_000);
});
