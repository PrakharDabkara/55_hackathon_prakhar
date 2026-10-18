import { describe, expect, it } from 'vitest';
import { checkProductName } from './itemSanity.js';

const why = (text: string) => {
  const r = checkProductName(text);
  return r.ok ? null : r.reason;
};

describe('checkProductName: code-level checks before a new item is made (ADR-0028, when unsure do not create)', () => {
  it('lets real product names through, in English, Hinglish and Devanagari', () => {
    for (const ok of [
      'bead dazzling kit',
      'rangoli stencil',
      'popsicle sticks',
      'chandan itr',
      'dhaaga',
      'pichkari',
      'a4 paper',
      'led bulb 9w',
      'glue dots',
      'kanch ki chudi',
      'चंदन इत्र',
      'रंगोली रंग',
      'strength band',
      'thermocol ball',
    ])
      expect(why(ok), ok).toBeNull();
  });

  it('refuses random strings and keyboard mash', () => {
    expect(why('qpzx wvk')).toBe('not_words');
    expect(why('zzzzzz')).toBe('not_words');
    expect(why('lkjhgfd')).toBe('not_words');
    expect(why('mnbvcx zxcvbn')).toBe('not_words');
    expect(why('asdkjh')).toBe('not_words');
    expect(why('qwerty uiop')).toBe('not_words');
    expect(why('hjkl')).toBe('not_words');
    expect(why('xq')).toBe('not_words');
  });

  it('refuses repeated characters and mostly-random text with one lucky word', () => {
    expect(why('ababababab')).toBe('not_words');
    expect(why('aaaa bbbb')).toBe('not_words');
    expect(why('pen qpzx wvkt lkjhg')).toBe('not_words');
  });

  it('needs at least one real word: numbers and short bits alone are not a product', () => {
    expect(why('12 34')).toBe('not_words');
    expect(why('9w')).toBe('not_words');
    expect(why('a b c')).toBe('not_words');
  });

  it('refuses sentences and questions', () => {
    expect(why('what is the time')).toBe('sentence');
    expect(why('kal subah kaun aayega')).toBe('sentence');
    expect(why('my friend rahul')).toBe('sentence');
    expect(why('one two three four five six seven eight')).toBe('sentence');
  });

  it('refuses vehicles, phones and laptops, property, services and places themselves', () => {
    for (const text of [
      'tesla car',
      'maruti swift',
      'honda activa',
      'iphone 15 pro max',
      'samsung galaxy s24',
      'macbook pro',
      '2bhk flat',
      'plot',
      'plumber',
      'electrician',
      'taxi booking',
      'mobile recharge',
      'indore',
      'delhi mumbai',
    ])
      expect(why(text), text).toBe('out_of_scope');
  });

  it('but accepts the accessory, the toy or the care product for them', () => {
    for (const ok of [
      'iphone charger',
      'phone cover',
      'samsung galaxy case',
      'laptop stand',
      'car freshener',
      'bike chain lock',
      'tesla car toy',
      'car wash shampoo',
      'scooter key chain',
      'macbook sleeve cover',
    ])
      expect(why(ok), ok).toBeNull();
  });
});
