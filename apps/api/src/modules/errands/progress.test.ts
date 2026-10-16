import { describe, expect, it } from 'vitest';
import { buildProgress, type StepView } from './progress.js';

let n = 0;
const tool = (
  toolName: string,
  args: Record<string, unknown>,
  resultSummary: Record<string, unknown>,
): StepView => ({
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

  describe('waiting, answers and questions (Day 13)', () => {
    const at = (sec: number) => new Date(Date.UTC(2026, 9, 24, 10, 0, sec));
    const ask = (label: string, requestId: string, sec: number): StepView => ({
      ...tool('ask_shops', { itemId: 'i' }, { label, requestId }),
      at: at(sec),
    });

    it('says how many shops were asked, per item: "6 dukaanon se pooch raha hoon: phenyl"', () => {
      const lines = buildProgress([ask('phenyl', 'r1', 1)], 'PLANNING', null, {
        pingsSent: { r1: 6 },
      });
      expect(lines).toEqual(['6 dukaanon se pooch raha hoon: phenyl']);
    });

    it('uses the singular for one shop, and no number while the pings are still being sent', () => {
      expect(
        buildProgress([ask('jhaadu', 'r1', 1)], 'PLANNING', null, { pingsSent: { r1: 1 } }),
      ).toEqual(['1 dukaan se pooch raha hoon: jhaadu']);
      expect(
        buildProgress([ask('jhaadu', 'r1', 1)], 'PLANNING', null, { pingsSent: { r1: 0 } }),
      ).toEqual(['Dukaanon se pooch raha hoon: jhaadu']);
      expect(buildProgress([ask('jhaadu', 'r1', 1)], 'PLANNING', null)).toEqual([
        'Dukaanon se pooch raha hoon: jhaadu',
      ]);
    });

    it('ends with "Jawab ka intezaar…" while the errand waits for shops', () => {
      const lines = buildProgress([ask('phenyl', 'r1', 1)], 'WAITING_FOR_SHOPS', null, {
        pingsSent: { r1: 3 },
      });
      expect(lines).toEqual(['3 dukaanon se pooch raha hoon: phenyl', 'Jawab ka intezaar…']);
    });

    it('reports each yes in time order with its price: "Mishra Kirana ne haan kaha ₹42"', () => {
      const lines = buildProgress(
        [
          ask('phenyl', 'r1', 1),
          { ...tool('find_item_nearby', {}, { label: 'x', count: 0 }), at: at(30) },
        ],
        'WAITING_FOR_SHOPS',
        null,
        {
          pingsSent: { r1: 2 },
          answers: [
            { shopName: 'Mishra Kirana', pricePaise: 4200, at: at(10) },
            { shopName: 'Gupta Store', pricePaise: null, at: at(20) },
          ],
        },
      );
      expect(lines).toEqual([
        '2 dukaanon se pooch raha hoon: phenyl',
        'Mishra Kirana ne haan kaha ₹42',
        'Gupta Store ne haan kaha',
        'X: kisi dukaan mein nahi mili',
        'Jawab ka intezaar…',
      ]);
    });

    it('shows paise as a decimal rupee amount when needed', () => {
      const lines = buildProgress([], 'WAITING_FOR_SHOPS', null, {
        answers: [{ shopName: 'A', pricePaise: 4250, at: at(1) }],
      });
      expect(lines[0]).toBe('A ne haan kaha ₹42.50');
    });

    it('shows the question the agent asked: "Aapse ek sawaal: …"', () => {
      const lines = buildProgress(
        [
          {
            ...tool('ask_user', { question: 'Kaunsa phenyl chahiye?' }, { asked: true }),
            at: at(5),
          },
        ],
        'NEEDS_INPUT',
        null,
      );
      expect(lines).toEqual(['Aapse ek sawaal: Kaunsa phenyl chahiye?']);
    });

    it('ends with plain lines for an expired or a cancelled errand', () => {
      expect(buildProgress([], 'EXPIRED', null).at(-1)).toMatch(/time khatam/i);
      expect(buildProgress([], 'CANCELLED', null).at(-1)).toMatch(/cancel/i);
    });

    it('explains the new failure reason wait_limit', () => {
      expect(buildProgress([], 'FAILED', 'wait_limit').at(-1)).toMatch(/intezaar/i);
    });

    it('does not repeat a line for a failed ask_shops (error) step', () => {
      const failed: StepView = { ...tool('ask_shops', {}, { error: true }), at: at(1) };
      expect(buildProgress([failed], 'PLANNING', null)).toEqual([]);
    });
  });
});
