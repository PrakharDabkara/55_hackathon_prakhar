import type { Pool } from 'pg';
import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { createAi, createFakeProvider, type AiContext } from './modules/ai/index.js';
import {
  CATALOG_VERSION,
  loadSeedCatalog,
  resolveItem,
  seedCatalog,
} from './modules/catalog/index.js';
import { DIM, setEmbeddings, vec } from './testing/aiFixtures.js';
import { testConfig } from './testing/config.js';
import { ORIGIN } from './testing/fixtures.js';
import { loginAs } from './testing/login.js';
import { startPostgres, type TestDatabase } from './testing/startPostgres.js';
import { truncateKeepingShops } from './testing/truncate.js';

// Day 17, PR H: the app says what it understood before it asks any shop (ADR-0036), and a word
// that only names a modifier of a longer term ("phool" in "phool jhadu") is never that item.
describe('understanding the customer before any ping', () => {
  let testDb: TestDatabase;
  let pool: Pool;
  let app: ReturnType<typeof createApp>;
  let ai: AiContext;
  let seeker: { token: string; userId: string };
  const lines: Record<string, unknown>[] = [];
  const logger = pino({ level: 'info' }, { write: (line: string) => lines.push(JSON.parse(line)) });
  const provider = createFakeProvider({ dim: DIM });
  const ids: Record<string, string> = {};
  const auth = (u: { token: string }) => ({ Authorization: `Bearer ${u.token}` });

  beforeAll(async () => {
    testDb = await startPostgres();
    pool = testDb.pool;
    await seedCatalog(pool, loadSeedCatalog());
    const { rows } = await pool.query<{ id: string; slug: string }>('SELECT id, slug FROM items');
    for (const r of rows) ids[r.slug] = r.id;
    ai = createAi({
      provider,
      db: pool,
      logger: pino({ level: 'silent' }),
      embedThreshold: 0.8,
      embedMargin: 0.05,
      limiter: { allow: async () => true },
      client: { backoffMs: 1, retries: 0 },
    });
    app = createApp({ config: testConfig(), logger, db: pool, ai });
    seeker = await loginAs(app, 'seeker', '9893000001');
  }, 300_000);
  afterAll(async () => {
    await testDb?.stop();
  });
  beforeEach(async () => {
    await truncateKeepingShops(
      pool,
      'query_cache, suggested_synonyms, ai_calls, search_queries, requests',
    );
    await pool.query('UPDATE items SET embedding = NULL, embedding_source_hash = NULL');
    await pool.query(`DELETE FROM items WHERE source = 'user'`);
    await pool.query('TRUNCATE new_item_attempts');
    provider.calls.length = 0;
    lines.length = 0;
    provider.onEmbed((texts) => texts.map(() => vec({ 1: 1 })));
    provider.onGenerate(({ purpose }) =>
      purpose === 'classify_item'
        ? { verdict: 'allowed', confidence: 'high', category: 'pooja' }
        : { itemId: null, needsClarification: false },
    );
  });

  const resolve = (q: string, extra: { openCatalog?: object } = {}) =>
    resolveItem(pool, q, { threshold: 0.4, ai, userId: seeker.userId, ...extra });
  const ask = (body: Record<string, unknown>) =>
    request(app)
      .post('/requests')
      .set(auth(seeker))
      .send({ lat: ORIGIN.lat, lng: ORIGIN.lng, ...body });
  const events = (name: string) => lines.filter((l) => l['event'] === name);

  describe('a word that is only a modifier of a longer term', () => {
    it('"phool" is not the broom, even when the embedding step ranks the broom first', async () => {
      await setEmbeddings(pool, { broom: vec({ 1: 1 }) });
      const r = await resolve('phool');
      expect(r.item).toBeNull();
      expect(r.ambiguous).toBeUndefined();
    });

    it('does not trust an answer cached before the rule (phool → broom)', async () => {
      await pool.query(
        `INSERT INTO query_cache (normalised, item_id, method, catalog_version, expires_at)
         VALUES ('phool', $1, 'llm', '${CATALOG_VERSION}', now() + interval '1 day')`,
        [ids['broom']],
      );
      expect((await resolve('phool')).item).toBeNull();
    });

    it('never offers the broom to the model for "phool"', async () => {
      await setEmbeddings(pool, { broom: vec({ 1: 1 }), 'gel-pen': vec({ 1: 0.9, 2: 0.4 }) });
      let shortlist = '';
      provider.onGenerate(({ user }) => {
        shortlist = String(user);
        return { itemId: null, needsClarification: false };
      });
      await resolve('phool');
      expect(shortlist).not.toContain(ids['broom']);
    });

    it('"phool" becomes a flower item in the pooja category through the open catalog', async () => {
      const r = await resolve('phool', { openCatalog: {} });
      expect(r).toMatchObject({
        matchedBy: 'new_item',
        item: { category: 'pooja', unverified: true },
      });
      expect(r.item?.slug).not.toBe('broom');
    });

    it('a plain search still needs "high" confidence to make a new item', async () => {
      provider.onGenerate(({ purpose }) =>
        purpose === 'classify_item'
          ? { verdict: 'allowed', confidence: 'medium', category: 'pooja' }
          : { itemId: null, needsClarification: false },
      );
      expect((await resolve('rangoli stencil', { openCatalog: {} })).item).toBeNull();
    });

    it('"phool jhadu" is still the broom, by its exact synonym', async () => {
      expect(await resolve('phool jhadu')).toMatchObject({
        matchedBy: 'synonym',
        item: { slug: 'broom' },
      });
    });
  });

  describe('everyday words that mean several items go to the question, not to a guess', () => {
    it.each([
      ['mirchi', ['red-chilli-powder', 'green-chilli', 'black-pepper']],
      ['mirch', ['red-chilli-powder', 'green-chilli', 'black-pepper']],
      ['daal', ['toor-dal', 'moong-dal', 'chana-dal', 'urad-dal', 'masoor-dal']],
      ['dal', ['toor-dal', 'moong-dal', 'chana-dal', 'urad-dal', 'masoor-dal']],
      ['tel', ['refined-oil', 'mustard-oil', 'hair-oil']],
      ['oil', ['refined-oil', 'mustard-oil', 'hair-oil']],
    ])('"%s" asks which one, with no model call', async (word, slugs) => {
      const r = await resolve(word);
      expect(r.item).toBeNull();
      expect(r.ambiguous?.options.map((o) => o.itemId).sort()).toEqual(
        slugs.map((s) => ids[s]).sort(),
      );
      expect(provider.calls).toEqual([]);
    });

    it('a more specific phrase is still answered straight', async () => {
      for (const [q, slug] of [
        ['hari mirchi', 'green-chilli'],
        ['lal mirch powder', 'red-chilli-powder'],
        ['kali mirch', 'black-pepper'],
        ['sarson ka tel', 'mustard-oil'],
      ] as const)
        expect(await resolve(q), q).toMatchObject({ item: { slug } });
    });
  });

  describe('brand names never fuzzy-match a similar-spelled generic item', () => {
    it.each([
      ['maggi', 'noodles'],
      ['harpic', 'toilet-cleaner'],
      ['fevicol', 'wood-glue'],
    ])('"%s" is %s by its own synonym', async (q, slug) => {
      expect(await resolve(q)).toMatchObject({ matchedBy: 'synonym', item: { slug } });
    });

    it('"mentos" is not turned into a catalog item by letter overlap', async () => {
      const r = await resolve('mentos');
      expect(r.item).toBeNull();
      expect(r.matchedBy).toBeNull();
    });
  });

  describe('"Kya aapka matlab…?": POST /requests before any ping', () => {
    it('lets an exact synonym straight through', async () => {
      const res = await ask({ q: 'aata' });
      expect(res.status).toBe(201);
      expect(events('understanding_shown')).toEqual([]);
    });

    it.each([
      ['a typo the trigram step is sure about', 'bottle brsh', 'bottle brush'],
      ['a generic word with a usual item', 'pen', 'ball pen'],
    ])('asks first for %s, and creates nothing', async (_name, q, nameEn) => {
      const res = await ask({ q });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('item_confirm');
      const { item, alternatives } = res.body.error;
      expect(item).toEqual({
        itemId: expect.any(String),
        nameEn,
        nameHi: expect.stringMatching(/[ऀ-ॿ]/),
      });
      expect(alternatives.length).toBeLessThanOrEqual(2);
      for (const a of alternatives) {
        expect(a).toEqual({
          itemId: expect.any(String),
          nameEn: expect.any(String),
          nameHi: expect.any(String),
        });
        expect(a.itemId).not.toBe(item.itemId);
      }
      expect((await pool.query('SELECT 1 FROM requests')).rowCount).toBe(0);
      expect((await pool.query('SELECT 1 FROM pings')).rowCount).toBe(0);
    });

    it('asks first for a cached model answer too: only an exact name or synonym goes straight', async () => {
      await pool.query(
        `INSERT INTO query_cache (normalised, item_id, method, catalog_version, expires_at)
         VALUES ('zzcache', $1, 'llm', '${CATALOG_VERSION}', now() + interval '1 day')`,
        [ids['sugar']],
      );
      const res = await ask({ q: 'zzcache' });
      expect(res.status).toBe(422);
      expect(res.body.error).toMatchObject({
        code: 'item_confirm',
        item: { itemId: ids['sugar'] },
      });
    });

    it('gives up to two other candidates the customer can pick instead', async () => {
      const res = await ask({ q: 'bottle brsh' });
      expect(res.body.error.alternatives.length).toBeGreaterThan(0);
      const other = res.body.error.alternatives[0].itemId as string;
      const picked = await ask({ q: 'bottle brsh', itemId: other, understanding: 'changed' });
      expect(picked.status).toBe(201);
      expect(picked.body.item.id).toBe(other);
    });

    it('goes ahead when the customer says "Haan, yahi" (the item id is sent)', async () => {
      const first = await ask({ q: 'bottle brsh' });
      const res = await ask({
        q: 'bottle brsh',
        itemId: first.body.error.item.itemId,
        understanding: 'confirmed',
      });
      expect(res.status).toBe(201);
      expect(res.body.state).toBe('PINGING');
    });

    it('asks the same way for a word with several meanings, and shows the question first', async () => {
      const res = await ask({ q: 'mirchi' });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('item_ambiguous');
      expect(res.body.error.options.length).toBeGreaterThanOrEqual(2);
      expect(events('understanding_shown')).toHaveLength(1);
    });

    it('counts how often the question is shown and how often the customer changes the answer', async () => {
      const shown = await ask({ q: 'bottle brsh' });
      const itemId = shown.body.error.item.itemId as string;
      const other = shown.body.error.alternatives[0].itemId as string;
      await ask({ q: 'bottle brsh', itemId, understanding: 'confirmed' });
      await ask({ q: 'bottle brsh', itemId: other, understanding: 'changed' });
      await ask({ q: 'kuch aur', itemId: other, understanding: 'changed' });
      expect(events('understanding_shown')).toHaveLength(1);
      expect(events('understanding_confirmed')).toHaveLength(1);
      expect(events('understanding_changed')).toHaveLength(2);
      for (const l of [
        ...events('understanding_shown'),
        ...events('understanding_confirmed'),
        ...events('understanding_changed'),
      ])
        expect(l['req']).toMatchObject({ id: expect.any(String) });
    });

    it('rejects an unknown value for `understanding`', async () => {
      const res = await ask({ q: 'aata', understanding: 'maybe' });
      expect(res.status).toBe(400);
    });

    it('still answers item_unresolved for text nothing fits', async () => {
      const res = await ask({ q: 'zzqx plmk' });
      expect(res.body.error.code).toBe('item_unresolved');
    });
  });
});
