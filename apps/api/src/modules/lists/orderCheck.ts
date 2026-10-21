export type FulfilMode = 'pickup' | 'delivery';

/** What a shop said on its parchi, for the lines it said it has. */
export interface AnsweredShop {
  have: ReadonlyMap<number, number>;
  canDeliver: boolean;
  feePaise: number | null;
}

export interface OrderPlanInput {
  assignments: { position: number; shopId: string }[];
  modes: Record<string, FulfilMode>;
}

export type OrderPlanCheck =
  | {
      ok: true;
      shops: {
        shopId: string;
        mode: FulfilMode;
        lines: { position: number; pricePaise: number }[];
        feePaise: number | null;
      }[];
    }
  | {
      ok: false;
      code:
        | 'nothing_to_order'
        | 'unknown_line'
        | 'line_assigned_twice'
        | 'line_not_available'
        | 'mode_without_lines'
        | 'cannot_deliver';
      message: string;
    };

const fail = (code: Extract<OrderPlanCheck, { ok: false }>['code'], message: string) =>
  ({ ok: false, code, message }) as const;

/**
 * The customer's line-to-shop choice (ADR-0055 rule 11), checked in code against what the shops
 * answered. Prices and fees come from the answers, never from the request. A shop with no mode is
 * pickup; delivery only where the shop said canDeliver.
 */
export function checkOrderPlan(
  input: OrderPlanInput,
  list: { positions: readonly number[]; answers: ReadonlyMap<string, AnsweredShop> },
): OrderPlanCheck {
  if (input.assignments.length === 0) return fail('nothing_to_order', 'Choose at least one line');
  const lines = new Set(list.positions);
  const taken = new Set<number>();
  const byShop = new Map<string, { position: number; pricePaise: number }[]>();
  for (const { position, shopId } of input.assignments) {
    if (!lines.has(position)) return fail('unknown_line', 'That line is not on this list');
    if (taken.has(position)) return fail('line_assigned_twice', 'Each line goes to one shop');
    taken.add(position);
    const price = list.answers.get(shopId)?.have.get(position);
    if (price === undefined)
      return fail('line_not_available', 'That shop did not say it has that line');
    byShop.set(shopId, [...(byShop.get(shopId) ?? []), { position, pricePaise: price }]);
  }
  for (const shopId of Object.keys(input.modes))
    if (!byShop.has(shopId)) return fail('mode_without_lines', 'A mode needs a shop with lines');
  const shops = [...byShop].map(([shopId, shopLines]) => {
    const answer = list.answers.get(shopId) as AnsweredShop;
    const mode = input.modes[shopId] ?? 'pickup';
    return {
      shopId,
      mode,
      lines: shopLines,
      feePaise: mode === 'delivery' ? answer.feePaise : null,
    };
  });
  if (shops.some((s) => s.mode === 'delivery' && !list.answers.get(s.shopId)?.canDeliver))
    return fail('cannot_deliver', 'That shop did not say it can deliver');
  return { ok: true, shops };
}
