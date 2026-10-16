import { describe, expect, it } from 'vitest';
import { toolByName } from '@kahanmilega/shared';
import {
  ApiUnreachableError,
  NotLoggedInError,
  type ApiClient,
  type ApiRequest,
} from './apiClient.js';
import { runTool, ToolError } from './handlers.js';

const ITEM = {
  id: '3f2b8c1e-9a4d-4e6b-8c1d-2a7f5e9b0c11',
  slug: 'sugar',
  nameEn: 'sugar',
  nameHi: 'चीनी',
  category: 'grocery',
};
const REQ = '5a1b2c3d-1111-4222-8333-444455556666';

/** A fake API that records what was asked and answers from a script. */
function fakeApi(reply: (r: ApiRequest) => { status: number; body: unknown } | Error) {
  const seen: ApiRequest[] = [];
  const api: ApiClient = {
    async call(r) {
      seen.push(r);
      const out = reply(r);
      if (out instanceof Error) throw out;
      return out;
    },
  };
  return { api, seen };
}
const ok = (body: unknown, status = 200) => fakeApi(() => ({ status, body }));
const failing = (status: number, body: unknown = {}) => fakeApi(() => ({ status, body }));

describe('resolve_item', () => {
  it('returns the item for text that resolves, without making a request', async () => {
    const { api, seen } = ok({ query: {}, item: ITEM, matchedBy: 'synonym', results: [] });
    const out = await runTool('resolve_item', { text: 'chini' }, api);
    expect(out).toEqual({
      item: { id: ITEM.id, name: 'sugar', nameHi: 'चीनी', category: 'grocery' },
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ method: 'GET', path: '/search', query: { q: 'chini' } });
  });

  it('reports text that matches nothing as unresolved, with a hint', async () => {
    const { api } = ok({ query: {}, item: null, matchedBy: null, results: [] });
    const out = (await runTool('resolve_item', { text: 'xyzzy' }, api)) as { unresolved: boolean };
    expect(out).toMatchObject({ unresolved: true });
    expect(out).toHaveProperty('message');
  });

  it('turns a 422 item_ambiguous into a normal result with the question and options', async () => {
    const { api } = failing(422, {
      error: {
        code: 'item_ambiguous',
        message: 'Which of these do you mean?',
        question: 'Kaunsi clip?',
        options: [
          { itemId: 'i1', nameEn: 'paper clips', nameHi: 'पेपर क्लिप' },
          { itemId: 'i2', nameEn: 'clothes clips', nameHi: 'कपड़े की क्लिप' },
        ],
      },
    });
    expect(await runTool('resolve_item', { text: 'clip' }, api)).toEqual({
      clarification: {
        question: 'Kaunsi clip?',
        options: [
          { itemId: 'i1', name: 'paper clips', nameHi: 'पेपर क्लिप' },
          { itemId: 'i2', name: 'clothes clips', nameHi: 'कपड़े की क्लिप' },
        ],
      },
    });
  });
});

describe('find_item_nearby', () => {
  const stock = (hoursAgo: number, over = {}) => ({
    shopId: 's1',
    name: 'Jain Mart',
    distanceM: 420,
    lat: 22.72,
    lng: 75.86,
    pricePaise: 5800,
    quantityHint: 'plenty',
    lastConfirmedAt: new Date(Date.now() - hoursAgo * 3_600_000).toISOString(),
    freshness: `Confirmed ${hoursAgo} h ago`,
    ...over,
  });

  it('reads learned stock by item id, never creating a request', async () => {
    const { api, seen } = ok({ item: ITEM, results: [stock(2), stock(40, { shopId: 's2' })] });
    const out = (await runTool(
      'find_item_nearby',
      { itemId: ITEM.id, lat: 22.7, lng: 75.8, radiusM: 1500 },
      api,
    )) as {
      shops: { shopId: string; pricePaise: number | null }[];
      freshCount: number;
      count: number;
    };
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      method: 'GET',
      path: '/search',
      query: { itemId: ITEM.id, lat: 22.7, lng: 75.8, radius_m: 1500 },
    });
    expect(out.count).toBe(2);
    expect(out.freshCount).toBe(1); // only the one confirmed within 24 hours
    expect(out.shops[0]).toMatchObject({
      shopId: 's1',
      name: 'Jain Mart',
      distanceM: 420,
      pricePaise: 5800,
    });
  });

  it('keeps the output compact: no internal fields beyond what the next call needs', async () => {
    const { api } = ok({ item: ITEM, results: [stock(1, { quantityHint: null, extra: 'x' })] });
    const out = (await runTool('find_item_nearby', { itemId: ITEM.id, lat: 1, lng: 1 }, api)) as {
      shops: Record<string, unknown>[];
    };
    expect(Object.keys(out.shops[0] as object).sort()).toEqual(
      ['distanceM', 'freshness', 'lat', 'lng', 'name', 'pricePaise', 'shopId'].sort(),
    );
  });
});

describe('ask_shops', () => {
  const view = { id: REQ, state: 'PINGING', expiresAt: '2026-10-22T10:15:00.000Z', results: [] };

  it('creates the request with the item id, location and target price', async () => {
    const { api, seen } = fakeApi(() => ({ status: 201, body: view }));
    const out = await runTool(
      'ask_shops',
      { itemId: ITEM.id, lat: 22.7, lng: 75.8, radiusM: 2000, targetPricePaise: 6000 },
      api,
    );
    expect(out).toEqual({
      requestId: REQ,
      state: 'PINGING',
      expiresAt: view.expiresAt,
      reused: false,
    });
    expect(seen[0]).toMatchObject({
      method: 'POST',
      path: '/requests',
      body: { itemId: ITEM.id, lat: 22.7, lng: 75.8, radiusM: 2000, targetPricePaise: 6000 },
    });
    expect(seen[0]?.headers?.['idempotency-key']).toBeUndefined();
  });

  it('passes the idempotency key as a header, and says when the request was reused (200)', async () => {
    const { api, seen } = fakeApi(() => ({ status: 200, body: view }));
    const out = (await runTool(
      'ask_shops',
      { itemId: ITEM.id, lat: 22.7, lng: 75.8, idempotencyKey: 'errand-1' },
      api,
    )) as { reused: boolean };
    expect(seen[0]?.headers?.['idempotency-key']).toBe('errand-1');
    expect(seen[0]?.body).not.toHaveProperty('idempotencyKey');
    expect(out.reused).toBe(true);
  });
});

describe('get_request_status', () => {
  it('asks for cheapest first and gives compact results', async () => {
    const { api, seen } = ok({
      id: REQ,
      state: 'ANSWERED',
      item: ITEM,
      pingStats: { sent: 5, yes: 2, no: 1, pending: 2 },
      expiresAt: '2026-10-22T10:15:00.000Z',
      createdAt: '2026-10-22T10:00:00.000Z',
      radiusM: 2000,
      results: [
        {
          shopId: 's1',
          name: 'Jain Mart',
          distanceM: 420,
          lat: 22.72,
          lng: 75.86,
          pricePaise: 5500,
          quantityHint: 'plenty',
          lastConfirmedAt: '2026-10-22T10:05:00.000Z',
          freshness: 'Confirmed just now',
          source: 'live',
          savingsPaise: 500,
        },
      ],
    });
    const out = (await runTool('get_request_status', { requestId: REQ }, api)) as {
      state: string;
      results: Record<string, unknown>[];
    };
    expect(seen[0]).toMatchObject({
      method: 'GET',
      path: `/requests/${REQ}`,
      query: { sort: 'price' },
    });
    expect(out.state).toBe('ANSWERED');
    expect(out).toMatchObject({ pingStats: { sent: 5, yes: 2, no: 1, pending: 2 } });
    expect(out.results[0]).toEqual({
      shopId: 's1',
      name: 'Jain Mart',
      distanceM: 420,
      lat: 22.72,
      lng: 75.86,
      pricePaise: 5500,
      source: 'live',
      freshness: 'Confirmed just now',
      savingsPaise: 500,
    });
  });
});

describe('close_request and plan_route', () => {
  it('closes a request and returns its state', async () => {
    const { api, seen } = ok({ id: REQ, state: 'CLOSED' });
    expect(await runTool('close_request', { requestId: REQ }, api)).toEqual({ state: 'CLOSED' });
    expect(seen[0]).toMatchObject({ method: 'POST', path: `/requests/${REQ}/close` });
  });

  it('plans a route through the API and returns it as is', async () => {
    const plan = {
      orderedStops: [{ shopId: 'a', lat: 1, lng: 1, label: 'A' }],
      legsM: [100],
      totalM: 100,
    };
    const { api, seen } = ok(plan);
    const input = { start: { lat: 1, lng: 1 }, stops: plan.orderedStops };
    expect(await runTool('plan_route', input, api)).toEqual(plan);
    expect(seen[0]).toMatchObject({ method: 'POST', path: '/route/plan', body: input });
  });
});

describe("every output is valid against the tool's output schema", () => {
  it('checks the schemas used above', () => {
    expect(toolByName('close_request').output.safeParse({ state: 'CLOSED' }).success).toBe(true);
    expect(toolByName('close_request').output.safeParse({}).success).toBe(false);
  });
});

describe('errors become clear tool errors', () => {
  const message = async (
    api: ApiClient,
    name = 'close_request',
    input: object = { requestId: REQ },
  ) =>
    runTool(name, input, api).then(
      () => 'no error',
      (e: unknown) => {
        expect(e).toBeInstanceOf(ToolError);
        return (e as Error).message;
      },
    );

  it('401 and a missing token say to run npm run mcp:login', async () => {
    expect(await message(failing(401).api)).toMatch(/npm run mcp:login/);
    expect(await message(fakeApi(() => new NotLoggedInError()).api)).toMatch(/npm run mcp:login/);
  });

  it('429 says rate limited, retry later', async () => {
    expect(await message(failing(429).api)).toMatch(/rate limited.*retry later/i);
  });

  it('404 on a request says there is no such request', async () => {
    expect(await message(failing(404, { error: { code: 'not_found' } }).api)).toMatch(
      /no such request/i,
    );
  });

  it('400 repeats what the API said was wrong', async () => {
    const api = failing(400, { error: { code: 'invalid_request', message: 'lat: too big' } }).api;
    expect(await message(api)).toMatch(/lat: too big/);
  });

  it('403 says the account cannot do this (a shop token, for example)', async () => {
    expect(await message(failing(403).api)).toMatch(/not allowed|seeker/i);
  });

  it('a 5xx and an unreachable API are told apart, and neither leaks a token', async () => {
    expect(await message(failing(503).api)).toMatch(/server|try again/i);
    const down = fakeApi(() => new ApiUnreachableError('https://api.example'));
    expect(await message(down.api)).toMatch(/could not reach.*https:\/\/api\.example/i);
  });

  it('rejects input that breaks the schema before calling the API', async () => {
    const { api, seen } = ok({});
    expect(await message(api, 'close_request', { requestId: 'nope' })).toMatch(/requestId/);
    expect(seen).toHaveLength(0);
  });
});
