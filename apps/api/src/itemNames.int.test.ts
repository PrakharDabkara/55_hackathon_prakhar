import type { Pool } from 'pg';
import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { createAi, createFakeProvider, type FakeProvider } from './modules/ai/index.js';
import { loadSeedCatalog, seedCatalog } from './modules/catalog/index.js';
import { testConfig } from './testing/config.js';
import { ORIGIN } from './testing/fixtures.js';
import { loginAs } from './testing/login.js';
import { startPostgres, type TestDatabase } from './testing/startPostgres.js';
import { truncateKeepingShops } from './testing/truncate.js';

const logger = pino({ level: 'silent' });

// App round 3 (C-11): "Samsung A4 phone" answered 422 in 46 ms with no AI call and the screen said
// "We couldn't understand that item". The cause is a code rule (phones are out of scope, ADR-0028),
// and it now says what it is. Everyday names with digits and punctuation reach the classifier.
describe('item names with letters and digits (round 3 C-11)', () => {
  let testDb: TestDatabase;
  let pool: Pool;
  let app: ReturnType<typeof createApp>;
  let provider: FakeProvider;
  let seeker: { token: string; userId: string };

  beforeAll(async () => {
    testDb = await startPostgres();
    pool = testDb.pool;
    await seedCatalog(pool, loadSeedCatalog());
    provider = createFakeProvider();
    const ai = createAi({
      provider,
      db: pool,
      logger,
      embedThreshold: 0.8,
      embedMargin: 0.05,
      limiter: { allow: async () => true },
      client: { backoffMs: 1, retries: 0 },
    });
    app = createApp({ config: testConfig(), logger, db: pool, ai });
    seeker = await loginAs(app, 'seeker', '9860000001');
  }, 300_000);
  afterAll(async () => {
    await testDb?.stop();
  });
  beforeEach(async () => {
    await truncateKeepingShops(pool, 'requests, pings, new_item_attempts, query_cache');
    await pool.query(`DELETE FROM items WHERE source = 'user'`);
    provider.calls.length = 0;
    provider.onGenerate(({ purpose }) =>
      purpose === 'classify_item'
        ? { verdict: 'allowed', confidence: 'high', category: 'grocery' }
        : { itemId: null, needsClarification: false },
    );
  });

  const ask = (q: string) =>
    request(app)
      .post('/requests')
      .set({ Authorization: `Bearer ${seeker.token}` })
      .send({ q, lat: ORIGIN.lat, lng: ORIGIN.lng, asTyped: true });

  it('says a phone is out of scope (not "unresolved"), without asking any model', async () => {
    const res = await ask('Samsung A4 phone');
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('item_out_of_scope');
    expect(res.body.error.message).toMatch(/phones/i);
    expect(provider.calls).toEqual([]);
  });

  it.each(['Walnuts, 500g', 'AA batteries x4', 'No. 2 pencil'])(
    'accepts %s as a product and reaches the classifier',
    async (name) => {
      const res = await ask(name);
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(provider.calls.map((c) => c.purpose)).toContain('classify_item');
    },
  );
});
