import type { Pool } from 'pg';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadSeedCatalog, seedCatalog } from './modules/catalog/index.js';
import { createRequest, fanOutPings, type RequestsContext } from './modules/requests/index.js';
import { north, ORIGIN } from './testing/fixtures.js';
import { startPostgres, type TestDatabase } from './testing/startPostgres.js';

const logger = pino({ level: 'silent' });

describe('fan-out backfill', () => {
  let testDb: TestDatabase;
  let pool: Pool;
  let ctx: RequestsContext;
  let seekerId: string;
  /** Electrical shops 0.1, 0.2 ... km north of the origin, nearest first. */
  const shops: { id: string; km: number }[] = [];

  beforeAll(async () => {
    testDb = await startPostgres();
    pool = testDb.pool;
    await seedCatalog(pool, loadSeedCatalog());
    seekerId = (
      await pool.query(
        `INSERT INTO users (phone, role) VALUES ('+919860000001', 'seeker') RETURNING id`,
      )
    ).rows[0].id;
    ctx = {
      db: pool,
      logger,
      config: { minStockResults: 3, ttlMinutes: 15, trigramThreshold: 0.4 },
    };
    for (let i = 1; i <= 13; i++) {
      const km = i / 10;
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO shops (name, phone, categories, location)
         VALUES ($1, '+910000000000', ARRAY['electrical'],
                 ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography) RETURNING id`,
        [`Electrical ${i}`, ORIGIN.lng, north(km)],
      );
      shops.push({ id: (rows[0] as { id: string }).id, km });
    }
  }, 300_000);

  afterAll(async () => {
    await testDb?.stop();
  });

  async function pingingRequest() {
    const { request } = await createRequest(ctx, seekerId, {
      q: 'torch',
      lat: ORIGIN.lat,
      lng: ORIGIN.lng,
      radiusM: 5000,
    });
    expect(request.state).toBe('PINGING');
    return request.id;
  }
  const pinged = async (requestId: string) =>
    (await pool.query('SELECT shop_id FROM pings WHERE request_id = $1', [requestId])).rows.map(
      (r) => r.shop_id as string,
    );
  const refusing = (refused: Set<string>) => {
    const asked: string[] = [];
    return {
      asked,
      claim: async (shopId: string) => {
        asked.push(shopId);
        return !refused.has(shopId);
      },
      release: async () => undefined,
    };
  };
  const deps = (maxPings: number) => ({ db: pool, logger, config: { maxPings } });

  it('when the dedupe refuses the 3 nearest of 13 shops, pings go to shops 4 to 13: still 10', async () => {
    const id = await pingingRequest();
    const claims = refusing(new Set(shops.slice(0, 3).map((s) => s.id)));

    const result = await fanOutPings(deps(10), id, claims);

    expect(result.sent).toBe(10);
    expect((await pinged(id)).sort()).toEqual(
      shops
        .slice(3, 13)
        .map((s) => s.id)
        .sort(),
    );
  });

  it('stops asking once the cap is reached', async () => {
    const id = await pingingRequest();
    const claims = refusing(new Set());
    await fanOutPings(deps(4), id, claims);
    expect(claims.asked).toEqual(shops.slice(0, 4).map((s) => s.id));
  });

  it('considers at most 3 times the cap, then gives up', async () => {
    const id = await pingingRequest();
    const claims = refusing(new Set(shops.map((s) => s.id))); // everyone was pinged recently
    const result = await fanOutPings(deps(2), id, claims);
    expect(result.sent).toBe(0);
    expect(claims.asked).toEqual(shops.slice(0, 6).map((s) => s.id)); // 3 x 2
    expect(await pinged(id)).toEqual([]);
  });

  it('sends fewer than the cap when the candidates run out', async () => {
    const id = await pingingRequest();
    // Only 13 shops exist and the cap is 20: all but the 3 refused get a ping.
    const claims = refusing(new Set(shops.slice(0, 3).map((s) => s.id)));
    const result = await fanOutPings(deps(20), id, claims);
    expect(result.sent).toBe(10);
  });
});
