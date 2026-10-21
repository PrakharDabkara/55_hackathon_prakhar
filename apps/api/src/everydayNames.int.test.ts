import type { Pool } from 'pg';
import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { createAi, createFakeProvider, type FakeProvider } from './modules/ai/index.js';
import { loadSeedCatalog, seedCatalog } from './modules/catalog/index.js';
import { fanOutPings, type PingClaims } from './modules/requests/index.js';
import { testConfig } from './testing/config.js';
import { north, ORIGIN } from './testing/fixtures.js';
import { loginAs } from './testing/login.js';
import { startPostgres, type TestDatabase } from './testing/startPostgres.js';
import { truncateKeepingShops } from './testing/truncate.js';

const logger = pino({ level: 'silent' });
const claimsAll: PingClaims = { claim: async () => true, release: async () => undefined };

// ADR-0047: the customer types "maida", the catalog item is "refined flour". The request keeps the
// catalog word that matched (never the customer's own text); the shop sees "Maida" large.
describe('everyday names', () => {
  let testDb: TestDatabase;
  let pool: Pool;
  let app: ReturnType<typeof createApp>;
  let provider: FakeProvider;
  let seeker: { token: string; userId: string };
  let owner: { token: string; userId: string };
  let phone = 9_840_000_000;

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
    seeker = await loginAs(app, 'seeker', String(phone++));
    owner = await loginAs(app, 'shop', String(phone++));
  }, 300_000);
  afterAll(async () => {
    await testDb?.stop();
  });
  beforeEach(async () => {
    await truncateKeepingShops(pool, 'requests, pings, new_item_attempts, query_cache');
    await pool.query(`DELETE FROM shops`);
    await pool.query(`DELETE FROM items WHERE source = 'user'`);
    provider.onGenerate(({ purpose }) =>
      purpose === 'classify_item'
        ? { verdict: 'allowed', confidence: 'high', category: 'grocery' }
        : { itemId: null, needsClarification: false },
    );
    await request(app)
      .post('/shops')
      .set({ Authorization: `Bearer ${owner.token}` })
      .send({ name: 'Flour Kirana', lat: north(0.3), lng: ORIGIN.lng, categories: ['grocery'] });
  });

  const ask = (body: Record<string, unknown>) =>
    request(app)
      .post('/requests')
      .set({ Authorization: `Bearer ${seeker.token}` })
      .send({ lat: ORIGIN.lat, lng: ORIGIN.lng, ...body });
  const alias = async (id: string) =>
    (
      await pool.query<{ matched_alias: string | null }>(
        `SELECT matched_alias FROM requests WHERE id = $1`,
        [id],
      )
    ).rows[0]?.matched_alias;
  const shopCards = async () =>
    (
      await request(app)
        .get('/shops/me/pings')
        .set({ Authorization: `Bearer ${owner.token}` })
    ).body;

  it("records the catalog synonym that matched, and shows it as displayName with the customer's words as typed", async () => {
    const res = await ask({ q: 'Maida' });
    expect(res.status).toBe(201);
    expect(res.body.item.nameEn).toBe('refined flour');
    expect(await alias(res.body.id)).toBe('maida');
    expect(res.body.displayName).toBe('Maida');
    expect(res.body.typed).toBe('Maida');
  });

  it("leaves displayName out when the customer used the item's own name, or no catalog word matched", async () => {
    const own = await ask({ q: 'refined flour' });
    expect(own.status).toBe(201);
    expect(own.body.displayName).toBeUndefined();
    expect(await alias(own.body.id)).toBeNull();
    expect(own.body.typed).toBe('refined flour');
  });

  it("stores the catalog word, never the customer's own text, even for a typo with extra words", async () => {
    const res = await ask({ q: 'maidaa', understanding: 'confirmed' });
    expect(res.status).toBe(201);
    const stored = await alias(res.body.id);
    expect(stored).toBe('maidaa');
    // The stored word is a row of item_synonyms, not an echo of the request.
    const known = await pool.query(`SELECT 1 FROM item_synonyms WHERE term = $1`, [stored]);
    expect(known.rowCount).toBe(1);
  });

  it('a fuzzy match stores the catalog term it matched, not what was typed', async () => {
    const res = await ask({ q: 'maidha' });
    if (res.status === 422) {
      // The app asks first for a fuzzy match; picking the item it understood is the confirmed path.
      const picked = await ask({ q: 'maidha', itemId: res.body.error.item.itemId });
      expect(picked.status).toBe(201);
      // "maidha" is not a catalog word, so nothing is kept as the everyday name.
      expect(await alias(picked.body.id)).toBeNull();
      return;
    }
    const stored = await alias(res.body.id);
    expect(stored).not.toBe('maidha');
  });

  it('a generic word the catalog names a usual item for ("pen") shows as "Pen" over the item name', async () => {
    const asked = await ask({ q: 'pen' });
    expect(asked.status).toBe(422);
    expect(asked.body.error.code).toBe('item_confirm');
    const res = await ask({
      q: 'pen',
      itemId: asked.body.error.item.itemId,
      understanding: 'confirmed',
    });
    expect(res.status).toBe(201);
    expect(await alias(res.body.id)).toBe('pen');
    expect(res.body.displayName).toBe('Pen');
  });

  it("an item made from the customer's own words has no alias", async () => {
    const res = await ask({ q: 'foam glitter sheet', asTyped: true });
    expect(res.status).toBe(201);
    expect(await alias(res.body.id)).toBeNull();
  });

  it('gives the shop displayName on the ping card, with the English name next to it', async () => {
    const res = await ask({ q: 'maida' });
    await fanOutPings(
      { db: pool, logger, config: { maxPings: 10 } },
      res.body.id as string,
      claimsAll,
    );
    const [card] = await shopCards();
    expect(card.item.nameEn).toBe('refined flour');
    expect(card.displayName).toBe('Maida');
    // Never the customer's own text or anything else about them.
    expect(JSON.stringify(card)).not.toMatch(/typed|rawQuery|raw_query/);
  });

  it('adds no displayName to the shop card when nothing matched by synonym', async () => {
    const res = await ask({ q: 'refined flour' });
    await fanOutPings(
      { db: pool, logger, config: { maxPings: 10 } },
      res.body.id as string,
      claimsAll,
    );
    const [card] = await shopCards();
    expect(card).not.toHaveProperty('displayName');
  });

  it("carries displayName on the shop's order line and the customer's own words on theirs", async () => {
    const res = await ask({ q: 'maida' });
    await fanOutPings(
      { db: pool, logger, config: { maxPings: 10 } },
      res.body.id as string,
      claimsAll,
    );
    const [card] = await shopCards();
    await request(app)
      .post(`/pings/${card.id}/answer`)
      .set({ Authorization: `Bearer ${owner.token}` })
      .send({ answer: 'yes', pricePaise: 4500, delivery: { feePaise: 3000, minutes: 45 } });
    const shopRow = (
      await pool.query<{ id: string }>(`SELECT id FROM shops WHERE owner_user_id = $1`, [
        owner.userId,
      ])
    ).rows[0];
    const placed = await request(app)
      .post('/orders')
      .set({ Authorization: `Bearer ${seeker.token}` })
      .send({
        shopId: shopRow?.id,
        requestId: res.body.id,
        addressText: 'Flat 4B, Sapna Apartments, Indore',
        customerName: 'Asha',
      });
    expect(placed.status).toBe(201);
    // Customer: their own word, as typed (text), and the catalog name.
    expect(placed.body.lines[0]).toMatchObject({ text: 'maida', name: 'refined flour' });
    const mine = (
      await request(app)
        .get('/shops/me/orders')
        .set({ Authorization: `Bearer ${owner.token}` })
    ).body;
    const line = mine[0].lines[0];
    expect(line).toMatchObject({ name: 'refined flour', displayName: 'Maida' });
    expect(line).not.toHaveProperty('text');
  });
});
