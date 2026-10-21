import type { ListAnswerBody, MyShop, ShopListLine, ShopListParchi } from '../../lib/api.js';
import { priceInput } from './answer.js';

/** The most a price or a fee can be, in whole rupees (what the server accepts). */
const MAX_RUPEES = 100_000;
const MAX_FEE_RUPEES = 10_000;

/** What the shop has done to a list parchi so far; sent only when it taps Send answer. */
export interface ListDraft {
  /** By line id. A line missing here is not ticked. */
  ticked: Record<string, boolean>;
  /** What was typed, by line id; kept when a line is unticked, so ticking again brings it back. */
  prices: Record<string, string>;
  delivers: boolean;
  fee: string;
}

export type LineIssue = 'price_required' | 'price_invalid';
export type FormIssue = 'cannot_deliver' | 'ping_closed' | 'invalid' | 'failed';

/** What to point at: a message next to a line's field, next to the fee, or at the button. */
export interface ListIssues {
  lines: Record<string, LineIssue>;
  fee?: 'fee_invalid';
  form?: FormIssue;
}

export type ListAnswerResult =
  { ok: true; body: ListAnswerBody; none: boolean } | { ok: false; issues: ListIssues };

type ShopDefaults = Pick<MyShop, 'deliversDefault' | 'defaultFeePaise'>;

export function startDraft(parchi: ShopListParchi, shop: ShopDefaults): ListDraft {
  return {
    ticked: {},
    prices: {},
    delivers: parchi.canDeliver && shop.deliversDefault,
    fee: priceInput(shop.defaultFeePaise),
  };
}

/** Ticks or unticks a line. Ticking fills the price from last time, unless something was typed. */
export function toggleLine(draft: ListDraft, line: ShopListLine): ListDraft {
  const on = !draft.ticked[line.lineId];
  const typed = draft.prices[line.lineId];
  return {
    ...draft,
    ticked: { ...draft.ticked, [line.lineId]: on },
    prices:
      on && typed === undefined && line.lastPricePaise !== null
        ? { ...draft.prices, [line.lineId]: priceInput(line.lastPricePaise) }
        : draft.prices,
  };
}

export const setLinePrice = (draft: ListDraft, lineId: string, text: string): ListDraft => ({
  ...draft,
  prices: { ...draft.prices, [lineId]: text },
});

/** A whole-rupee amount typed by a shop: digits only (so "12.5", "-4" and "1e3" are mistakes). */
function wholeRupees(text: string | undefined, max: number): number | null | undefined {
  const trimmed = (text ?? '').trim();
  if (trimmed === '') return undefined;
  if (!/^\d{1,6}$/.test(trimmed)) return null;
  const rupees = Number(trimmed);
  return rupees > max ? null : rupees;
}

export interface ListSummary {
  ticked: number;
  of: number;
  /** Of the ticked lines whose price is a clean number; the rest count when they are fixed. */
  totalPaise: number;
}

export function listSummary(parchi: ShopListParchi, draft: ListDraft): ListSummary {
  let ticked = 0;
  let totalPaise = 0;
  for (const line of parchi.lines) {
    if (!draft.ticked[line.lineId]) continue;
    ticked += 1;
    const rupees = wholeRupees(draft.prices[line.lineId], MAX_RUPEES);
    if (typeof rupees === 'number') totalPaise += rupees * 100;
  }
  return { ticked, of: parchi.lines.length, totalPaise };
}

/** Checks the draft the way the server will, so a mistake is shown next to the field before sending. */
export function buildListAnswer(parchi: ShopListParchi, draft: ListDraft): ListAnswerResult {
  const issues: ListIssues = { lines: {} };
  const lines: ListAnswerBody['lines'] = [];
  for (const line of parchi.lines) {
    if (!draft.ticked[line.lineId]) {
      lines.push({ lineId: line.lineId, have: false });
      continue;
    }
    const rupees = wholeRupees(draft.prices[line.lineId], MAX_RUPEES);
    if (rupees === undefined) issues.lines[line.lineId] = 'price_required';
    else if (rupees === null) issues.lines[line.lineId] = 'price_invalid';
    else lines.push({ lineId: line.lineId, have: true, priceRupees: rupees });
  }
  const none = parchi.lines.every((line) => !draft.ticked[line.lineId]);
  const delivers = !none && parchi.canDeliver && draft.delivers;
  const fee = delivers ? wholeRupees(draft.fee, MAX_FEE_RUPEES) : undefined;
  if (fee === null) issues.fee = 'fee_invalid';
  if (Object.keys(issues.lines).length > 0 || issues.fee) return { ok: false, issues };
  return {
    ok: true,
    none,
    body: {
      lines,
      ...(delivers && { canDeliver: true }),
      ...(typeof fee === 'number' && { deliveryFeeRupees: fee }),
    },
  };
}

/** Where to show a refusal from the server: on the lines it is about, or at the button. */
export function issuesFromError(
  code: string,
  parchi: ShopListParchi,
  draft: ListDraft,
): ListIssues {
  if (code === 'price_required') {
    const lines: Record<string, LineIssue> = {};
    for (const line of parchi.lines)
      if (draft.ticked[line.lineId] && !(draft.prices[line.lineId] ?? '').trim())
        lines[line.lineId] = 'price_required';
    return Object.keys(lines).length > 0 ? { lines } : { lines, form: 'invalid' };
  }
  if (code === 'cannot_deliver') return { lines: {}, form: 'cannot_deliver' };
  if (code === 'ping_closed') return { lines: {}, form: 'ping_closed' };
  if (
    [
      'fee_without_delivery',
      'lines_missing',
      'duplicate_line',
      'line_not_sent',
      'price_not_allowed',
    ].includes(code)
  )
    return { lines: {}, form: 'invalid' };
  return { lines: {}, form: 'failed' };
}
