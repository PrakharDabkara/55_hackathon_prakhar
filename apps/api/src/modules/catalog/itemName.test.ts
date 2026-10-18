import { describe, expect, it } from 'vitest';
import { cleanItemName, slugForUserItem } from './itemName.js';

describe('cleanItemName (name hygiene for new items, ADR-0028)', () => {
  it('returns a normalised display name', () => {
    expect(cleanItemName('  bead   dazzling KIT ')).toBe('Bead dazzling kit');
    expect(cleanItemName('chart paper')).toBe('Chart paper');
    expect(cleanItemName('चंदन इत्र')).toBe('चंदन इत्र');
  });

  it('accepts 2 to 60 characters', () => {
    expect(cleanItemName('ab')).toBe('Ab');
    expect(cleanItemName('a')).toBeNull();
    expect(cleanItemName('a'.repeat(60))).not.toBeNull();
    expect(cleanItemName('a'.repeat(61))).toBeNull();
    expect(cleanItemName('   ')).toBeNull();
  });

  it('accepts letters, digits, spaces and Devanagari only', () => {
    expect(cleanItemName('a4 paper 500 sheets')).toBe('A4 paper 500 sheets');
    expect(cleanItemName('led bulb 9w')).toBe('Led bulb 9w');
    expect(cleanItemName('pen 🖊️')).toBeNull();
    expect(cleanItemName('قلم')).toBeNull();
    expect(cleanItemName('笔记本')).toBeNull();
    expect(cleanItemName('pen; drop table items')).toBeNull();
  });

  it('turns harmless punctuation into spaces but never keeps it', () => {
    expect(cleanItemName('parle-g biscuit')).toBe('Parle g biscuit');
    expect(cleanItemName('tom & jerry sticker')).toBe('Tom jerry sticker');
  });

  it('rejects URLs and emails', () => {
    expect(cleanItemName('http://evil.example/pen')).toBeNull();
    expect(cleanItemName('www.shop.in pen')).toBeNull();
    expect(cleanItemName('buy at example.com')).toBeNull();
    expect(cleanItemName('ravi@example.com')).toBeNull();
  });

  it('rejects a run of 6 or more digits, however it is spaced', () => {
    expect(cleanItemName('pen 123456')).toBeNull();
    expect(cleanItemName('call 98765 43210')).toBeNull();
    expect(cleanItemName('call 98765-43210')).toBeNull();
    expect(cleanItemName('pen 12345')).toBe('Pen 12345');
    expect(cleanItemName('pack of 100 pens 20 pcs')).toBe('Pack of 100 pens 20 pcs');
  });
});

describe('slugForUserItem', () => {
  it('is stable for the same name and cannot clash with a catalog slug', () => {
    expect(slugForUserItem('bead dazzling kit')).toBe(slugForUserItem('bead dazzling kit'));
    expect(slugForUserItem('bead dazzling kit')).toMatch(/^u-[0-9a-f]{12}$/);
    expect(slugForUserItem('chart paper')).not.toBe(slugForUserItem('bead dazzling kit'));
  });
});
