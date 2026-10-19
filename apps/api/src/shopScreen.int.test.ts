import type { Pool } from 'pg';
import { pino } from 'pino';
import request from 'supertest';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { loadSeedCatalog, seedCatalog } from './modules/catalog/index.js';
import { createRealtime } from './modules/realtime/index.js';
import { fanOutPings, type PingClaims } from './modules/requests/index.js';
import { testConfig } from './testing/config.js';
import { north, ORIGIN } from './testing/fixtures.js';
import { loginAs } from './testing/login.js';
import { startPostgres, type TestDatabase } from './testing/startPostgres.js';
import { truncateKeepingShops } from './testing/truncate.js';

const claimsAll: PingClaims = { claim: async () => true, release: async () => undefined };
const quiet = pino({ level: 'silent' });
const ADDRESS = 'Flat 4B, Sapna Apartments, Vijay Nagar, Indore';

const jpeg = (width = 640, height = 480) =>
  sharp({ create: { width, height, channels: 3, background: { r: 30, g: 120, b: 200 } } })
    .jpeg()
    .withMetadata({
      exif: {
        IFD0: { Make: 'PhoneCo' },
        IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '22/1 43/1 11/1' },
      },
    })
    .toBuffer();

// ADR-0040 (PR K): data for the new shop screen, and the shop's logo.
describe('shop screen data and the shop logo', () => {
  let testDb: TestDatabase;
  let pool: Pool;
  let app: ReturnType<typeof createApp>;
  let phone = 9_896_000_000;
  type User = { token: string; userId: string; phone: string };
  let seeker: User;
  let owner: User & { shopId: string };
  let rival: User & { shopId: string };
  let noShop: User;
  const auth = (u: { token: string }) => ({ Authorization: `Bearer ${u.token}` });
  let slugs: string[];
  let itemIds: Record<string, string>;

  async function newUser(role: 'seeker' | 'shop'): Promise<User> {
    const p = String(phone++);
    return { ...(await loginAs(app, role, p)), phone: p };
  }
  async function newShop(name: string, km: number) {
    const u = await newUser('shop');
    const made = await request(app)
      .post('/shops')
      .set(auth(u))
      .send({ name, lat: north(km), lng: ORIGIN.lng, categories: ['grocery'] });
    return { ...u, shopId: made.body.id as string };
  }

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
    seeker = await newUser('seeker');
    owner = await newShop('Logo Kirana', 0.3);
    rival = await newShop('Rival Kirana', 0.6);
    noShop = await newUser('shop');
    const items = await pool.query<{ id: string; slug: string }>(
      `SELECT id, slug FROM items WHERE category = 'grocery' ORDER BY slug LIMIT 4`,
    );
    slugs = items.rows.map((r) => r.slug);
    itemIds = Object.fromEntries(items.rows.map((r) => [r.slug, r.id]));
  }, 300_000);
  afterAll(async () => {
    await testDb?.stop();
  });
  beforeEach(async () => {
    await truncateKeepingShops(
      pool,
      'photos, requests, pings, shop_stock, delivery_orders, saved_addresses',
    );
  });

  /** A request made `daysAgo` days back, and the ping it sent to `shop`. */
  async function ping(
    slug: string,
    state: string,
    over: {
      daysAgo?: number;
      replySeconds?: number | null;
      late?: boolean;
      shop?: { shopId: string };
    } = {},
  ) {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO requests (user_id, item_id, raw_query, location, radius_m, state, expires_at, created_at)
       VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint($4, $5), 4326)::geography, 1000, 'EXPIRED',
               now() + interval '1 hour', now() - make_interval(days => $6::int))
       RETURNING id`,
      [seeker.userId, itemIds[slug], slug, ORIGIN.lng, north(0.3), over.daysAgo ?? 0],
    );
    const requestId = (rows[0] as { id: string }).id;
    const reply = over.replySeconds;
    await pool.query(
      `INSERT INTO pings (request_id, shop_id, item_id, state, late, sent_at, answered_at, created_at)
       SELECT $1, $2, $3, $4, $5, r.created_at,
              CASE WHEN $6::int IS NULL THEN NULL ELSE r.created_at + make_interval(secs => $6::int) END,
              r.created_at
         FROM requests r WHERE r.id = $1`,
      [
        requestId,
        (over.shop ?? owner).shopId,
        itemIds[slug],
        state,
        over.late ?? false,
        reply ?? null,
      ],
    );
  }

  // ---- 1. last price on a ping card ---------------------------------------------------------
  describe('lastPricePaise on a ping card', () => {
    const cards = async (u: User = owner) =>
      (await request(app).get('/shops/me/pings').set(auth(u))).body as Record<string, unknown>[];
    async function find(q = 'chini') {
      const made = await request(app)
        .post('/requests')
        .set(auth(seeker))
        .send({ q, lat: ORIGIN.lat, lng: ORIGIN.lng });
      expect(made.status).toBe(201);
      await fanOutPings(
        { db: pool, logger: quiet, config: { maxPings: 10 } },
        made.body.id,
        claimsAll,
      );
      return made.body as { id: string; item: { id: string } };
    }
    const stock = (shopId: string, itemId: string, price: number | null, invalidated = false) =>
      pool.query(
        `INSERT INTO shop_stock (shop_id, item_id, source, price_paise, last_confirmed_at, expires_at, invalidated_at)
         VALUES ($1, $2, 'ping_yes', $3, now() - interval '3 days', now() + interval '4 days',
                 CASE WHEN $4 THEN now() END)
         ON CONFLICT (shop_id, item_id) DO UPDATE SET price_paise = $3`,
        [shopId, itemId, price, invalidated],
      );

    it('is null when the shop never answered for this item', async () => {
      await find();
      expect((await cards())[0]).toHaveProperty('lastPricePaise', null);
    });

    it("is the price in this shop's own stock row, and no other shop's", async () => {
      const req = await find();
      await stock(owner.shopId, req.item.id, 4500);
      await stock(rival.shopId, req.item.id, 9900);
      expect((await cards())[0]).toMatchObject({ lastPricePaise: 4500 });
      expect((await cards(rival))[0]).toMatchObject({ lastPricePaise: 9900 });
    });

    it('is null when the row has no price, or the answer was called wrong', async () => {
      const req = await find();
      await stock(owner.shopId, req.item.id, null);
      expect((await cards())[0]).toHaveProperty('lastPricePaise', null);
      await stock(owner.shopId, req.item.id, 4500, true);
      await pool.query(`UPDATE shop_stock SET invalidated_at = now() WHERE shop_id = $1`, [
        owner.shopId,
      ]);
      expect((await cards())[0]).toHaveProperty('lastPricePaise', null);
    });

    it('is on the allow-list on purpose: the card has exactly these keys', async () => {
      const req = await find();
      await stock(owner.shopId, req.item.id, 4500);
      const [card] = await cards();
      expect(Object.keys(card as object).sort()).toEqual(
        [
          'canDeliver',
          'distanceBand',
          'expiresAt',
          'id',
          'item',
          'lastPricePaise',
          'sentAt',
          'wantsDelivery',
        ].sort(),
      );
      expect(JSON.stringify(card)).not.toContain(seeker.userId);
    });
  });

  // ---- 2. insights window and average reply ---------------------------------------------------
  describe('GET /shops/me/demand?days=', () => {
    const demand = (query: string, u: User = owner) =>
      request(app).get(`/shops/me/demand${query}`).set(auth(u));

    it('defaults to 1 day, accepts 1 and 7, and names the window in the response', async () => {
      expect((await demand('')).body.days).toBe(1);
      expect((await demand('?days=1')).body.days).toBe(1);
      const week = await demand('?days=7');
      expect(week.status).toBe(200);
      expect(week.body.days).toBe(7);
      expect(Object.keys(week.body).sort()).toEqual(
        ['asked', 'avgReplySeconds', 'days', 'nearby', 'today'].sort(),
      );
    });

    it.each(['0', '2', '30', '-1', 'abc', '', '1.5'])(
      'refuses ?days=%s with 400',
      async (value) => {
        const res = await demand(`?days=${value}`);
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('invalid_request');
      },
    );

    it('still needs a shop login and a shop', async () => {
      expect((await request(app).get('/shops/me/demand?days=7')).status).toBe(401);
      expect((await demand('?days=7', seeker)).status).toBe(403);
      expect((await demand('?days=7', noShop)).status).toBe(404);
    });

    it('today.* counts the selected window; field names stay', async () => {
      const [a, b] = slugs as [string, string];
      await ping(a, 'YES');
      await ping(b, 'NO', { daysAgo: 3 });
      await ping(a, 'NO_REPLY', { daysAgo: 20 });
      expect((await demand('?days=1')).body.today).toEqual({ received: 1, answered: 1, yes: 1 });
      expect((await demand('?days=7')).body.today).toEqual({ received: 2, answered: 2, yes: 1 });
    });

    it('asked[] respects the window', async () => {
      const [a] = slugs as [string];
      await ping(a, 'NO', { daysAgo: 3 });
      expect((await demand('?days=1')).body.asked).toEqual([]);
      expect((await demand('?days=7')).body.asked).toEqual([expect.objectContaining({ count: 1 })]);
    });

    it('nearby[] respects the window, and still needs three customers', async () => {
      const [a] = slugs as [string];
      const customers = [await newUser('seeker'), await newUser('seeker'), await newUser('seeker')];
      for (const c of customers)
        await pool.query(
          `INSERT INTO requests (user_id, item_id, raw_query, location, radius_m, state, expires_at, created_at)
           VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint($4, $5), 4326)::geography, 1000, 'EXPIRED',
                   now() + interval '1 hour', now() - interval '3 days')`,
          [c.userId, itemIds[a], a, ORIGIN.lng, north(0.3)],
        );
      expect((await demand('?days=1')).body.nearby).toEqual([]);
      expect((await demand('?days=7')).body.nearby).toEqual([
        expect.objectContaining({ customers: 3 }),
      ]);
    });

    describe('avgReplySeconds', () => {
      it('is null when nothing was answered', async () => {
        expect((await demand('')).body.avgReplySeconds).toBeNull();
        await ping(slugs[0] as string, 'SENT');
        await ping(slugs[1] as string, 'NO_REPLY');
        expect((await demand('')).body.avgReplySeconds).toBeNull();
      });

      it('averages answered_at - sent_at over YES and NO', async () => {
        await ping(slugs[0] as string, 'YES', { replySeconds: 30 });
        await ping(slugs[1] as string, 'NO', { replySeconds: 90 });
        expect((await demand('')).body.avgReplySeconds).toBe(60);
      });

      it('leaves out late answers', async () => {
        await ping(slugs[0] as string, 'YES', { replySeconds: 30 });
        await ping(slugs[1] as string, 'YES', { replySeconds: 3000, late: true });
        expect((await demand('')).body.avgReplySeconds).toBe(30);
        await pool.query(`UPDATE pings SET late = true`);
        expect((await demand('')).body.avgReplySeconds).toBeNull();
      });

      it('follows the window and only this shop', async () => {
        await ping(slugs[0] as string, 'YES', { replySeconds: 30 });
        await ping(slugs[1] as string, 'YES', { replySeconds: 150, daysAgo: 3 });
        await ping(slugs[2] as string, 'YES', { replySeconds: 9999, shop: rival });
        expect((await demand('?days=1')).body.avgReplySeconds).toBe(30);
        expect((await demand('?days=7')).body.avgReplySeconds).toBe(90);
      });
    });
  });

  // ---- 3. the logo ---------------------------------------------------------------------------
  describe('shop logo', () => {
    const upload = (u: { token: string } | null, body: Buffer) => {
      const r = request(app).post('/shops/me/logo').set('Content-Type', 'image/jpeg');
      return (u ? r.set(auth(u)) : r).send(body);
    };
    const remove = (u: { token: string }) => request(app).delete('/shops/me/logo').set(auth(u));
    const me = (u: { token: string }) => request(app).get('/shops/me').set(auth(u));
    const fetchLogo = (url: string, u?: { token: string }) => {
      const r = request(app).get(url);
      return u ? r.set(auth(u)) : r;
    };
    const rows = async () => (await pool.query(`SELECT * FROM photos WHERE role = 'logo'`)).rows;

    beforeEach(async () => {
      await pool.query(`UPDATE shops SET logo_photo_id = NULL`);
    });

    it('GET /shops/me has logoUrl: null before any upload', async () => {
      const res = await me(owner);
      expect(res.body).toHaveProperty('logoUrl', null);
    });

    it('is for the shop owner only', async () => {
      expect((await upload(null, await jpeg())).status).toBe(401);
      expect((await upload(seeker, await jpeg())).status).toBe(403);
      expect((await upload(noShop, await jpeg())).status).toBe(404);
      expect((await remove(seeker)).status).toBe(403);
      expect(await rows()).toHaveLength(0);
    });

    it('stores a 512 px square webp with no metadata and answers with the url alone', async () => {
      const res = await upload(owner, await jpeg(800, 400));
      expect(res.status).toBe(201);
      expect(res.body).toEqual({ logoUrl: expect.stringMatching(/^\/photos\/[0-9a-f-]{36}$/) });
      const [row] = await rows();
      expect(row).toMatchObject({
        mime: 'image/webp',
        owner_user_id: owner.userId,
        shop_id: owner.shopId,
      });
      expect(res.body.logoUrl).toBe(`/photos/${row.id}`);
      const meta = await sharp(row.data).metadata();
      expect([meta.format, meta.width, meta.height]).toEqual(['webp', 512, 512]);
      expect(meta.exif).toBeUndefined();
      expect(row.data.toString('latin1')).not.toMatch(/GPS|PhoneCo/);
      expect((await me(owner)).body.logoUrl).toBe(res.body.logoUrl);
    });

    it('keeps the same size and type limits as other photos', async () => {
      const big = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(401 * 1024)]);
      const tooBig = await upload(owner, big);
      expect(tooBig.status).toBe(413);
      expect(tooBig.body.error.code).toBe('photo_too_large');
      for (const body of [
        Buffer.from('GIF89a' + 'x'.repeat(100)),
        Buffer.from('words'),
        Buffer.alloc(0),
      ]) {
        const res = await upload(owner, body);
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('invalid_image');
      }
      expect(await rows()).toHaveLength(0);
    });

    it('a second upload replaces the first: one row, the old one gone', async () => {
      const first = (await upload(owner, await jpeg())).body.logoUrl as string;
      const second = (await upload(owner, await jpeg(300, 300))).body.logoUrl as string;
      expect(second).not.toBe(first);
      expect(await rows()).toHaveLength(1);
      expect((await fetchLogo(first, seeker)).status).toBe(404);
      expect((await fetchLogo(second)).status).toBe(200);
      expect((await me(owner)).body.logoUrl).toBe(second);
    });

    it('each shop has its own logo', async () => {
      const a = (await upload(owner, await jpeg())).body.logoUrl;
      const b = (await upload(rival, await jpeg())).body.logoUrl;
      expect(await rows()).toHaveLength(2);
      expect((await me(owner)).body.logoUrl).toBe(a);
      expect((await me(rival)).body.logoUrl).toBe(b);
    });

    it('DELETE removes the row and the url; deleting again is fine', async () => {
      await upload(owner, await jpeg());
      const res = await remove(owner);
      expect(res.status).toBe(204);
      expect(await rows()).toHaveLength(0);
      expect((await me(owner)).body.logoUrl).toBeNull();
      expect((await remove(owner)).status).toBe(204);
    });

    it('the daily sweep keeps a logo that is attached to no request', async () => {
      const { sweepPhotos } = await import('./modules/photos/index.js');
      await upload(owner, await jpeg());
      await pool.query(`UPDATE photos SET created_at = now() - interval '10 days'`);
      await sweepPhotos({ db: pool, logger: quiet }, new Date());
      expect(await rows()).toHaveLength(1);
    });

    describe('reading it back (GET /photos/:id)', () => {
      it('a logo is readable by anyone, with no login, and cached for a long time', async () => {
        const { logoUrl } = (await upload(owner, await jpeg())).body;
        const res = await fetchLogo(logoUrl);
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toBe('image/webp');
        expect(res.headers['cache-control']).toMatch(/public/);
        expect(res.headers['cache-control']).toMatch(/max-age=(\d{6,})/);
        expect(res.headers['x-content-type-options']).toBe('nosniff');
        expect((await fetchLogo(logoUrl, seeker)).status).toBe(200);
      });

      it('every other role keeps its rules: no login, no photo', async () => {
        const mine = await request(app)
          .post('/photos')
          .query({ role: 'answer' })
          .set(auth(owner))
          .set('Content-Type', 'image/jpeg')
          .send(await jpeg());
        expect(mine.status).toBe(201);
        const url = `/photos/${mine.body.id}`;
        expect((await fetchLogo(url)).status).toBe(401);
        expect((await fetchLogo(url, seeker)).status).toBe(404);
        expect((await fetchLogo(url, owner)).status).toBe(200);
        const req = await request(app)
          .post('/photos')
          .query({ role: 'request' })
          .set(auth(seeker))
          .set('Content-Type', 'image/jpeg')
          .send(await jpeg());
        expect((await fetchLogo(`/photos/${req.body.id}`)).status).toBe(401);
        expect((await fetchLogo(`/photos/${req.body.id}`, rival)).status).toBe(404);
      });

      it('an unknown or malformed id is 404 without a login for a logo-shaped miss, 401 otherwise', async () => {
        expect((await fetchLogo('/photos/not-an-id', seeker)).status).toBe(404);
        expect(
          (await fetchLogo('/photos/00000000-0000-4000-8000-000000000000', seeker)).status,
        ).toBe(404);
      });
    });

    describe('where logoUrl shows', () => {
      async function withLogo() {
        const { logoUrl } = (await upload(owner, await jpeg())).body;
        return logoUrl as string;
      }
      async function offer(): Promise<string> {
        const saved = await request(app)
          .put('/orders/saved-address')
          .set(auth(seeker))
          .send({ addressText: ADDRESS, customerName: 'Asha Verma' });
        const made = await request(app).post('/requests').set(auth(seeker)).send({
          q: 'chini',
          lat: ORIGIN.lat,
          lng: ORIGIN.lng,
          wantsDelivery: true,
          deliveryAddressId: saved.body.id,
        });
        await fanOutPings(
          { db: pool, logger: quiet, config: { maxPings: 10 } },
          made.body.id,
          claimsAll,
        );
        const [card] = (await request(app).get('/shops/me/pings').set(auth(owner))).body;
        await request(app)
          .post(`/pings/${card.id}/answer`)
          .set(auth(owner))
          .send({ answer: 'yes', pricePaise: 4500, delivery: { feePaise: 3000, minutes: 45 } });
        return made.body.id as string;
      }

      it('is in the results of a search (live answer and learned stock), null for a shop without one', async () => {
        const logoUrl = await withLogo();
        const requestId = await offer();
        const view = (await request(app).get(`/requests/${requestId}`).set(auth(seeker))).body;
        const mine = view.results.find((r: { shopId: string }) => r.shopId === owner.shopId);
        expect(mine).toMatchObject({ source: 'live', logoUrl });
        // Learned stock from a shop with no logo: the key is there and null.
        await pool.query(
          `INSERT INTO shop_stock (shop_id, item_id, source, price_paise, last_confirmed_at, expires_at)
           VALUES ($1, $2, 'ping_yes', 5000, now(), now() + interval '7 days')`,
          [rival.shopId, view.item.id],
        );
        const again = (await request(app).get(`/requests/${requestId}`).set(auth(seeker))).body;
        const other = again.results.find((r: { shopId: string }) => r.shopId === rival.shopId);
        expect(other).toMatchObject({ source: 'learned', logoUrl: null });
      });

      it('is on the order page and in Mere orders', async () => {
        const logoUrl = await withLogo();
        const requestId = await offer();
        const placed = await request(app)
          .post('/orders')
          .set(auth(seeker))
          .send({ shopId: owner.shopId, requestId });
        expect(placed.status, JSON.stringify(placed.body)).toBe(201);
        expect(placed.body.logoUrl).toBe(logoUrl);
        const page = await request(app).get(`/orders/${placed.body.id}`).set(auth(seeker));
        expect(page.body.logoUrl).toBe(logoUrl);
        const list = await request(app).get('/orders').set(auth(seeker));
        expect(list.body.orders ?? list.body).toEqual([expect.objectContaining({ logoUrl })]);
      });

      it('shows null on the order page once the logo is deleted', async () => {
        await withLogo();
        const requestId = await offer();
        await request(app)
          .put('/orders/saved-address')
          .set(auth(seeker))
          .send({ addressText: ADDRESS });
        const placed = await request(app)
          .post('/orders')
          .set(auth(seeker))
          .send({ shopId: owner.shopId, requestId });
        await remove(owner);
        const page = await request(app).get(`/orders/${placed.body.id}`).set(auth(seeker));
        expect(page.body.logoUrl).toBeNull();
      });
    });

    describe('privacy: nothing but the picture and its address', () => {
      it('no logo endpoint or customer view carries the owner id, phone or user id', async () => {
        const up = await upload(owner, await jpeg());
        const del = await upload(rival, await jpeg());
        const logoUrl = up.body.logoUrl as string;
        const requestId = (
          await request(app)
            .post('/requests')
            .set(auth(seeker))
            .send({ q: 'chini', lat: ORIGIN.lat, lng: ORIGIN.lng })
        ).body.id as string;
        await pool.query(
          `INSERT INTO shop_stock (shop_id, item_id, source, price_paise, last_confirmed_at, expires_at)
           SELECT $1, item_id, 'ping_yes', 4500, now(), now() + interval '7 days' FROM requests WHERE id = $2`,
          [owner.shopId, requestId],
        );
        const bodies = [
          JSON.stringify(up.body),
          JSON.stringify(del.body),
          JSON.stringify((await request(app).get(`/requests/${requestId}`).set(auth(seeker))).body),
          JSON.stringify((await request(app).get('/orders').set(auth(seeker))).body),
          JSON.stringify((await remove(rival)).body),
        ];
        const res = await fetchLogo(logoUrl);
        const headers = JSON.stringify(res.headers);
        for (const text of [...bodies, headers]) {
          for (const secret of [owner.userId, owner.phone, rival.userId, rival.phone])
            expect(text).not.toContain(secret);
          expect(text).not.toMatch(/owner|ownerUserId|owner_user_id/i);
        }
        // The photo row's owner never leaves the database.
        expect(Buffer.from(res.body).toString('latin1')).not.toContain(owner.userId);
      });
    });
  });
});
