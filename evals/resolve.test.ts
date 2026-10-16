import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import seed from '../apps/api/src/modules/catalog/catalog.seed.json' with { type: 'json' };
import {
  categoryOf,
  checkGates,
  renderMarkdown,
  scoreCase,
  summarise,
  type Case,
  type Row,
} from '../apps/api/src/evalScore.js';

const load = (file: string): Case[] =>
  readFileSync(new URL(file, import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as Case);
const cases = load('./resolve.dev.jsonl');
const holdout = load('./resolve.holdout.jsonl');
const slugs = new Set(seed.items.map((i) => i.slug));

describe('evals/resolve.dev.jsonl', () => {
  it('has about 80 labelled queries, each one line of JSON', () => {
    expect(cases.length).toBeGreaterThanOrEqual(75);
    expect(cases.length).toBeLessThanOrEqual(100);
  });

  it('labels every query with a catalog slug, "ambiguous" or null', () => {
    for (const c of cases) {
      expect(typeof c.q, JSON.stringify(c)).toBe('string');
      expect(c.q.length).toBeGreaterThan(0);
      expect(
        c.expected === null || c.expected === 'ambiguous' || slugs.has(c.expected),
        JSON.stringify(c),
      ).toBe(true);
    }
  });

  it('has no query twice', () => {
    const keys = cases.map((c) => c.q.toLowerCase());
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('covers every kind of query: Hinglish, Devanagari, typos, variants, ambiguous, nonsense, multi-word, quantities, injections', () => {
    const kinds = new Set(cases.map((c) => c.kind));
    for (const kind of [
      'hinglish',
      'devanagari',
      'typo',
      'variant',
      'ambiguous',
      'nonsense',
      'multiword',
      'quantity',
      'injection',
    ]) {
      expect(kinds.has(kind), kind).toBe(true);
    }
  });

  it('has 5 prompt-injection attempts, and none may resolve to a made-up answer', () => {
    const injections = cases.filter((c) => c.kind === 'injection');
    expect(injections).toHaveLength(5);
    for (const c of injections)
      expect(c.expected === null || c.expected === 'ambiguous' || slugs.has(c.expected)).toBe(true);
  });

  it('has several genuinely ambiguous and several nonsense queries', () => {
    expect(cases.filter((c) => c.expected === 'ambiguous').length).toBeGreaterThanOrEqual(5);
    expect(cases.filter((c) => c.expected === null).length).toBeGreaterThanOrEqual(8);
  });
});

describe('scoreCase', () => {
  it('a resolved item is right when its slug matches', () => {
    expect(
      scoreCase({ q: 'x', kind: 'k', expected: 'sugar' }, { slug: 'sugar', ambiguous: false }),
    ).toBe(true);
    expect(
      scoreCase({ q: 'x', kind: 'k', expected: 'sugar' }, { slug: 'rice', ambiguous: false }),
    ).toBe(false);
    expect(
      scoreCase({ q: 'x', kind: 'k', expected: 'sugar' }, { slug: null, ambiguous: false }),
    ).toBe(false);
  });

  it('"ambiguous" is right only when the pipeline asked a question', () => {
    expect(
      scoreCase({ q: 'x', kind: 'k', expected: 'ambiguous' }, { slug: null, ambiguous: true }),
    ).toBe(true);
    expect(
      scoreCase({ q: 'x', kind: 'k', expected: 'ambiguous' }, { slug: 'sugar', ambiguous: false }),
    ).toBe(false);
    expect(
      scoreCase({ q: 'x', kind: 'k', expected: 'ambiguous' }, { slug: null, ambiguous: false }),
    ).toBe(false);
  });

  it('null is right only when nothing resolved and nothing was asked', () => {
    expect(scoreCase({ q: 'x', kind: 'k', expected: null }, { slug: null, ambiguous: false })).toBe(
      true,
    );
    expect(
      scoreCase({ q: 'x', kind: 'k', expected: null }, { slug: 'sugar', ambiguous: false }),
    ).toBe(false);
    expect(scoreCase({ q: 'x', kind: 'k', expected: null }, { slug: null, ambiguous: true })).toBe(
      false,
    );
  });
});

describe('summarise', () => {
  it('reports accuracy, per-step counts, the LLM fallback rate, tokens and p95 latency', () => {
    const rows = [
      { correct: true, step: 'synonym' as const },
      { correct: true, step: 'embedding' as const },
      { correct: false, step: 'llm' as const },
      { correct: true, step: null },
    ];
    const s = summarise(rows, [
      { tokens: 100, latencyMs: 400 },
      { tokens: 50, latencyMs: 800 },
    ]);
    expect(s.total).toBe(4);
    expect(s.accuracy).toBe(0.75);
    expect(s.byStep).toEqual({
      cache: 0,
      synonym: 1,
      trigram: 0,
      default: 0,
      embedding: 1,
      llm: 1,
      unresolved: 1,
    });
    expect(s.llmFallbackRate).toBe(0.25);
    expect(s.llm).toEqual({ calls: 2, totalTokens: 150, p95LatencyMs: 800 });
  });
});

describe('evals/resolve.holdout.jsonl', () => {
  it('has about 60 queries, each labelled with a catalog slug, "ambiguous" or null', () => {
    expect(holdout.length).toBeGreaterThanOrEqual(55);
    expect(holdout.length).toBeLessThanOrEqual(70);
    for (const c of holdout) {
      expect(c.expected === null || c.expected === 'ambiguous' || slugs.has(c.expected)).toBe(true);
    }
  });

  it('shares no query with the dev set, so tuning on dev cannot leak into it', () => {
    const dev = new Set(cases.map((c) => c.q.toLowerCase()));
    expect(holdout.filter((c) => dev.has(c.q.toLowerCase()))).toEqual([]);
    const own = holdout.map((c) => c.q.toLowerCase());
    expect(new Set(own).size).toBe(own.length);
  });

  it('covers every kind and has exactly 5 injections', () => {
    const kinds = new Set(holdout.map((c) => c.kind));
    for (const kind of [
      'hinglish',
      'devanagari',
      'typo',
      'variant',
      'ambiguous',
      'nonsense',
      'multiword',
      'quantity',
      'injection',
    ])
      expect(kinds.has(kind), kind).toBe(true);
    expect(holdout.filter((c) => c.kind === 'injection')).toHaveLength(5);
  });
});

describe('categoryOf', () => {
  it('keeps variant, ambiguous, nonsense and injection, and calls everything else plain', () => {
    expect(categoryOf('variant')).toBe('variant');
    expect(categoryOf('injection')).toBe('injection');
    expect(categoryOf('typo')).toBe('plain');
    expect(categoryOf('hinglish')).toBe('plain');
  });
});

const row = (kind: string, correct: boolean, over: Partial<Row> = {}): Row => ({
  kind,
  correct,
  step: 'synonym',
  gotItem: true,
  ...over,
});

describe('summarise per category', () => {
  it('reports accuracy by category and the error count', () => {
    const s = summarise(
      [
        row('typo', true),
        row('hinglish', false),
        row('injection', true),
        row('nonsense', true, { step: null, gotItem: false }),
      ],
      [],
      3,
    );
    expect(s.byCategory.plain).toEqual({ right: 1, total: 2, accuracy: 0.5 });
    expect(s.byCategory.injection?.accuracy).toBe(1);
    expect(s.byCategory.variant).toEqual({ right: 0, total: 0, accuracy: 0 });
    expect(s.errors).toBe(3);
    expect(s.nonsenseResolved).toBe(0);
  });
});

describe('checkGates (holdout)', () => {
  const good: Row[] = [
    ...Array.from({ length: 18 }, () => row('typo', true)),
    row('injection', true),
    row('nonsense', true, { step: null, gotItem: false }),
  ];
  it('passes at ≥90% accuracy, 100% injections, no nonsense resolved, ≤40% LLM fallback', () => {
    expect(checkGates(summarise(good, [])).failures).toEqual([]);
  });
  it('fails each gate with a readable reason', () => {
    const low = summarise(
      [...good, row('typo', false), row('typo', false), row('typo', false)],
      [],
    );
    expect(checkGates(low).failures.join()).toMatch(/accuracy/);
    const inj = summarise([...good, row('injection', false)], []);
    expect(checkGates(inj).failures.join()).toMatch(/injection/);
    const non = summarise([...good, row('nonsense', false, { gotItem: true })], []);
    expect(checkGates(non).failures.join()).toMatch(/nonsense/);
    const llm = summarise(
      [
        ...good.slice(0, 10),
        ...Array.from({ length: 10 }, () => row('typo', true, { step: 'llm' })),
      ],
      [],
    );
    expect(checkGates(llm).failures.join()).toMatch(/LLM fallback/);
  });
});

describe('renderMarkdown', () => {
  it('prints one table row per set and the gate verdict for the holdout', () => {
    const md = renderMarkdown([
      { set: 'dev', summary: summarise(good(), []) },
      { set: 'holdout', summary: summarise(good(), []) },
    ]);
    expect(md).toContain('| dev |');
    expect(md).toContain('| holdout |');
    expect(md).toMatch(/Gate/i);
  });
  function good(): Row[] {
    return [row('typo', true), row('injection', true)];
  }
});
