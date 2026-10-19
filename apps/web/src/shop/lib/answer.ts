import type { DeliveryDefaults } from '../../lib/api.js';
import { rupeesToPaise } from '../../lib/money.js';
import { parseFee } from '../../lib/offer.js';

/** 4500 → "45", 4550 → "45.5": a price as a shop would type it. */
export function priceInput(paise: number | null | undefined): string {
  if (paise === null || paise === undefined) return '';
  return String(paise / 100);
}

/** "" → undefined (no price said); "45" → 4500; anything else → null (a mistake to point out). */
export function parsePrice(text: string): number | null | undefined {
  if (text.trim() === '') return undefined;
  const parsed = rupeesToPaise(text);
  return parsed.ok ? parsed.paise : null;
}

/** The shop's standing delivery offer, as the answer body wants it. */
export function defaultOffer(shop: {
  defaultFeePaise: number | null;
  defaultMinutes: number | null;
}): DeliveryDefaults {
  return {
    ...(shop.defaultFeePaise !== null && { feePaise: shop.defaultFeePaise }),
    ...(shop.defaultMinutes !== null && { minutes: shop.defaultMinutes }),
  };
}

export { parseFee };
