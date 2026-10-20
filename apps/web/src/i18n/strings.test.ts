import { CATEGORIES } from '@kahanmilega/shared';
import { describe, expect, it } from 'vitest';
import { en, hi } from './strings.js';

describe('the two dictionaries', () => {
  it('have exactly the same keys', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(hi).sort());
    expect(Object.keys(en.categories).sort()).toEqual(Object.keys(hi.categories).sort());
    expect(Object.keys(en.bands).sort()).toEqual(Object.keys(hi.bands).sort());
  });

  it('have the same shop keys, none empty', () => {
    expect(Object.keys(en.shop).sort()).toEqual(Object.keys(hi.shop).sort());
    for (const dict of [en.shop, hi.shop]) {
      for (const [key, value] of Object.entries(dict)) {
        if (typeof value === 'string') expect(value.trim(), key).not.toBe('');
        else expect(typeof value, key).toBe('function');
      }
    }
  });

  it('have the same customer keys, none empty', () => {
    expect(Object.keys(en.c).sort()).toEqual(Object.keys(hi.c).sort());
    for (const dict of [en.c, hi.c]) {
      for (const [key, value] of Object.entries(dict)) {
        if (typeof value === 'string') expect(value.trim(), key).not.toBe('');
        else expect(typeof value, key).toBe('function');
      }
    }
  });

  it('use the English copy the shop UI promises', () => {
    const s = en.shop;
    expect(s.toastClosed).toBe("You're closed. You won't get new requests.");
    expect(s.toastOpen).toBe("You're open.");
    expect(s.sendFailed).toBe("Couldn't send. Check your connection and try again.");
    expect(s.priceInvalid).toBe('Price must be a number, like 45.');
    expect(s.offline).toBe("You're offline. Reconnect to answer.");
    expect(s.emptyTitle).toBe('No requests right now');
    expect(s.startReceiving).toBe('Start getting requests');
    expect(s.sheetTitle('Atta', '5 kg')).toBe('Atta · 5 kg');
    expect(s.orderBanner('Atta')).toBe('Customer chose you · Atta');
    expect(s.inclFee('₹120', '₹20')).toBe('₹120 incl. ₹20 delivery · collect cash');
  });

  it('have no empty text', () => {
    for (const dict of [en, hi]) {
      for (const [key, value] of Object.entries(dict)) {
        if (typeof value === 'string') expect(value.trim(), key).not.toBe('');
      }
    }
  });

  it('show the big answer words in Devanagari and the Latin spelling only in Hindi', () => {
    for (const label of [hi.yes]) {
      expect(label.main).toMatch(/[ऀ-ॿ]/);
      expect(label.sub).toMatch(/^[A-Za-z? ]+$/);
    }
    for (const label of [en.yes]) {
      expect(label.main).toMatch(/^[A-Za-z?, ]+$/);
      expect(label.sub).toBeUndefined();
    }
  });

  it('name every shop category, in Devanagari for Hindi', () => {
    for (const c of CATEGORIES) {
      expect(hi.categories[c], c).toMatch(/[ऀ-ॿ]/);
      expect(en.categories[c], c).toMatch(/^[A-Za-z ,&]+$/);
    }
  });

  it('keep the wording the customer flow still shows', () => {
    expect(hi.yes).toEqual({ main: 'हाँ है', sub: 'Haan hai' });
    expect(hi.few).toBe('थोड़ा बचा है');
    expect(hi.plenty).toBe('काफ़ी है');
    expect(hi.send).toBe('Bhejo');
    expect(hi.useMyLocation).toBe('Meri location use karein');
  });

  it('give four examples: a vague goal and an explicit list among them', () => {
    expect(en.errandExamples).toHaveLength(4);
    expect(en.errandExamples).toContain('Make tea at home');
    expect(en.errandExamples).toContain('Tea: tea leaves, sugar, milk');
    expect(hi.errandExamples).toHaveLength(4);
    expect(hi.errandExamples).toContain('chai banane ka saaman');
  });
});
