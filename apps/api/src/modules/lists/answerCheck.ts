export interface ListAnswerInput {
  lines: { lineId: string; have: boolean; priceRupees?: number | undefined }[];
  canDeliver?: boolean | undefined;
  deliveryFeeRupees?: number | undefined;
}

export type ListAnswerCheck =
  | {
      ok: true;
      lines: { lineId: string; have: boolean; pricePaise: number | null }[];
      canDeliver: boolean;
      deliveryFeePaise: number | null;
    }
  | {
      ok: false;
      code:
        | 'line_not_sent'
        | 'lines_missing'
        | 'duplicate_line'
        | 'price_required'
        | 'price_not_allowed'
        | 'fee_without_delivery'
        | 'cannot_deliver';
      message: string;
    };

const fail = (code: Extract<ListAnswerCheck, { ok: false }>['code'], message: string) =>
  ({ ok: false, code, message }) as const;

/**
 * A shop's answer to its parchi (ADR-0055 rule 7), checked in code: exactly the lines it was
 * sent, each once; a whole-rupee price with every "have" and none without; one fee, only with
 * canDeliver, and canDeliver only where the shop can reach the customer. Prices become paise.
 */
export function checkListAnswer(
  sentLineIds: readonly string[],
  input: ListAnswerInput,
  shop: { canDeliverHere: boolean },
): ListAnswerCheck {
  const sent = new Set(sentLineIds);
  const seen = new Set<string>();
  for (const l of input.lines) {
    if (!sent.has(l.lineId)) return fail('line_not_sent', 'That line was not on your parchi');
    if (seen.has(l.lineId)) return fail('duplicate_line', 'Answer each line once');
    seen.add(l.lineId);
  }
  if (seen.size !== sent.size) return fail('lines_missing', 'Answer every line on the parchi');
  for (const l of input.lines) {
    if (l.have && l.priceRupees === undefined)
      return fail('price_required', 'Give a price for every line you have');
    if (!l.have && l.priceRupees !== undefined)
      return fail('price_not_allowed', 'A line you do not have has no price');
  }
  const canDeliver = input.canDeliver === true;
  if (!canDeliver && input.deliveryFeeRupees !== undefined)
    return fail('fee_without_delivery', 'A delivery fee needs canDeliver');
  if (canDeliver && !shop.canDeliverHere)
    return fail('cannot_deliver', 'This customer is beyond the distance you deliver to');
  return {
    ok: true,
    lines: input.lines.map((l) => ({
      lineId: l.lineId,
      have: l.have,
      pricePaise: l.have ? (l.priceRupees as number) * 100 : null,
    })),
    canDeliver,
    deliveryFeePaise:
      canDeliver && input.deliveryFeeRupees !== undefined ? input.deliveryFeeRupees * 100 : null,
  };
}
