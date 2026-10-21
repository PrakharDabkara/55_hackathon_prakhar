import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LIST_LINE_MAX_CHARS, LIST_MAX_LINES } from '@askbuy/shared';
import seed from '../apps/api/src/modules/catalog/catalog.seed.json' with { type: 'json' };
import {
  LIST_KINDS,
  scoreListLine,
  withinListBudget,
  type ListCase,
} from '../apps/api/src/evalScore.js';

const cases = readFileSync(new URL('./resolve.list.dev.jsonl', import.meta.url), 'utf8')
  .split('\n')
  .filter((l) => l.trim() !== '')
  .map((l) => JSON.parse(l) as ListCase);
const slugs = new Set(seed.items.map((i) => i.slug));

describe('evals/resolve.list.dev.jsonl (ADR-0055)', () => {
  it('has 8 lists: mixed known, ambiguous, denied, other and nonsense lines', () => {
    expect(cases).toHaveLength(8);
    const kinds = new Set(cases.map((c) => c.kind));
    for (const k of ['known', 'ambiguous', 'denied', 'other', 'nonsense', 'injection', 'mixed'])
      expect(kinds.has(k), k).toBe(true);
    const all = cases.flatMap((c) => c.lines.map((l) => l.expected));
    for (const e of LIST_KINDS) expect(all, e).toContain(e);
  });

  it('keeps every list inside the product limits, with no empty or repeated line', () => {
    for (const c of cases) {
      expect(c.lines.length).toBeGreaterThanOrEqual(1);
      expect(c.lines.length).toBeLessThanOrEqual(LIST_MAX_LINES);
      const qs = c.lines.map((l) => l.q.toLowerCase());
      expect(new Set(qs).size).toBe(qs.length);
      for (const l of c.lines) {
        expect(l.q.trim()).not.toBe('');
        expect([...l.q].length).toBeLessThanOrEqual(LIST_LINE_MAX_CHARS);
      }
    }
  });

  it('labels every line with a catalog slug, "ambiguous", "other" or "refused"', () => {
    for (const c of cases)
      for (const l of c.lines)
        expect(
          (LIST_KINDS as readonly string[]).includes(l.expected) || slugs.has(l.expected),
          `${l.q} -> ${l.expected}`,
        ).toBe(true);
  });

  it('shares no list with the resolve holdouts: it never touches a holdout file', () => {
    const holdout = ['./resolve.holdout.jsonl', './resolve.holdout.v2.jsonl']
      .flatMap((f) => readFileSync(new URL(f, import.meta.url), 'utf8').split('\n'))
      .filter(Boolean)
      .map((l) => (JSON.parse(l) as { q: string }).q.toLowerCase());
    const mine = new Set(cases.flatMap((c) => c.lines.map((l) => l.q.toLowerCase())));
    // Words may repeat from dev cases, but a holdout query is never copied here.
    expect(holdout.filter((q) => mine.has(q))).toEqual([]);
  });
});

describe('scoreListLine', () => {
  it('an item line is right with that slug only', () => {
    expect(scoreListLine('sugar', { kind: 'item', slug: 'sugar' })).toBe(true);
    expect(scoreListLine('sugar', { kind: 'item', slug: 'salt' })).toBe(false);
    expect(scoreListLine('sugar', { kind: 'other', slug: null })).toBe(false);
  });

  it('"ambiguous", "other" and "refused" are right only for that ending', () => {
    for (const kind of LIST_KINDS) {
      expect(scoreListLine(kind, { kind, slug: null })).toBe(true);
      expect(scoreListLine(kind, { kind: 'item', slug: 'sugar' })).toBe(false);
    }
    expect(scoreListLine('refused', { kind: 'other', slug: null })).toBe(false);
  });
});

describe('the call budget of a list', () => {
  it('is one embedding request and one model call, however many lines', () => {
    expect(withinListBudget({ embed: 0, generate: 0 })).toBe(true);
    expect(withinListBudget({ embed: 1, generate: 1 })).toBe(true);
    expect(withinListBudget({ embed: 1, generate: 2 })).toBe(false);
    expect(withinListBudget({ embed: 2, generate: 1 })).toBe(false);
  });
});
