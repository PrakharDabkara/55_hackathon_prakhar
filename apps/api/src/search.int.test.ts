import { CATEGORIES } from '@kahanmilega/shared';
import type { Pool } from 'pg';
import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import type { Config } from './config/config.js';
import { loadSeedCatalog, resolveItem, seedCatalog } from './modules/catalog/index.js';
import { REMOVED_TERMS } from './testing/removedTerms.js';
import { findLearnedStock } from './modules/shops/index.js';
import { startPostgres, type TestDatabase } from './testing/startPostgres.js';

const config: Config = {
  nodeEnv: 'test',
  port: 0,
  logLevel: 'silent',
  databaseUrl: 'postgres://unused',
  otpMode: 'simulated',
  trigramThreshold: 0.4,
  redisUrl: null,
  minStockResults: 3,
  requestTtlMinutes: 15,
  maxPingsPerRequest: 10,
  pingDedupeMinutes: 30,
  workersEnabled: false,
  adminPhones: [],
  llmProvider: 'fake',
  geminiApiKey: null,
  geminiModel: 'gemini-3.1-flash-lite',
  geminiEmbedModel: 'gemini-embedding-001',
  embedDim: 768,
  embedThreshold: 0.8,
  embedMargin: 0.03,
  errandMaxItems: 10,
  errandMaxSteps: 8,
  errandTokenBudget: 20_000,
  errandUserHourlyLimit: 5,
  errandTaskMaxChars: 500,
  errandAiTimeoutMs: 30_000,
  errandMaxAskShops: 6,
  errandMaxQuestions: 2,
  errandResumeAfterMs: 45_000,
  errandMaxWaitMs: 300_000,
  errandAnswerTimeoutMs: 600_000,
  errandExpiryMs: 900_000,
  errandResumeDebounceMs: 1000,
  errandFewerStopsMaxExtraPaise: 3000,
  fakeLlmScenario: null,
  geminiFallbackModel: null,
  errandModel: 'gemini-3.1-flash-lite',
  errandFallbackModel: null,
  photoStorageCapMb: 300,
  gitSha: 'test',
};

// A point in Indore (Rajwada). One degree of latitude is ~111 km.
const ORIGIN = { lat: 22.7196, lng: 75.8577 };
const north = (km: number) => ORIGIN.lat + km / 111;

describe('catalog and search', () => {
  let testDb: TestDatabase;
  let pool: Pool;
  let app: ReturnType<typeof createApp>;
  let token: string;
  let userId: string;
  const itemId: Record<string, string> = {};

  beforeAll(async () => {
    testDb = await startPostgres();
    pool = testDb.pool;
    await seedCatalog(pool, loadSeedCatalog());
    const { rows } = await pool.query<{ id: string; slug: string }>('SELECT id, slug FROM items');
    for (const r of rows) itemId[r.slug] = r.id;

    app = createApp({ config, logger: pino({ level: 'silent' }), db: pool });

    // A real login, so the search endpoint is exercised the way a client uses it.
    const phone = '9811100001';
    await request(app).post('/auth/otp/request').send({ phone });
    const inbox = await request(app).get('/dev/otp-inbox').query({ phone });
    const login = await request(app)
      .post('/auth/otp/verify')
      .send({ phone, code: inbox.body.code, role: 'seeker' });
    token = login.body.token;
    userId = login.body.user.id;

    // Shops at known distances, each with wheat-flour stock of a known age.
    const shop = async (name: string, km: number) => {
      const { rows: r } = await pool.query<{ id: string }>(
        `INSERT INTO shops (name, phone, categories, location)
         VALUES ($1, '+910000000000', ARRAY['grocery'],
                 ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography) RETURNING id`,
        [name, ORIGIN.lng, north(km)],
      );
      return (r[0] as { id: string }).id;
    };
    const stock = (
      shopId: string,
      slug: string,
      ageHours: number,
      opts: { hint?: 'few' | 'plenty'; price?: number } = {},
    ) =>
      pool.query(
        `INSERT INTO shop_stock (shop_id, item_id, source, quantity_hint, price_paise,
                                 last_confirmed_at, expires_at)
         VALUES ($1, $2, 'ping_yes', $3, $4,
                 now() - make_interval(hours => $5::int),
                 now() - make_interval(hours => $5::int)
                       + make_interval(days => $6::int))`,
        [
          shopId,
          itemId[slug],
          opts.hint ?? null,
          opts.price ?? null,
          ageHours,
          opts.hint === 'few' ? 3 : 7,
        ],
      );

    await stock(await shop('Near old (0.5 km, 5 days)', 0.5), 'wheat-flour', 5 * 24, {
      hint: 'plenty',
      price: 4500,
    });
    await stock(await shop('Mid today (1.5 km, 2 hours)', 1.5), 'wheat-flour', 2, { price: 4800 });
    await stock(await shop('Mid recent (1.0 km, 2 days)', 1.0), 'wheat-flour', 2 * 24 + 1);
    await stock(await shop('Expired (1.2 km, 8 days)', 1.2), 'wheat-flour', 8 * 24);
    await stock(await shop('Few, expired (0.8 km, 4 days)', 0.8), 'wheat-flour', 4 * 24, {
      hint: 'few',
    });
    await stock(await shop('Far today (3 km, 1 hour)', 3), 'wheat-flour', 1);
    await stock(await shop('Rice only (0.3 km)', 0.3), 'rice', 1);
  }, 300_000);

  afterAll(async () => {
    await testDb?.stop();
  });

  const auth = () => ({ Authorization: `Bearer ${token}` });
  const search = (q: Record<string, string | number>) =>
    request(app)
      .get('/search')
      .set(auth())
      .query({ lat: ORIGIN.lat, lng: ORIGIN.lng, ...q });

  describe('migration 004', () => {
    it('keeps categories, sources, hints and prices inside their allowed values', async () => {
      const insertItem = (category: string) =>
        pool.query(
          `INSERT INTO items (slug, name_en, name_hi, category) VALUES ($1, 'x', 'क', $2)`,
          [`t-${Math.random()}`, category],
        );
      for (const c of CATEGORIES) await expect(insertItem(c)).resolves.toBeDefined();
      await expect(insertItem('pharmacy')).rejects.toThrow();

      const { rows } = await pool.query<{ id: string }>('SELECT id FROM shops LIMIT 1');
      const shopId = (rows[0] as { id: string }).id;
      const insertStock = (source: string, hint: string | null, price: number | null) =>
        pool.query(
          `INSERT INTO shop_stock (shop_id, item_id, source, quantity_hint, price_paise, last_confirmed_at, expires_at)
           VALUES ($1, $2, $3, $4, $5, now(), now() + interval '1 day')`,
          [shopId, itemId['salt'], source, hint, price],
        );
      await expect(insertStock('guess', null, null)).rejects.toThrow();
      await expect(insertStock('seed', 'lots', null)).rejects.toThrow();
      await expect(insertStock('seed', null, -1)).rejects.toThrow();
      await expect(insertStock('seed', 'few', 1250)).resolves.toBeDefined();
      await expect(insertStock('seed', null, null)).rejects.toThrow(); // one row per shop and item
    });

    it('validated the Day 4 category check', async () => {
      const { rows } = await pool.query(
        `SELECT convalidated FROM pg_constraint WHERE conname = 'shops_categories_valid'`,
      );
      expect(rows[0].convalidated).toBe(true);
    });
  });

  describe('seedCatalog', () => {
    it('is idempotent and moves a synonym that changed owner', async () => {
      const before = await pool.query('SELECT count(*)::int AS n FROM item_synonyms');
      const itemsBefore = await pool.query('SELECT count(*)::int AS n FROM items');
      await seedCatalog(pool, loadSeedCatalog());
      const after = await pool.query('SELECT count(*)::int AS n FROM item_synonyms');
      const itemsAfter = await pool.query('SELECT count(*)::int AS n FROM items');
      expect(after.rows[0].n).toBe(before.rows[0].n);
      expect(itemsAfter.rows[0].n).toBe(itemsBefore.rows[0].n);
      expect(itemsAfter.rows[0].n).toBeGreaterThanOrEqual(140);
    });
  });

  describe('resolveItem', () => {
    const resolve = (text: string) => resolveItem(pool, text, { userId, threshold: 0.4 });

    it('resolves English, Devanagari and Hinglish spellings to the same item by exact synonym', async () => {
      for (const text of ['aata', 'आटा', 'gehun ka atta', 'Atta!', 'mujhe aata chahiye']) {
        const r = await resolve(text);
        expect(r.item?.slug, text).toBe('wheat-flour');
        expect(r.matchedBy, text).toBe('synonym');
        expect(r.similarity, text).toBe(1);
      }
    });

    it('resolves misspellings by trigram similarity above the threshold', async () => {
      for (const [text, slug] of [
        ['bottle brsh', 'bottle-brush'],
        ['screwdrivar', 'screwdriver'],
        ['hammmer', 'hammer'],
      ] as const) {
        const r = await resolve(text);
        expect(r.item?.slug, text).toBe(slug);
        expect(r.matchedBy, text).toBe('trigram');
        expect(r.similarity).toBeGreaterThanOrEqual(0.4);
        expect(r.similarity).toBeLessThan(1);
      }
    });

    it('leaves unrelated text unresolved', async () => {
      const r = await resolve('quantum flux capacitor');
      expect(r.item).toBeNull();
      expect(r.matchedBy).toBeNull();
    });

    it('a stricter threshold turns a trigram match into unresolved', async () => {
      const r = await resolveItem(pool, 'bottle brsh', { userId, threshold: 0.99 });
      expect(r.item).toBeNull();
    });

    it('writes one search_queries row per call, with item_id null when unresolved', async () => {
      await pool.query('DELETE FROM search_queries');
      await resolve('aata');
      await resolve('nonsense zzqx');
      const { rows } = await pool.query(
        'SELECT user_id, raw_text, normalised, item_id, matched_by FROM search_queries ORDER BY created_at',
      );
      expect(rows).toHaveLength(2);
      expect(rows[0]).toMatchObject({
        user_id: userId,
        raw_text: 'aata',
        normalised: 'aata',
        item_id: itemId['wheat-flour'],
        matched_by: 'synonym',
      });
      expect(rows[1]).toMatchObject({ raw_text: 'nonsense zzqx', item_id: null, matched_by: null });
    });
  });

  describe('ambiguous terms', () => {
    const resolve = (text: string) => resolveItem(pool, text, { userId, threshold: 0.4 });

    it.each(REMOVED_TERMS)('"%s" on its own resolves to no item', async (term) => {
      const r = await resolve(term);
      expect(r.item?.slug ?? null).toBeNull();
      expect(r.matchedBy).toBeNull();
    });

    it('still resolves the specific forms', async () => {
      for (const [text, slug] of [
        ['paper clip', 'paper-clips'],
        ['nail cutter', 'nail-cutter'],
        ['नेल कटर', 'nail-cutter'],
        ['clothes clips', 'clothes-clips'],
        ['electric switch', 'electric-switch'],
        ['drill bit', 'drill-bits'],
        ['cello tape', 'cello-tape'],
      ] as const) {
        const r = await resolve(text);
        expect(r.item?.slug, text).toBe(slug);
      }
    });

    it('does not let a generic word fuzzy-match one of several items that contain it', async () => {
      for (const word of ['tape', 'brush', 'cable', 'cover', 'oil']) {
        const r = await resolve(word);
        expect(r.item?.slug ?? null, word).toBeNull();
      }
    });
  });

  describe('seedCatalog removals', () => {
    it('deletes a term that is no longer in the file, and keeps the item', async () => {
      const full = loadSeedCatalog();
      const trimmed = {
        ...full,
        items: full.items.map((i) =>
          i.slug === 'wheat-flour'
            ? { ...i, synonyms: i.synonyms.filter((t) => t !== 'chakki atta') }
            : i,
        ),
      };
      const count = async (term: string) =>
        (await pool.query('SELECT count(*)::int AS n FROM item_synonyms WHERE term = $1', [term]))
          .rows[0].n;
      expect(await count('chakki atta')).toBe(1);

      await seedCatalog(pool, trimmed);
      expect(await count('chakki atta')).toBe(0);
      const item = await pool.query(`SELECT 1 FROM items WHERE slug = 'wheat-flour'`);
      expect(item.rowCount).toBe(1);
      expect((await resolveItem(pool, 'chakki atta', { userId, threshold: 0.99 })).item).toBeNull();

      await seedCatalog(pool, full);
      expect(await count('chakki atta')).toBe(1);
    });
  });

  describe('findLearnedStock', () => {
    it('returns live stock within the radius: freshest bucket first, then nearest', async () => {
      const results = await findLearnedStock(
        pool,
        itemId['wheat-flour'] as string,
        ORIGIN.lat,
        ORIGIN.lng,
        2000,
      );
      expect(results.map((r) => r.name)).toEqual([
        'Mid today (1.5 km, 2 hours)',
        'Mid recent (1.0 km, 2 days)',
        'Near old (0.5 km, 5 days)',
      ]);
    });
  });

  describe('GET /search', () => {
    it('resolves "aata" and "आटा" to the same item and lists nearby shops, expired stock excluded', async () => {
      const a = await search({ q: 'aata' });
      const b = await search({ q: 'आटा' });
      expect(a.status).toBe(200);
      expect(a.body.item.slug).toBe('wheat-flour');
      expect(b.body.item.id).toBe(a.body.item.id);
      expect(a.body.matchedBy).toBe('synonym');
      expect(a.body.query).toEqual({ normalised: 'aata' });

      expect(a.body.results.map((r: { name: string }) => r.name)).toEqual([
        'Mid today (1.5 km, 2 hours)',
        'Mid recent (1.0 km, 2 days)',
        'Near old (0.5 km, 5 days)',
      ]);
      const [today, recent, old] = a.body.results;
      expect(today).toMatchObject({
        pricePaise: 4800,
        quantityHint: null,
        freshness: 'Confirmed today',
      });
      expect(recent).toMatchObject({ pricePaise: null, freshness: 'Had it 2 days ago' });
      expect(old).toMatchObject({
        pricePaise: 4500,
        quantityHint: 'plenty',
        freshness: 'Had it 5 days ago',
      });
      expect(today.shopId).toMatch(/^[0-9a-f-]{36}$/);
      expect(today.distanceM).toBeGreaterThan(1450);
      expect(today.distanceM).toBeLessThan(1550);
      expect(new Date(today.lastConfirmedAt).getTime()).toBeLessThan(Date.now());
    });

    it('respects radius_m', async () => {
      const narrow = await search({ q: 'aata', radius_m: 700 });
      expect(narrow.body.results.map((r: { name: string }) => r.name)).toEqual([
        'Near old (0.5 km, 5 days)',
      ]);
      const wide = await search({ q: 'aata', radius_m: 5000 });
      expect(wide.body.results.map((r: { name: string }) => r.name)).toEqual([
        'Mid today (1.5 km, 2 hours)',
        'Far today (3 km, 1 hour)',
        'Mid recent (1.0 km, 2 days)',
        'Near old (0.5 km, 5 days)',
      ]);
    });

    it('returns the typed quantity separately', async () => {
      const res = await search({ q: 'gehun ka aata 5 kilo' });
      expect(res.body.query).toEqual({
        normalised: 'gehun aata',
        quantity: { quantity: 5, unit: 'kg' },
      });
      expect(res.body.item.slug).toBe('wheat-flour');
    });

    it('does not show shops that only stock another item', async () => {
      const res = await search({ q: 'rice' });
      expect(res.body.item.slug).toBe('rice');
      expect(res.body.results.map((r: { name: string }) => r.name)).toEqual(['Rice only (0.3 km)']);
    });

    it('answers an unresolved query with item null and no results, and logs it', async () => {
      await pool.query('DELETE FROM search_queries');
      const res = await search({ q: 'quantum flux capacitor' });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ item: null, matchedBy: null, results: [] });
      const { rows } = await pool.query('SELECT item_id, matched_by, user_id FROM search_queries');
      expect(rows).toEqual([{ item_id: null, matched_by: null, user_id: userId }]);
    });

    it('needs a login, for any role', async () => {
      const res = await request(app).get('/search').query({ q: 'aata', lat: 22.7, lng: 75.8 });
      expect(res.status).toBe(401);
    });

    it('validates the query string', async () => {
      const bad: Record<string, string | number>[] = [
        { q: '' },
        { q: 'aata', lat: 'x' },
        { q: 'aata', lat: 95 },
        { q: 'aata', radius_m: 5001 },
        { q: 'aata', radius_m: 0 },
        { q: 'x'.repeat(201) },
      ];
      for (const params of bad) {
        const res = await request(app)
          .get('/search')
          .set(auth())
          .query({ lat: ORIGIN.lat, lng: ORIGIN.lng, ...params });
        expect(res.status, JSON.stringify(params)).toBe(400);
        expect(res.body.error.code).toBe('invalid_request');
      }
      const noLat = await request(app).get('/search').set(auth()).query({ q: 'aata', lng: 75.8 });
      expect(noLat.status).toBe(400);
    });
  });
});
