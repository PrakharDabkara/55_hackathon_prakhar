import type { Pool } from 'pg';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadSeedCatalog, seedCatalog } from '../modules/catalog/index.js';
import {
  createRequest,
  findUnpingedRequestIds,
  type RequestsContext,
} from '../modules/requests/index.js';
import { testConfig } from '../testing/config.js';
import { north, ORIGIN } from '../testing/fixtures.js';
import { startPostgres, type TestDatabase } from '../testing/startPostgres.js';
import { startRedis } from '../testing/startRedis.js';
import { waitFor } from '../testing/waitFor.js';
import { startWorkers, type Workers } from './index.js';

const logger = pino({ level: 'silent' });

describe('fan-out recovery by the sweeper', () => {
  let testDb: TestDatabase;
  let pool: Pool;
  let redis: Awaited<ReturnType<typeof startRedis>>;
  let workers: Workers;
  let ctx: RequestsContext;
  let seekerId: string;

  beforeAll(async () => {
    [testDb, redis] = await Promise.all([startPostgres(), startRedis()]);
    pool = testDb.pool;
    await seedCatalog(pool, loadSeedCatalog());
    seekerId = (
      await pool.query(
        `INSERT INTO users (phone, role) VALUES ('+919870000001', 'seeker') RETURNING id`,
      )
    ).rows[0].id;
    await pool.query(
      `INSERT INTO shops (name, phone, categories, location)
       VALUES ('Electrical near', '+910000000000', ARRAY['electrical'],
               ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography)`,
      [ORIGIN.lng, north(0.3)],
    );
    const config = testConfig({ workersEnabled: true, redisUrl: redis.url });
    workers = startWorkers({ config, db: pool, logger, sweepEveryMs: 300 }) as Workers;
    ctx = {
      db: pool,
      logger,
      config: { minStockResults: 3, ttlMinutes: 15, trigramThreshold: 0.4 },
      hooks: workers.hooks,
    };
  }, 300_000);

  afterAll(async () => {
    await workers?.close();
    await testDb?.stop();
    await redis?.stop();
  });

  const pingCount = async (requestId: string) =>
    (await pool.query('SELECT count(*)::int AS n FROM pings WHERE request_id = $1', [requestId]))
      .rows[0].n as number;
  const age = (requestId: string, seconds: number) =>
    pool.query(`UPDATE requests SET created_at = now() - make_interval(secs => $2) WHERE id = $1`, [
      requestId,
      seconds,
    ]);
  const newRequest = async (hooks: boolean, q = 'torch') => {
    const { request } = await createRequest(
      hooks ? ctx : { db: ctx.db, logger: ctx.logger, config: ctx.config },
      seekerId,
      { q, lat: ORIGIN.lat, lng: ORIGIN.lng },
    );
    return request.id;
  };

  it('deleting the fan-out job does not lose the pings: the sweeper re-adds it', async () => {
    await workers.fanout.queue.pause(); // keep the job waiting so we can delete it
    const id = await newRequest(true);
    await workers.fanout.queue.remove(`fanout-${id}`);
    expect(await workers.fanout.queue.getJob(`fanout-${id}`)).toBeUndefined();
    await workers.fanout.queue.resume();

    await age(id, 40);
    const sent = await waitFor(
      () => pingCount(id),
      (n) => n > 0,
    );
    expect(sent).toBe(1);
  });

  it('leaves a request alone for its first 30 seconds, when the normal job may still be on its way', async () => {
    // A different item: the shop was just asked about torches, and the dedupe remembers.
    const id = await newRequest(false, 'tubelight'); // nothing queued at all
    await new Promise((r) => setTimeout(r, 1500)); // several sweeps
    expect(await pingCount(id)).toBe(0);

    await age(id, 31);
    expect(
      await waitFor(
        () => pingCount(id),
        (n) => n > 0,
      ),
    ).toBe(1);
  });

  it('finds only live requests with no pings', async () => {
    const lonely = await newRequest(false);
    const pinged = await newRequest(false);
    const closed = await newRequest(false);
    const expired = await newRequest(false);
    for (const id of [lonely, pinged, closed, expired]) await age(id, 120);
    await pool.query(
      `INSERT INTO pings (request_id, shop_id, item_id, state, sent_at)
       SELECT $1, (SELECT id FROM shops LIMIT 1), item_id, 'SENT', now() FROM requests WHERE id = $1`,
      [pinged],
    );
    await pool.query(`UPDATE requests SET state = 'CLOSED' WHERE id = $1`, [closed]);
    await pool.query(`UPDATE requests SET expires_at = now() - interval '1 second' WHERE id = $1`, [
      expired,
    ]);

    const ids = await findUnpingedRequestIds(pool, 30);
    expect(ids).toContain(lonely);
    expect(ids).not.toContain(pinged);
    expect(ids).not.toContain(closed);
    expect(ids).not.toContain(expired);
  });
});
