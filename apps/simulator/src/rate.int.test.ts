import { mkdtempSync, writeFileSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../api/src/app.js';
import { createMemoryStore, type IpLimitStore } from '../../api/src/http/ipLimit.js';
import { loadSeedCatalog, seedCatalog } from '../../api/src/modules/catalog/index.js';
import { createRealtime, type Realtime } from '../../api/src/modules/realtime/index.js';
import { testConfig, TEST_ADMIN_TOKEN } from '../../api/src/testing/config.js';
import { ORIGIN } from '../../api/src/testing/fixtures.js';
import { loginAs } from '../../api/src/testing/login.js';
import { startPostgres, type TestDatabase } from '../../api/src/testing/startPostgres.js';
import { startRedis } from '../../api/src/testing/startRedis.js';
import { startWorkers, type Workers } from '../../api/src/workers/index.js';
import { runSimulator, type Simulator } from './simulator.ts';

// A measurement, not a regression test: `MEASURE_SIM_RATE=1 npx vitest run apps/simulator/src/rate.int.test.ts`.
// How many API calls per minute does the simulator make from its one address (PR SEC2, ADR-0059)?
const quiet = pino({ level: 'silent' });
const DURATION_MS = 180_000;

describe.skipIf(!process.env['MEASURE_SIM_RATE'])(
  'simulator request rate (10 shops, 3 minutes)',
  () => {
    let testDb: TestDatabase;
    let redis: Awaited<ReturnType<typeof startRedis>>;
    let realtime: Realtime;
    let workers: Workers;
    let server: Server;
    let sim: Simulator;
    const hits: { at: number; key: string }[] = [];

    beforeAll(async () => {
      [testDb, redis] = await Promise.all([startPostgres(), startRedis()]);
      await seedCatalog(testDb.pool, loadSeedCatalog());
      const config = testConfig({
        workersEnabled: true,
        redisUrl: redis.url,
        adminToken: TEST_ADMIN_TOKEN,
        rateLimitScale: 1000, // never refuse: this measures what is asked for
      });
      realtime = createRealtime({ redisUrl: redis.url, logger: quiet, heartbeatMs: 20_000 });
      workers = startWorkers({
        config,
        db: testDb.pool,
        logger: quiet,
        events: realtime.events,
      }) as Workers;
      const memory = createMemoryStore();
      const counting: IpLimitStore = {
        hit(key, windowMs) {
          if (key.startsWith('rl:api:')) hits.push({ at: Date.now(), key });
          return memory.hit(key, windowMs);
        },
      };
      const app = createApp({
        config,
        logger: quiet,
        db: testDb.pool,
        requestHooks: workers.hooks,
        realtime,
        ipLimitStore: counting,
      });
      server = app.listen(0);
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      sim = await runSimulator({
        target: base,
        adminToken: TEST_ADMIN_TOKEN,
        count: 10,
        speed: 1, // real reply times, 5 to 90 seconds
        seed: 11,
        eager: true, // every asked shop answers: the busiest a demo gets
        centre: ORIGIN,
        radiusM: 1500,
        stateFile: path.join(mkdtempSync(path.join(tmpdir(), 'sim-rate-')), 'state.json'),
        log: () => undefined,
      });
    }, 300_000);

    afterAll(async () => {
      await sim?.stop();
      server?.closeAllConnections();
      await workers?.close();
      await realtime?.close();
      await testDb?.stop();
      await redis?.stop();
    });

    it(
      'reports the busiest minute',
      async () => {
        const app = server; // supertest talks to the same server, from another address
        const customerIp = '203.0.113.9';
        const as = (token: string) => ({
          Authorization: `Bearer ${token}`,
          'X-Forwarded-For': customerIp,
        });
        const seeker = await loginAs(app, 'seeker', '9860000001');
        const started = Date.now();
        const items = ['aata', 'chini', 'doodh', 'chai patti', 'namak', 'tel', 'dal', 'rice'];
        let n = 0;
        const ask = async (body: Record<string, unknown>) =>
          (
            await request(app)
              .post('/requests')
              .set(as(seeker.token))
              .send({ lat: ORIGIN.lat, lng: ORIGIN.lng, ...body })
          ).body;

        const address = (
          await request(app)
            .put('/orders/saved-address')
            .set(as(seeker.token))
            .send({ addressText: 'Flat 4B, Sapna Apartments, Vijay Nagar, Indore' })
        ).body.id as string;

        let listSent = false;
        let ordered = false;
        let pending: string | null = null;
        while (Date.now() - started < DURATION_MS) {
          const t = Date.now() - started;
          // A single request every 12 seconds.
          if (t >= n * 12_000) {
            const delivery = n === 2;
            const sent = await ask({
              q: items[n % items.length],
              ...(delivery && { wantsDelivery: true, deliveryAddressId: address }),
            });
            if (delivery) pending = sent.id as string;
            n += 1;
          }
          // One list at 40 s.
          if (!listSent && t > 40_000) {
            listSent = true;
            const sorted = await request(app)
              .post('/lists/sort')
              .set(as(seeker.token))
              .send({ lines: ['aata', 'chini', 'doodh'] });
            await request(app)
              .post(`/lists/${sorted.body.id}/send`)
              .set(as(seeker.token))
              .send({ lat: ORIGIN.lat, lng: ORIGIN.lng });
          }
          // One delivery order at 80 s (a customer then follows it until it is delivered).
          if (!ordered && pending && t > 80_000) {
            const view = (await request(app).get(`/requests/${pending}`).set(as(seeker.token)))
              .body;
            const offer = (view.results ?? []).find((r: { delivery?: unknown }) => r.delivery);
            if (offer) {
              ordered = true;
              await request(app).post('/orders').set(as(seeker.token)).send({
                shopId: offer.shopId,
                requestId: pending,
                addressText: 'Flat 4B, Sapna Apartments, Vijay Nagar, Indore',
              });
            }
          }
          // The customer screen polls every ~3 s, in the app and on the same laptop.
          await request(app).get('/requests').set(as(seeker.token));
          await new Promise((r) => setTimeout(r, 3000));
        }

        const byKey = new Map<string, number[]>();
        for (const h of hits) byKey.set(h.key, [...(byKey.get(h.key) ?? []), h.at]);
        const report = [...byKey].map(([key, times]) => {
          let peak = 0;
          for (const [i, at] of times.entries()) {
            const inWindow = times.filter((x, j) => j >= i && x < at + 60_000).length;
            peak = Math.max(peak, inWindow);
          }
          return { key, total: times.length, peakPerMinute: peak };
        });
        const out = JSON.stringify({
          requestsAsked: n,
          listSent,
          ordered,
          stats: sim.stats(),
          report,
        });
        console.log('SIM_RATE', out);
        // vitest may swallow console output of a long test: a file is the sure way out.
        if (process.env['MEASURE_SIM_OUT']) writeFileSync(process.env['MEASURE_SIM_OUT'], out);
        expect(report.length).toBeGreaterThan(0);
      },
      DURATION_MS + 120_000,
    );
  },
);
