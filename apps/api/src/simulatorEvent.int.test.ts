import type { Pool } from 'pg';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadSeedCatalog, seedCatalog } from './modules/catalog/index.js';
import { createRequest, fanOutPings, type RequestsContext } from './modules/requests/index.js';
import type { RealtimeEvent } from './modules/realtime/index.js';
import { north, ORIGIN } from './testing/fixtures.js';
import { startPostgres, type TestDatabase } from './testing/startPostgres.js';

const logger = pino({ level: 'silent' });

// The simulator answers as its shop would: it needs the shop's categories and the item's.
describe('the ping event a simulated shop gets', () => {
  let testDb: TestDatabase;
  let pool: Pool;
  beforeAll(async () => {
    testDb = await startPostgres();
    pool = testDb.pool;
    await seedCatalog(pool, loadSeedCatalog());
  }, 300_000);
  afterAll(async () => {
    await testDb?.stop();
  });

  it("carries the item's categories and the shop's own, and nothing about the customer", async () => {
    const seeker = (
      await pool.query(
        `INSERT INTO users (phone, role) VALUES ('+919870000777', 'seeker') RETURNING id`,
      )
    ).rows[0].id as string;
    await pool.query(
      `INSERT INTO shops (name, phone, categories, location, is_simulated)
       VALUES ('Sim Hardware', '+916000000001', ARRAY['hardware','electrical'],
               ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, true)`,
      [ORIGIN.lng, north(0.2)],
    );
    const ctx: RequestsContext = {
      db: pool,
      logger,
      config: { minStockResults: 3, ttlMinutes: 15, trigramThreshold: 0.4 },
    };
    // Hardware is not a grocery shop, but with too few grocery shops near it is asked anyway.
    const { request } = await createRequest(ctx, seeker, {
      q: 'haldi',
      lat: ORIGIN.lat,
      lng: ORIGIN.lng,
    });
    const events: RealtimeEvent[] = [];
    await fanOutPings(
      {
        db: pool,
        logger,
        config: { maxPings: 10 },
        events: { publish: (e: RealtimeEvent) => void events.push(e) },
      },
      request.id,
      { claim: async () => true, release: async () => undefined },
    );
    const sim = events.find((e) => 'admin' in e.to && e.type === 'ping.created');
    expect(sim).toBeDefined();
    const data = sim?.data as Record<string, unknown>;
    expect(data['shopCategories']).toEqual(['hardware', 'electrical']);
    expect(data['itemCategories']).toEqual(expect.arrayContaining(['grocery']));
    expect(JSON.stringify(data)).not.toContain(seeker);
    expect(data).not.toHaveProperty('lat');
  });
});
