import type { Pool } from 'pg';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadSeedCatalog, seedCatalog } from '../modules/catalog/index.js';
import { startPostgres, type TestDatabase } from '../testing/startPostgres.js';
import { startRedis } from '../testing/startRedis.js';
import { startRequestExpiry, type RequestExpiry } from './requestExpiry.js';

const logger = pino({ level: 'silent' });

async function waitFor<T>(
  read: () => Promise<T>,
  done: (value: T) => boolean,
  ms = 15_000,
): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await read();
    if (done(value) || Date.now() > deadline) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

describe('request expiry worker', () => {
  let testDb: TestDatabase;
  let pool: Pool;
  let redis: Awaited<ReturnType<typeof startRedis>>;
  let userId: string;
  let itemId: string;
  const running: RequestExpiry[] = [];

  beforeAll(async () => {
    [testDb, redis] = await Promise.all([startPostgres(), startRedis()]);
    pool = testDb.pool;
    await seedCatalog(pool, loadSeedCatalog());
    itemId = (
      (await pool.query(`SELECT id FROM items WHERE slug = 'wheat-flour'`)).rows[0] as {
        id: string;
      }
    ).id;
    userId = (
      await pool.query(
        `INSERT INTO users (phone, role) VALUES ('+919833300001', 'seeker') RETURNING id`,
      )
    ).rows[0].id;
  }, 300_000);

  afterAll(async () => {
    await Promise.all(running.map((r) => r.close()));
    await testDb?.stop();
    await redis?.stop();
  });

  // A fresh queue name per test keeps one test's jobs out of the next.
  const start = (sweepEveryMs = 60_000) => {
    const handle = startRequestExpiry({
      redisUrl: redis.url,
      db: pool,
      logger,
      sweepEveryMs,
      queueName: `request-expiry-${Math.random().toString(36).slice(2)}`,
    });
    running.push(handle);
    return handle;
  };

  /** A request in `state` whose deadline is `inMs` from now (negative: already overdue). */
  async function insertRequest(
    inMs: number,
    state = 'PINGING',
  ): Promise<{ id: string; expiresAt: Date }> {
    const { rows } = await pool.query(
      `INSERT INTO requests (user_id, item_id, raw_query, location, radius_m, state, version, expires_at)
       VALUES ($1, $2, 'aata', ST_SetSRID(ST_MakePoint(75.8577, 22.7196), 4326)::geography, 2000, $3, 1,
               now() + make_interval(secs => $4::double precision))
       RETURNING id, expires_at`,
      [userId, itemId, state, inMs / 1000],
    );
    return { id: rows[0].id, expiresAt: rows[0].expires_at };
  }
  const stateOf = async (id: string) =>
    (await pool.query('SELECT state FROM requests WHERE id = $1', [id])).rows[0].state as string;
  const eventReason = async (id: string) =>
    (await pool.query('SELECT reason FROM request_events WHERE request_id = $1', [id])).rows[0]
      ?.reason;

  it('a delayed job expires the request when its deadline passes', async () => {
    const expiry = start();
    const req = await insertRequest(1500);
    await expiry.schedule(req.id, req.expiresAt);

    expect(await stateOf(req.id)).toBe('PINGING');
    const state = await waitFor(
      () => stateOf(req.id),
      (s) => s !== 'PINGING',
    );
    expect(state).toBe('EXPIRED');
    expect(await eventReason(req.id)).toBe('queue');
  });

  it('the job id is expire-<requestId>, so scheduling twice adds one job', async () => {
    const expiry = start();
    const req = await insertRequest(60_000);
    await expiry.schedule(req.id, req.expiresAt);
    await expiry.schedule(req.id, req.expiresAt);
    const jobs = await expiry.queue.getDelayed();
    expect(jobs.filter((j) => j.id === `expire-${req.id}`)).toHaveLength(1);
  });

  it('with the job lost, the sweeper still expires an overdue request', async () => {
    const expiry = start(200);
    const req = await insertRequest(1000);
    await expiry.schedule(req.id, req.expiresAt);
    await expiry.queue.remove(`expire-${req.id}`);
    // The repeatable sweeper is itself a delayed job; only the expire job must be gone.
    const left = (await expiry.queue.getDelayed()).filter((j) => j.name === 'expire');
    expect(left).toHaveLength(0);

    const state = await waitFor(
      () => stateOf(req.id),
      (s) => s !== 'PINGING',
    );
    expect(state).toBe('EXPIRED');
    expect(await eventReason(req.id)).toBe('sweeper');
  });

  it('the sweeper closes overdue ANSWERED requests and leaves live and finished ones alone', async () => {
    const expiry = start();
    const answered = await insertRequest(-1000, 'ANSWERED');
    const live = await insertRequest(60_000);
    const closed = await insertRequest(-1000, 'CLOSED');
    await expiry.sweepNow();

    expect(await stateOf(answered.id)).toBe('CLOSED');
    expect(await stateOf(live.id)).toBe('PINGING');
    expect(await stateOf(closed.id)).toBe('CLOSED');
    expect(await eventReason(closed.id)).toBeUndefined();
  });

  it('a job that fires for a request already finished does nothing', async () => {
    const expiry = start();
    const req = await insertRequest(500);
    await pool.query(`UPDATE requests SET state = 'CLOSED' WHERE id = $1`, [req.id]);
    await expiry.schedule(req.id, req.expiresAt);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(await stateOf(req.id)).toBe('CLOSED');
    expect(await eventReason(req.id)).toBeUndefined();
  });

  it('closes cleanly', async () => {
    const expiry = start();
    await expect(expiry.close()).resolves.toBeUndefined();
  });
});
