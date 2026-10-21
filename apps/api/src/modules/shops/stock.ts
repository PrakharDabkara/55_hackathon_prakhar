import type { ExactQuantity } from '@askbuy/shared';

export type QuantityHint = 'few' | 'plenty';

/** What a shop said about delivery with its yes: a fee and a time, either may be left out. */
export interface DeliveryOffer {
  feePaise: number | null;
  minutes: number | null;
}

export interface LearnedStockResult {
  shopId: string;
  name: string;
  /** The shop's published logo, or null (ADR-0040). */
  logoUrl?: string | null | undefined;
  distanceM: number;
  /** Where the shop is. Shops are public businesses, so this is shown to seekers. */
  lat: number;
  lng: number;
  pricePaise: number | null;
  quantityHint: QuantityHint | null;
  /** The exact quantity the shop last said it had: remembered, never subtracted. */
  quantity: ExactQuantity | null;
  /** The delivery the shop last offered, if it did. */
  delivery: DeliveryOffer | null;
  lastConfirmedAt: Date;
  freshness: string;
  /** A customer who went there found it (ADR-0035). Forgotten when the shop answers again itself. */
  customerVerified?: boolean;
  /** Customers have repeatedly come away empty-handed: ranked below the others, never shown as such. */
  doubtful?: boolean;
}

/** After this many "Wahan nahi tha" a shop's learned answer for an item is ranked last (ADR-0035). */
export const DOUBTFUL_AFTER_REPORTS = 2;

const DAY_MS = 24 * 3_600_000;

/** Starting defaults: learned stock fades after 7 days, sooner if the shop said "a few". */
const STOCK_TTL_DAYS = 7;
const FEW_TTL_DAYS = 3;

/**
 * An exact quantity is a snapshot that goes stale fast, so it fades like "a few": 3 days (ADR-0031).
 */
export function stockExpiry(
  confirmedAt: Date,
  quantityHint: QuantityHint | null,
  exactQuantity = false,
): Date {
  const days = quantityHint === 'few' || exactQuantity ? FEW_TTL_DAYS : STOCK_TTL_DAYS;
  return new Date(confirmedAt.getTime() + days * DAY_MS);
}

/** Whole days since confirmation; a timestamp slightly in the future counts as 0. */
const daysSince = (confirmedAt: Date, now: Date): number =>
  Math.max(0, Math.floor((now.getTime() - confirmedAt.getTime()) / DAY_MS));

export function freshnessLabel(confirmedAt: Date, now: Date): string {
  const days = daysSince(confirmedAt, now);
  if (days < 1) return 'Confirmed today';
  if (days === 1) return 'Had it yesterday';
  return `Had it ${days} days ago`;
}

/** 0 = today, 1 = the last 3 days, 2 = older, 3 = doubtful whatever its age. */
const freshnessBucket = (result: LearnedStockResult, now: Date): number => {
  if (result.doubtful) return 3;
  const days = daysSince(result.lastConfirmedAt, now);
  return days < 1 ? 0 : days < 3 ? 1 : 2;
};

/** Fresher bucket first, doubtful answers last, then nearest. Returns a new array. */
export function rankResults(results: LearnedStockResult[], now: Date): LearnedStockResult[] {
  return results
    .map((r) => ({ r, bucket: freshnessBucket(r, now) }))
    .sort((a, b) => a.bucket - b.bucket || a.r.distanceM - b.r.distanceM)
    .map(({ r }) => r);
}
