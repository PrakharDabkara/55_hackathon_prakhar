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
  refPricePaise: number | null;
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
  ping: Pick<PingInfo, 'refPricePaise'>,
  rng: () => number,
  speed: number,
): Decision {
  if (rng() >= profile.replyProbability) return { kind: 'skip' };
  const delayMs = (MIN_DELAY_MS + rng() * (MAX_DELAY_MS - MIN_DELAY_MS)) / speed;
  if (profile.alwaysNo) return { kind: 'answer', delayMs, body: { answer: 'no' } };

  const body: AnswerBody = { answer: 'yes' };
  if (ping.refPricePaise !== null) {
    const factor = 1 - PRICE_SPREAD + 2 * PRICE_SPREAD * rng();
    body.pricePaise = roundPrice(ping.refPricePaise * factor, ping.refPricePaise);
  }
  if (rng() < HINT_RATE) body.quantityHint = rng() < 0.5 ? 'few' : 'plenty';
  return { kind: 'answer', delayMs, body };
}
