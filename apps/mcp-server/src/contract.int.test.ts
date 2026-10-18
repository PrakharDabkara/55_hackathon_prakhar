import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { Pool } from 'pg';
import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tools } from '@kahanmilega/shared/tools';
import { createApp } from '../../api/src/app.js';
import { createAi, createFakeProvider } from '../../api/src/modules/ai/index.js';
import { loadSeedCatalog, seedCatalog } from '../../api/src/modules/catalog/index.js';
import { testConfig } from '../../api/src/testing/config.js';
import { ORIGIN } from '../../api/src/testing/fixtures.js';
import { loginAs } from '../../api/src/testing/login.js';
import { startPostgres, type TestDatabase } from '../../api/src/testing/startPostgres.js';
import { startRedis } from '../../api/src/testing/startRedis.js';
import { waitFor } from '../../api/src/testing/waitFor.js';
import { startWorkers, type Workers } from '../../api/src/workers/index.js';
import { createHttpApiClient } from './apiClient.js';
import { createMcpServer } from './server.js';

const logger = pino({ level: 'silent' });

// The real MCP server, connected to a real client through the SDK's in-memory transport, talking
// over HTTP to the real API on a throwaway Postgres and Redis. No mocks between the tool call and
// the database.
describe('MCP contract', () => {
  let testDb: TestDatabase;
  let pool: Pool;
  let redis: Awaited<ReturnType<typeof startRedis>>;
  let workers: Workers;
  let app: ReturnType<typeof createApp>;
  let server: Server;
  let baseUrl: string;
  let client: Client;
  let loggedOutClient: Client;
  let shopToken = '';
  let seekerToken = '';

  async function connect(getToken: () => string | null): Promise<Client> {
    const mcp = createMcpServer({
      api: createHttpApiClient({ baseUrl, getToken }),
    });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    const c = new Client({ name: 'contract-test', version: '0.0.0' });
    await Promise.all([mcp.connect(serverSide), c.connect(clientSide)]);
    return c;
  }

  const call = async (name: string, args: Record<string, unknown>) => {
    const res = await client.callTool({ name, arguments: args });
    return res as {
      isError?: boolean;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      structuredContent?: Record<string, any>;
      content: { type: string; text: string }[];
    };
  };

  beforeAll(async () => {
    [testDb, redis] = await Promise.all([startPostgres(), startRedis()]);
    pool = testDb.pool;
    await seedCatalog(pool, loadSeedCatalog());
    const config = testConfig({ workersEnabled: true, redisUrl: redis.url });
    workers = startWorkers({ config, db: pool, logger }) as Workers;
    // A scripted model, so an ambiguous word ("clip") comes back as a question without a network call.
    const provider = createFakeProvider();
    const ids = Object.fromEntries(
      (await pool.query<{ id: string; slug: string }>(`SELECT id, slug FROM items`)).rows.map(
        (r) => [r.slug, r.id],
      ),
    );
    provider.onGenerate(({ purpose, user }) =>
      purpose === 'classify_item'
        ? /bead dazzling/i.test(user)
          ? { verdict: 'allowed', category: 'stationery' }
          : { verdict: 'nonsense' }
        : {
            itemId: null,
            needsClarification: true,
            question: 'Kaunsi clip?',
            optionIds: [ids['paper-clips'], ids['clothes-clips']],
          },
    );
    const ai = createAi({
      provider,
      db: pool,
      logger,
      embedThreshold: 0.8,
      embedMargin: 0.05,
      limiter: { allow: async () => true },
    });
    app = createApp({ config, logger, db: pool, requestHooks: workers.hooks, ai });
    server = app.listen(0);
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    seekerToken = (await loginAs(app, 'seeker', '9872000001')).token;
    const shop = await loginAs(app, 'shop', '9872000002');
    shopToken = shop.token;
    await request(app)
      .post('/shops')
      .set({ Authorization: `Bearer ${shopToken}` })
      .send({
        name: 'Contract Kirana',
        lat: ORIGIN.lat + 0.002,
        lng: ORIGIN.lng,
        categories: ['grocery'],
      });

    client = await connect(() => seekerToken);
    loggedOutClient = await connect(() => null);
  }, 300_000);

  afterAll(async () => {
    await client?.close();
    await loggedOutClient?.close();
    server?.close();
    await workers?.close();
    await testDb?.stop();
    await redis?.stop();
  });

  it('lists the six tools with their schemas and annotations (snapshot)', async () => {
    const { tools: listed } = await client.listTools();
    expect(listed.map((t) => t.name)).toEqual(tools.map((t) => t.name));
    expect(
      listed.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
        outputSchema: t.outputSchema,
        annotations: t.annotations,
      })),
    ).toMatchSnapshot();
  });

  it('marks ask_shops as not read-only and not idempotent, and the reads as read-only', async () => {
    const { tools: listed } = await client.listTools();
    const by = (n: string) => listed.find((t) => t.name === n)?.annotations;
    expect(by('ask_shops')).toMatchObject({ readOnlyHint: false, idempotentHint: false });
    expect(by('close_request')).toMatchObject({ readOnlyHint: false, idempotentHint: true });
    for (const n of ['find_item_nearby', 'get_request_status', 'plan_route'])
      expect(by(n), n).toMatchObject({ readOnlyHint: true });
    // resolve_item can add an unverified item to the catalog, but asking twice adds nothing more.
    expect(by('resolve_item')).toMatchObject({ readOnlyHint: false, idempotentHint: true });
  });

  it('describes the errand workflow in the server instructions', () => {
    const instructions = client.getInstructions() ?? '';
    for (const word of [
      'resolve_item',
      'find_item_nearby',
      'ask_shops',
      'get_request_status',
      'close_request',
    ])
      expect(instructions).toContain(word);
  });

  it('resolve_item: a Hinglish word becomes an item; an ambiguous one comes back as a question', async () => {
    const sugar = await call('resolve_item', { text: 'chini' });
    expect(sugar.isError).toBeFalsy();
    expect(sugar.structuredContent?.['item']).toMatchObject({ name: 'sugar', category: 'grocery' });

    const clip = await call('resolve_item', { text: 'clip' });
    expect(clip.isError).toBeFalsy();
    expect(clip.structuredContent?.['clarification'].question).toBeTruthy();
    expect(clip.structuredContent?.['clarification'].options.length).toBeGreaterThanOrEqual(2);

    const nonsense = await call('resolve_item', { text: 'zxcvb' });
    expect(nonsense.structuredContent).toMatchObject({ unresolved: true });
  });

  it('resolve_item: a real product the catalog lacks becomes a new item; a dangerous one is blocked', async () => {
    const made = await call('resolve_item', { text: 'bead dazzling kit' });
    expect(made.isError).toBeFalsy();
    expect(made.structuredContent?.['item']).toMatchObject({
      name: 'Bead dazzling kit',
      category: 'stationery',
      isNew: true,
    });
    const again = await call('resolve_item', { text: 'bead dazzling kit' });
    expect(again.structuredContent?.['item'].id).toBe(made.structuredContent?.['item'].id);

    const blocked = await call('resolve_item', { text: 'country made pistol' });
    expect(blocked.isError).toBeFalsy();
    expect(blocked.structuredContent).toMatchObject({ blocked: true });
    expect(blocked.structuredContent?.['item']).toBeUndefined();
  });

  it('find_item_nearby: reads learned stock without pinging anyone', async () => {
    const sugarId = (await pool.query<{ id: string }>(`SELECT id FROM items WHERE slug='sugar'`))
      .rows[0]?.id as string;
    const before = (await pool.query(`SELECT count(*)::int AS n FROM pings`)).rows[0].n;
    const out = await call('find_item_nearby', {
      itemId: sugarId,
      lat: ORIGIN.lat,
      lng: ORIGIN.lng,
    });
    expect(out.isError).toBeFalsy();
    expect(out.structuredContent).toMatchObject({ count: 0, shops: [] });
    expect((await pool.query(`SELECT count(*)::int AS n FROM pings`)).rows[0].n).toBe(before);
  });

  it('ask_shops, a simulated shop answering, then get_request_status and close_request', async () => {
    const resolved = await call('resolve_item', { text: 'chini' });
    const itemId = resolved.structuredContent?.['item'].id as string;

    const asked = await call('ask_shops', {
      itemId,
      lat: ORIGIN.lat,
      lng: ORIGIN.lng,
      radiusM: 5000,
      targetPricePaise: 6000,
      idempotencyKey: 'contract-1',
    });
    expect(asked.isError).toBeFalsy();
    const { requestId, state } = asked.structuredContent as { requestId: string; state: string };
    expect(state).toBe('PINGING');

    // The same key returns the same request.
    const again = await call('ask_shops', {
      itemId,
      lat: ORIGIN.lat,
      lng: ORIGIN.lng,
      radiusM: 5000,
      targetPricePaise: 6000,
      idempotencyKey: 'contract-1',
    });
    expect(again.structuredContent).toMatchObject({ requestId, reused: true });

    // The shop sees the ping and says yes at Rs 55.
    const shopAuth = { Authorization: `Bearer ${shopToken}` };
    const pings = await waitFor(
      async () => (await request(app).get('/shops/me/pings').set(shopAuth)).body,
      (body: unknown[]) => body.length > 0,
    );
    await request(app)
      .post(`/pings/${(pings[0] as { id: string }).id}/answer`)
      .set(shopAuth)
      .send({ answer: 'yes', pricePaise: 5500 });

    const status = await call('get_request_status', { requestId });
    expect(status.isError).toBeFalsy();
    expect(status.structuredContent).toMatchObject({
      state: 'ANSWERED',
      pingStats: { yes: 1 },
    });
    expect(status.structuredContent?.['results'][0]).toMatchObject({
      name: 'Contract Kirana',
      pricePaise: 5500,
      source: 'live',
      savingsPaise: 500,
    });

    const closed = await call('close_request', { requestId });
    expect(closed.structuredContent).toEqual({ state: 'CLOSED' });
    // Closing twice is safe (idempotent).
    expect((await call('close_request', { requestId })).isError).toBeFalsy();
  });

  it('plan_route: orders stops and totals the distance', async () => {
    const north = (km: number) => ORIGIN.lat + km / 111.195;
    const out = await call('plan_route', {
      start: { lat: ORIGIN.lat, lng: ORIGIN.lng },
      stops: [
        { shopId: 'far', lat: north(2), lng: ORIGIN.lng, label: 'Far' },
        { shopId: 'near', lat: north(1), lng: ORIGIN.lng, label: 'Near' },
      ],
    });
    expect(out.isError).toBeFalsy();
    expect(
      out.structuredContent?.['orderedStops'].map((s: { shopId: string }) => s.shopId),
    ).toEqual(['near', 'far']);
    expect(out.structuredContent?.['totalM']).toBeGreaterThan(1900);
  });

  it('errors: bad input is refused by the SDK, an unknown request is a clear tool error', async () => {
    await expect(
      client.callTool({ name: 'close_request', arguments: { requestId: 'nope' } }),
    ).resolves.toMatchObject({
      isError: true,
    });
    const missing = await call('get_request_status', {
      requestId: '11111111-2222-4333-8444-555555555555',
    });
    expect(missing.isError).toBe(true);
    expect(missing.content[0]?.text).toMatch(/no such request/i);
  });

  it('errors: with no token, every tool says to run npm run mcp:login', async () => {
    const res = (await loggedOutClient.callTool({
      name: 'resolve_item',
      arguments: { text: 'chini' },
    })) as { isError?: boolean; content: { text: string }[] };
    expect(res.isError).toBe(true);
    expect(res.content[0]?.text).toMatch(/npm run mcp:login/);
  });
});
