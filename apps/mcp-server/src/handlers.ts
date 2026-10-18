import { toolByName, type ToolName } from '@kahanmilega/shared/tools';
import {
  ApiUnreachableError,
  NotLoggedInError,
  type ApiClient,
  type ApiRequest,
  type ApiResponse,
} from './apiClient.js';

/** A failure the AI should read and act on: becomes an MCP tool error, never a crash. */
export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolError';
  }
}

const LOGIN_HINT =
  'Not logged in, or the login expired. Run `npm run mcp:login -- --phone <your 10-digit number>` in the KahanMilega folder, then restart this MCP server.';

const DAY_MS = 24 * 3_600_000;

interface Shared {
  /** The API said "not found": which thing was missing. */
  missing: string;
}

/** Everything that is not a 2xx becomes a ToolError with an instruction, except what a tool handles itself. */
function expectOk(res: ApiResponse, { missing }: Shared): void {
  if (res.status >= 200 && res.status < 300) return;
  const message: string | undefined = res.body?.error?.message;
  if (res.status === 401) throw new ToolError(LOGIN_HINT);
  if (res.status === 403)
    throw new ToolError(
      'This login is not allowed to do that. The MCP server needs a customer (seeker) login, not a shop or admin login.',
    );
  if (res.status === 404) throw new ToolError(missing);
  if (res.status === 400)
    throw new ToolError(`The API rejected the input: ${message ?? 'invalid request'}`);
  if (res.status === 429) throw new ToolError('Rate limited by KahanMilega. Retry later.');
  if (res.status >= 500)
    throw new ToolError(
      `KahanMilega had a server problem (status ${res.status}). Try again in a minute.`,
    );
  throw new ToolError(message ?? `Unexpected answer from the API (status ${res.status}).`);
}

const NO_REQUEST = 'No such request. Check the requestId (it comes from ask_shops).';

type Input = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Compact shop row: what a person or the next call needs, nothing internal. */
const shopRow = (r: Input) => ({
  shopId: r['shopId'],
  name: r['name'],
  distanceM: r['distanceM'],
  lat: r['lat'],
  lng: r['lng'],
  pricePaise: r['pricePaise'] ?? null,
  freshness: r['freshness'],
});

const handlers: Record<ToolName, (input: Input, api: ApiClient) => Promise<unknown>> = {
  async resolve_item({ text }, api) {
    // /search resolves text to an item; the location is required by the API but unused here.
    const res = await api.call({
      method: 'GET',
      path: '/search',
      // create: a real product the catalog does not know yet becomes a new, unverified item.
      query: { q: text, lat: 0, lng: 0, radius_m: 1, create: 'true' },
    });
    if (res.status === 422 && res.body?.error?.code === 'item_ambiguous') {
      const e = res.body.error;
      return {
        clarification: {
          question: e.question,
          options: (e.options as Input[]).map((o) => ({
            itemId: o['itemId'],
            name: o['nameEn'],
            nameHi: o['nameHi'],
          })),
        },
      };
    }
    expectOk(res, { missing: 'Not found.' });
    const item = res.body.item as Input | null;
    const refused = res.body.refused as { reason?: string } | undefined;
    if (!item && refused?.reason === 'blocked')
      return {
        blocked: true,
        message:
          'This item cannot be sent to shops. Do not try other words for it; tell the user you cannot help with it.',
      };
    if (!item && refused?.reason === 'unavailable')
      return {
        unavailable: true,
        message: 'This item cannot be sent to shops right now. Try again later.',
      };
    if (!item && refused?.reason === 'limit')
      return {
        limit: true,
        message:
          'The limit of new items is reached for now, so this one cannot be sent to shops. Try again tomorrow.',
      };
    if (!item) {
      return {
        unresolved: true,
        message: 'Nothing in the catalog fits that text. Ask the user for other words.',
      };
    }
    return {
      item: {
        id: item['id'],
        name: item['nameEn'],
        nameHi: item['nameHi'],
        category: item['category'],
        // No shop has confirmed it yet: it was added by a customer.
        ...(item['unverified'] === true && { isNew: true }),
      },
    };
  },

  async find_item_nearby({ itemId, lat, lng, radiusM }, api) {
    const res = await api.call({
      method: 'GET',
      path: '/search',
      query: { itemId, lat, lng, radius_m: radiusM },
    });
    expectOk(res, { missing: 'No such item. Get the itemId from resolve_item.' });
    const results = res.body.results as Input[];
    const fresh = results.filter(
      (r) => Date.now() - new Date(r['lastConfirmedAt']).getTime() < DAY_MS,
    );
    return { count: results.length, freshCount: fresh.length, shops: results.map(shopRow) };
  },

  async ask_shops({ idempotencyKey, ...rest }, api) {
    const request: ApiRequest = {
      method: 'POST',
      path: '/requests',
      body: rest,
      ...(idempotencyKey && { headers: { 'idempotency-key': idempotencyKey } }),
    };
    const res = await api.call(request);
    expectOk(res, { missing: 'No such item. Get the itemId from resolve_item.' });
    return {
      requestId: res.body.id,
      state: res.body.state,
      expiresAt: res.body.expiresAt,
      reused: res.status === 200,
    };
  },

  async get_request_status({ requestId }, api) {
    const res = await api.call({
      method: 'GET',
      path: `/requests/${requestId}`,
      query: { sort: 'price' },
    });
    expectOk(res, { missing: NO_REQUEST });
    const b = res.body;
    return {
      state: b.state,
      ...(b.item && { item: { id: b.item.id, name: b.item.nameEn } }),
      pingStats: b.pingStats,
      results: (b.results as Input[]).map((r) => ({
        ...shopRow(r),
        source: r['source'],
        ...(r['savingsPaise'] !== undefined && { savingsPaise: r['savingsPaise'] }),
      })),
      expiresAt: b.expiresAt,
    };
  },

  async close_request({ requestId }, api) {
    const res = await api.call({ method: 'POST', path: `/requests/${requestId}/close` });
    expectOk(res, { missing: NO_REQUEST });
    return { state: res.body.state };
  },

  async plan_route(input, api) {
    const res = await api.call({ method: 'POST', path: '/route/plan', body: input });
    expectOk(res, { missing: 'Not found.' });
    return res.body;
  },
};

/** Validates the input, calls the API, and returns output that matches the tool's schema. */
export async function runTool(name: string, rawInput: unknown, api: ApiClient): Promise<unknown> {
  const tool = toolByName(name);
  const parsed = tool.input.safeParse(rawInput);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`);
    throw new ToolError(`Invalid input: ${problems.join('; ')}`);
  }
  try {
    const handler = handlers[name as ToolName] as (typeof handlers)[ToolName];
    const output = await handler(parsed.data, api);
    return tool.output.parse(output);
  } catch (error) {
    if (error instanceof NotLoggedInError) throw new ToolError(LOGIN_HINT);
    if (error instanceof ApiUnreachableError)
      throw new ToolError(
        `${error.message}. Check the address and your connection, then try again.`,
      );
    throw error;
  }
}
