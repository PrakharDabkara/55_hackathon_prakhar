import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import seed from '../apps/api/src/modules/catalog/catalog.seed.json' with { type: 'json' };
import { scoreCase, summarise, type Case } from '../apps/api/src/evalScore.js';

const lines = readFileSync(new URL('./resolve.dev.jsonl', import.meta.url), 'utf8')
  .split('\n')
  .filter((l) => l.trim() !== '');
const cases: Case[] = lines.map((l) => JSON.parse(l) as Case);
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
      embedding: 1,
      llm: 1,
      unresolved: 1,
    });
    expect(s.llmFallbackRate).toBe(0.25);
    expect(s.llm).toEqual({ calls: 2, totalTokens: 150, p95LatencyMs: 800 });
  });
});
