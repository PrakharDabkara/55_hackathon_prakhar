import type { Pool } from 'pg';
import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { createAi, createFakeProvider } from './modules/ai/index.js';
import { loadSeedCatalog, seedCatalog } from './modules/catalog/index.js';
import { DIM, setEmbeddings, vec } from './testing/aiFixtures.js';
import { testConfig } from './testing/config.js';
import { ORIGIN } from './testing/fixtures.js';
import { loginAs } from './testing/login.js';
import { startPostgres, type TestDatabase } from './testing/startPostgres.js';

const logger = pino({ level: 'silent' });
const ADMIN_PHONE = '9810000777';

describe('asking the customer which item they mean (422 item_ambiguous) and the admin AI stats', () => {
  let testDb: TestDatabase;
  let pool: Pool;
  let app: ReturnType<typeof createApp>;
  const ids: Record<string, string> = {};
  const provider = createFakeProvider({ dim: DIM });
  let seeker: { token: string; userId: string };
  let admin: { token: string };

  beforeAll(async () => {
    testDb = await startPostgres();
    pool = testDb.pool;
    await seedCatalog(pool, loadSeedCatalog());
    const { rows } = await pool.query<{ id: string; slug: string }>('SELECT id, slug FROM items');
    for (const r of rows) ids[r.slug] = r.id;
    await setEmbeddings(pool, {
      'paper-clips': vec({ 1: 1 }),
      'clothes-clips': vec({ 1: 0.97, 2: 0.2 }),
    });
    provider.onEmbed((texts) => texts.map(() => vec({ 1: 1 })));
    provider.onGenerate(() => ({
      itemId: null,
      needsClarification: true,
      question: 'Kaunsa clip chahiye?',
      optionIds: [ids['paper-clips'], ids['clothes-clips']],
    }));
    const ai = createAi({
      provider,
      db: pool,
      logger,
      embedThreshold: 0.8,
      embedMargin: 0.05,
      limiter: { allow: async () => true },
      client: { backoffMs: 1 },
    });
    const config = testConfig({ adminPhones: [`+91${ADMIN_PHONE}`] });
    app = createApp({ config, logger, db: pool, ai });
    seeker = await loginAs(app, 'seeker', '9811000001');
    admin = await loginAs(app, 'seeker', ADMIN_PHONE);
  }, 300_000);

  afterAll(async () => {
    await testDb?.stop();
  });

  const auth = (u: { token: string }) => ({ Authorization: `Bearer ${u.token}` });
  const ask = (body: Record<string, unknown>) =>
    request(app)
      .post('/requests')
      .set(auth(seeker))
      .send({ lat: ORIGIN.lat, lng: ORIGIN.lng, ...body });

  describe('POST /requests', () => {
    it('answers 422 item_ambiguous with the question and the options, and creates nothing', async () => {
      const res = await ask({ q: 'clip' });
      expect(res.status).toBe(422);
      expect(res.body.error).toMatchObject({
        code: 'item_ambiguous',
        question: 'Kaunsa clip chahiye?',
        options: [
          { itemId: ids['paper-clips'], nameEn: 'paper clips', nameHi: expect.any(String) },
          { itemId: ids['clothes-clips'], nameEn: 'clothes clips', nameHi: expect.any(String) },
        ],
      });
      expect(Object.keys(res.body.error.options[0]).sort()).toEqual(['itemId', 'nameEn', 'nameHi']);
      expect((await pool.query('SELECT 1 FROM requests')).rowCount).toBe(0);
    });

    it('takes the customer choice as itemId and skips resolution', async () => {
      const before = provider.calls.length;
      const res = await ask({ q: 'clip', itemId: ids['paper-clips'] });
      expect(res.status).toBe(201);
      expect(res.body.item).toMatchObject({ slug: 'paper-clips' });
      expect(provider.calls.length).toBe(before); // no embedding, no LLM
    });

    it('refuses an itemId that is not a uuid (400) or not in the catalog (404)', async () => {
      expect((await ask({ q: 'clip', itemId: 'sugar' })).status).toBe(400);
      const missing = await ask({ q: 'clip', itemId: '99999999-9999-4999-8999-999999999999' });
      expect(missing.status).toBe(404);
      expect(missing.body.error.code).toBe('item_not_found');
    });

    it('still answers 422 item_unresolved when nothing fits, as before', async () => {
      provider.onGenerate(({ purpose }) =>
        purpose === 'classify_item'
          ? { verdict: 'nonsense' }
          : { itemId: null, needsClarification: false },
      );
      const res = await ask({ q: 'zzq qwerty' });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('item_unresolved');
    });

    it('keeps working when the AI is down: a clear 503 that nothing was sent, never a 500', async () => {
      provider.onGenerate(() => {
        throw Object.assign(new Error('down'), { status: 503 });
      });
      const res = await ask({ q: 'zzq down' });
      // The catalog has no answer and the safety classifier is down: fail closed (ADR-0029).
      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe('item_unavailable');
      const ok = await ask({ q: 'chini' }); // the dictionary still answers
      expect(ok.status).toBe(201);
    });
  });

  describe('GET /search', () => {
    beforeAll(() => {
      provider.onGenerate(() => ({
        itemId: null,
        needsClarification: true,
        question: 'Kaunsa clip chahiye?',
        optionIds: [ids['paper-clips'], ids['clothes-clips']],
      }));
    });
    const search = (query: Record<string, string>) =>
      request(app)
        .get('/search')
        .set(auth(seeker))
        .query({ lat: String(ORIGIN.lat), lng: String(ORIGIN.lng), ...query });

    it('answers the same 422 for an ambiguous query', async () => {
      const res = await search({ q: 'clip' });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('item_ambiguous');
      expect(res.body.error.options).toHaveLength(2);
    });

    it('accepts itemId to skip resolution', async () => {
      const res = await search({ q: 'clip', itemId: ids['clothes-clips'] as string });
      expect(res.status).toBe(200);
      expect(res.body.item).toMatchObject({ slug: 'clothes-clips' });
    });

    it('a normal query is unchanged, and now reports which step answered', async () => {
      const res = await search({ q: 'aata' });
      expect(res.body).toMatchObject({ item: { slug: 'wheat-flour' }, matchedBy: 'synonym' });
    });
  });

  describe('GET /admin/ai/stats', () => {
    it('is 404 for everyone but an admin', async () => {
      expect((await request(app).get('/admin/ai/stats')).status).toBe(404);
      expect((await request(app).get('/admin/ai/stats').set(auth(seeker))).status).toBe(404);
    });

    it('reports the steps, fallback and cache rates, tokens, latency, errors and breaker skips', async () => {
      const res = await request(app).get('/admin/ai/stats').set(auth(admin));
      expect(res.status).toBe(200);
      for (const window of ['24h', '7d']) {
        const w = res.body[window];
        expect(w.queries).toBeGreaterThan(0);
        expect(Object.keys(w.byStep).sort()).toEqual([
          'cache',
          'embedding',
          'llm',
          'synonym',
          'trigram',
          'unresolved',
        ]);
        expect(Object.values(w.byStep as Record<string, number>).reduce((a, b) => a + b, 0)).toBe(
          w.queries,
        );
        expect(w.llmFallbackRate).toBeGreaterThanOrEqual(0);
        expect(w.llmFallbackRate).toBeLessThanOrEqual(1);
        expect(w.cacheHitRate).toBeGreaterThanOrEqual(0);
        expect(w.llm).toMatchObject({
          calls: expect.any(Number),
          avgTokensPerCall: expect.any(Number),
          p95LatencyMs: expect.any(Number),
          errors: expect.any(Number),
          invalidOutputs: expect.any(Number),
          breakerSkips: expect.any(Number),
        });
      }
      expect(res.body['24h'].byStep.synonym).toBeGreaterThan(0);
      expect(res.body['24h'].byStep.llm).toBeGreaterThan(0);
      expect(res.body['24h'].llm.errors).toBeGreaterThan(0); // the 503 above
    });

    it('counts rows by age: a week-old query is in 7d but not in 24h', async () => {
      await pool.query(
        `INSERT INTO search_queries (raw_text, normalised, item_id, matched_by, created_at)
         VALUES ('old', 'old', NULL, NULL, now() - interval '3 days')`,
      );
      const res = await request(app).get('/admin/ai/stats').set(auth(admin));
      expect(res.body['7d'].queries).toBe(res.body['24h'].queries + 1);
    });
  });
});
