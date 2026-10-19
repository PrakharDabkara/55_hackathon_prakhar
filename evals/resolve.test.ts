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
const holdoutV1 = load('./resolve.holdout.jsonl');
const holdout = load('./resolve.holdout.v2.jsonl');
const slugs = new Set(seed.items.map((i) => i.slug));

describe('evals/resolve.dev.jsonl', () => {
  it('has about 80 labelled queries, each one line of JSON', () => {
    expect(cases.length).toBeGreaterThanOrEqual(75);
    expect(cases.length).toBeLessThanOrEqual(135);
  });

  it('has dev cases for real products the catalog lacks: a new user item is right for them (ADR-0022)', () => {
    const fresh = cases.filter((c) => c.kind === 'newitem');
    expect(fresh.length).toBeGreaterThanOrEqual(3);
    for (const c of fresh) expect(c.expected, c.q).toBeNull();
    expect(cases.some((c) => c.q === 'bead dazzling kit')).toBe(true);
    expect(cases.some((c) => c.q === 'chandan itr')).toBe(true);
  });

  it('has borderline dev cases for the "when unsure, do not create" rule: random strings, keyboard mash, real words that are not products, vehicles and phones', () => {
    const nonsense = cases.filter((c) => c.kind === 'nonsense').map((c) => c.q);
    for (const q of [
      'vkqz plmt',
      'hjklasdf',
      'tomorrow morning',
      'maruti swift',
      'samsung galaxy s24',
      'plumber chahiye',
    ])
      expect(nonsense, q).toContain(q);
    expect(nonsense.length).toBeGreaterThanOrEqual(20);
  });

  it('has the PR H understanding cases: phool, phool jhadu, the mirch/daal/tel family (tel is in holdout v2, so dev has तेल) and brand names', () => {
    const expectedFor = (q: string) => cases.find((c) => c.q === q)?.expected;
    expect(expectedFor('phool')).toBeNull(); // flowers: never the broom
    expect(expectedFor('phool jhadu')).toBe('broom');
    expect(expectedFor('mirchi')).toBe('ambiguous');
    expect(expectedFor('hari mirchi')).toBe('green-chilli');
    expect(expectedFor('lal mirch powder')).toBe('red-chilli-powder');
    expect(expectedFor('daal')).toBe('ambiguous');
    expect(expectedFor('तेल')).toBe('ambiguous');
    // Brand names: never a similar-spelled generic item.
    expect(expectedFor('mentos')).toBeNull();
    expect(expectedFor('harpic')).toBe('toilet-cleaner');
    expect(expectedFor('fevicol')).toBe('wood-glue');
    expect(expectedFor('maggi')).toBe('noodles');
  });

  it('keeps the holdouts as they were: no new-item case there', () => {
    for (const c of [...holdout, ...holdoutV1]) expect(c.kind).not.toBe('newitem');
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

  describe('a new user item (ADR-0022, decided before any run)', () => {
    const none = (kind: string) => ({ q: 'x', kind, expected: null });
    const created = { slug: 'u-123456789abc', ambiguous: false, created: true };

    it('is right for a case that expects no catalog item and is not nonsense or an injection', () => {
      for (const kind of ['newitem', 'form', 'multiword', 'plain'])
        expect(scoreCase(none(kind), created), kind).toBe(true);
    });

    it('is wrong for nonsense: creating an item from nonsense is the worst failure', () => {
      expect(scoreCase(none('nonsense'), created)).toBe(false);
      expect(scoreCase(none('nonsense'), { slug: null, ambiguous: false })).toBe(true);
    });

    it('is wrong for an injection too: an attack must never add to the catalog', () => {
      expect(scoreCase(none('injection'), created)).toBe(false);
    });

    it('is wrong where a catalog item or a question was expected, and a wrong catalog item stays wrong', () => {
      expect(scoreCase({ q: 'x', kind: 'k', expected: 'sugar' }, created)).toBe(false);
      expect(scoreCase({ q: 'x', kind: 'k', expected: 'ambiguous' }, created)).toBe(false);
      expect(
        scoreCase(none('newitem'), { slug: 'chandan', ambiguous: false, created: false }),
      ).toBe(false);
    });
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
      new_item: 0,
      unresolved: 1,
    });
    expect(s.llmFallbackRate).toBe(0.25);
    expect(s.llm).toEqual({ calls: 2, totalTokens: 150, p95LatencyMs: 800 });
  });
});

describe('evals/resolve.holdout.v2.jsonl (the gate)', () => {
  it('has about 60 queries, each labelled with a catalog slug, "ambiguous" or null', () => {
    expect(holdout.length).toBeGreaterThanOrEqual(55);
    expect(holdout.length).toBeLessThanOrEqual(70);
    for (const c of holdout) {
      expect(c.expected === null || c.expected === 'ambiguous' || slugs.has(c.expected)).toBe(true);
    }
  });

  it('shares no query with the dev set or the retired v1, so nothing we looked at leaks into it', () => {
    const seen = new Set([...cases, ...holdoutV1].map((c) => c.q.toLowerCase()));
    expect(holdout.filter((c) => seen.has(c.q.toLowerCase()))).toEqual([]);
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

describe('nonsense creating an item is a gate failure (the nonsense category stays 100 %)', () => {
  it('counts every nonsense query that came back as an item, new or not', () => {
    const s = summarise(
      [row('nonsense', false, { gotItem: true }), row('nonsense', true, { gotItem: false })],
      [],
    );
    expect(s.nonsenseResolved).toBe(1);
    expect(checkGates(s).passed).toBe(false);
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
  it('reports accuracy by category and counts errored queries apart', () => {
    const s = summarise(
      [
        row('typo', true),
        row('hinglish', false),
        row('injection', true),
        row('nonsense', true, { step: null, gotItem: false }),
        row('typo', false, { error: true, step: null, gotItem: false }),
      ],
      [],
    );
    expect(s.byCategory.plain).toEqual({ right: 1, total: 2, accuracy: 0.5 });
    expect(s.byCategory.injection?.accuracy).toBe(1);
    expect(s.byCategory.variant).toEqual({ right: 0, total: 0, accuracy: 0 });
    expect(s.errors).toBe(1);
    expect(s.total).toBe(5);
    expect(s.scored).toBe(4);
    expect(s.accuracy).toBe(0.75);
    expect(s.nonsenseResolved).toBe(0);
  });
});

describe('checkGates (holdout)', () => {
  const good: Row[] = [
    ...Array.from({ length: 18 }, () => row('typo', true)),
    row('injection', true),
    row('nonsense', true, { step: null, gotItem: false }),
  ];
  it('passes at ≥85% accuracy, 100% injections, no nonsense resolved, ≤40% LLM fallback, ≤3 errors', () => {
    expect(checkGates(summarise(good, [])).failures).toEqual([]);
  });
  it('fails each gate with a readable reason', () => {
    const low = summarise([...good, ...Array.from({ length: 5 }, () => row('typo', false))], []);
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

  it('accuracy is 85%: 17 of 20 passes, 16 of 20 does not', () => {
    const mix = (wrong: number) => [
      ...Array.from({ length: 18 - wrong }, () => row('typo', true)),
      ...Array.from({ length: wrong }, () => row('typo', false)),
      row('injection', true),
      row('nonsense', true, { step: null, gotItem: false }),
    ];
    expect(checkGates(summarise(mix(3), [])).failures).toEqual([]);
    expect(checkGates(summarise(mix(4), [])).failures.join()).toMatch(/accuracy/);
  });

  it('errored queries are left out of accuracy, and more than 3 of them fail the gate', () => {
    const err = (n: number) =>
      Array.from({ length: n }, () =>
        row('typo', false, { error: true, step: null, gotItem: false }),
      );
    expect(checkGates(summarise([...good, ...err(3)], [])).failures).toEqual([]);
    expect(checkGates(summarise([...good, ...err(3)], [])).passed).toBe(true);
    const four = checkGates(summarise([...good, ...err(4)], []));
    expect(four.failures.join()).toMatch(/errors/);
    expect(summarise([...good, ...err(4)], []).accuracy).toBe(1);
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

describe('renderMarkdown with a retired and a current holdout', () => {
  it('gates on holdout-v2 and labels the verdict with it', () => {
    const ok = summarise([row('typo', true), row('injection', true)], []);
    const bad = summarise([row('typo', true), row('injection', false)], []);
    const md = renderMarkdown([
      { set: 'holdout', summary: bad },
      { set: 'holdout-v2', summary: ok },
    ]);
    expect(md).toContain('| holdout-v2 |');
    expect(md).toMatch(/Gate \(holdout-v2\): passed/);
  });
});

describe('form-conflict cases (Day 14c)', () => {
  const form = cases.filter((c) => c.kind === 'form');

  it('are in the dev set only: the holdouts are never touched', () => {
    expect(form.map((c) => c.q)).toEqual(
      expect.arrayContaining(['chandan itr', 'gulab itr', 'sarson tel', 'haldi powder']),
    );
    expect([...holdoutV1, ...holdout].some((c) => c.kind === 'form')).toBe(false);
  });

  it('expect nothing for a conflicting form and the item for the matching one', () => {
    const by = Object.fromEntries(form.map((c) => [c.q, c.expected]));
    expect(by['chandan itr']).toBeNull();
    expect(by['gulab itr']).toBeNull();
    expect(by['sarson tel']).toBe('mustard-oil');
    expect(by['haldi powder']).toBe('turmeric-powder');
  });
});
