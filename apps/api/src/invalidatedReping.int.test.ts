import type { Pool } from 'pg';
import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { loadSeedCatalog, seedCatalog } from './modules/catalog/index.js';
import {
  createRequest,
  fanOutPings,
  type PingClaims,
  type RequestsContext,
} from './modules/requests/index.js';
import { createRealtime } from './modules/realtime/index.js';
import { testConfig } from './testing/config.js';
import { north, ORIGIN } from './testing/fixtures.js';
import { loginAs } from './testing/login.js';
import { startPostgres, type TestDatabase } from './testing/startPostgres.js';

const quiet = pino({ level: 'silent' });

/** The Redis window of PING_DEDUPE_MINUTES, in memory: a shop asked about an item is not asked again. */
function windowClaims(): PingClaims & { held: Set<string> } {
  const held = new Set<string>();
  return {
    held,
    claim: async (shopId, itemId) => {
      const key = `${shopId}-${itemId}`;
      if (held.has(key)) return false;
      held.add(key);
      return true;
    },
    release: async (shopId, itemId) => void held.delete(`${shopId}-${itemId}`),
  };
}

// Live bug (PR H): after "Wahan nahi tha" a new search did not ping the shop, because the shop had
// been asked inside the dedupe window. The wrong answer is hidden; the shop is still asked.
describe('a shop whose answer a customer called wrong is asked again', () => {
  let testDb: TestDatabase;
  let pool: Pool;
  let app: ReturnType<typeof createApp>;
  let ctx: RequestsContext;
  let seeker: { token: string; userId: string };
  let owner: { token: string; userId: string };
  let shopId: string;
  const claims = windowClaims();
  const auth = (u: { token: string }) => ({ Authorization: `Bearer ${u.token}` });

  beforeAll(async () => {
    testDb = await startPostgres();
    pool = testDb.pool;
    await seedCatalog(pool, loadSeedCatalog());
    app = createApp({
      config: testConfig(),
      logger: quiet,
      db: pool,
      realtime: createRealtime({ redisUrl: null, logger: quiet }),
    });
    ctx = {
      db: pool,
      logger: quiet,
      config: { minStockResults: 3, ttlMinutes: 15, trigramThreshold: 0.4 },
    };
    seeker = await loginAs(app, 'seeker', '9895000001');
    owner = await loginAs(app, 'shop', '9895000002');
    const made = await request(app)
      .post('/shops')
      .set(auth(owner))
      .send({ name: 'Dobara Kirana', lat: north(0.3), lng: ORIGIN.lng, categories: ['grocery'] });
    shopId = made.body.id as string;
  }, 300_000);
  afterAll(async () => {
    await testDb?.stop();
  });

  const search = async () => {
    const { request: r } = await createRequest(ctx, seeker.userId, {
      q: 'chini',
      lat: ORIGIN.lat,
      lng: ORIGIN.lng,
    });
    return r;
  };
  const fan = (requestId: string) =>
    fanOutPings({ db: pool, logger: quiet, config: { maxPings: 10 } }, requestId, claims);
  const pingsOf = async (requestId: string) =>
    (await pool.query(`SELECT id, shop_id FROM pings WHERE request_id = $1`, [requestId])).rows;

  it('hides the invalidated answer but pings the shop on the next search, once', async () => {
    // 1. The shop is asked, says yes, and is remembered.
    const first = await search();
    expect(first.state).toBe('PINGING');
    expect(await fan(first.id)).toMatchObject({ sent: 1 });
    const ping = (await pingsOf(first.id))[0];
    const yes = await request(app)
      .post(`/pings/${ping?.id}/answer`)
      .set(auth(owner))
      .send({ answer: 'yes', pricePaise: 4500 });
    expect(yes.status).toBe(200);

    // 2. The customer walks there, and it was not there.
    expect(
      (
        await request(app).post('/pickups').set(auth(seeker)).send({
          shopId,
          itemId: first.item?.id,
          requestId: first.id,
        })
      ).status,
    ).toBe(204);
    await pool.query(`UPDATE pickup_visits SET created_at = now() - interval '20 minutes'`);
    const visit = (await request(app).get('/pickups/pending').set(auth(seeker))).body[0];
    await request(app)
      .post(`/pickups/${visit.id}/answer`)
      .set(auth(seeker))
      .send({ answer: 'not_there' })
      .expect(204);

    // 3. A new search: nothing is shown as stock, and the shop (still inside the dedupe window)
    // is asked again.
    const second = await search();
    expect(second.state).toBe('PINGING');
    expect(second.results).toEqual([]);
    expect(await fan(second.id)).toMatchObject({ sent: 1 });
    expect((await pingsOf(second.id)).map((p) => p.shop_id)).toEqual([shopId]);

    // 4. Asked once is enough: a third search before it answers does not ask again.
    const third = await search();
    expect(await fan(third.id)).toMatchObject({ sent: 0 });

    // 5. Its fresh answer replaces the invalidated one.
    const again = (await pingsOf(second.id))[0];
    await request(app)
      .post(`/pings/${again?.id}/answer`)
      .set(auth(owner))
      .send({ answer: 'yes', pricePaise: 4600 })
      .expect(200);
    const fourth = await search();
    expect(fourth.results).toHaveLength(1);
    expect(await fan(fourth.id)).toMatchObject({ sent: 0 });
  });
});
