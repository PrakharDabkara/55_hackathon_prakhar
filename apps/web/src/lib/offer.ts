import { QUANTITY_UNITS, type QuantityUnit } from '@askbuy/shared';
import { rupeesToPaise } from './money.js';

export { QUANTITY_UNITS };
export type { QuantityUnit };

/** "5", "1.5" or "1,5" → a positive amount, or null. */
export function parseAmount(text: string): number | null {
  const clean = text.trim().replace(',', '.');
  if (!/^\d{1,6}(\.\d{1,3})?$/.test(clean)) return null;
  const value = Number(clean);
  return value > 0 ? value : null;
}

/** A delivery fee in rupees → paise. Unlike a price, 0 is allowed: it means free delivery. */
export function parseFee(text: string): number | null {
  if (/^\s*₹?\s*0+(\.0{1,2})?\s*$/.test(text)) return 0;
  const parsed = rupeesToPaise(text);
  return parsed.ok ? parsed.paise : null;
}

/** "45" → 45 minutes (1 to 1440), or null. */
export function parseMinutes(text: string): number | null {
  if (!/^\s*\d{1,4}\s*$/.test(text)) return null;
  const value = Number(text);
  return value >= 1 && value <= 1440 ? value : null;
}
