/** How one fake shop behaves. Drawn once per shop from a seed, so a restart keeps its character. */
export interface ShopProfile {
  /** Chance the shop answers a ping at all (the rest it ignores, like a busy shopkeeper). */
  replyProbability: number;
  /** About 5 % of shops never have anything. */
  alwaysNo: boolean;
}

export interface PingInfo {
  pingId: string;
  shopId: string;
  /** Null for an item a customer made up (ADR-0028): the catalog has no reference price for it. */
  refPricePaise: number | null;
  /** The item's category, so a made-up item can be priced like its kind. */
  category?: string | null;
  /** Every kind of shop that carries the item, and the kinds this shop is. Both known: a shop only has what its kind carries. */
  itemCategories?: string[];
  shopCategories?: string[];
}

export interface AnswerBody {
  answer: 'yes' | 'no';
  pricePaise?: number;
  quantityHint?: 'few' | 'plenty';
}

export type Decision = { kind: 'skip' } | { kind: 'answer'; delayMs: number; body: AnswerBody };

export function makeProfile(rng: () => number): ShopProfile {
  return { replyProbability: 0.3 + 0.6 * rng(), alwaysNo: rng() < 0.05 };
}

const MIN_DELAY_MS = 5000;
const MAX_DELAY_MS = 90_000;
const PRICE_SPREAD = 0.3;
const HINT_RATE = 0.4;

/** What shops of an unknown item's kind plausibly charge, in paise: [lowest, highest]. */
const PRICE_RANGE: Record<string, [number, number]> = {
  grocery: [1000, 50000],
  general_store: [1000, 40000],
  household_kitchen: [2000, 80000],
  stationery: [1000, 30000],
  hardware: [2000, 80000],
  electrical: [2000, 100000],
  mobile_accessories: [3000, 100000],
  personal_care: [2000, 60000],
  dairy: [1000, 20000],
  sabzi_fruit: [1000, 15000],
  pooja: [1000, 50000],
  medical: [1000, 50000],
  bakery_sweets: [1000, 40000],
};
const DEFAULT_RANGE: [number, number] = [1000, 50000];
/** About four in ten shops have something a customer made up: it is a guess at what they stock. */
const USER_ITEM_YES_RATE = 0.4;

/** A price spread evenly on a log scale (cheap things are far more common), in whole 50 paise. */
function priceFromRange(category: string | null | undefined, rng: () => number): number {
  const [low, high] = (category ? PRICE_RANGE[category] : undefined) ?? DEFAULT_RANGE;
  const raw = Math.exp(Math.log(low) + rng() * (Math.log(high) - Math.log(low)));
  const step = raw >= 1000 ? 100 : 50;
  return Math.min(high, Math.max(low, Math.round(raw / step) * step));
}

/** Rounds to whole rupees for anything dear, to 50 paise for cheap things, never below 50 paise. */
function roundPrice(paise: number, ref: number): number {
  const step = ref >= 1000 ? 100 : 50;
  return Math.max(50, Math.round(paise / step) * step);
}

/**
 * What a shop does with a ping: ignore it, or answer after a delay (5 to 90 seconds divided by
 * `speed`). A yes quotes the reference price plus or minus 30 %, and sometimes says "a few" or
 * "plenty". All randomness comes from `rng`, so a seeded run is repeatable.
 */
export function decide(
  profile: ShopProfile,
  ping: Pick<PingInfo, 'refPricePaise' | 'category' | 'itemCategories' | 'shopCategories'>,
  rng: () => number,
  speed: number,
): Decision {
  if (rng() >= profile.replyProbability) return { kind: 'skip' };
  const delayMs = (MIN_DELAY_MS + rng() * (MAX_DELAY_MS - MIN_DELAY_MS)) / speed;
  if (profile.alwaysNo) return { kind: 'answer', delayMs, body: { answer: 'no' } };
  // A hardware store has no haldi: an item outside the shop's own kinds is a no, even for a catalog
  // item (the fan-out may ask a shop of another kind when too few of the right kind are near).
  const mine = ping.shopCategories;
  const wanted = ping.itemCategories;
  if (mine && wanted && !wanted.some((c) => mine.includes(c)))
    return { kind: 'answer', delayMs, body: { answer: 'no' } };

  if (ping.refPricePaise === null) {
    // An item the catalog does not know: yes or no at random, priced like its category.
    if (rng() >= USER_ITEM_YES_RATE) return { kind: 'answer', delayMs, body: { answer: 'no' } };
    return {
      kind: 'answer',
      delayMs,
      body: { answer: 'yes', pricePaise: priceFromRange(ping.category, rng) },
    };
  }
  const body: AnswerBody = { answer: 'yes' };
  if (ping.refPricePaise !== null) {
    const factor = 1 - PRICE_SPREAD + 2 * PRICE_SPREAD * rng();
    body.pricePaise = roundPrice(ping.refPricePaise * factor, ping.refPricePaise);
  }
  if (rng() < HINT_RATE) body.quantityHint = rng() < 0.5 ? 'few' : 'plenty';
  return { kind: 'answer', delayMs, body };
}
