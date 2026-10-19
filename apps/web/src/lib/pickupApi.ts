import { createCaller, type ClientOptions } from './api.js';

export type PickupAnswer = 'found' | 'not_there' | 'not_gone';

/** A shop and item the customer went to, noted when they tap "Raasta". */
export type NewPickup = { shopId: string; itemId: string } & (
  { requestId: string; errandId?: never } | { errandId: string; requestId?: never }
);

/** "Kya aapko <item> <shop> par mila?" */
export interface PendingPickup {
  id: string;
  item: { nameEn: string; nameHi: string };
  shop: { name: string };
}

/** The "Le liya?" half of the customer app (ADR-0035). */
export interface PickupApi {
  recordPickup(pickup: NewPickup): Promise<void>;
  pendingPickups(): Promise<PendingPickup[]>;
  answerPickup(id: string, answer: PickupAnswer): Promise<void>;
}

export function createPickupApi(options: ClientOptions): PickupApi {
  const call = createCaller(options);
  return {
    async recordPickup(pickup) {
      await call('POST', '/pickups', pickup);
    },
    pendingPickups: () => call<PendingPickup[]>('GET', '/pickups/pending'),
    async answerPickup(id, answer) {
      await call('POST', `/pickups/${encodeURIComponent(id)}/answer`, { answer });
    },
  };
}
