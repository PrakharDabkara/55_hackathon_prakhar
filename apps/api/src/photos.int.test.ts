import { Writable } from 'node:stream';
import type { Pool } from 'pg';
import { pino } from 'pino';
import request from 'supertest';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { createAi, createFakeProvider, type FakeProvider } from './modules/ai/index.js';
import { loadSeedCatalog, seedCatalog } from './modules/catalog/index.js';
import { createErrand, limitsFromConfig, runErrand } from './modules/errands/index.js';
import { fanOutPings, type PingClaims } from './modules/requests/index.js';
import { sweepPhotos } from './modules/photos/index.js';
import { testConfig } from './testing/config.js';
import { north, ORIGIN } from './testing/fixtures.js';
import { loginAs } from './testing/login.js';
import { startPostgres, type TestDatabase } from './testing/startPostgres.js';
import { truncateKeepingShops } from './testing/truncate.js';

const lines: string[] = [];
const sink = new Writable({
  write(chunk, _enc, done) {
    lines.push(String(chunk));
    done();
  },
});
const logger = pino({ level: 'info' }, sink);
const claimsAll: PingClaims = { claim: async () => true, release: async () => undefined };

const jpeg = (width = 640, height = 480) =>
  sharp({ create: { width, height, channels: 3, background: { r: 30, g: 120, b: 200 } } })
    .jpeg()
    .withMetadata({
      exif: {
        IFD0: { Make: 'PhoneCo' },
        IFD3: {
          GPSLatitudeRef: 'N',
          GPSLatitude: '22/1 43/1 11/1',
          GPSLongitudeRef: 'E',
          GPSLongitude: '75/1 51/1 28/1',
        },
      },
    })
    .toBuffer();

// ADR-0030: optional photos on both sides, stored in Postgres, served only to the people in the loop.
describe('photos', () => {
  let testDb: TestDatabase;
  let pool: Pool;
  let app: ReturnType<typeof createApp>;
  let phone = 9_890_000_000;
  type User = { token: string; userId: string };
  let seeker: User;
  let other: User;
  let shopA: User & { shopId: string };
  let shopB: User & { shopId: string };
  let stranger: User;

  beforeAll(async () => {
    testDb = await startPostgres();
    pool = testDb.pool;
    await seedCatalog(pool, loadSeedCatalog());
    app = createApp({ config: testConfig({ photoStorageCapMb: 1 }), logger, db: pool });
    seeker = await loginAs(app, 'seeker', String(phone++));
    other = await loginAs(app, 'seeker', String(phone++));
    const mk = async (name: string, km: number) => {
      const u = await loginAs(app, 'shop', String(phone++));
      const res = await request(app)
        .post('/shops')
        .set(auth(u))
        .send({ name, lat: north(km), lng: ORIGIN.lng, categories: ['grocery'] });
      return { ...u, shopId: res.body.id as string };
    };
    shopA = await mk('Pinged A', 0.2);
    shopB = await mk('Far B', 0.4);
    stranger = await loginAs(app, 'shop', String(phone++));
  }, 300_000);
  afterAll(async () => {
    await testDb?.stop();
  });
  beforeEach(async () => {
    await truncateKeepingShops(pool, 'photos, requests, pings, shop_stock');
    lines.length = 0;
  });

  function auth(u: { token: string }) {
    return { Authorization: `Bearer ${u.token}` };
  }
  const upload = (u: User, body: Buffer, query: Record<string, string> = { role: 'request' }) =>
    request(app)
      .post('/photos')
      .query(query)
      .set(auth(u))
      .set('Content-Type', 'image/jpeg')
      .send(body);
  const photoOf = async (u: User, role = 'request') =>
    (await upload(u, await jpeg(), { role })).body.id as string;
  const get = (u: User | null, id: string) => {
    const r = request(app).get(`/photos/${id}`);
    return u ? r.set(auth(u)) : r;
  };
  const ask = (photoId?: string, user = seeker) =>
    request(app)
      .post('/requests')
      .set(auth(user))
      .send({ q: 'chini', lat: ORIGIN.lat, lng: ORIGIN.lng, ...(photoId && { photoId }) });
  const fanOut = (requestId: string) =>
    fanOutPings({ db: pool, logger, config: { maxPings: 1 } }, requestId, claimsAll);

  describe('upload', () => {
    it('re-encodes the picture and stores it with no metadata; the answer carries no bytes', async () => {
      const res = await upload(seeker, await jpeg());
      expect(res.status).toBe(201);
      expect(res.body).toEqual({
        id: expect.any(String),
        mime: 'image/jpeg',
        size: expect.any(Number),
      });
      const { rows } = await pool.query(
        `SELECT data, mime, size, owner_user_id, role FROM photos WHERE id = $1`,
        [res.body.id],
      );
      expect(rows[0]).toMatchObject({
        mime: 'image/jpeg',
        owner_user_id: seeker.userId,
        role: 'request',
        size: res.body.size,
      });
      const meta = await sharp(rows[0].data).metadata();
      expect(meta.exif).toBeUndefined();
      expect(rows[0].data.toString('latin1')).not.toMatch(/GPS|PhoneCo/);
    });

    it('is for the right side only: customers upload request photos, shops answer photos', async () => {
      expect((await upload(shopA, await jpeg(), { role: 'request' })).status).toBe(403);
      expect((await upload(seeker, await jpeg(), { role: 'answer' })).status).toBe(403);
      expect((await upload(shopA, await jpeg(), { role: 'answer' })).status).toBe(201);
      expect(
        (
          await request(app)
            .post('/photos')
            .query({ role: 'request' })
            .send(await jpeg())
        ).status,
      ).toBe(401);
      expect((await upload(seeker, await jpeg(), { role: 'other' })).status).toBe(400);
    });

    it('refuses by magic bytes: GIF, SVG and text, whatever the client calls them', async () => {
      for (const body of [
        Buffer.from('GIF89a' + 'x'.repeat(100)),
        Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
        Buffer.from('plain words, named photo.jpg'),
      ]) {
        const res = await upload(seeker, body);
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('invalid_image');
      }
      expect((await pool.query(`SELECT 1 FROM photos`)).rowCount).toBe(0);
    });

    it('refuses more than 400 KB with 413, and accepts what is just under', async () => {
      const big = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(401 * 1024)]);
      const res = await upload(seeker, big);
      expect(res.status).toBe(413);
      expect(res.body.error.code).toBe('photo_too_large');
    });

    it('allows 10 photos per user per day and not an 11th; another user and a new day are fine', async () => {
      const body = await jpeg(100, 100);
      for (let n = 0; n < 10; n++)
        expect((await upload(seeker, body)).status, `#${n + 1}`).toBe(201);
      const eleventh = await upload(seeker, body);
      expect(eleventh.status).toBe(429);
      expect(eleventh.body.error.code).toBe('photo_limit');
      expect((await upload(other, body)).status).toBe(201);
      await pool.query(`UPDATE photos SET created_at = now() - interval '25 hours'`);
      expect((await upload(seeker, body)).status).toBe(201);
    });

    it('refuses uploads over the storage cap and logs the total stored size', async () => {
      // The app runs with a 1 MB cap: fill it with a row, then one more picture does not fit.
      await pool.query(
        `INSERT INTO photos (owner_user_id, role, data, mime, size) VALUES ($1, 'request', $2, 'image/jpeg', $3)`,
        [other.userId, Buffer.alloc(10), 1024 * 1024 - 5],
      );
      const res = await upload(seeker, await jpeg(400, 300));
      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe('photo_storage_full');
      expect(lines.join('')).toMatch(/"event":"photo_storage_full"/);
      await truncateKeepingShops(pool, 'photos');
      await upload(seeker, await jpeg(400, 300));
      const logged = lines.map((l) => JSON.parse(l)).find((l) => l.event === 'photo_stored');
      expect(logged).toMatchObject({
        totalBytes: expect.any(Number),
        photoBytes: expect.any(Number),
      });
      expect(JSON.stringify(logged)).not.toContain(seeker.userId);
    });
  });

  describe('who may see a photo (GET /photos/:id, with auth)', () => {
    it('a customer photo: the customer and the shops the request went to, nobody else', async () => {
      const id = await photoOf(seeker);
      const made = await ask(id);
      expect(made.status).toBe(201);
      await fanOut(made.body.id);
      const pinged = (
        await pool.query<{ shop_id: string }>(`SELECT shop_id FROM pings WHERE request_id = $1`, [
          made.body.id,
        ])
      ).rows.map((r) => r.shop_id);
      expect(pinged).toEqual([shopA.shopId]); // maxPings 1: shop B was not asked
      for (const ok of [seeker, shopA]) {
        const res = await get(ok, id);
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toBe('image/jpeg');
        expect(res.headers['cache-control']).toMatch(/private/);
        expect(res.headers['cache-control']).not.toMatch(/public/);
        expect(res.headers['x-content-type-options']).toBe('nosniff');
        expect(res.body.length).toBeGreaterThan(100);
      }
      for (const no of [shopB, other, stranger]) expect((await get(no, id)).status).toBe(404);
      expect((await get(null, id)).status).toBe(401);
    });

    it("a photo not yet attached to anything is the uploader's alone", async () => {
      const id = await photoOf(seeker);
      expect((await get(seeker, id)).status).toBe(200);
      for (const no of [other, shopA]) expect((await get(no, id)).status).toBe(404);
    });

    it('a shop photo: that shop and the customer who asked, nobody else (not even another pinged shop)', async () => {
      const made = await ask();
      await pool.query(`UPDATE shops SET categories = ARRAY['grocery']`);
      await fanOutPings({ db: pool, logger, config: { maxPings: 10 } }, made.body.id, claimsAll);
      const pings = await pool.query<{ id: string; shop_id: string }>(
        `SELECT id, shop_id FROM pings WHERE request_id = $1`,
        [made.body.id],
      );
      expect(pings.rowCount).toBe(2);
      const pingA = pings.rows.find((p) => p.shop_id === shopA.shopId)?.id;
      const photo = await photoOf(shopA, 'answer');
      const yes = await request(app)
        .post(`/pings/${pingA}/answer`)
        .set(auth(shopA))
        .send({ answer: 'yes', pricePaise: 5000, photoId: photo });
      expect(yes.status).toBe(200);
      for (const ok of [shopA, seeker]) expect((await get(ok, photo)).status).toBe(200);
      for (const no of [shopB, other, stranger]) expect((await get(no, photo)).status).toBe(404);
    });

    it('the shop card carries the customer photo id, and the customer sees the shop photo id on the result', async () => {
      const customerPhoto = await photoOf(seeker);
      const made = await ask(customerPhoto);
      await fanOut(made.body.id);
      const card = await request(app).get('/shops/me/pings').set(auth(shopA));
      expect(card.body[0].photoId).toBe(customerPhoto);
      const raw = JSON.stringify(card.body);
      expect(raw).not.toContain(seeker.userId);

      const shopPhoto = await photoOf(shopA, 'answer');
      await request(app)
        .post(`/pings/${card.body[0].id}/answer`)
        .set(auth(shopA))
        .send({ answer: 'yes', pricePaise: 4500, photoId: shopPhoto });
      const view = await request(app).get(`/requests/${made.body.id}`).set(auth(seeker));
      expect(view.body.results[0]).toMatchObject({ shopId: shopA.shopId, photoId: shopPhoto });
      const none = await request(app).get('/shops/me/pings').set(auth(shopB));
      expect(none.body).toEqual([]);
    });
  });

  describe('attaching', () => {
    it('uses only your own, unused photo of the right kind', async () => {
      const mine = await photoOf(seeker);
      expect((await ask(mine, other)).status).toBe(404); // someone else's photo
      expect((await ask('11111111-2222-4333-8444-555555555555')).status).toBe(404);
      const answerPhoto = await photoOf(shopA, 'answer');
      expect((await ask(answerPhoto)).status).toBe(404);
      expect((await ask(mine)).status).toBe(201);
      const again = await request(app)
        .post('/requests')
        .set(auth(seeker))
        .set('Idempotency-Key', 'second-ask')
        .send({ q: 'namak', lat: ORIGIN.lat, lng: ORIGIN.lng, photoId: mine });
      expect(again.status).toBe(409);
      expect(again.body.error.code).toBe('photo_taken');
    });

    it('a photo comes only with a yes', async () => {
      const made = await ask();
      await fanOut(made.body.id);
      const ping = (await request(app).get('/shops/me/pings').set(auth(shopA))).body[0];
      const photo = await photoOf(shopA, 'answer');
      const no = await request(app)
        .post(`/pings/${ping.id}/answer`)
        .set(auth(shopA))
        .send({ answer: 'no', photoId: photo });
      expect(no.status).toBe(400);
    });
  });

  describe('the sweeper (7 days after the request expires)', () => {
    it('deletes photos of a request that expired more than 7 days ago, keeps newer ones, and unattached ones after a day', async () => {
      const old = await photoOf(seeker);
      const recent = await photoOf(other);
      const loose = await photoOf(seeker);
      const looseNew = await photoOf(seeker);
      const a = await ask(old);
      const b = await ask(recent, other);
      await pool.query(`UPDATE requests SET expires_at = now() - interval '8 days' WHERE id = $1`, [
        a.body.id,
      ]);
      await pool.query(`UPDATE requests SET expires_at = now() - interval '6 days' WHERE id = $1`, [
        b.body.id,
      ]);
      await pool.query(`UPDATE photos SET created_at = now() - interval '25 hours' WHERE id = $1`, [
        loose,
      ]);
      const result = await sweepPhotos({ db: pool, logger }, new Date());
      expect(result.deleted).toBe(2);
      const left = (await pool.query<{ id: string }>(`SELECT id FROM photos`)).rows.map(
        (r) => r.id,
      );
      expect(left.sort()).toEqual([recent, looseNew].sort());
      expect(lines.map((l) => JSON.parse(l)).find((l) => l.event === 'photos_swept')).toMatchObject(
        {
          deleted: 2,
          totalBytes: expect.any(Number),
        },
      );
    });

    it('deletes a shop photo with its request', async () => {
      const made = await ask();
      await fanOut(made.body.id);
      const ping = (await request(app).get('/shops/me/pings').set(auth(shopA))).body[0];
      const photo = await photoOf(shopA, 'answer');
      await request(app)
        .post(`/pings/${ping.id}/answer`)
        .set(auth(shopA))
        .send({ answer: 'yes', photoId: photo });
      await pool.query(
        `UPDATE requests SET expires_at = now() - interval '8 days', state = 'EXPIRED'`,
      );
      expect((await sweepPhotos({ db: pool, logger }, new Date())).deleted).toBe(1);
      expect((await get(shopA, photo)).status).toBe(404);
    });
  });
});

// A photo on a checklist item follows the item to the shops, and never goes to a model.
describe('photos on an errand item', () => {
  let testDb: TestDatabase;
  let pool: Pool;
  let app: ReturnType<typeof createApp>;
  let provider: FakeProvider;
  let seeker: { token: string; userId: string };
  let shop: { token: string; userId: string; shopId: string };
  const config = testConfig();
  const limits = { ...limitsFromConfig(config), userHourlyLimit: 10_000, resumeDebounceMs: 0 };
  const call = (name: string, args: Record<string, unknown>) => ({ name, args });

  beforeAll(async () => {
    testDb = await startPostgres();
    pool = testDb.pool;
    await seedCatalog(pool, loadSeedCatalog());
    app = createApp({ config, logger, db: pool });
    seeker = await loginAs(app, 'seeker', '9891000001');
    const u = await loginAs(app, 'shop', '9891000002');
    const made = await request(app)
      .post('/shops')
      .set({ Authorization: `Bearer ${u.token}` })
      .send({ name: 'Stationer', lat: north(0.2), lng: ORIGIN.lng, categories: ['stationery'] });
    shop = { ...u, shopId: made.body.id };
  }, 300_000);
  afterAll(async () => {
    await testDb?.stop();
  });

  it('the photo is attached to the request the agent opens for that item, shown to the shop, and its answer photo reaches the plan; no model ever sees a photo', async () => {
    provider = createFakeProvider();
    const ai = createAi({
      provider,
      db: pool,
      logger,
      embedThreshold: 0.8,
      embedMargin: 0.05,
      limiter: { allow: async () => true },
      client: { backoffMs: 1 },
    });
    const { id } = await createErrand({ db: pool, logger, limits }, seeker.userId, {
      task: 'chart paper chahiye',
      lat: ORIGIN.lat,
      lng: ORIGIN.lng,
      requestId: 'req-photo-1',
    });
    const mine = { Authorization: `Bearer ${seeker.token}` };
    const up = await request(app)
      .post('/photos')
      .query({ role: 'request', errandId: id, label: 'Chart Paper' })
      .set(mine)
      .send(await jpeg());
    expect(up.status).toBe(201);
    // Someone else's errand is not yours to attach to.
    const other = await loginAs(app, 'seeker', '9891000003');
    const denied = await request(app)
      .post('/photos')
      .query({ role: 'request', errandId: id, label: 'x' })
      .set({ Authorization: `Bearer ${other.token}` })
      .send(await jpeg());
    expect(denied.status).toBe(404);

    let itemId = '';
    provider.playChat([
      { toolCalls: [call('resolve_item', { text: 'chart paper' })] },
      async () => {
        itemId = (
          await pool.query<{ id: string }>(`SELECT id FROM items WHERE slug = 'chart-paper'`)
        ).rows[0]?.id as string;
        return { toolCalls: [call('ask_shops', { itemId })] };
      },
      async () => ({
        toolCalls: [
          call('submit_plan', {
            items: [{ text: 'chart paper', itemId, status: 'confirmed', shopId: shop.shopId }],
          }),
        ],
      }),
    ]);
    const deps = { db: pool, logger, ai, limits, trigramThreshold: 0.4 };
    expect((await runErrand(deps, id)).outcome).toBe('waiting');

    const linked = await pool.query(`SELECT request_id FROM photos WHERE id = $1`, [up.body.id]);
    expect(linked.rows[0].request_id).not.toBeNull();
    await fanOutPings(
      { db: pool, logger, config: { maxPings: 10 } },
      linked.rows[0].request_id,
      claimsAll,
    );
    const card = await request(app)
      .get('/shops/me/pings')
      .set({ Authorization: `Bearer ${shop.token}` });
    expect(card.body[0].photoId).toBe(up.body.id);

    const shopPhoto = (
      await request(app)
        .post('/photos')
        .query({ role: 'answer' })
        .set({ Authorization: `Bearer ${shop.token}` })
        .send(await jpeg())
    ).body.id;
    await request(app)
      .post(`/pings/${card.body[0].id}/answer`)
      .set({ Authorization: `Bearer ${shop.token}` })
      .send({ answer: 'yes', pricePaise: 1500, photoId: shopPhoto });
    await pool.query(`UPDATE errands SET lease_until = NULL`);
    await runErrand(deps, id);

    const view = await request(app).get(`/errands/${id}`).set(mine);
    expect(view.body.state).toBe('PLAN_READY');
    expect(view.body.plan.items[0]).toMatchObject({ status: 'confirmed', photoId: shopPhoto });
    expect((await request(app).get(`/photos/${shopPhoto}`).set(mine)).status).toBe(200);

    // Photos never leave the server: not the bytes, not the id, not even the word.
    const sent = JSON.stringify(provider.calls);
    for (const secret of [up.body.id, shopPhoto, 'photoId', 'photo'])
      expect(sent).not.toContain(secret);
  }, 60_000);
});
