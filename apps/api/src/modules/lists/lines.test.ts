import { describe, expect, it } from 'vitest';
import { LIST_LINE_MAX_CHARS, LIST_MAX_LINES } from '@askbuy/shared';
import { cleanLines } from './lines.js';

describe('cleanLines (ADR-0055 rule 2)', () => {
  it('trims, collapses inner spaces and drops empty lines', () => {
    expect(cleanLines(['  sugar 1kg ', '', '   ', 'atta   5 kg'])).toEqual({
      ok: true,
      lines: ['sugar 1kg', 'atta 5 kg'],
    });
  });

  it('merges exact duplicates, ignoring case, and keeps the first spelling and the order', () => {
    expect(cleanLines(['Sugar', 'atta', 'sugar', 'SUGAR ', 'salt'])).toEqual({
      ok: true,
      lines: ['Sugar', 'atta', 'salt'],
    });
  });

  it('accepts exactly 10 distinct lines and refuses an 11th', () => {
    const ten = Array.from({ length: LIST_MAX_LINES }, (_, i) => `item ${i}`);
    expect(cleanLines(ten)).toMatchObject({ ok: true });
    expect(cleanLines([...ten, 'one more'])).toEqual({ ok: false, code: 'too_many_lines' });
  });

  it('counts after cleanup: eleven lines that merge into ten are fine', () => {
    const lines = Array.from({ length: LIST_MAX_LINES }, (_, i) => `item ${i}`);
    expect(cleanLines([...lines, 'ITEM 0', ' '])).toMatchObject({ ok: true });
  });

  it('refuses a list with nothing in it', () => {
    expect(cleanLines([])).toEqual({ ok: false, code: 'no_lines' });
    expect(cleanLines(['', '  '])).toEqual({ ok: false, code: 'no_lines' });
  });

  it('allows 80 characters and refuses 81, never cutting a line', () => {
    expect(cleanLines(['a'.repeat(LIST_LINE_MAX_CHARS)])).toMatchObject({ ok: true });
    expect(cleanLines(['a'.repeat(LIST_LINE_MAX_CHARS + 1)])).toEqual({
      ok: false,
      code: 'line_too_long',
    });
  });

  it('counts characters, not bytes (Devanagari)', () => {
    expect(cleanLines(['आ'.repeat(LIST_LINE_MAX_CHARS)])).toMatchObject({ ok: true });
  });
});
