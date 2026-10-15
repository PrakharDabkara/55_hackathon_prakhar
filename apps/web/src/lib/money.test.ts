import { describe, expect, it } from 'vitest';
import { formatRupees, rupeesToPaise } from './money.js';

describe('rupeesToPaise', () => {
  it.each([
    ['45', 4500],
    ['45.5', 4550],
    ['45.50', 4550],
    ['0.5', 50],
    ['0.05', 5],
    ['1200', 120000],
    ['1,200', 120000],
    ['  60  ', 6000],
    ['₹45', 4500],
    ['19.99', 1999],
    ['4.35', 435], // 4.35 * 100 is 434.99999999999994 in floating point
    ['1.1', 110],
  ])('%s rupees is %i paise', (text, paise) => {
    expect(rupeesToPaise(text)).toEqual({ ok: true, paise });
  });

  it('rejects empty input', () => {
    for (const text of ['', '   ', '₹']) {
      expect(rupeesToPaise(text), JSON.stringify(text)).toEqual({ ok: false, reason: 'empty' });
    }
  });

  it('rejects negatives', () => {
    for (const text of ['-5', '-0.50', '−5']) {
      expect(rupeesToPaise(text), text).toEqual({ ok: false, reason: 'negative' });
    }
  });

  it('rejects more than 2 decimal places instead of rounding them', () => {
    for (const text of ['4.555', '1.001', '0.123']) {
      expect(rupeesToPaise(text), text).toEqual({ ok: false, reason: 'too_precise' });
    }
  });

  it('rejects zero and anything that is not a plain amount', () => {
    for (const text of ['0', '0.00']) {
      expect(rupeesToPaise(text), text).toEqual({ ok: false, reason: 'invalid' });
    }
    for (const text of ['abc', '4.5.5', '1e3', '12 34', '4.', '.5x', '١٢']) {
      expect(rupeesToPaise(text), text).toEqual({ ok: false, reason: 'invalid' });
    }
  });

  it('rejects an amount larger than the API accepts (Rs 100,000)', () => {
    expect(rupeesToPaise('100000')).toEqual({ ok: true, paise: 10_000_000 });
    expect(rupeesToPaise('100000.01')).toEqual({ ok: false, reason: 'invalid' });
  });
});

describe('formatRupees', () => {
  it('drops .00 and keeps real paise', () => {
    expect(formatRupees(6000)).toBe('₹60');
    expect(formatRupees(4550)).toBe('₹45.50');
    expect(formatRupees(5)).toBe('₹0.05');
    expect(formatRupees(120000)).toBe('₹1200');
  });
});
