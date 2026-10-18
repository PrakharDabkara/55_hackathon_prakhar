import { describe, expect, it } from 'vitest';
import {
  compareQuantity,
  formatQuantity,
  isQuantityUnit,
  QUANTITY_UNITS,
  unitFromQuery,
} from './index.js';

describe('quantity units (ADR-0031)', () => {
  it('are exactly kg, g, l, ml, piece and packet', () => {
    expect([...QUANTITY_UNITS]).toEqual(['kg', 'g', 'l', 'ml', 'piece', 'packet']);
    expect(isQuantityUnit('kg')).toBe(true);
    expect(isQuantityUnit('pc')).toBe(false);
    expect(isQuantityUnit('dozen')).toBe(false);
  });

  it('turns the query parser\'s "pc" into "piece" and keeps the rest', () => {
    expect(unitFromQuery('pc')).toBe('piece');
    for (const u of ['kg', 'g', 'l', 'ml']) expect(unitFromQuery(u)).toBe(u);
  });
});

describe('formatQuantity: "5 kg"', () => {
  it('writes the amount without trailing zeros, then the unit', () => {
    expect(formatQuantity({ amount: 5, unit: 'kg' })).toBe('5 kg');
    expect(formatQuantity({ amount: 1.5, unit: 'kg' })).toBe('1.5 kg');
    expect(formatQuantity({ amount: 0.25, unit: 'l' })).toBe('0.25 L');
    expect(formatQuantity({ amount: 500, unit: 'g' })).toBe('500 g');
    expect(formatQuantity({ amount: 250, unit: 'ml' })).toBe('250 ml');
    expect(formatQuantity({ amount: 3, unit: 'piece' })).toBe('3 piece');
    expect(formatQuantity({ amount: 2, unit: 'packet' })).toBe('2 packet');
  });
});

describe('compareQuantity: is what the shop has enough for what was asked?', () => {
  it('compares across kg and g, and across l and ml', () => {
    expect(compareQuantity({ amount: 2, unit: 'kg' }, { amount: 5, unit: 'kg' })).toBe('enough');
    expect(compareQuantity({ amount: 2, unit: 'kg' }, { amount: 1, unit: 'kg' })).toBe('short');
    expect(compareQuantity({ amount: 500, unit: 'g' }, { amount: 1, unit: 'kg' })).toBe('enough');
    expect(compareQuantity({ amount: 2, unit: 'kg' }, { amount: 1500, unit: 'g' })).toBe('short');
    expect(compareQuantity({ amount: 1, unit: 'l' }, { amount: 500, unit: 'ml' })).toBe('short');
    expect(compareQuantity({ amount: 250, unit: 'ml' }, { amount: 1, unit: 'l' })).toBe('enough');
  });

  it('an equal amount is enough', () => {
    expect(compareQuantity({ amount: 1, unit: 'kg' }, { amount: 1000, unit: 'g' })).toBe('enough');
  });

  it('says unknown when the units cannot be compared (kg against a packet, litres against pieces)', () => {
    expect(compareQuantity({ amount: 1, unit: 'kg' }, { amount: 2, unit: 'packet' })).toBe(
      'unknown',
    );
    expect(compareQuantity({ amount: 1, unit: 'l' }, { amount: 2, unit: 'piece' })).toBe('unknown');
    expect(compareQuantity({ amount: 2, unit: 'piece' }, { amount: 2, unit: 'packet' })).toBe(
      'unknown',
    );
  });

  it('compares pieces with pieces and packets with packets', () => {
    expect(compareQuantity({ amount: 3, unit: 'piece' }, { amount: 2, unit: 'piece' })).toBe(
      'short',
    );
    expect(compareQuantity({ amount: 2, unit: 'packet' }, { amount: 2, unit: 'packet' })).toBe(
      'enough',
    );
  });
});
