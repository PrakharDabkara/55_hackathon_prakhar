import { CATEGORIES } from '@kahanmilega/shared';
import { describe, expect, it } from 'vitest';
import { en, hi } from './strings.js';

describe('the two dictionaries', () => {
  it('have exactly the same keys', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(hi).sort());
    expect(Object.keys(en.categories).sort()).toEqual(Object.keys(hi.categories).sort());
    expect(Object.keys(en.bands).sort()).toEqual(Object.keys(hi.bands).sort());
  });

  it('have no empty text', () => {
    for (const dict of [en, hi]) {
      for (const [key, value] of Object.entries(dict)) {
        if (typeof value === 'string') expect(value.trim(), key).not.toBe('');
      }
    }
  });

  it('show the big answer words in Devanagari and the Latin spelling only in Hindi', () => {
    for (const label of [hi.yes, hi.no, hi.quantityTitle]) {
      expect(label.main).toMatch(/[ऀ-ॿ]/);
      expect(label.sub).toMatch(/^[A-Za-z? ]+$/);
    }
    for (const label of [en.yes, en.no, en.quantityTitle]) {
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

  it('use the wording the shopkeeper flow promises', () => {
    expect(hi.yes).toEqual({ main: 'हाँ है', sub: 'Haan hai' });
    expect(hi.no).toEqual({ main: 'नहीं है', sub: 'Nahi hai' });
    expect(hi.quantityTitle).toEqual({ main: 'कितना है?', sub: 'Kitna hai?' });
    expect(hi.few).toBe('थोड़ा बचा है');
    expect(hi.plenty).toBe('काफ़ी है');
    expect(hi.send).toBe('Bhejo');
    expect(hi.skip).toBe('Skip');
    expect(hi.useMyLocation).toBe('Meri location use karein');
    expect(hi.emptyHome).toBe('Abhi koi sawaal nahi. Naye sawaal yahan apne aap aayenge.');
    expect(hi.targetLine('₹60')).toBe(
      'Customer ne ₹60 mein dekha hai — kya aapke paas isse kam mein hai?',
    );
  });

  it('give four examples: a vague goal and an explicit list among them', () => {
    for (const dict of [en, hi]) {
      expect(dict.errandExamples).toHaveLength(4);
      expect(dict.errandExamples).toContain('chai banane ka saaman');
      expect(dict.errandExamples).toContain('chai: chai patti, chini, doodh');
    }
  });
});
