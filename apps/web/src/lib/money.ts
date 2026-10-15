export type RupeesResult =
  | { ok: true; paise: number }
  | { ok: false; reason: 'empty' | 'negative' | 'too_precise' | 'invalid' };

/** The API accepts up to Rs 100,000 (10,000,000 paise). */
const MAX_PAISE = 10_000_000;

/**
 * "45", "45.5", "₹1,200" → integer paise. Integer arithmetic only: 4.35 * 100 is not 435 in floating
 * point, and money must never be a float. Rejects negatives and zero, more than 2 decimals (it
 * would have to round), and anything that is not a plain amount.
 */
export function rupeesToPaise(input: string): RupeesResult {
  const text = input.trim().replace(/^₹\s*/, '').replace(/,/g, '').trim();
  if (text === '') return { ok: false, reason: 'empty' };
  if (/^[-−]/.test(text)) return { ok: false, reason: 'negative' };

  const match = /^(\d{1,9})(?:\.(\d+))?$/.exec(text);
  if (!match) return { ok: false, reason: 'invalid' };
  const fraction = match[2] ?? '';
  if (fraction.length > 2) return { ok: false, reason: 'too_precise' };

  const paise = Number(match[1]) * 100 + Number(fraction.padEnd(2, '0'));
  if (paise <= 0 || paise > MAX_PAISE) return { ok: false, reason: 'invalid' };
  return { ok: true, paise };
}

/** 6000 → "₹60", 4550 → "₹45.50". */
export function formatRupees(paise: number): string {
  const rupees = Math.floor(paise / 100);
  const rest = paise % 100;
  return rest === 0 ? `₹${rupees}` : `₹${rupees}.${String(rest).padStart(2, '0')}`;
}
