import { z } from 'zod';

/**
 * One tool, described once. The MCP server turns these into MCP tools and the internal agent
 * (Day 12) will turn the same objects into Gemini function declarations, so the names, the
 * descriptions an AI reads and the schemas never drift apart (ADR-0023).
 */
export interface ToolDefinition<
  I extends z.ZodObject = z.ZodObject,
  O extends z.ZodObject = z.ZodObject,
> {
  name: string;
  /** Short human title (MCP shows it in tool lists). */
  title: string;
  /** Written for an AI reader: what it does, when to use it, what to do next. */
  description: string;
  input: I;
  output: O;
  /** Changes something in the world (pings real shops, closes a request). False for pure reads. */
  sideEffects: boolean;
  /** Calling it again with the same input has no further effect. */
  idempotent: boolean;
}

const defineTool = <I extends z.ZodObject, O extends z.ZodObject>(t: ToolDefinition<I, O>) => t;

const lat = z.number().min(-90).max(90).describe('Latitude in degrees, for example 22.7196');
const lng = z.number().min(-180).max(180).describe('Longitude in degrees, for example 75.8577');
const itemId = z
  .uuid()
  .describe('The item id from resolve_item (item.id or a clarification option itemId)');
const radiusM = z
  .number()
  .int()
  .min(1)
  .max(5000)
  .optional()
  .describe('Search radius in metres, 1 to 5000. Default 2000.');
const requestId = z.uuid().describe('The requestId returned by ask_shops');
const price = z
  .number()
  .int()
  .nullable()
  .describe('Price in paise (100 paise = ₹1), null if unknown');

export const REQUEST_STATES = ['OPEN', 'PINGING', 'ANSWERED', 'EXPIRED', 'CLOSED'] as const;

const itemOut = z.object({
  id: z.string().describe('Pass this as itemId to the other tools'),
  name: z.string(),
  nameHi: z.string(),
  category: z.string(),
});

const shopOut = z.object({
  shopId: z.string(),
  name: z.string(),
  distanceM: z.number().describe('Straight-line distance from the search point, metres'),
  lat: z.number(),
  lng: z.number(),
  pricePaise: price,
  freshness: z.string().describe('How recently the shop confirmed it has the item, in words'),
});

export const resolveItemTool = defineTool({
  name: 'resolve_item',
  title: 'Find the catalog item for some text',
  description:
    'Turn what the customer typed (English, Hindi or Hinglish, typos allowed, for example "chini" or "bottle brsh") into one catalog item. ' +
    'Call this first, before any other tool: they all need the item id it returns. It never contacts shops and creates nothing. ' +
    'If the answer has `clarification`, the text could mean several different things: ask the user the question, then call resolve_item again with their choice, or use the chosen option itemId directly. ' +
    'If the answer has `unresolved`, nothing in the catalog fits: tell the user and ask for different words. ' +
    'When you have an item, call find_item_nearby next.',
  input: z.object({
    text: z.string().trim().min(1).max(200).describe('The item as the customer said it'),
  }),
  output: z.object({
    item: itemOut.optional().describe('Set when the text resolved to one item'),
    clarification: z
      .object({
        question: z.string(),
        options: z.array(z.object({ itemId: z.string(), name: z.string(), nameHi: z.string() })),
      })
      .optional()
      .describe('Set when the user must choose between genuinely different items'),
    unresolved: z.boolean().optional().describe('True when nothing in the catalog fits'),
    message: z.string().optional(),
  }),
  sideEffects: false,
  idempotent: true,
});

export const findItemNearbyTool = defineTool({
  name: 'find_item_nearby',
  title: 'Shops that probably have the item, from what we already know',
  description:
    'List shops near a point that earlier confirmed they have the item, with price, distance and how recently they confirmed. ' +
    'Use this first once you have an item id: it is instant, free and contacts nobody. ' +
    '`freshCount` is how many shops confirmed within the last 24 hours. If freshCount is 3 or more, answer from this and stop. ' +
    'If it is fewer than 3, call ask_shops to check with shops right now. Prices are paise (100 paise = ₹1).',
  input: z.object({ itemId, lat, lng, radiusM }),
  output: z.object({
    count: z.number().int().describe('Shops found'),
    freshCount: z.number().int().describe('Of those, confirmed within 24 hours'),
    shops: z.array(shopOut).describe('Nearest first'),
  }),
  sideEffects: false,
  idempotent: true,
});

export const askShopsTool = defineTool({
  name: 'ask_shops',
  title: 'Ask nearby shops right now',
  description:
    'SIDE EFFECT: sends a real ping to up to 10 real shops near the point, asking whether they have the item. ' +
    'Use it only after find_item_nearby returned fewer than 3 fresh shops (freshCount < 3), and only when the user wants current answers. ' +
    'Do not call it twice for the same need: pass the same idempotencyKey to make a retry safe (the same request is returned, `reused: true`). ' +
    'It returns at once with a requestId: shops answer over the next minutes. Then call get_request_status every 10 to 20 s, and call close_request when you have enough answers or the user is done. ' +
    'targetPricePaise is optional: a price the user has already seen elsewhere, so results show how much each shop saves.',
  input: z.object({
    itemId,
    lat,
    lng,
    radiusM,
    targetPricePaise: z
      .number()
      .int()
      .min(1)
      .max(10_000_000)
      .optional()
      .describe('A price the user has seen elsewhere, in paise'),
    idempotencyKey: z
      .string()
      .min(1)
      .max(128)
      .optional()
      .describe('Any unique string for this need; repeating the call with it does not ping again'),
  }),
  output: z.object({
    requestId: z.string(),
    state: z.enum(REQUEST_STATES),
    expiresAt: z.string().describe('When the request stops accepting answers (ISO time)'),
    reused: z.boolean().describe('True when the idempotencyKey matched an earlier request'),
  }),
  sideEffects: true,
  idempotent: false,
});

export const getRequestStatusTool = defineTool({
  name: 'get_request_status',
  title: 'Answers so far for a request',
  description:
    'Read how shops have answered an ask_shops request: state, how many were asked, said yes, said no and are still to reply, and the shops that have the item, cheapest first. ' +
    'Poll every 10 to 20 s while pingStats.pending is above 0 and the state is PINGING or ANSWERED; stop when pending is 0, when state is EXPIRED or CLOSED, or when you have enough answers. ' +
    'Then call close_request if the request is still open. Results mix live answers (`source: live`, just confirmed) and remembered stock (`learned`). Prices are paise.',
  input: z.object({ requestId }),
  output: z.object({
    state: z.enum(REQUEST_STATES),
    item: z.object({ id: z.string(), name: z.string() }).optional(),
    pingStats: z.object({
      sent: z.number().int(),
      yes: z.number().int(),
      no: z.number().int(),
      pending: z.number().int().describe('Asked and not answered yet'),
    }),
    results: z
      .array(
        shopOut.extend({
          source: z.enum(['live', 'learned']),
          savingsPaise: z.number().optional().describe('Below the target price by this much'),
        }),
      )
      .describe('Cheapest first'),
    expiresAt: z.string(),
  }),
  sideEffects: false,
  idempotent: true,
});

export const closeRequestTool = defineTool({
  name: 'close_request',
  title: 'Stop asking shops',
  description:
    'SIDE EFFECT: close a request so no more shops are pinged and late answers stop arriving. ' +
    'Call it when you have enough answers or the user is done; it is safe to call twice. ' +
    'Closing does not delete the answers you already have: read them with get_request_status first if you still need them.',
  input: z.object({ requestId }),
  output: z.object({ state: z.enum(REQUEST_STATES) }),
  sideEffects: true,
  idempotent: true,
});

const stop = z.object({
  shopId: z.string(),
  lat,
  lng,
  label: z.string().min(1).max(80).describe('A name to show, usually the shop name'),
});

export const planRouteTool = defineTool({
  name: 'plan_route',
  title: 'Shortest order to visit shops',
  description:
    'Given where the user is and 1 to 8 shops to visit (take lat and lng from find_item_nearby or get_request_status results), ' +
    'return the order that gives the shortest total walk, the distance of each leg and the total, all in metres (straight-line distances). ' +
    'The route starts at `start` and does not return. Use it when the user wants to visit several shops, for example the 3 cheapest.',
  input: z.object({
    start: z.object({ lat, lng }).describe('Where the user is now'),
    stops: z.array(stop).min(1).max(8),
  }),
  output: z.object({
    orderedStops: z.array(stop),
    legsM: z
      .array(z.number())
      .describe('Distance of each leg, in order, from start to the first stop and on'),
    totalM: z.number(),
  }),
  sideEffects: false,
  idempotent: true,
});
