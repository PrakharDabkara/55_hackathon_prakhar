import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { Redis } from 'ioredis';
import type { Pool } from 'pg';
import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { loadSeedCatalog, seedCatalog } from './modules/catalog/index.js';
import { createRealtime, type EventPublisher, type Realtime } from './modules/realtime/index.js';
import {
  answerPing,
  applyRequestEvent,
  createRequest,
  expireRequest,
  fanOutPings,
  type RequestsContext,
} from './modules/requests/index.js';
import { testConfig } from './testing/config.js';
import { north, ORIGIN } from './testing/fixtures.js';
import { loginAs } from './testing/login.js';
import { openSse, type SseStream } from './testing/sseClient.js';
import { startPostgres, type TestDatabase } from './testing/startPostgres.js';
import { startRedis } from './testing/startRedis.js';
import { waitFor } from './testing/waitFor.js';
import { startWorkers, type Workers } from './workers/index.js';

type User = { token: string; userId: string };
type Shop = User & { shopId: string };

describe('realtime over SSE', () => {
  let testDb: TestDatabase;
  let pool: Pool;
  let redis: Awaited<ReturnType<typeof startRedis>>;
  let probe: Redis;
  let realtime: Realtime;
  let shortRealtime: Realtime; // a second API instance: tickets live 1 s
  let workers: Workers;
  let app: ReturnType<typeof createApp>;
  let shortApp: ReturnType<typeof createApp>;
  let server: Server;
  let shortServer: Server;
  let base: string;
  let shortBase: string;
  let seekerA: User;
  let seekerB: User;
  let phone = 9_850_000_000;
  const logLines: string[] = [];
  const streams: SseStream[] = [];
  const logger = pino({ level: 'info' }, { write: (line: string) => void logLines.push(line) });
  const quiet = pino({ level: 'silent' });

  beforeAll(async () => {
    [testDb, redis] = await Promise.all([startPostgres(), startRedis()]);
    pool = testDb.pool;
    await seedCatalog(pool, loadSeedCatalog());
    probe = new Redis(redis.url);

    const config = testConfig({ workersEnabled: true, redisUrl: redis.url });
    realtime = createRealtime({ redisUrl: redis.url, logger, heartbeatMs: 100 });
    workers = startWorkers({ config, db: pool, logger: quiet, events: realtime.events }) as Workers;
    app = createApp({ config, logger, db: pool, requestHooks: workers.hooks, realtime });
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    shortRealtime = createRealtime({
      redisUrl: redis.url,
      logger: quiet,
      heartbeatMs: 100,
      ticketTtlSeconds: 1,
    });
    shortApp = createApp({ config, logger: quiet, db: pool, realtime: shortRealtime });
    shortServer = shortApp.listen(0);
    shortBase = `http://127.0.0.1:${(shortServer.address() as AddressInfo).port}`;

    seekerA = await loginAs(app, 'seeker', String(phone++));
    seekerB = await loginAs(app, 'seeker', String(phone++));
  }, 300_000);

  afterAll(async () => {
    for (const s of streams) s.close();
    server?.closeAllConnections();
    shortServer?.closeAllConnections();
    await workers?.close();
    await realtime?.close();
    await shortRealtime?.close();
    probe?.disconnect();
    await testDb?.stop();
    await redis?.stop();
  });

  const auth = (u: { token: string }) => ({ Authorization: `Bearer ${u.token}` });

  async function makeShop(name: string, km: number, categories: string[]): Promise<Shop> {
    const u = await loginAs(app, 'shop', String(phone++));
    const res = await request(app)
      .post('/shops')
      .set(auth(u))
      .send({ name, lat: north(km), lng: ORIGIN.lng, categories });
    expect(res.status, name).toBe(201);
    return { ...u, shopId: res.body.id as string };
  }

  const ticketFor = async (u: User, via = base) => {
    const res = await fetch(`${via}/events/ticket`, { method: 'POST', headers: auth(u) });
    return (await res.json()) as { ticket: string; expiresInSeconds: number };
  };

  async function listen(u: User): Promise<SseStream> {
    const { ticket } = await ticketFor(u);
    const stream = await openSse(`${base}/events?ticket=${ticket}`);
    expect(stream.status).toBe(200);
    streams.push(stream);
    return stream;
  }

  const ask = (q: string, user = seekerA) =>
    request(app).post('/requests').set(auth(user)).send({ q, lat: ORIGIN.lat, lng: ORIGIN.lng });
  const myPings = async (shop: Shop) =>
    (await request(app).get('/shops/me/pings').set(auth(shop))).body as { id: string }[];
  const settle = () => new Promise((resolve) => setTimeout(resolve, 400));

  describe('tickets', () => {
    it('go to any logged-in user and never to an anonymous caller', async () => {
      expect((await request(app).post('/events/ticket')).status).toBe(401);
      const shop = await makeShop('Ticket Shop', 0.1, ['grocery']);
      for (const user of [seekerA, shop]) {
        const res = await request(app).post('/events/ticket').set(auth(user));
        expect(res.status).toBe(200);
        expect(res.body.expiresInSeconds).toBe(60);
        expect(res.body.ticket).toMatch(/^[A-Za-z0-9_-]{43,}$/);
      }
    });

    it('are kept in Redis only as a hash, for 60 seconds', async () => {
      const { ticket } = await ticketFor(seekerA);
      const keys = await probe.keys('ticket:*');
      expect(keys.length).toBeGreaterThan(0);
      for (const key of keys) {
        expect(key).not.toContain(ticket);
        expect(await probe.get(key)).not.toContain(ticket);
        const ttl = await probe.ttl(key);
        expect(ttl).toBeGreaterThan(0);
        expect(ttl).toBeLessThanOrEqual(60);
      }
    });

    it('open the stream once, then are used up', async () => {
      const { ticket } = await ticketFor(seekerA);
      const first = await openSse(`${base}/events?ticket=${ticket}`);
      streams.push(first);
      expect(first.status).toBe(200);
      expect(first.contentType).toMatch(/^text\/event-stream/);
      const second = await openSse(`${base}/events?ticket=${ticket}`);
      expect(second.status).toBe(401);
    });

    it('expire: a ticket older than its lifetime is refused', async () => {
      const { ticket } = await ticketFor(seekerA, shortBase);
      await new Promise((resolve) => setTimeout(resolve, 1500));
      expect((await openSse(`${base}/events?ticket=${ticket}`)).status).toBe(401);
    });

    it('work on any API instance, because they live in Redis', async () => {
      const { ticket } = await ticketFor(seekerA, shortBase);
      const stream = await openSse(`${base}/events?ticket=${ticket}`);
      streams.push(stream);
      expect(stream.status).toBe(200);
    });

    it('are the only way in: no ticket, a made-up ticket, or the bearer token in the URL all fail', async () => {
      expect((await openSse(`${base}/events`)).status).toBe(401);
      expect((await openSse(`${base}/events?ticket=made-up`)).status).toBe(401);
      for (const name of ['token', 'access_token', 'bearer', 'ticket']) {
        expect((await openSse(`${base}/events?${name}=${seekerA.token}`)).status, name).toBe(401);
      }
      const withHeader = await fetch(`${base}/events`, { headers: auth(seekerA) });
      expect(withHeader.status).toBe(401);
      await withHeader.body?.cancel();
    });

    it('never reach the logs, nor does the bearer token', async () => {
      const { ticket } = await ticketFor(seekerB);
      const stream = await openSse(`${base}/events?ticket=${ticket}`);
      await waitFor(
        async () => stream.comments.length,
        (n) => n > 0,
      );
      stream.close();
      await waitFor(
        async () => realtime.connectionCount(),
        (n) => n === 0,
      );
      await settle();
      const logs = logLines.join('\n');
      expect(logs).toContain('/events'); // the request was logged...
      expect(logs).not.toContain(ticket); // ...without its query string
      expect(logs).not.toContain(seekerB.token);
      expect(logs).not.toContain(seekerA.token);
    });
  });

  describe('the stream', () => {
    it('sends a heartbeat comment on a timer', async () => {
      const stream = await listen(seekerB);
      await waitFor(
        async () => stream.comments.filter((c) => /heartbeat/.test(c)).length,
        (n) => n >= 2,
        3000,
      );
      expect(stream.comments.filter((c) => /heartbeat/.test(c)).length).toBeGreaterThanOrEqual(2);
      stream.close();
    });

    it('removes the connection when the client goes away', async () => {
      const before = realtime.connectionCount();
      const stream = await listen(seekerB);
      await waitFor(
        async () => realtime.connectionCount(),
        (n) => n === before + 1,
      );
      stream.close();
      await waitFor(
        async () => realtime.connectionCount(),
        (n) => n === before,
      );
      expect(realtime.connectionCount()).toBe(before);
    });
  });

  describe('events', () => {
    it('reach only the people they are about, as hints with ids and nothing else', async () => {
      const shop1 = await makeShop('Kirana One', 0.2, ['grocery']);
      const shop2 = await makeShop('Kirana Two', 0.4, ['grocery']);
      const hardware = await makeShop('Hardware Three', 0.3, ['hardware']);
      const [sA, sB, s1, s2, s3] = await Promise.all(
        [seekerA, seekerB, shop1, shop2, hardware].map(listen),
      );

      const created = await ask('aata');
      expect(created.body.state).toBe('PINGING');
      const requestId = created.body.id as string;

      // Each pinged shop is told about its own ping, and sees that ping when it looks.
      const [c1, c2] = await Promise.all([
        (s1 as SseStream).waitForEvent('ping.created'),
        (s2 as SseStream).waitForEvent('ping.created'),
      ]);
      expect(Object.keys(c1.data)).toEqual(['pingId']);
      expect((await myPings(shop1)).map((p) => p.id)).toEqual([c1.data['pingId']]);
      expect((await myPings(shop2)).map((p) => p.id)).toEqual([c2.data['pingId']]);

      // Shop 1 says yes: the seeker's request is ANSWERED, and the database already agrees.
      const answered = await request(app)
        .post(`/pings/${c1.data['pingId'] as string}/answer`)
        .set(auth(shop1))
        .send({ answer: 'yes', pricePaise: 4500 });
      expect(answered.status).toBe(200);

      const updated = await (sA as SseStream).waitForEvent('request.updated');
      expect(updated.data).toEqual({ requestId, state: 'ANSWERED' });
      const view = await request(app).get(`/requests/${requestId}`).set(auth(seekerA));
      expect(view.body.state).toBe('ANSWERED');

      // The answering shop's ping is done; the other shop's ping closed with the request.
      expect((await (s1 as SseStream).waitForEvent('ping.closed')).data).toEqual({
        pingId: c1.data['pingId'],
      });
      expect((await (s2 as SseStream).waitForEvent('ping.closed')).data).toEqual({
        pingId: c2.data['pingId'],
      });

      await settle();
      expect((sB as SseStream).events).toEqual([]);
      expect((s3 as SseStream).events).toEqual([]);
      expect((sA as SseStream).events.map((e) => e.type)).toEqual(['request.updated']);
      expect((s1 as SseStream).events.map((e) => e.type)).toEqual(['ping.created', 'ping.closed']);
      expect((s2 as SseStream).events.map((e) => e.type)).toEqual(['ping.created', 'ping.closed']);
      for (const s of [sA, sB, s1, s2, s3] as SseStream[]) s.close();
    });

    it('travel through Redis, so a stream on another API instance gets them', async () => {
      const stream = await listen(seekerB);
      // Published by the *other* instance.
      shortRealtime.events.publish({
        to: { userId: seekerB.userId },
        type: 'request.updated',
        data: { requestId: 'r-1', state: 'CLOSED' },
      });
      const got = await stream.waitForEvent('request.updated');
      expect(got.data).toEqual({ requestId: 'r-1', state: 'CLOSED' });
      stream.close();
    });
  });

  describe('publishing', () => {
    /** Records each event with what a *different* connection sees at the moment it is published. */
    function recorder() {
      const seen: {
        type: string;
        data: Record<string, string>;
        atPublish: Promise<string | null>;
      }[] = [];
      const publisher: EventPublisher = {
        publish(event) {
          const data = event.data as Record<string, string>;
          const [table, id] =
            event.type === 'request.updated'
              ? ['requests', data['requestId']]
              : ['pings', data['pingId']];
          const atPublish = pool
            .query<{ state: string }>(`SELECT state FROM ${table} WHERE id = $1`, [id])
            .then((r) => r.rows[0]?.state ?? null);
          seen.push({ type: event.type, data, atPublish });
        },
      };
      return { seen, publisher };
    }

    it('happens after the database transaction commits, never inside it', async () => {
      const { seen, publisher } = recorder();
      const ctx: RequestsContext = {
        db: pool,
        logger: quiet,
        config: { minStockResults: 3, ttlMinutes: 15, trigramThreshold: 0.4 },
        events: publisher,
      };
      const shop = await makeShop('Commit Kirana', 0.5, ['grocery']);
      const asker = await loginAs(app, 'seeker', String(phone++));
      const claims = { claim: async () => true, release: async () => undefined };

      // Fan-out: when ping.created goes out, the ping row is already visible to everyone.
      const { request: r1 } = await createRequest(ctx, asker.userId, {
        q: 'chawal',
        lat: ORIGIN.lat,
        lng: ORIGIN.lng,
      });
      await fanOutPings({ ...ctx, config: { maxPings: 10 } }, r1.id, claims);
      const pingCreated = seen.filter((e) => e.type === 'ping.created');
      expect(pingCreated.length).toBeGreaterThan(0);
      for (const e of pingCreated) expect(await e.atPublish).toBe('SENT');

      // A yes: request.updated shows the committed state, ping.closed a finished ping.
      const pingId = pingCreated[0]?.data['pingId'] as string;
      await answerPing({ db: pool, logger: quiet, events: publisher }, shop.userId, pingId, {
        answer: 'yes',
      });
      const updated = seen.find((e) => e.type === 'request.updated');
      expect(updated?.data).toEqual({ requestId: r1.id, state: 'ANSWERED' });
      expect(await updated?.atPublish).toBe('ANSWERED');
      const closed = seen.find((e) => e.type === 'ping.closed');
      expect(await closed?.atPublish).toBe('YES');

      // A timeout: the request is EXPIRED and its open ping NO_REPLY by the time anyone hears.
      seen.length = 0;
      const { request: r2 } = await createRequest(ctx, asker.userId, {
        q: 'sugar',
        lat: ORIGIN.lat,
        lng: ORIGIN.lng,
      });
      await fanOutPings({ ...ctx, config: { maxPings: 10 } }, r2.id, claims);
      seen.length = 0;
      await pool.query(
        `UPDATE requests SET expires_at = now() - interval '1 second' WHERE id = $1`,
        [r2.id],
      );
      await expireRequest({ db: pool, logger: quiet, events: publisher }, r2.id, 'sweeper');
      const expired = seen.find((e) => e.type === 'request.updated');
      expect(expired?.data).toEqual({ requestId: r2.id, state: 'EXPIRED' });
      expect(await expired?.atPublish).toBe('EXPIRED');
      const noReply = seen.find((e) => e.type === 'ping.closed');
      expect(await noReply?.atPublish).toBe('NO_REPLY');
    });

    it('sends nothing for a transition that did not happen', async () => {
      const { seen, publisher } = recorder();
      const asker = await loginAs(app, 'seeker', String(phone++));
      const ctx: RequestsContext = {
        db: pool,
        logger: quiet,
        config: { minStockResults: 3, ttlMinutes: 15, trigramThreshold: 0.4 },
        events: publisher,
      };
      const { request: r } = await createRequest(ctx, asker.userId, {
        q: 'namak',
        lat: ORIGIN.lat,
        lng: ORIGIN.lng,
      });
      await applyRequestEvent(ctx, r.id, 'TIMEOUT'); // PINGING -> EXPIRED
      seen.length = 0;
      await applyRequestEvent(ctx, r.id, 'TIMEOUT'); // already EXPIRED: nothing moves
      await applyRequestEvent(ctx, r.id, 'USER_CLOSED'); // invalid from EXPIRED
      expect(seen).toEqual([]);
    });

    it('never fails a request when Redis is away', async () => {
      const dead = createRealtime({
        redisUrl: 'redis://127.0.0.1:1',
        logger: quiet,
        heartbeatMs: 100,
      });
      expect(() =>
        dead.events.publish({ to: { userId: 'u' }, type: 'request.updated', data: {} }),
      ).not.toThrow();
      await expect(dead.issueTicket({ id: 'u', role: 'seeker' })).rejects.toThrow();
      await dead.close();
    });
  });
});
