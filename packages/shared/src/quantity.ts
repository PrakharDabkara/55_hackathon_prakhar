/** The units a shop may give an exact quantity in (ADR-0031). */
export const QUANTITY_UNITS = ['kg', 'g', 'l', 'ml', 'piece', 'packet'] as const;
export type QuantityUnit = (typeof QUANTITY_UNITS)[number];

export interface ExactQuantity {
  amount: number;
  unit: QuantityUnit;
}

export const isQuantityUnit = (value: unknown): value is QuantityUnit =>
  typeof value === 'string' && (QUANTITY_UNITS as readonly string[]).includes(value);

/** The query parser writes "pc"; a quantity says "piece". */
export const unitFromQuery = (unit: string): QuantityUnit =>
  unit === 'pc' ? 'piece' : (unit as QuantityUnit);

const LABEL: Record<QuantityUnit, string> = {
  kg: 'kg',
  g: 'g',
  l: 'L',
  ml: 'ml',
  piece: 'piece',
  packet: 'packet',
};

/** "5 kg", "1.5 kg", "0.25 L": the amount without trailing zeros, then the unit. */
export const formatQuantity = ({ amount, unit }: ExactQuantity): string =>
  `${Number(amount.toFixed(3))} ${LABEL[unit]}`;

/** Mass in grams, volume in millilitres; pieces and packets only compare with themselves. */
const BASE: Record<QuantityUnit, { family: string; factor: number }> = {
  kg: { family: 'mass', factor: 1000 },
  g: { family: 'mass', factor: 1 },
  l: { family: 'volume', factor: 1000 },
  ml: { family: 'volume', factor: 1 },
  piece: { family: 'piece', factor: 1 },
  packet: { family: 'packet', factor: 1 },
};

/**
 * Is what the shop has (`offered`) enough for what was asked? "unknown" when the units cannot be
 * compared (a kilo against a packet): the screen then shows what the shop said and no judgement.
 */
export function compareQuantity(
  asked: ExactQuantity,
  offered: ExactQuantity,
): 'enough' | 'short' | 'unknown' {
  const a = BASE[asked.unit];
  const o = BASE[offered.unit];
  if (a.family !== o.family) return 'unknown';
  // Compare in whole base units: 0.1 + 0.2 style float noise must not decide a yes or no.
  const want = Math.round(asked.amount * a.factor * 1000);
  const have = Math.round(offered.amount * o.factor * 1000);
  return have >= want ? 'enough' : 'short';
}
