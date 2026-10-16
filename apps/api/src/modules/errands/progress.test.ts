import { describe, expect, it } from 'vitest';
import { buildProgress, type StepView } from './progress.js';

let n = 0;
const tool = (toolName: string, args: object, resultSummary: object): StepView => ({
  n: ++n,
  kind: 'tool',
  toolName,
  args,
  resultSummary,
});
const model: StepView = { n: 0, kind: 'model', toolName: null, args: {}, resultSummary: {} };

describe('buildProgress', () => {
  it('says nothing before the first tool runs', () => {
    expect(buildProgress([model], 'PLANNING', null)).toEqual([]);
  });

  it('counts the items understood, once: "Samjha: 4 cheezein"', () => {
    const steps = Array.from({ length: 4 }, (_, i) =>
      tool('resolve_item', { text: `t${i}` }, { status: 'resolved' }),
    );
    expect(buildProgress(steps, 'PLANNING', null)).toEqual(['Samjha: 4 cheezein']);
  });

  it('uses the singular for one item', () => {
    expect(
      buildProgress(
        [tool('resolve_item', { text: 'x' }, { status: 'resolved' })],
        'PLANNING',
        null,
      ),
    ).toEqual(['Samjha: 1 cheez']);
  });

  it("reports the shops found for each item by the customer's own word", () => {
    const steps = [
      tool('resolve_item', { text: 'chini' }, { status: 'resolved' }),
      tool('find_item_nearby', { itemId: 'i' }, { label: 'chini', count: 7, freshCount: 2 }),
      tool('find_item_nearby', { itemId: 'j' }, { label: 'tape', count: 1, freshCount: 0 }),
      tool('find_item_nearby', { itemId: 'k' }, { label: 'glue', count: 0, freshCount: 0 }),
    ];
    expect(buildProgress(steps, 'PLANNING', null)).toEqual([
      'Samjha: 1 cheez',
      'Chini: 7 dukaanon mein mili',
      'Tape: 1 dukaan mein mili',
      'Glue: kisi dukaan mein nahi mili',
    ]);
  });

  it('says when a word was not understood', () => {
    const steps = [tool('resolve_item', { text: 'xyzzy' }, { status: 'unresolved' })];
    expect(buildProgress(steps, 'PLANNING', null).join('\n')).toMatch(/xyzzy.*samajh nahi aaya/);
  });

  it('reports the route and the finished plan', () => {
    const steps = [
      tool('plan_route', { shopIds: ['a'] }, { stops: 3, totalM: 2400 }),
      tool('submit_plan', {}, { likely: 3, notFound: 1 }),
    ];
    expect(buildProgress(steps, 'PLAN_READY', null)).toEqual([
      'Raasta bana: 3 dukaanein, 2.4 km',
      'Plan taiyaar: 3 cheezein mil gayi, 1 nahi mili',
    ]);
  });

  it('ends with a plain line when the errand failed', () => {
    const lines = buildProgress([], 'FAILED', 'step_limit');
    expect(lines.at(-1)).toMatch(/plan nahi ban paya/i);
  });
});
