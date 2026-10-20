import { result, seekerRequest } from './fakes.js';
import type { SeekerRequest, ShopResult } from '../lib/seekerApi.js';

/** The clock the replies tests run on: "now" is three minutes after the default lastConfirmedAt. */
export const REPLIES_NOW = '2026-10-16T10:03:00.000Z';

/** A live yes. */
export const liveYes = (overrides: Partial<ShopResult> = {}): ShopResult => result(overrides);

/** Remembered stock, last confirmed `days` days before REPLIES_NOW. */
export const remembered = (days: number, overrides: Partial<ShopResult> = {}): ShopResult =>
  result({
    source: 'learned',
    lastConfirmedAt: new Date(new Date(REPLIES_NOW).getTime() - days * 86_400_000).toISOString(),
    ...overrides,
  });

/** An answered request whose stats follow from its results. */
export const answeredRequest = (
  results: ShopResult[],
  overrides: Partial<SeekerRequest> = {},
): SeekerRequest => {
  const yes = results.filter((r) => r.source === 'live').length;
  return seekerRequest({
    state: 'ANSWERED',
    results,
    pingStats: { sent: yes + 2, yes, no: 2, pending: 0 },
    ...overrides,
  });
};
