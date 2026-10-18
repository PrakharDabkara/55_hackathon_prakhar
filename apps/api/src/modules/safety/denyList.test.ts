import { describe, expect, it } from 'vitest';
import { checkDenyList, DENY_RULES } from './denyList.js';

const rule = (text: string) => checkDenyList(text)?.rule ?? null;

describe('checkDenyList (layer 1 of the safety block, ADR-0029)', () => {
  it('blocks weapons, explosives, drugs and counterfeits in Latin script', () => {
    expect(rule('pistol')).toBe('weapons');
    expect(rule('country made katta')).toBe('weapons');
    expect(rule('live ammunition')).toBe('weapons');
    expect(rule('gun')).toBe('weapons');
    expect(rule('bomb banane ka saaman')).toBe('explosives');
    expect(rule('dynamite')).toBe('explosives');
    expect(rule('gun powder')).toBe('explosives');
    expect(rule('barood')).toBe('explosives');
    expect(rule('cocaine')).toBe('drugs');
    expect(rule('charas')).toBe('drugs');
    expect(rule('brown sugar')).toBe('drugs');
    expect(rule('fake currency notes')).toBe('counterfeit');
  });

  it('blocks the same things written in Devanagari', () => {
    expect(rule('बंदूक')).toBe('weapons');
    expect(rule('तमंचा')).toBe('weapons');
    expect(rule('बारूद')).toBe('explosives');
    expect(rule('बम')).toBe('explosives');
    expect(rule('गांजा')).toBe('drugs');
    expect(rule('अफीम')).toBe('drugs');
    expect(rule('नकली नोट')).toBe('counterfeit');
  });

  it('ignores case, repeated spaces and punctuation', () => {
    expect(rule('  PISTOL!! ')).toBe('weapons');
    expect(rule('hand   grenade')).toBe('weapons');
  });

  it('matches whole words only', () => {
    expect(rule('gunny bag')).toBeNull();
    expect(rule('bombay dyeing bedsheet')).toBeNull();
    expect(rule('meth')).toBe('drugs');
    expect(rule('methi')).toBeNull();
    expect(rule('methi dana')).toBeNull();
  });

  it('lets everyday products that share a word through', () => {
    for (const ok of [
      'glue gun',
      'hot glue gun sticks',
      'staple gun',
      'heat gun',
      'spray gun',
      'water gun',
      'bath bomb',
      'bullet journal',
      'printer cartridge',
      'ink cartridge',
      'gas cartridge',
      'diwali diya',
      'rat poison',
    ])
      expect(rule(ok), ok).toBeNull();
  });

  it('every rule has an id, and ids are the only thing a caller needs to log', () => {
    expect(DENY_RULES.map((r) => r.id)).toEqual(['weapons', 'explosives', 'drugs', 'counterfeit']);
    expect(Object.keys(checkDenyList('pistol') ?? {})).toEqual(['rule']);
  });
});
