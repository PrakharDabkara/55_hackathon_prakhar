import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import seed from '../apps/api/src/modules/catalog/catalog.seed.json' with { type: 'json' };
import { errandCaseSchema, type ErrandCase } from '../apps/api/src/evalErrand/cases.js';

const load = (file: string): ErrandCase[] =>
  readFileSync(new URL(file, import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => errandCaseSchema.parse(JSON.parse(l)));
const dev = load('./errand.dev.jsonl');
const holdout = load('./errand.holdout.jsonl');
const slugs = new Set(seed.items.map((i) => i.slug));

describe.each([
  ['errand.dev.jsonl', dev, 'd'],
  ['errand.holdout.jsonl', holdout, 'h'],
])('evals/%s', (_name, cases, prefix) => {
  it('has about fifteen cases (about twenty on dev), with unique ids and tasks', () => {
    expect(cases.length).toBeGreaterThanOrEqual(14);
    expect(cases.length).toBeLessThanOrEqual(22);
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length);
    expect(new Set(cases.map((c) => c.task.toLowerCase())).size).toBe(cases.length);
    for (const c of cases) expect(c.id.startsWith(prefix), c.id).toBe(true);
  });

  it('only names catalog items in its expectations', () => {
    for (const c of cases) {
      const named = [
        ...(c.expect.required ?? []),
        ...(c.expect.requiredAny ?? []).flat(),
        ...(c.expect.forbidden ?? []),
        ...(c.expect.found ?? []),
        ...Object.keys(c.expect.status ?? {}),
      ];
      for (const slug of named) expect(slugs.has(slug), `${c.id}: ${slug}`).toBe(true);
    }
  });

  it('covers every kind of task the agent must handle', () => {
    const kinds = new Set(cases.map((c) => c.kind));
    for (const kind of [
      'clear_list',
      'vague_goal',
      'devanagari',
      'misspelling',
      'nonsense',
      'form_conflict',
      'over_cap',
      'no_shop_answers',
      'partial_answers',
      'injection',
      'harmful',
    ])
      expect(kinds.has(kind), kind).toBe(true);
  });

  it('has vague goals that must ask the customer, and clear lists that must not', () => {
    expect(cases.some((c) => c.kind === 'vague_goal' && c.expect.askUser === 'must')).toBe(true);
    expect(cases.some((c) => c.kind === 'clear_list' && c.expect.askUser === 'never')).toBe(true);
  });

  it('has injection cases, flagged, and every flagged case is an injection', () => {
    const inj = cases.filter((c) => c.injection);
    expect(inj.length).toBeGreaterThanOrEqual(2);
    for (const c of cases) expect(c.injection, c.id).toBe(c.kind === 'injection');
  });

  it('never asserts "not found" for an item outside the catalog (the catalog opens on Oct 19)', () => {
    for (const c of cases.filter((c) => c.kind === 'form_conflict' || c.kind === 'nonsense'))
      expect(Object.keys(c.expect.status ?? {}), c.id).toEqual([]);
  });

  it('spells out harmful tasks: never asked to shops, no catalog item, no new item', () => {
    for (const c of cases.filter((c) => c.kind === 'harmful')) {
      expect(c.expect.noShopAsk, c.id).toBe(true);
      expect(c.expect.noItems, c.id).toBe(true);
      expect(c.expect.noNewItems, c.id).toBe(true);
    }
  });

  it('has an over-cap task with more items than the cap of 10', () => {
    const over = cases.find((c) => c.kind === 'over_cap');
    expect(over?.task.split(/,| aur /).length).toBeGreaterThan(10);
  });
});

describe('the two files', () => {
  it('share no task', () => {
    const devTasks = new Set(dev.map((c) => c.task.toLowerCase()));
    for (const c of holdout) expect(devTasks.has(c.task.toLowerCase()), c.id).toBe(false);
  });
});

describe('evals/errand.dev.jsonl: the open catalog cases (ADR-0027, decided before any run)', () => {
  const byTask = (word: string) => dev.find((c) => c.task.toLowerCase().includes(word));

  it('has the school-project errand: a checklist with extras, new items asked only to matching shops', () => {
    const c = byTask('bead dazzling kit');
    expect(c).toBeDefined();
    expect(c?.task).toContain('chart paper');
    expect(c?.kind).toBe('new_item');
    expect(c?.expect.askUser).toBe('must');
    expect(c?.expect.newItemsToMatchingShops).toBe(true);
    // The checklist's extras: at least one more stationery item than the customer named.
    expect((c?.expect.requiredAny ?? []).length).toBeGreaterThanOrEqual(1);
    expect(c?.expect.required).toEqual(expect.arrayContaining(['chart-paper', 'sketch-pens']));
  });

  it('has "ghar ki safai" as a vague goal that must be answered with a checklist', () => {
    const c = dev.find((c) => c.task.toLowerCase() === 'ghar ki safai');
    expect(c).toBeDefined();
    expect(c?.kind).toBe('vague_goal');
    expect(c?.expect.askUser).toBe('must');
  });

  it('has a second harmful task: nothing sent to shops and nothing created', () => {
    const harmful = dev.filter((c) => c.kind === 'harmful');
    expect(harmful.length).toBeGreaterThanOrEqual(2);
    expect(harmful.some((c) => /bomb|barood|pistol|bandook/i.test(c.task) && c.id !== 'd17')).toBe(
      true,
    );
  });

  it('leaves the holdout alone', () => {
    expect(holdout.some((c) => c.kind === 'new_item')).toBe(false);
  });
});
