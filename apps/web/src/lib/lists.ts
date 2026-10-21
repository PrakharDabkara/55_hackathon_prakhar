import { LIST_MAX_LINES } from '@askbuy/shared';
import { haversineM } from './errand.js';
import { displayItemName } from './format.js';
import type { AnswerView, LineView, ListView } from './listApi.js';

// ---- What the customer types -------------------------------------------------------------

/** "2 kg", "50 g", "3": a part that only says how much, so it belongs to the item before it. */
const QUANTITY_ONLY =
  /^\d+(?:\.\d+)?\s*(?:kg|kgs|g|gm|gms|gram|grams|l|ltr|litre|litres|ml|pc|pcs|piece|pieces|packet|packets|dozen)?$/i;

/** A bullet or a number a pasted list carries: "- ", "• ", "1. ", "2) ". */
const LEADING_MARK = /^(?:[-*•·]\s+|\d{1,2}[.)]\s+)/;

/**
 * The items in some text: split at new lines and commas (and, when asked, " and "), without
 * bullets or numbers, empty parts dropped. A part that is only a quantity stays with the item
 * before it, so "javitri, 50 g" is one item and "atta, 2 kg, sugar" is two.
 */
export function splitItems(text: string, { and = false }: { and?: boolean } = {}): string[] {
  const separators = and ? /[\n,]|\s+and\s+/i : /[\n,]/;
  const items: string[] = [];
  for (const raw of text.split(separators)) {
    const part = raw.replace(LEADING_MARK, '').replace(/\s+/g, ' ').trim();
    if (part === '') continue;
    const last = items.length - 1;
    if (last >= 0 && QUANTITY_ONLY.test(part)) items[last] = `${items[last]}, ${part}`;
    else items.push(part);
  }
  return items;
}

/** Does the single-item text look like a shopping list? Two or more things, split at commas, new lines or " and ". */
export const looksLikeSeveral = (text: string): boolean =>
  splitItems(text, { and: true }).length >= 2;

/** The editor's lines for these words: one line each and, while there is room, an empty "Next item". */
export const editorRows = (lines: readonly string[]): string[] => {
  const kept = lines.slice(0, LIST_MAX_LINES);
  return kept.length < LIST_MAX_LINES ? [...kept, ''] : [...kept];
};

// ---- What this device remembers ----------------------------------------------------------

export type FindMode = 'one' | 'list';

const MODE_KEY = 'km-find-mode';
const LINES_KEY = 'km-list-draft';

/** One thing or A list: kept per device. Storage can be blocked: the answer is then "one". */
export function loadFindMode(): FindMode {
  try {
    return localStorage.getItem(MODE_KEY) === 'list' ? 'list' : 'one';
  } catch {
    return 'one';
  }
}

export function saveFindMode(mode: FindMode): void {
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch {
    // Blocked storage: the choice lives until the page closes.
  }
}

/** The lines of the list being typed, kept for the tab (like the Find draft). */
export function loadListDraft(): string[] {
  try {
    const raw = sessionStorage.getItem(LINES_KEY);
    const data: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(data)
      ? data
          .filter((l): l is string => typeof l === 'string' && l.trim() !== '')
          .slice(0, LIST_MAX_LINES)
      : [];
  } catch {
    return [];
  }
}

export function saveListDraft(lines: readonly string[]): void {
  try {
    sessionStorage.setItem(LINES_KEY, JSON.stringify(lines.filter((l) => l.trim() !== '')));
  } catch {
    // Private mode: the draft lives in memory only.
  }
}

export function clearListDraft(): void {
  try {
    sessionStorage.removeItem(LINES_KEY);
  } catch {
    // Nothing to clear.
  }
}

// ---- Reading a sorted list ---------------------------------------------------------------

/** A sorted draft shows the check screen only if a line is a question or was refused. */
export const needsCheck = (list: ListView): boolean =>
  list.lines.some((l) => l.status === 'ambiguous' || l.status === 'refused');

/** The lines that go to shops (what answers and plans are about). */
export const sendableLines = (list: ListView): LineView[] =>
  list.lines.filter((l) => l.status === 'item' || l.status === 'other');

const sentenceCase = (text: string): string => displayItemName(text.trim());

/** What a line is called in answers and plans: the catalog name, or the customer's words. */
export const lineLabel = (line: LineView): string => sentenceCase(line.item?.nameEn ?? line.text);

// ---- The plan the customer makes ---------------------------------------------------------

export type Mode = 'pickup' | 'delivery';

/** Which shop each line goes to, and how each shop's items are handed over (pickup unless set). */
export interface PlanChoice {
  assignments: Record<number, string>;
  modes: Record<string, Mode>;
}

export function initialPlan(list: ListView): PlanChoice {
  const assignments: Record<number, string> = {};
  for (const a of list.plan?.assignments ?? []) assignments[a.position] = a.shopId;
  return { assignments, modes: {} };
}

const answerOf = (list: ListView, shopId: string): AnswerView | undefined =>
  list.answers.find((a) => a.shopId === shopId);

const priceOf = (answer: AnswerView | undefined, position: number): number | null => {
  const line = answer?.lines.find((l) => l.position === position);
  return line?.status === 'have' ? (line.pricePaise ?? null) : null;
};

/** Every shop that has this line, cheapest first. */
export function alternativesFor(
  list: ListView,
  position: number,
): { answer: AnswerView; pricePaise: number }[] {
  return list.answers
    .flatMap((answer) => {
      const pricePaise = priceOf(answer, position);
      return pricePaise === null ? [] : [{ answer, pricePaise }];
    })
    .sort((a, b) => a.pricePaise - b.pricePaise || a.answer.distanceM - b.answer.distanceM);
}

/** Moves one line to another shop that said it has it; anything else changes nothing. */
export function movePlanLine(
  choice: PlanChoice,
  list: ListView,
  position: number,
  shopId: string,
): PlanChoice {
  if (priceOf(answerOf(list, shopId), position) === null) return choice;
  const assignments = { ...choice.assignments, [position]: shopId };
  // A shop with no lines left forgets its mode.
  const kept = new Set(Object.values(assignments));
  const modes = Object.fromEntries(Object.entries(choice.modes).filter(([id]) => kept.has(id)));
  return { assignments, modes };
}

/** Pickup or delivery for one shop; delivery only where the shop said it delivers. */
export function setPlanMode(
  choice: PlanChoice,
  list: ListView,
  shopId: string,
  mode: Mode,
): PlanChoice {
  if (mode === 'delivery' && !answerOf(list, shopId)?.canDeliver) return choice;
  const others = Object.fromEntries(Object.entries(choice.modes).filter(([id]) => id !== shopId));
  return { ...choice, modes: mode === 'pickup' ? others : { ...others, [shopId]: mode } };
}

export interface PlanGroup {
  shopId: string;
  answer: AnswerView;
  mode: Mode;
  lines: { position: number; label: string; pricePaise: number }[];
  itemsPaise: number;
  /** The fee of a shop set to Deliver; null when it is pickup or named none. */
  feePaise: number | null;
}

export interface PlanSummary {
  /** In the order to visit them: nearest first from the customer, then nearest to the last. */
  groups: PlanGroup[];
  shops: number;
  covered: number;
  total: number;
  itemsPaise: number;
  /** The known fees of the shops set to Deliver. */
  feePaise: number;
  /** Shops set to Deliver that did not name a fee: the total cannot include it. */
  unknownFeeCount: number;
  deliveryShops: number;
  /** Items plus the known fees: what the customer will pay in cash. */
  cashPaise: number;
  missing: number[];
}

/** Nearest-neighbour: from the customer to the closest shop, then to the closest of the rest. */
function nearestFirst<T extends { answer: AnswerView }>(
  origin: { lat: number; lng: number } | null,
  groups: T[],
): T[] {
  const rest = [...groups].sort((a, b) => a.answer.distanceM - b.answer.distanceM);
  if (!origin) return rest;
  const ordered: T[] = [];
  let here = origin;
  while (rest.length > 0) {
    let best = 0;
    let bestM = Infinity;
    rest.forEach((g, i) => {
      const m = haversineM(here, g.answer);
      if (m < bestM) {
        bestM = m;
        best = i;
      }
    });
    const [next] = rest.splice(best, 1) as [T];
    ordered.push(next);
    here = next.answer;
  }
  return ordered;
}

export function summarizePlan(
  list: ListView,
  choice: PlanChoice,
  origin: { lat: number; lng: number } | null,
): PlanSummary {
  const lines = sendableLines(list);
  const byShop = new Map<string, PlanGroup['lines']>();
  for (const line of lines) {
    const shopId = choice.assignments[line.position];
    const answer = shopId === undefined ? undefined : answerOf(list, shopId);
    const pricePaise = priceOf(answer, line.position);
    if (shopId === undefined || pricePaise === null) continue;
    byShop.set(shopId, [
      ...(byShop.get(shopId) ?? []),
      { position: line.position, label: lineLabel(line), pricePaise },
    ]);
  }
  const unordered = [...byShop].map(([shopId, shopLines]): PlanGroup => {
    const answer = answerOf(list, shopId) as AnswerView;
    const mode: Mode =
      choice.modes[shopId] === 'delivery' && answer.canDeliver ? 'delivery' : 'pickup';
    return {
      shopId,
      answer,
      mode,
      lines: shopLines,
      itemsPaise: shopLines.reduce((sum, l) => sum + l.pricePaise, 0),
      feePaise: mode === 'delivery' ? answer.deliveryFeePaise : null,
    };
  });
  const groups = nearestFirst(origin, unordered);
  const delivering = groups.filter((g) => g.mode === 'delivery');
  const itemsPaise = groups.reduce((sum, g) => sum + g.itemsPaise, 0);
  const feePaise = delivering.reduce((sum, g) => sum + (g.feePaise ?? 0), 0);
  const covered = groups.reduce((sum, g) => sum + g.lines.length, 0);
  const placed = new Set(groups.flatMap((g) => g.lines.map((l) => l.position)));
  return {
    groups,
    shops: groups.length,
    covered,
    total: lines.length,
    itemsPaise,
    feePaise,
    unknownFeeCount: delivering.filter((g) => g.feePaise === null).length,
    deliveryShops: delivering.length,
    cashPaise: itemsPaise + feePaise,
    missing: lines.map((l) => l.position).filter((p) => !placed.has(p)),
  };
}
