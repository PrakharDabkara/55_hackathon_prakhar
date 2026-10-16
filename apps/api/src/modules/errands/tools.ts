import { findItemNearbyTool, planRouteTool, resolveItemTool } from '@kahanmilega/shared/tools';
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
          .enum(['likely', 'not_found'])
          .describe('likely: a shop listed by find_item_nearby has it. not_found: otherwise.'),
        shopId: z
          .string()
          .max(64)
          .optional()
          .describe('For likely: the shopId from find_item_nearby of the shop to buy it from'),
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
 * variants take no coordinates; `ask_shops` is left out until Day 13.
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
      'Call it for every item you resolved. It is instant and contacts nobody. You cannot ask shops today, so what it lists is all you can know. ' +
      '`freshCount` is how many confirmed within 24 hours. Shops come freshest first, then nearest; prices are paise (100 paise = ₹1). ' +
      'Then call submit_plan.',
    input: findItemNearbyAgentInput,
  },
  {
    name: planRouteTool.name,
    description:
      'Optional: the best order to visit 1 to 8 shops, starting near the user and not returning, with distances in metres. ' +
      'Give shopIds from find_item_nearby. Use it only to compare options (for example two shops against one); submit_plan builds the final route itself.',
    input: planRouteAgentInput,
  },
  {
    name: 'submit_plan',
    description:
      'FINISH: hand in the shopping plan. Call it exactly once, as your last step, when every item has been looked up (or when told to submit now). ' +
      'One entry per thing the customer wants (at most 10). status "likely" only for an item whose shop was listed by find_item_nearby for that exact item: give that itemId and shopId. Everything else is "not_found". ' +
      'Never invent ids, shops or prices: the server checks every id against its records and changes any claim it cannot confirm to not_found. Prices are filled in by the server.',
    input: submitPlanInput,
  },
];
