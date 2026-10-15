import { describe, expect, it } from 'vitest';
import { normaliseQuery } from './normalise.js';

describe('normaliseQuery', () => {
  it('lowercases, trims, collapses spaces and strips punctuation', () => {
    expect(normaliseQuery('  Aata!!  ')).toEqual({ text: 'aata' });
    expect(normaliseQuery('Bottle,   BRUSH.')).toEqual({ text: 'bottle brush' });
    expect(normaliseQuery('bottel-brush?')).toEqual({ text: 'bottel brush' });
  });

  it('keeps Devanagari, including vowel signs and nukta', () => {
    expect(normaliseQuery('आटा')).toEqual({ text: 'आटा' });
    expect(normaliseQuery('  झाड़ू । ')).toEqual({ text: 'झाड़ू' });
    expect(normaliseQuery('पानी की बोतल')).toEqual({ text: 'पानी बोतल' });
  });

  it('keeps Hinglish spellings as typed', () => {
    expect(normaliseQuery('gehun ka atta')).toEqual({ text: 'gehun atta' });
    expect(normaliseQuery('Fevikwik')).toEqual({ text: 'fevikwik' });
  });

  it('drops filler words in English, Hinglish and Devanagari', () => {
    expect(normaliseQuery('mujhe pen chahiye please')).toEqual({ text: 'pen' });
    expect(normaliseQuery('need a hammer')).toEqual({ text: 'hammer' });
    expect(normaliseQuery('chai ki patti')).toEqual({ text: 'chai patti' });
    expect(normaliseQuery('आटा चाहिए')).toEqual({ text: 'आटा' });
  });

  it('does not drop filler-looking letters inside words', () => {
    expect(normaliseQuery('kela')).toEqual({ text: 'kela' });
    expect(normaliseQuery('kitchen knife')).toEqual({ text: 'kitchen knife' });
  });

  it('returns quantities separately, with units normalised', () => {
    expect(normaliseQuery('gehun ka aata 5 kilo')).toEqual({
      text: 'gehun aata',
      quantity: { quantity: 5, unit: 'kg' },
    });
    expect(normaliseQuery('5kg rice')).toEqual({
      text: 'rice',
      quantity: { quantity: 5, unit: 'kg' },
    });
    expect(normaliseQuery('1.5 kg sugar')).toEqual({
      text: 'sugar',
      quantity: { quantity: 1.5, unit: 'kg' },
    });
    expect(normaliseQuery('500 gm chini')).toEqual({
      text: 'chini',
      quantity: { quantity: 500, unit: 'g' },
    });
    expect(normaliseQuery('need 2 litre milk')).toEqual({
      text: 'milk',
      quantity: { quantity: 2, unit: 'l' },
    });
    expect(normaliseQuery('6 pcs pencil')).toEqual({
      text: 'pencil',
      quantity: { quantity: 6, unit: 'pc' },
    });
    expect(normaliseQuery('दूध 2 लीटर')).toEqual({
      text: 'दूध',
      quantity: { quantity: 2, unit: 'l' },
    });
  });

  it('keeps digits that are not a quantity', () => {
    expect(normaliseQuery('led bulb 9 watt')).toEqual({ text: 'led bulb 9 watt' });
    expect(normaliseQuery('a4 paper')).toEqual({ text: 'a4 paper' });
  });

  it('returns empty text for empty or all-filler input', () => {
    expect(normaliseQuery('')).toEqual({ text: '' });
    expect(normaliseQuery('  ?!  ')).toEqual({ text: '' });
    expect(normaliseQuery('please chahiye')).toEqual({ text: '' });
  });
});
