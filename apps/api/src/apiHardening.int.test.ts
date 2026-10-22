import type { Pool } from 'pg';
import { pino } from 'pino';
import request from 'supertest';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { loadSeedCatalog, seedCatalog } from './modules/catalog/index.js';
import { createErrand, limitsFromConfig } from './modules/errands/index.js';
import { fanOutPings, type PingClaims } from './modules/requests/index.js';
import { testConfig, TEST_ADMIN_TOKEN } from './testing/config.js';
import { north, ORIGIN } from './testing/fixtures.js';
import { loginAs } from './testing/login.js';
import { startPostgres, type TestDatabase } from './testing/startPostgres.js';

// SEC2 (ADR-0059): who may touch what, what every route refuses, and the limits on the dear routes.

const quiet = pino({ level: 'silent' });
const claimsAll: PingClaims = { claim: async () => true, release: async () => undefined };
const ADDRESS = 'Flat 4B, Sapna Apartments, Vijay Nagar, Indore';
const GHOST = '00000000-0000-4000-8000-000000000000';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type User = { token: string; userId: string };
type Shop = User & { shopId: string };
type Role = 'seeker' | 'shop';

describe('API hardening (SEC2)', () => {
  let testDb: TestDatabase;
  let pool: Pool;
  let app: ReturnType<typeof createApp>;
  let limitedApp: ReturnType<typeof createApp>;
  let phone = 9_700_000_000;
  const auth = (u: { token: string }) => ({ Authorization: `Bearer ${u.token}` });

  let custA: User;
  let custB: User;
  let shopA: Shop;
  let shopB: Shop;
  let w: {
    addressA: string;
    requestA: string;
    itemId: string;
    pingA: string; // shop A's ping on request A, answered yes
    pingB: string; // shop B's ping on request A, still waiting
    orderA: string;
    listA: string;
    listPingA: string; // shop A's parchi
    listPingB: string; // shop B's parchi
    listLinesA: Json[];
    errandA: string;
    photoA: string; // custA's request photo
    photoShopA: string; // shop A's answer photo
    pickupA: string;
  };

  const jpeg = () =>
    sharp({ create: { width: 64, height: 48, channels: 3, background: { r: 30, g: 120, b: 200 } } })
      .jpeg()
      .toBuffer();

  async function newShop(name: string, km: number): Promise<Shop> {
    const u = await loginAs(app, 'shop', String(phone++));
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
    const config = testConfig({
      adminToken: TEST_ADMIN_TOKEN,
      pickupAskAfterMinutes: 0,
      vapid: { publicKey: 'BPublicKey-for-tests', privateKey: 'p', subject: 'mailto:o@e.com' },
    });
    // testConfig lifts every rate limit (x1000): this suite makes thousands of calls from one
    // address. The last block makes its own app at the real numbers.
    app = createApp({ config, logger: quiet, db: pool });
    limitedApp = createApp({ config: { ...config, rateLimitScale: 1 }, logger: quiet, db: pool });
    custA = await loginAs(app, 'seeker', String(phone++));
    custB = await loginAs(app, 'seeker', String(phone++));
    shopA = await newShop('Hardening A', 0.2);
    shopB = await newShop('Hardening B', 0.4);

    const addressA = (
      await request(app)
        .put('/orders/saved-address')
        .set(auth(custA))
        .send({ addressText: ADDRESS, customerName: 'Asha Verma' })
    ).body.id as string;

    const made = await request(app)
      .post('/requests')
      .set(auth(custA))
      .send({ q: 'chini', lat: ORIGIN.lat, lng: ORIGIN.lng });
    const requestA = made.body.id as string;
    await fanOutPings({ db: pool, logger: quiet, config: { maxPings: 10 } }, requestA, claimsAll);
    const pingsA = (await request(app).get('/shops/me/pings').set(auth(shopA))).body as Json[];
    const pingsB = (await request(app).get('/shops/me/pings').set(auth(shopB))).body as Json[];
    const pingA = pingsA[0]?.['id'] as string;
    const pingB = pingsB[0]?.['id'] as string;
    const answered = await request(app)
      .post(`/pings/${pingA}/answer`)
      .set(auth(shopA))
      .send({ answer: 'yes', pricePaise: 4500, delivery: { feePaise: 3000, minutes: 45 } });
    expect(answered.status).toBe(200);
    const itemId = (await pool.query(`SELECT item_id FROM requests WHERE id = $1`, [requestA]))
      .rows[0].item_id as string;

    // Before the order: a pickup question is never recorded for a shop the customer ordered from.
    const visit = await request(app)
      .post('/pickups')
      .set(auth(custA))
      .send({ shopId: shopA.shopId, itemId, requestId: requestA });
    expect(visit.status).toBe(204);
    const pickupId = (
      await pool.query(`SELECT id FROM pickup_visits WHERE user_id = $1`, [custA.userId])
    ).rows[0]?.id as string;

    const placed = await request(app)
      .post('/orders')
      .set(auth(custA))
      .send({ shopId: shopA.shopId, requestId: requestA, addressText: ADDRESS });
    expect(placed.status).toBe(201);

    const sorted = await request(app)
      .post('/lists/sort')
      .set(auth(custA))
      .send({ lines: ['chini'] });
    const listA = sorted.body.id as string;
    const sent = await request(app)
      .post(`/lists/${listA}/send`)
      .set(auth(custA))
      .send({ lat: ORIGIN.lat, lng: ORIGIN.lng });
    expect(sent.status).toBe(200);
    const parchisA = (await request(app).get('/shops/me/lists').set(auth(shopA))).body as Json[];
    const parchisB = (await request(app).get('/shops/me/lists').set(auth(shopB))).body as Json[];

    const errand = await createErrand(
      { db: pool, logger: quiet, limits: limitsFromConfig(config) },
      custA.userId,
      { task: 'chini aur chai patti', lat: ORIGIN.lat, lng: ORIGIN.lng },
    );

    const photoA = (
      await request(app)
        .post('/photos')
        .query({ role: 'request' })
        .set(auth(custA))
        .set('Content-Type', 'image/jpeg')
        .send(await jpeg())
    ).body.id as string;
    const photoShopA = (
      await request(app)
        .post('/photos')
        .query({ role: 'answer' })
        .set(auth(shopA))
        .set('Content-Type', 'image/jpeg')
        .send(await jpeg())
    ).body.id as string;

    w = {
      addressA,
      requestA,
      itemId,
      pingA,
      pingB,
      orderA: (placed.body as Json)['id'],
      listA,
      listPingA: parchisA[0]?.['id'],
      listPingB: parchisB[0]?.['id'],
      listLinesA: parchisA[0]?.['lines'] ?? [],
      errandA: errand.id,
      photoA,
      photoShopA,
      pickupA: pickupId,
    };
    for (const [name, value] of Object.entries(w)) {
      expect(value, `fixture ${name}`).toBeTruthy();
    }
  }, 300_000);

  afterAll(async () => {
    await testDb?.stop();
  });

  // ---------------------------------------------------------------------------------------
  // 5. The authorization matrix
  // ---------------------------------------------------------------------------------------

  /** `:id` is replaced by the resource's id; `id` says which fixture belongs in it. */
  interface Route {
    name: string;
    method: 'get' | 'post' | 'put' | 'patch' | 'delete';
    path: (id: string) => string;
    id: () => string;
    /** Who owns the thing (and so may use the route). */
    owner: () => User;
    /** Someone with the right role who does not own it. */
    sameRole: () => User;
    /** Someone with the wrong role. */
    wrongRole: () => User;
    body?: () => Json;
    /** The route changes data, so the owner's call comes after every refusal has been checked. */
    write: boolean;
    /** What the owner gets (reads only; writes are checked on their own below). */
    ownerStatus?: number;
  }
  const send = (route: Route, user: User | null, id = route.id()) => {
    const r = request(app)[route.method](route.path(id));
    const withUser = user ? r.set(auth(user)) : r;
    return route.body ? withUser.send(route.body()) : withUser;
  };

  const lineBody = () => ({
    lines: w.listLinesA.map((l) => ({ lineId: l['lineId'], have: true, priceRupees: 40 })),
  });
  const orderBody = () => ({
    assignments: [{ position: 0, shopId: shopA.shopId }],
    addressText: ADDRESS,
  });

  const routes: Route[] = [
    // requests
    {
      name: 'GET /requests/:id',
      method: 'get',
      path: (id) => `/requests/${id}`,
      id: () => w.requestA,
      owner: () => custA,
      sameRole: () => custB,
      wrongRole: () => shopB,
      write: false,
      ownerStatus: 200,
    },
    {
      name: 'POST /requests/:id/close',
      method: 'post',
      path: (id) => `/requests/${id}/close`,
      id: () => w.requestA,
      owner: () => custA,
      sameRole: () => custB,
      wrongRole: () => shopB,
      write: true,
    },
    // pings (a shop answers its own ping only)
    {
      name: 'POST /pings/:id/answer',
      method: 'post',
      path: (id) => `/pings/${id}/answer`,
      id: () => w.pingB,
      owner: () => shopB,
      sameRole: () => shopA,
      wrongRole: () => custA,
      body: () => ({ answer: 'no' }),
      write: true,
    },
    // orders: the customer's side
    {
      name: 'GET /orders/:id',
      method: 'get',
      path: (id) => `/orders/${id}`,
      id: () => w.orderA,
      owner: () => custA,
      sameRole: () => custB,
      wrongRole: () => shopB,
      write: false,
      ownerStatus: 200,
    },
    {
      name: 'POST /orders/:id/received',
      method: 'post',
      path: (id) => `/orders/${id}/received`,
      id: () => w.orderA,
      owner: () => custA,
      sameRole: () => custB,
      wrongRole: () => shopB,
      write: true,
    },
    {
      name: 'POST /orders/:id/collected',
      method: 'post',
      path: (id) => `/orders/${id}/collected`,
      id: () => w.orderA,
      owner: () => custA,
      sameRole: () => custB,
      wrongRole: () => shopB,
      write: true,
    },
    {
      name: 'POST /orders/:id/cancel (a customer)',
      method: 'post',
      path: (id) => `/orders/${id}/cancel`,
      id: () => w.orderA,
      owner: () => custA,
      sameRole: () => custB,
      wrongRole: () => shopB, // a shop that is not this order's shop
      body: () => ({}),
      write: true,
    },
    // orders: the shop's side
    ...(['accept', 'decline', 'out', 'ready'] as const).map((verb): Route => ({
      name: `POST /orders/:id/${verb}`,
      method: 'post',
      path: (id) => `/orders/${id}/${verb}`,
      id: () => w.orderA,
      owner: () => shopA,
      sameRole: () => shopB,
      wrongRole: () => custA,
      write: true,
    })),
    {
      name: 'PUT /orders/:id/lines/0/packed',
      method: 'put',
      path: (id) => `/orders/${id}/lines/0/packed`,
      id: () => w.orderA,
      owner: () => shopA,
      sameRole: () => shopB,
      wrongRole: () => custA,
      body: () => ({ packed: true }),
      write: true,
    },
    // shopping lists
    {
      name: 'GET /lists/:id',
      method: 'get',
      path: (id) => `/lists/${id}`,
      id: () => w.listA,
      owner: () => custA,
      sameRole: () => custB,
      wrongRole: () => shopA,
      write: false,
      ownerStatus: 200,
    },
    {
      name: 'POST /lists/:id/send',
      method: 'post',
      path: (id) => `/lists/${id}/send`,
      id: () => w.listA,
      owner: () => custA,
      sameRole: () => custB,
      wrongRole: () => shopA,
      body: () => ({ lat: ORIGIN.lat, lng: ORIGIN.lng }),
      write: true,
    },
    {
      name: 'POST /lists/:id/order',
      method: 'post',
      path: (id) => `/lists/${id}/order`,
      id: () => w.listA,
      owner: () => custA,
      sameRole: () => custB,
      wrongRole: () => shopA,
      body: orderBody,
      write: true,
    },
    {
      name: 'POST /lists/:id/stop',
      method: 'post',
      path: (id) => `/lists/${id}/stop`,
      id: () => w.listA,
      owner: () => custA,
      sameRole: () => custB,
      wrongRole: () => shopA,
      write: true,
    },
    {
      name: 'POST /list-pings/:id/answer',
      method: 'post',
      path: (id) => `/list-pings/${id}/answer`,
      id: () => w.listPingA,
      owner: () => shopA,
      sameRole: () => shopB,
      wrongRole: () => custA,
      body: lineBody,
      write: true,
    },
    // errands
    {
      name: 'GET /errands/:id',
      method: 'get',
      path: (id) => `/errands/${id}`,
      id: () => w.errandA,
      owner: () => custA,
      sameRole: () => custB,
      wrongRole: () => shopA,
      write: false,
      ownerStatus: 200,
    },
    {
      name: 'POST /errands/:id/modes',
      method: 'post',
      path: (id) => `/errands/${id}/modes`,
      id: () => w.errandA,
      owner: () => custA,
      sameRole: () => custB,
      wrongRole: () => shopA,
      body: () => ({ shopId: shopA.shopId, mode: 'pickup' }),
      write: true,
    },
    {
      name: 'POST /errands/:id/answer',
      method: 'post',
      path: (id) => `/errands/${id}/answer`,
      id: () => w.errandA,
      owner: () => custA,
      sameRole: () => custB,
      wrongRole: () => shopA,
      body: () => ({ text: 'haan' }),
      write: true,
    },
    {
      name: 'POST /errands/:id/cancel',
      method: 'post',
      path: (id) => `/errands/${id}/cancel`,
      id: () => w.errandA,
      owner: () => custA,
      sameRole: () => custB,
      wrongRole: () => shopA,
      write: true,
    },
    // photos
    {
      name: 'GET /photos/:id (a customer photo)',
      method: 'get',
      path: (id) => `/photos/${id}`,
      id: () => w.photoA,
      owner: () => custA,
      sameRole: () => custB,
      wrongRole: () => shopB, // not pinged with it
      write: false,
      ownerStatus: 200,
    },
    {
      name: 'GET /photos/:id (a shop photo)',
      method: 'get',
      path: (id) => `/photos/${id}`,
      id: () => w.photoShopA,
      owner: () => shopA,
      sameRole: () => shopB,
      wrongRole: () => custB, // not the customer it was shown to
      write: false,
      ownerStatus: 200,
    },
    // "Le liya?"
    {
      name: 'POST /pickups/:id/answer',
      method: 'post',
      path: (id) => `/pickups/${id}/answer`,
      id: () => w.pickupA,
      owner: () => custA,
      sameRole: () => custB,
      wrongRole: () => shopA,
      body: () => ({ answer: 'found' }),
      write: true,
    },
  ];

  describe('authorization matrix: two customers, two shops', () => {
    it('has the fixtures it needs', () => {
      expect(w.listLinesA.length).toBeGreaterThan(0);
      expect(new Set([custA.userId, custB.userId, shopA.userId, shopB.userId]).size).toBe(4);
    });

    // Reads first, with the owner as the control that the route and the id are real.
    for (const route of routes.filter((r) => !r.write)) {
      it(`${route.name}: the owner reads it`, async () => {
        const res = await send(route, route.owner());
        expect(res.status).toBe(route.ownerStatus);
      });
    }

    for (const route of routes) {
      describe(route.name, () => {
        it('is 401 with no login', async () => {
          expect((await send(route, null)).status).toBe(401);
        });

        it("is 404 for another user of the same role, whatever they try, and says nothing about the owner's data", async () => {
          const res = await send(route, route.sameRole());
          expect(res.status).toBe(404);
          expect(res.body.error.code).toBe('not_found');
          expect(JSON.stringify(res.body)).not.toMatch(new RegExp(`${ADDRESS}|Asha|chini`, 'i'));
        });

        it('is 403 or 404 for the wrong role', async () => {
          const res = await send(route, route.wrongRole());
          expect([403, 404]).toContain(res.status);
        });

        it('is 404, never 400 or 500, for an id that is not an id', async () => {
          for (const id of [
            'not-a-uuid',
            GHOST,
            "1'; DROP TABLE users;--",
            '%00',
            'x'.repeat(300),
          ]) {
            const res = await send(route, route.owner(), id);
            expect(res.status, `${route.method} ${route.path(id).slice(0, 60)}`).toBe(404);
            expect(res.body.error.code).toBe('not_found');
          }
        });
      });
    }

    it('left everything as it was after all those refusals', async () => {
      const [order, list, errand, ping, pickup] = await Promise.all([
        pool.query(`SELECT state FROM delivery_orders WHERE id = $1`, [w.orderA]),
        pool.query(`SELECT state FROM shopping_lists WHERE id = $1`, [w.listA]),
        pool.query(`SELECT state FROM errands WHERE id = $1`, [w.errandA]),
        pool.query(`SELECT state FROM pings WHERE id = $1`, [w.pingB]),
        pool.query(`SELECT answer FROM pickup_visits WHERE id = $1`, [w.pickupA]),
      ]);
      expect(order.rows[0].state).toBe('ACCEPTED');
      expect(list.rows[0].state).not.toBe('STOPPED');
      expect(errand.rows[0].state).not.toBe('CANCELLED');
      // Withdrawn (NO_REPLY) when the customer ordered from shop A; never answered.
      expect(['QUEUED', 'SENT', 'NO_REPLY']).toContain(ping.rows[0].state);
      expect(pickup.rows[0].answer).toBeNull();
    });

    describe('things a user hands in that belong to someone else', () => {
      it("a customer cannot order from another customer's request, errand or list", async () => {
        for (const body of [
          { shopId: shopA.shopId, requestId: w.requestA, addressText: ADDRESS },
          { shopId: shopA.shopId, errandId: w.errandA, addressText: ADDRESS },
        ]) {
          const res = await request(app).post('/orders').set(auth(custB)).send(body);
          expect(res.status).toBe(404);
        }
        const listed = await request(app)
          .get('/orders')
          .query({ listId: w.listA })
          .set(auth(custB));
        expect(listed.status === 404 || (listed.status === 200 && listed.body.length === 0)).toBe(
          true,
        );
        for (const q of [{ requestId: w.requestA }, { errandId: w.errandA }]) {
          const res = await request(app).get('/orders').query(q).set(auth(custB));
          expect(res.status === 404 || (res.status === 200 && res.body.length === 0)).toBe(true);
        }
        expect((await request(app).get('/orders').set(auth(custB))).body).toEqual([]);
      });

      it("a customer cannot use another customer's saved address for delivery", async () => {
        const asRequest = await request(app).post('/requests').set(auth(custB)).send({
          q: 'chini',
          lat: ORIGIN.lat,
          lng: ORIGIN.lng,
          wantsDelivery: true,
          deliveryAddressId: w.addressA,
        });
        expect(asRequest.status).toBe(400);
        const asErrand = await request(app).post('/errands').set(auth(custB)).send({
          task: 'chini',
          lat: ORIGIN.lat,
          lng: ORIGIN.lng,
          wantsDelivery: true,
          deliveryAddressId: w.addressA,
        });
        expect(asErrand.status).toBe(400);
        const sorted = await request(app)
          .post('/lists/sort')
          .set(auth(custB))
          .send({ lines: ['chini'] });
        const asList = await request(app)
          .post(`/lists/${sorted.body.id}/send`)
          .set(auth(custB))
          .send({
            lat: ORIGIN.lat,
            lng: ORIGIN.lng,
            wantsDelivery: true,
            deliveryAddressId: w.addressA,
          });
        expect(asList.status).toBe(400);
      });

      it("saved-address routes only ever see the caller's own address", async () => {
        const mine = await request(app).get('/orders/saved-address').set(auth(custB));
        expect(JSON.stringify(mine.body)).not.toMatch(/Sapna|Asha/);
        expect((await request(app).delete('/orders/saved-address').set(auth(custB))).status).toBe(
          204,
        );
        const still = await request(app).get('/orders/saved-address').set(auth(custA));
        expect(JSON.stringify(still.body)).toContain('Sapna');
      });

      it("a customer cannot attach another customer's photo to a request", async () => {
        const res = await request(app)
          .post('/requests')
          .set(auth(custB))
          .send({ q: 'chini', lat: ORIGIN.lat, lng: ORIGIN.lng, photoId: w.photoA });
        expect(res.status).toBeGreaterThanOrEqual(400);
        expect(res.status).toBeLessThan(500);
      });

      it("a shop cannot attach another shop's photo to its answer", async () => {
        const res = await request(app)
          .post(`/pings/${w.pingB}/answer`)
          .set(auth(shopB))
          .send({ answer: 'yes', pricePaise: 4000, photoId: w.photoShopA });
        expect(res.status).toBeGreaterThanOrEqual(400);
        expect(res.status).toBeLessThan(500);
      });

      it("a customer cannot upload a photo into another customer's errand", async () => {
        const res = await request(app)
          .post('/photos')
          .query({ role: 'request', errandId: w.errandA, label: 'chini' })
          .set(auth(custB))
          .set('Content-Type', 'image/jpeg')
          .send(await jpeg());
        expect(res.status).toBe(404);
      });

      it("a customer cannot plant a pickup question about another customer's search", async () => {
        const res = await request(app)
          .post('/pickups')
          .set(auth(custB))
          .send({ shopId: shopA.shopId, itemId: w.itemId, requestId: w.requestA });
        expect(res.status).toBe(404);
      });

      it('a customer cannot read the shop side, and a shop cannot read the customer side', async () => {
        for (const path of [
          '/shops/me/pings',
          '/shops/me/lists',
          '/shops/me/orders',
          '/shops/me',
        ]) {
          expect((await request(app).get(path).set(auth(custA))).status, path).toBe(403);
        }
        for (const path of [
          '/requests',
          '/errands',
          '/orders',
          '/orders/saved-address',
          '/pickups/pending',
        ]) {
          expect((await request(app).get(path).set(auth(shopA))).status, path).toBe(403);
        }
        expect((await request(app).delete('/account').set(auth(shopA))).status).toBe(403);
      });

      it('admin routes answer 404 to every user token', async () => {
        for (const user of [custA, shopA]) {
          for (const [method, path] of [
            ['get', '/admin/ai/stats'],
            ['get', '/admin/errands/stats'],
            ['post', '/admin/sim/shops'],
            ['delete', '/admin/sim/shops'],
            ['post', '/admin/sim/ticket'],
            ['delete', '/admin/ai/cache'],
          ] as const) {
            expect((await request(app)[method](path).set(auth(user))).status, path).toBe(404);
          }
        }
      });
    });

    it('answers that need a login are never stored by a browser or a cache (no-store), private photos included', async () => {
      for (const [path, user] of [
        [`/requests/${w.requestA}`, custA],
        [`/orders/${w.orderA}`, custA],
        [`/photos/${w.photoA}`, custA],
        [`/photos/${w.photoShopA}`, shopA],
        ['/shops/me', shopA],
        ['/account', custA],
      ] as const) {
        const res = await request(app).get(path).set(auth(user));
        expect(res.status, path).toBe(200);
        expect(res.headers['cache-control'], path).toMatch(/no-store/);
      }
    });

    describe('the owner is not locked out', () => {
      it('shop A accepts, packs and the customer can still read the order', async () => {
        const accepted = await request(app).post(`/orders/${w.orderA}/accept`).set(auth(shopA));
        expect([200, 409]).toContain(accepted.status);
        const packed = await request(app)
          .put(`/orders/${w.orderA}/lines/0/packed`)
          .set(auth(shopA))
          .send({ packed: true });
        expect(packed.status).toBe(200);
        const out_of_range = await request(app)
          .put(`/orders/${w.orderA}/lines/999/packed`)
          .set(auth(shopA))
          .send({ packed: true });
        expect(out_of_range.status).toBe(404);
        expect((await request(app).get(`/orders/${w.orderA}`).set(auth(custA))).status).toBe(200);
      });

      it('shop B answers its own ping, shop A answers its own parchi, and the customer answers a pickup', async () => {
        const ping = await request(app)
          .post(`/pings/${w.pingB}/answer`)
          .set(auth(shopB))
          .send({ answer: 'no' });
        expect(ping.status).toBe(200);
        const parchi = await request(app)
          .post(`/list-pings/${w.listPingA}/answer`)
          .set(auth(shopA))
          .send(lineBody());
        expect(parchi.status).toBe(200);
        const pickup = await request(app)
          .post(`/pickups/${w.pickupA}/answer`)
          .set(auth(custA))
          .send({ answer: 'found' });
        expect(pickup.status).toBe(204);
      });
    });
  });

  // ---------------------------------------------------------------------------------------
  // 6. Input validation sweep
  // ---------------------------------------------------------------------------------------

  describe('every route with input rejects unknown fields and over-long text', () => {
    type Who = 'seeker' | 'shop' | 'admin' | 'none';
    interface Input {
      route: string;
      method: 'get' | 'post' | 'put' | 'patch' | 'delete';
      path: () => string;
      who: Who;
      /** A body or query that is valid on its own. */
      body?: () => Json;
      query?: () => Json;
      /** Fields to stuff past their limit, one at a time. */
      long?: { field: string; length: number; at?: (b: Json) => Json }[];
    }
    const text = (n: number) => 'a'.repeat(n);
    const inputs: Input[] = [
      {
        route: 'POST /auth/otp/request',
        method: 'post',
        path: () => '/auth/otp/request',
        who: 'none',
        body: () => ({ phone: '9800000001' }),
        long: [{ field: 'phone', length: 5000 }],
      },
      {
        route: 'POST /auth/otp/verify',
        method: 'post',
        path: () => '/auth/otp/verify',
        who: 'none',
        body: () => ({ phone: '9800000001', code: '123456', role: 'seeker' }),
        long: [
          { field: 'phone', length: 5000 },
          { field: 'code', length: 5000 },
        ],
      },
      {
        route: 'GET /dev/otp-inbox',
        method: 'get',
        path: () => '/dev/otp-inbox',
        who: 'none',
        query: () => ({ phone: '9800000001' }),
      },
      {
        route: 'GET /search',
        method: 'get',
        path: () => '/search',
        who: 'seeker',
        query: () => ({ q: 'chini', lat: ORIGIN.lat, lng: ORIGIN.lng }),
        long: [{ field: 'q', length: 201 }],
      },
      {
        route: 'POST /items/resolve',
        method: 'post',
        path: () => '/items/resolve',
        who: 'seeker',
        body: () => ({ q: 'chini' }),
        long: [{ field: 'q', length: 201 }],
      },
      {
        route: 'POST /route/plan',
        method: 'post',
        path: () => '/route/plan',
        who: 'seeker',
        body: () => ({
          start: { lat: 22.7, lng: 75.8 },
          stops: [{ shopId: 'a', lat: 22.7, lng: 75.8, label: 'A' }],
        }),
        long: [
          {
            field: 'stops',
            length: 0,
            at: (b) => ({ ...b, stops: [{ ...b['stops'][0], label: text(81) }] }),
          },
          {
            field: 'stops',
            length: 0,
            at: (b) => ({ ...b, stops: [{ ...b['stops'][0], shopId: text(500) }] }),
          },
        ],
      },
      {
        route: 'POST /requests',
        method: 'post',
        path: () => '/requests',
        who: 'seeker',
        body: () => ({ q: 'chini', lat: ORIGIN.lat, lng: ORIGIN.lng }),
        long: [{ field: 'q', length: 201 }],
      },
      {
        route: 'GET /requests/:id',
        method: 'get',
        path: () => `/requests/${w.requestA}`,
        who: 'seeker',
        query: () => ({ sort: 'price' }),
      },
      {
        route: 'POST /lists/sort',
        method: 'post',
        path: () => '/lists/sort',
        who: 'seeker',
        body: () => ({ lines: ['chini'] }),
        long: [
          { field: 'lines', length: 0, at: (b) => ({ ...b, lines: [text(1001)] }) },
          {
            field: 'lines',
            length: 0,
            at: (b) => ({ ...b, lines: Array.from({ length: 101 }, () => 'x') }),
          },
        ],
      },
      {
        route: 'POST /lists/:id/send',
        method: 'post',
        path: () => `/lists/${w.listA}/send`,
        who: 'seeker',
        body: () => ({ lat: ORIGIN.lat, lng: ORIGIN.lng }),
      },
      {
        route: 'POST /lists/:id/order',
        method: 'post',
        path: () => `/lists/${w.listA}/order`,
        who: 'seeker',
        body: () => ({
          assignments: [{ position: 0, shopId: shopA.shopId }],
          addressText: ADDRESS,
        }),
        long: [
          { field: 'addressText', length: 301 },
          { field: 'customerName', length: 61 },
          { field: 'note', length: 141 },
        ],
      },
      {
        route: 'POST /orders',
        method: 'post',
        path: () => '/orders',
        who: 'seeker',
        body: () => ({ shopId: shopA.shopId, requestId: w.requestA, addressText: ADDRESS }),
        long: [
          { field: 'addressText', length: 301 },
          { field: 'customerName', length: 61 },
          { field: 'note', length: 141 },
        ],
      },
      {
        route: 'GET /orders',
        method: 'get',
        path: () => '/orders',
        who: 'seeker',
        query: () => ({ requestId: w.requestA }),
      },
      {
        route: 'PUT /orders/saved-address',
        method: 'put',
        path: () => '/orders/saved-address',
        who: 'seeker',
        body: () => ({ addressText: ADDRESS }),
        long: [
          { field: 'addressText', length: 301 },
          { field: 'customerName', length: 61 },
        ],
      },
      {
        route: 'POST /orders/:id/cancel',
        method: 'post',
        path: () => `/orders/${w.orderA}/cancel`,
        who: 'seeker',
        body: () => ({ reason: 'changed my mind' }),
        long: [
          { field: 'reason', length: 141 },
          { field: 'text', length: 141 },
        ],
      },
      {
        route: 'POST /errands',
        method: 'post',
        path: () => '/errands',
        who: 'seeker',
        body: () => ({ task: 'chini', lat: ORIGIN.lat, lng: ORIGIN.lng }),
        long: [{ field: 'task', length: 501 }],
      },
      {
        route: 'POST /errands/:id/modes',
        method: 'post',
        path: () => `/errands/${w.errandA}/modes`,
        who: 'seeker',
        body: () => ({ shopId: shopA.shopId, mode: 'pickup' }),
      },
      {
        route: 'POST /errands/:id/answer',
        method: 'post',
        path: () => `/errands/${w.errandA}/answer`,
        who: 'seeker',
        body: () => ({ text: 'haan' }),
        long: [{ field: 'text', length: 501 }],
      },
      {
        route: 'POST /pickups',
        method: 'post',
        path: () => '/pickups',
        who: 'seeker',
        body: () => ({ shopId: shopA.shopId, itemId: w.itemId, requestId: w.requestA }),
      },
      {
        route: 'POST /pickups/:id/answer',
        method: 'post',
        path: () => `/pickups/${w.pickupA}/answer`,
        who: 'seeker',
        body: () => ({ answer: 'found' }),
      },
      {
        route: 'POST /photos',
        method: 'post',
        path: () => '/photos',
        who: 'seeker',
        query: () => ({ role: 'request' }),
      },
      {
        route: 'POST /account/logout',
        method: 'post',
        path: () => '/account/logout',
        who: 'seeker',
        body: () => ({}),
        long: [{ field: 'pushEndpoint', length: 2049 }],
      },
      {
        route: 'POST /push/subscribe',
        method: 'post',
        path: () => '/push/subscribe',
        who: 'seeker',
        body: () => ({
          endpoint: 'https://fcm.googleapis.com/fcm/send/x',
          keys: { p256dh: 'k', auth: 'a' },
        }),
        long: [{ field: 'endpoint', length: 2049 }],
      },
      {
        route: 'POST /push/unsubscribe',
        method: 'post',
        path: () => '/push/unsubscribe',
        who: 'seeker',
        body: () => ({ endpoint: 'https://fcm.googleapis.com/fcm/send/x' }),
        long: [{ field: 'endpoint', length: 2049 }],
      },
      {
        route: 'PATCH /shops/me',
        method: 'patch',
        path: () => '/shops/me',
        who: 'shop',
        body: () => ({ name: 'Kirana' }),
        long: [{ field: 'name', length: 81 }],
      },
      {
        route: 'PUT /shops/me/open',
        method: 'put',
        path: () => '/shops/me/open',
        who: 'shop',
        body: () => ({ open: true }),
      },
      {
        route: 'GET /shops/me/demand',
        method: 'get',
        path: () => '/shops/me/demand',
        who: 'shop',
        query: () => ({ days: '1' }),
      },
      {
        route: 'POST /pings/:id/answer',
        method: 'post',
        path: () => `/pings/${w.pingB}/answer`,
        who: 'shop',
        body: () => ({ answer: 'no' }),
      },
      {
        route: 'POST /list-pings/:id/answer',
        method: 'post',
        path: () => `/list-pings/${w.listPingA}/answer`,
        who: 'shop',
        body: () => ({ lines: w.listLinesA.map((l) => ({ lineId: l['lineId'], have: false })) }),
      },
      {
        route: 'PUT /orders/:id/lines/:index/packed',
        method: 'put',
        path: () => `/orders/${w.orderA}/lines/0/packed`,
        who: 'shop',
        body: () => ({ packed: true }),
      },
      {
        route: 'POST /admin/sim/shops',
        method: 'post',
        path: () => '/admin/sim/shops',
        who: 'admin',
        body: () => ({ count: 1, centre: { lat: 22.7, lng: 75.8 }, radiusM: 500, seed: 1 }),
      },
    ];

    const as = (who: Who) =>
      who === 'seeker'
        ? auth(custA)
        : who === 'shop'
          ? auth(shopA)
          : who === 'admin'
            ? { Authorization: `Bearer ${TEST_ADMIN_TOKEN}` }
            : {};
    const call = (i: Input, over: { body?: Json | undefined; query?: Json | undefined }) => {
      let r = request(app)[i.method](i.path());
      if (i.who !== 'none') r = r.set(as(i.who));
      if (over.query) r = r.query(over.query);
      return over.body ? r.send(over.body) : r;
    };

    for (const i of inputs) {
      describe(i.route, () => {
        if (i.body) {
          it('rejects a field it does not know in the body', async () => {
            const res = await call(i, {
              body: { ...(i.body?.() ?? {}), surprise: 1 },
              query: i.query?.(),
            });
            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('invalid_request');
            expect(res.body.error.message).toMatch(/Unrecognized key/i);
          });
        }
        if (i.query) {
          it('rejects a query parameter it does not know', async () => {
            const res = await call(i, {
              query: { ...(i.query?.() ?? {}), surprise: 1 },
              body: i.body?.(),
            });
            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('invalid_request');
          });
        }
        for (const l of i.long ?? []) {
          it(`rejects ${l.field} past its limit (${l.length || 'custom'})`, async () => {
            // Text goes where the route reads it: the body, or the query string of a GET.
            const inQuery = i.body === undefined;
            const valid = (inQuery ? i.query?.() : i.body?.()) ?? {};
            const stuffed = l.at ? l.at(valid) : { ...valid, [l.field]: text(l.length) };
            const res = await call(
              i,
              inQuery ? { query: stuffed } : { body: stuffed, query: i.query?.() },
            );
            expect(res.status).toBe(400);
            expect(res.body.error.code).toMatch(/invalid|too_|long/);
          });
        }
      });
    }

    it('rejects a body that is not an object, on every route that reads one', async () => {
      for (const i of inputs.filter((x) => x.body)) {
        for (const body of [[], 'text', 42, null]) {
          let r = request(app)[i.method](i.path()).set('Content-Type', 'application/json');
          if (i.who !== 'none') r = r.set(as(i.who));
          const res = await r.send(JSON.stringify(body));
          expect(res.status, `${i.route} <- ${JSON.stringify(body)}`).toBeGreaterThanOrEqual(400);
          expect(res.status, `${i.route} <- ${JSON.stringify(body)}`).toBeLessThan(500);
        }
      }
    });
  });

  // ---------------------------------------------------------------------------------------
  // 1. Rate limits on the dear routes, through the real app
  // ---------------------------------------------------------------------------------------

  describe('rate limits on the expensive routes', () => {
    let nthIp = 0;
    const ip = () => `10.20.30.${++nthIp}`;
    const ipHeader = (address: string) => ({ 'X-Forwarded-For': address });
    const fresh = async (role: Role = 'seeker') => loginAs(limitedApp, role, String(phone++));
    const limited = (
      count: number,
      call: (n: number) => request.Test,
    ): Promise<request.Response[]> => {
      return Array.from({ length: count }, (_, n) => n).reduce<Promise<request.Response[]>>(
        async (acc, n) => [...(await acc), await call(n)],
        Promise.resolve([]),
      );
    };

    it('GET /search: 30 a minute per user, then 429 with Retry-After; another user is fine', async () => {
      const a = await fresh();
      const b = await fresh();
      const address = ip();
      const search = (u: User) =>
        request(limitedApp)
          .get('/search')
          .query({ q: 'chini', lat: ORIGIN.lat, lng: ORIGIN.lng })
          .set(auth(u))
          .set(ipHeader(address));
      const first = await limited(30, () => search(a));
      expect(first.every((r) => r.status === 200)).toBe(true);
      const over = await search(a);
      expect(over.status).toBe(429);
      expect(over.body.error.code).toBe('rate_limited');
      expect(Number(over.headers['retry-after'])).toBeGreaterThan(0);
      expect((await search(b)).status).toBe(200);
    }, 120_000);

    it('GET /search: 60 a minute per IP, whoever is signed in', async () => {
      const users = await Promise.all([fresh(), fresh(), fresh(), fresh()]);
      const address = ip();
      const search = (u: User) =>
        request(limitedApp)
          .get('/search')
          .query({ q: 'chini', lat: ORIGIN.lat, lng: ORIGIN.lng })
          .set(auth(u))
          .set(ipHeader(address));
      for (const u of users.slice(0, 2)) {
        for (let n = 0; n < 30; n++) expect((await search(u)).status).toBe(200);
      }
      const third = await search(users[2] as User);
      expect(third.status).toBe(429);
      expect(third.headers['retry-after']).toBeDefined();
      // Another address is untouched.
      const elsewhere = await request(limitedApp)
        .get('/search')
        .query({ q: 'chini', lat: ORIGIN.lat, lng: ORIGIN.lng })
        .set(auth(users[3] as User))
        .set(ipHeader(ip()));
      expect(elsewhere.status).toBe(200);
    }, 180_000);

    it('POST /items/resolve: 30 a minute per user', async () => {
      const a = await fresh();
      const address = ip();
      const resolve = () =>
        request(limitedApp)
          .post('/items/resolve')
          .set(auth(a))
          .set(ipHeader(address))
          .send({ q: 'chini' });
      const first = await limited(30, resolve);
      expect(first.every((r) => r.status === 200)).toBe(true);
      expect((await resolve()).status).toBe(429);
    }, 120_000);

    it('POST /lists/sort: 10 a minute per user', async () => {
      const a = await fresh();
      const address = ip();
      const sort = () =>
        request(limitedApp)
          .post('/lists/sort')
          .set(auth(a))
          .set(ipHeader(address))
          .send({ lines: ['chini'] });
      const first = await limited(10, sort);
      expect(first.every((r) => r.status === 201)).toBe(true);
      const over = await sort();
      expect(over.status).toBe(429);
      expect(over.headers['retry-after']).toBeDefined();
    }, 60_000);

    it('POST /route/plan: 20 a minute per user', async () => {
      const a = await fresh();
      const address = ip();
      const plan = () =>
        request(limitedApp)
          .post('/route/plan')
          .set(auth(a))
          .set(ipHeader(address))
          .send({
            start: { lat: 22.7, lng: 75.8 },
            stops: [{ shopId: 's', lat: 22.71, lng: 75.81, label: 'S' }],
          });
      const first = await limited(20, plan);
      expect(first.every((r) => r.status === 200)).toBe(true);
      expect((await plan()).status).toBe(429);
    }, 60_000);

    it('POST /requests: 20 an hour per user (refused tries count too)', async () => {
      const a = await fresh();
      const address = ip();
      const ask = () =>
        request(limitedApp).post('/requests').set(auth(a)).set(ipHeader(address)).send({});
      const first = await limited(20, ask);
      expect(first.every((r) => r.status === 400)).toBe(true);
      const over = await ask();
      expect(over.status).toBe(429);
      expect(Number(over.headers['retry-after'])).toBeGreaterThan(60);
    }, 60_000);

    it('POST /photos: 20 an hour per user', async () => {
      const a = await fresh();
      const address = ip();
      const upload = () =>
        request(limitedApp)
          .post('/photos')
          .query({ role: 'bad' })
          .set(auth(a))
          .set(ipHeader(address))
          .set('Content-Type', 'image/jpeg')
          .send(Buffer.from('x'));
      const first = await limited(20, upload);
      expect(first.every((r) => r.status === 400)).toBe(true);
      expect((await upload()).status).toBe(429);
    }, 60_000);

    it('a limit is one route: filling /lists/sort leaves /search and /requests open', async () => {
      const a = await fresh();
      const address = ip();
      for (let n = 0; n < 11; n++) {
        await request(limitedApp)
          .post('/lists/sort')
          .set(auth(a))
          .set(ipHeader(address))
          .send({ lines: [] });
      }
      const search = await request(limitedApp)
        .get('/search')
        .query({ q: 'chini', lat: ORIGIN.lat, lng: ORIGIN.lng })
        .set(auth(a))
        .set(ipHeader(address));
      expect(search.status).toBe(200);
    });

    it('the limit belongs to the user, not to the token: a second login does not reset it', async () => {
      const phoneNumber = String(phone++);
      const first = await loginAs(limitedApp, 'seeker', phoneNumber);
      const address = ip();
      const sort = (u: User) =>
        request(limitedApp)
          .post('/lists/sort')
          .set(auth(u))
          .set(ipHeader(address))
          .send({ lines: ['chini'] });
      await limited(10, () => sort(first));
      expect((await sort(first)).status).toBe(429);
      const again = await loginAs(limitedApp, 'seeker', phoneNumber);
      expect(again.userId).toBe(first.userId);
      expect((await sort(again)).status).toBe(429);
    }, 60_000);

    it('the broad per-IP baseline covers every API route, and /health is exempt', async () => {
      const tight = createApp({
        config: testConfig({ rateLimitScale: 1 }),
        logger: quiet,
        db: pool,
        rateLimits: { apiPerIpPerMinute: 5 },
      });
      const address = ipHeader(ip());
      for (let n = 0; n < 20; n++) {
        expect((await request(tight).get('/health').set(address)).status).toBe(200);
      }
      for (let n = 0; n < 5; n++) {
        expect((await request(tight).get('/requests').set(address)).status).toBe(401);
      }
      const over = await request(tight).get('/requests').set(address);
      expect(over.status).toBe(429);
      expect(over.headers['retry-after']).toBeDefined();
      expect(over.body.error.code).toBe('rate_limited');
      // Even a login is counted, and /health still answers.
      expect((await request(tight).post('/auth/otp/request').set(address).send({})).status).toBe(
        429,
      );
      expect((await request(tight).get('/health').set(address)).status).toBe(200);
    });

    it('the default baseline is 300 a minute per IP', async () => {
      const dflt = createApp({
        config: testConfig({ rateLimitScale: 1 }),
        logger: quiet,
        db: pool,
      });
      const address = ipHeader(ip());
      let first429 = 0;
      for (let n = 1; n <= 305 && !first429; n++) {
        const res = await request(dflt).get('/requests').set(address);
        if (res.status === 429) first429 = n;
      }
      expect(first429).toBe(301);
    }, 120_000);
  });
});
