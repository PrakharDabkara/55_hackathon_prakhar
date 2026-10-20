import { describe, expect, it } from 'vitest';
import { covers, namedFragments, uncovered } from './named.js';

// ADR-0049: which things the customer named, worked out in code from their own words.
describe('namedFragments', () => {
  it('splits a list on commas, "aur", "and", "+" and "&"', () => {
    expect(namedFragments('sugar, tea aur milk')).toEqual(['sugar', 'tea', 'milk']);
    expect(namedFragments('atta and dal + rice & salt')).toEqual(['atta', 'dal', 'rice', 'salt']);
  });

  it('drops quantities and filler words but keeps the item', () => {
    expect(namedFragments('5 kg sugar, 2 litre milk chahiye')).toEqual(['sugar', 'milk']);
  });

  it('a goal is not an item: nothing is named for "poha banane ka saaman"', () => {
    expect(namedFragments('poha banane ka saaman')).toEqual([]);
    expect(namedFragments('chai banane ka saaman')).toEqual([]);
    expect(namedFragments('ghar ki safai ka saaman')).toEqual([]);
  });

  it('keeps what comes after "ke liye" or "for": the items of a project', () => {
    expect(
      namedFragments(
        'bachche ke project ke liye bead dazzling kit, chart paper, colours, sketch pens',
      ),
    ).toEqual(['bead dazzling kit', 'chart paper', 'colours', 'sketch pens']);
    expect(namedFragments('things for a school project')).toEqual([]);
  });

  it('works on Devanagari and Hinglish words', () => {
    expect(namedFragments('चीनी, दाल aur chai patti')).toEqual(['चीनी', 'दाल', 'chai patti']);
  });

  it('"kuch" (something) is no item', () => {
    expect(namedFragments('chai patti aur kuch')).toEqual(['chai patti']);
  });

  it('ignores empty pieces and text with no words', () => {
    expect(namedFragments(' , ,, ')).toEqual([]);
    expect(namedFragments('')).toEqual([]);
  });
});

describe('covers', () => {
  it('matches the same words in another order, case or form', () => {
    expect(covers('chart paper', 'Chart Paper')).toBe(true);
    expect(covers('sketch pens', 'sketch pen')).toBe(true);
    expect(covers('paper', 'chart paper')).toBe(true);
    expect(covers('chart paper', 'paper')).toBe(true);
  });

  it('forgives a typo in a word', () => {
    expect(covers('colours', 'colors')).toBe(true);
    expect(covers('shugar', 'sugar')).toBe(true);
  });

  it('does not match a different thing', () => {
    expect(covers('sugar', 'salt')).toBe(false);
    expect(covers('chart paper', 'glue stick')).toBe(false);
    expect(covers('', 'sugar')).toBe(false);
  });
});

describe('uncovered', () => {
  it('lists the named things no candidate covers, in order', () => {
    expect(uncovered(['sugar', 'tea', 'milk'], ['Sugar', 'biscuits'])).toEqual(['tea', 'milk']);
    expect(uncovered(['sugar'], ['sugar'])).toEqual([]);
    expect(uncovered([], ['sugar'])).toEqual([]);
  });
});
