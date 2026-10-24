import { coveredCategories } from '../categories.js';

/** How one fake shop behaves. Drawn once per shop from a seed, so a restart keeps its character. */
export interface ShopProfile {
  /** Chance the shop answers a ping at all (the rest it ignores, like a busy shopkeeper). */
  replyProbability: number;
  /** About 5 % of shops never have anything. */
  alwaysNo: boolean;
  /** For tests and demos that must not depend on luck: this shop accepts every delivery order. */
  neverDeclines?: boolean;
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
  /** The customer ticked "Deliver to me", and this shop is within its own delivery limit (ADR-0039). */
  wantsDelivery?: boolean;
  canDeliver?: boolean;
}

export interface AnswerBody {
  answer: 'yes' | 'no';
  pricePaise?: number;
  quantityHint?: 'few' | 'plenty';
  /** An exact quantity, sometimes (ADR-0031). */
  quantity?: { amount: number; unit: 'kg' | 'g' | 'l' | 'ml' | 'piece' | 'packet' };
  /** "Ghar bhej denge", sometimes: a fee (0 is free) and a time in minutes. */
  delivery?: { feePaise: number; minutes: number };
}

export type Decision = { kind: 'skip' } | { kind: 'answer'; delayMs: number; body: AnswerBody };

export function makeProfile(rng: () => number): ShopProfile {
  return { replyProbability: 0.3 + 0.6 * rng(), alwaysNo: rng() < 0.05 };
}

/** What a shop of each kind counts its stock in, and how much it might say it has. */
const STOCK_UNITS: Record<
  string,
  { unit: NonNullable<AnswerBody['quantity']>['unit']; amounts: number[] }[]
> = {
  grocery: [
    { unit: 'kg', amounts: [1, 2, 5, 10, 25] },
    { unit: 'packet', amounts: [3, 6, 12] },
  ],
  general_store: [
    { unit: 'piece', amounts: [4, 10, 24] },
    { unit: 'packet', amounts: [3, 6, 12] },
  ],
  dairy: [
    { unit: 'l', amounts: [1, 2, 5, 10] },
    { unit: 'packet', amounts: [4, 10, 20] },
  ],
  sabzi_fruit: [{ unit: 'kg', amounts: [1, 3, 5, 10] }],
  stationery: [{ unit: 'piece', amounts: [5, 10, 20, 50] }],
  hardware: [{ unit: 'piece', amounts: [2, 5, 10, 25] }],
  electrical: [{ unit: 'piece', amounts: [2, 5, 10] }],
  household_kitchen: [{ unit: 'piece', amounts: [2, 4, 8] }],
  personal_care: [{ unit: 'piece', amounts: [3, 6, 12] }],
  mobile_accessories: [{ unit: 'piece', amounts: [2, 5, 10] }],
  pooja: [{ unit: 'packet', amounts: [2, 5, 10] }],
  medical: [{ unit: 'packet', amounts: [2, 5, 10] }],
  bakery_sweets: [
    { unit: 'piece', amounts: [6, 12, 24] },
    { unit: 'kg', amounts: [1, 2] },
  ],
};
const DEFAULT_STOCK = [{ unit: 'piece' as const, amounts: [2, 5, 10] }];
const QUANTITY_RATE = 0.35;
const DELIVERY_RATE = 0.25;
/** A customer who asked for delivery gets an offer more often. */
const WANTED_DELIVERY_RATE = 0.4;
const DELIVERY_FEES_PAISE = [0, 2000, 3000, 5000];

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

/** Sometimes an exact quantity and a delivery offer, on a yes. Draws only when it adds one. */
function extras(
  body: AnswerBody,
  category: string | null | undefined,
  rng: () => number,
  delivery: Pick<PingInfo, 'wantsDelivery' | 'canDeliver'> = {},
): AnswerBody {
  if (rng() < QUANTITY_RATE) {
    const choices = (category ? STOCK_UNITS[category] : undefined) ?? DEFAULT_STOCK;
    const kind = choices[Math.floor(rng() * choices.length)] as (typeof choices)[number];
    body.quantity = {
      amount: kind.amounts[Math.floor(rng() * kind.amounts.length)] as number,
      unit: kind.unit,
    };
  }
  // Always one draw, so a seeded run is repeatable; a shop out of range cannot offer (the API refuses).
  const offers = rng() < (delivery.wantsDelivery ? WANTED_DELIVERY_RATE : DELIVERY_RATE);
  if (offers && delivery.canDeliver !== false)
    body.delivery = {
      feePaise: DELIVERY_FEES_PAISE[Math.floor(rng() * DELIVERY_FEES_PAISE.length)] as number,
      minutes: 20 + Math.floor(rng() * 9) * 5,
    };
  return body;
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
  ping: Pick<
    PingInfo,
    | 'refPricePaise'
    | 'category'
    | 'itemCategories'
    | 'shopCategories'
    | 'wantsDelivery'
    | 'canDeliver'
  >,
  rng: () => number,
  speed: number,
): Decision {
  if (rng() >= profile.replyProbability) return { kind: 'skip' };
  const delayMs = (MIN_DELAY_MS + rng() * (MAX_DELAY_MS - MIN_DELAY_MS)) / speed;
  if (profile.alwaysNo) return { kind: 'answer', delayMs, body: { answer: 'no' } };
  // A hardware store has no haldi: an item outside the shop's own kinds is a no, even for a catalog
  // item (the fan-out may ask a shop of another kind when too few of the right kind are near).
  const mine = ping.shopCategories && coveredCategories(ping.shopCategories);
  const wanted = ping.itemCategories;
  if (mine && wanted && !wanted.some((c) => mine.includes(c)))
    return { kind: 'answer', delayMs, body: { answer: 'no' } };

  if (ping.refPricePaise === null) {
    // An item the catalog does not know: yes or no at random, priced like its category.
    if (rng() >= USER_ITEM_YES_RATE) return { kind: 'answer', delayMs, body: { answer: 'no' } };
    return {
      kind: 'answer',
      delayMs,
      body: extras(
        { answer: 'yes', pricePaise: priceFromRange(ping.category, rng) },
        ping.category,
        rng,
        ping,
      ),
    };
  }
  const body: AnswerBody = { answer: 'yes' };
  if (ping.refPricePaise !== null) {
    const factor = 1 - PRICE_SPREAD + 2 * PRICE_SPREAD * rng();
    body.pricePaise = roundPrice(ping.refPricePaise * factor, ping.refPricePaise);
  }
  if (rng() < HINT_RATE) body.quantityHint = rng() < 0.5 ? 'few' : 'plenty';
  return { kind: 'answer', delayMs, body: extras(body, ping.category, rng, ping) };
}

/** What a shop does with a delivery order (ADR-0031): take it and bring it, or say no. */
export type OrderDecision =
  | { kind: 'accept'; acceptMs: number; outMs: number }
  /** The order started ACCEPTED (a fresh offer the customer took): only set out. */
  | { kind: 'dispatch'; outMs: number }
  | { kind: 'decline'; delayMs: number };

const ORDER_DECLINE_RATE = 0.2;
const between = (rng: () => number, low: number, high: number) => low + rng() * (high - low);

/**
 * Most orders are accepted after 3 to 30 s and set out 5 to 30 s later (all divided by `speed`);
 * about one in five is declined after 3 to 30 s. An order that starts ACCEPTED is only set out.
 * The shop never marks it delivered: the customer's Received does (ADR-0039). All randomness comes
 * from `rng`, so a seeded run is repeatable.
 */
export function decideOrder(
  profile: ShopProfile,
  rng: () => number,
  speed: number,
  state: 'REQUESTED' | 'ACCEPTED' = 'REQUESTED',
): OrderDecision {
  if (state === 'ACCEPTED') return { kind: 'dispatch', outMs: between(rng, 5000, 30_000) / speed };
  const declines = !profile.neverDeclines && rng() < ORDER_DECLINE_RATE;
  const acceptMs = between(rng, 3000, 30_000) / speed;
  if (declines) return { kind: 'decline', delayMs: acceptMs };
  return {
    kind: 'accept',
    acceptMs,
    outMs: between(rng, 5000, 30_000) / speed,
  };
}

/** A parchi (ADR-0055): the lines one shop is asked about, as the admin stream announces them. */
export interface ListPingInfo {
  listPingId: string;
  shopId: string;
  wantsDelivery?: boolean;
  canDeliver?: boolean;
  shopCategories?: string[];
  lines: {
    lineId: string;
    name: string;
    /** The item's category, so a line is priced like its kind. Null for an "other" line. */
    category: string | null;
    itemCategories: string[];
    refPricePaise: number | null;
    other: boolean;
  }[];
}

export interface ListAnswerBody {
  lines: { lineId: string; have: boolean; priceRupees?: number }[];
  canDeliver?: boolean;
  /** One fee for the whole list, in whole rupees (0 is free). */
  deliveryFeeRupees?: number;
}

export type ListDecision =
  { kind: 'skip' } | { kind: 'answer'; delayMs: number; body: ListAnswerBody };

/** About three in four catalog lines are in stock; far fewer of the odd things nobody files. */
const LIST_HAVE_RATE = 0.75;

const wholeRupees = (paise: number): number => Math.max(1, Math.round(paise / 100));

/**
 * What a shop does with a parchi: ignore it, or answer every line after a delay (5 to 90 seconds
 * divided by `speed`). Each line is a yes or a no at random (a kind of shop that does not carry the
 * item says no), with a plausible whole-rupee price; sometimes the shop can deliver, with one fee.
 * All randomness comes from `rng`, with one draw per decision in a fixed order, so a seeded run is
 * repeatable.
 */
export function decideList(
  profile: ShopProfile,
  ping: ListPingInfo,
  rng: () => number,
  speed: number,
): ListDecision {
  if (rng() >= profile.replyProbability) return { kind: 'skip' };
  const delayMs = (MIN_DELAY_MS + rng() * (MAX_DELAY_MS - MIN_DELAY_MS)) / speed;
  const mine = ping.shopCategories && coveredCategories(ping.shopCategories);
  const lines = ping.lines.map((line) => {
    // Always the same draws per line, so a no on one line does not shift the next.
    const chance = rng();
    const priceDraw = rng();
    const outsideKind =
      !line.other &&
      mine !== undefined &&
      line.itemCategories.length > 0 &&
      !line.itemCategories.some((c) => mine.includes(c));
    const rate = line.other || line.refPricePaise === null ? USER_ITEM_YES_RATE : LIST_HAVE_RATE;
    if (profile.alwaysNo || outsideKind || chance >= rate)
      return { lineId: line.lineId, have: false };
    const paise =
      line.refPricePaise !== null
        ? roundPrice(
            line.refPricePaise * (1 - PRICE_SPREAD + 2 * PRICE_SPREAD * priceDraw),
            line.refPricePaise,
          )
        : priceFromRange(line.category, () => priceDraw);
    return { lineId: line.lineId, have: true, priceRupees: wholeRupees(paise) };
  });
  const body: ListAnswerBody = { lines };
  // Always two draws, so a seeded run is repeatable; a shop out of range cannot offer (the API refuses).
  const offers = rng() < (ping.wantsDelivery ? WANTED_DELIVERY_RATE : DELIVERY_RATE);
  const fee = DELIVERY_FEES_PAISE[Math.floor(rng() * DELIVERY_FEES_PAISE.length)] as number;
  if (offers && ping.canDeliver !== false && !profile.alwaysNo) {
    body.canDeliver = true;
    body.deliveryFeeRupees = fee / 100;
  }
  return { kind: 'answer', delayMs, body };
}
