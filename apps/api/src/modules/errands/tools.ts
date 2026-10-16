import {
  askShopsTool,
  findItemNearbyTool,
  getRequestStatusTool,
  planRouteTool,
  resolveItemTool,
} from '@kahanmilega/shared/tools';
import { z } from 'zod';
import type { ChatTool } from '../ai/index.js';

/** The most items one plan can hold. ERRAND_MAX_ITEMS may lower it, never raise it. */
export const MAX_PLAN_ITEMS = 10;

/**
 * The plan the model hands in. Ids are plain strings on purpose: a made-up id must reach the
 * server check (and become not_found) instead of rejecting the whole plan. `pricePaise` is
 * accepted and ignored: prices come from the database (ADR-0024).
 */
export const submitPlanInput = z.object({
  items: z
    .array(
      z.object({
        text: z.string().trim().min(1).max(100).describe('The item as the customer said it'),
        itemId: z.string().max(64).optional().describe('The item id from resolve_item'),
        quantity: z.number().int().min(1).max(100).optional().describe('How many, default 1'),
        status: z
          .enum(['confirmed', 'likely', 'not_found'])
          .describe(
            'confirmed: a shop said yes to your ask_shops for this item. likely: a shop listed by find_item_nearby has it. not_found: otherwise.',
          ),
        shopId: z
          .string()
          .max(64)
          .optional()
          .describe(
            'For confirmed or likely: the shopId of the shop to buy it from (from get_request_status or find_item_nearby)',
          ),
        pricePaise: z
          .number()
          .optional()
          .describe('Ignored: the server fills in the price it has on record'),
      }),
    )
    .min(1)
    .max(MAX_PLAN_ITEMS),
  notes: z
    .string()
    .max(400)
    .optional()
    .describe("One or two short lines for the customer, in the customer's language"),
});
export type SubmitPlanInput = z.infer<typeof submitPlanInput>;

export const findItemNearbyAgentInput = findItemNearbyTool.input.omit({ lat: true, lng: true });
export const askShopsAgentInput = askShopsTool.input.pick({ itemId: true, targetPricePaise: true });
export const getRequestStatusAgentInput = getRequestStatusTool.input;
export const askUserInput = z.object({
  question: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .describe("One short question, in the customer's language"),
  options: z
    .array(z.string().trim().min(1).max(80))
    .min(1)
    .max(4)
    .optional()
    .describe('Up to 4 answers to choose from (the customer may also type)'),
});
export const planRouteAgentInput = z.object({
  shopIds: z
    .array(z.uuid())
    .min(1)
    .max(8)
    .describe('The shopIds to visit, from find_item_nearby (1 to 8)'),
});

/**
 * What the errand agent may call (ADR-0023, ADR-0024). The inputs come from the shared registry
 * so field names and limits cannot drift; the location is injected by the server, so the agent
 * variants take no coordinates. `ask_shops` pings real shops (capped per errand) and
 * `get_request_status` reads only this errand's own requests. `ask_user` and `submit_plan` end a run.
 */
export const AGENT_TOOLS: ChatTool[] = [
  {
    name: resolveItemTool.name,
    description: resolveItemTool.description,
    input: resolveItemTool.input,
  },
  {
    name: findItemNearbyTool.name,
    description:
      'List shops near the user that earlier confirmed they have the item (learned stock: remembered, not checked just now), with price, distance and how recently they confirmed. ' +
      'Call it first for every item you resolved: it is instant and contacts nobody. ' +
      '`freshCount` is how many confirmed within 24 hours. Shops come freshest first, then nearest; prices are paise (100 paise = ₹1). ' +
      'If freshCount is 3 or more, you can plan from this. If it is fewer, use ask_shops for that item.',
    input: findItemNearbyAgentInput,
  },
  {
    name: askShopsTool.name,
    description:
      'SIDE EFFECT: pings real shops near the user to ask whether they have the item right now. Use find_item_nearby first; call ask_shops only for items with fewer than 3 fresh shops (freshCount < 3). ' +
      'It returns at once with a requestId; shops answer over the next minutes. Ask about every such item in the same step, then stop calling tools (reply with one short line): you are resumed automatically when answers arrive or time passes, and you will be shown the fresh status of every request then. ' +
      'At most a few items per errand; asking again about the same item does nothing new. targetPricePaise is optional: a price the customer already saw elsewhere.',
    input: askShopsAgentInput,
  },
  {
    name: getRequestStatusTool.name,
    description:
      'Read how shops answered one of your ask_shops requests: state, how many were asked, said yes, said no and are still to reply, and the shops that said yes with prices (`source: live` means just confirmed). ' +
      'Only requests you made in this errand. You do not need it to wait: you are shown fresh status when you are resumed. A shop that said yes (live) can be marked "confirmed" in submit_plan.',
    input: getRequestStatusAgentInput,
  },
  {
    name: 'ask_user',
    description:
      'FINISH THIS RUN by asking the customer one short question; the errand pauses until they answer, then you continue. ' +
      'Use it when resolve_item returns a clarification: pass its question and options to ask_user instead of guessing. Also for a task too vague to act on. ' +
      'Use it rarely; at most a couple of times per errand. Do not ask what you can find out with the other tools.',
    input: askUserInput,
  },
  {
    name: planRouteTool.name,
    description:
      'Optional: the best order to visit 1 to 8 shops, starting near the user and not returning, with distances in metres. ' +
      'Give shopIds from find_item_nearby or get_request_status. Use it only to compare options (for example two shops against one); submit_plan builds the final route itself.',
    input: planRouteAgentInput,
  },
  {
    name: 'submit_plan',
    description:
      'FINISH: hand in the shopping plan. Call it exactly once, as your last step, when every item has been looked up (or when told to submit now). ' +
      'One entry per thing the customer wants (at most 10). status "confirmed" only for an item whose shop said yes to your ask_shops (give that itemId and shopId); "likely" for an item whose shop was listed by find_item_nearby; everything else "not_found". ' +
      'Never invent ids, shops or prices: the server checks every claim against its records and sets the real status itself. Prices are filled in by the server.',
    input: submitPlanInput,
  },
];
