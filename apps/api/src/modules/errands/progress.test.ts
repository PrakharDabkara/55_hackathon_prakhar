import { describe, expect, it } from 'vitest';
import { buildProgress, lateAnswerLines, type StepView } from './progress.js';

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

  it('counts the items understood, once: "Understood: 4 items"', () => {
    const steps = Array.from({ length: 4 }, (_, i) =>
      tool('resolve_item', { text: `t${i}` }, { status: 'resolved' }),
    );
    expect(buildProgress(steps, 'PLANNING', null)).toEqual(['Understood: 4 items']);
  });

  describe('"Understood" counts every item in the task (Day 14a bug)', () => {
    it('counts an item that could not be resolved and one whose lookup failed', () => {
      const steps = [
        tool('resolve_item', { text: 'chai patti' }, { status: 'resolved' }),
        tool('resolve_item', { text: 'xyzzy' }, { status: 'unresolved' }),
        tool('resolve_item', { text: 'doodh' }, { error: true }),
        tool('resolve_item', { text: 'chini' }, { status: 'clarification' }),
      ];
      expect(buildProgress(steps, 'PLANNING', null)[0]).toBe('Understood: 4 items');
    });

    it('does not count the same word twice', () => {
      const steps = [
        tool('resolve_item', { text: 'Phenyl' }, { status: 'clarification' }),
        tool('resolve_item', { text: 'phenyl ' }, { status: 'resolved' }),
      ];
      expect(buildProgress(steps, 'PLANNING', null)[0]).toBe('Understood: 1 item');
    });

    it('uses the number of items in the submitted plan when it is larger', () => {
      const steps = [
        tool('resolve_item', { text: 'a' }, { status: 'resolved' }),
        tool('submit_plan', {}, { confirmed: 0, likely: 1, notFound: 2, items: 3 }),
      ];
      expect(buildProgress(steps, 'PLAN_READY', null)[0]).toBe('Understood: 3 items');
    });
  });

  describe('truthful names (Day 14a)', () => {
    const submit = (matched: unknown[]) =>
      tool('submit_plan', {}, { confirmed: 1, likely: 0, notFound: 0, items: 1, matched });

    it("says what the shop confirmed when it is not what the customer said: 'diya' → 'candle'", () => {
      const lines = buildProgress(
        [submit([{ text: 'diya', itemName: 'candle', status: 'confirmed' }])],
        'PLAN_READY',
        null,
      );
      expect(lines).toContain("You said 'diya': the shop confirmed 'candle'");
    });

    it('does not claim a shop confirmed something it only has in learned stock', () => {
      const lines = buildProgress(
        [submit([{ text: 'diya', itemName: 'candle', status: 'likely' }])],
        'PLAN_READY',
        null,
      );
      expect(lines).toContain("You said 'diya': the shop has 'candle'");
      expect(lines.join('\n')).not.toMatch(/confirm kiya/);
    });

    it('says nothing when the names match', () => {
      const lines = buildProgress([submit([])], 'PLAN_READY', null);
      expect(lines.join('\n')).not.toMatch(/kaha tha/);
    });
  });

  it('uses the singular for one item', () => {
    expect(
      buildProgress(
        [tool('resolve_item', { text: 'x' }, { status: 'resolved' })],
        'PLANNING',
        null,
      ),
    ).toEqual(['Understood: 1 item']);
  });

  it("reports the shops found for each item by the customer's own word", () => {
    const steps = [
      tool('resolve_item', { text: 'chini' }, { status: 'resolved' }),
      tool('find_item_nearby', { itemId: 'i' }, { label: 'chini', count: 7, freshCount: 2 }),
      tool('find_item_nearby', { itemId: 'j' }, { label: 'tape', count: 1, freshCount: 0 }),
      tool('find_item_nearby', { itemId: 'k' }, { label: 'glue', count: 0, freshCount: 0 }),
    ];
    expect(buildProgress(steps, 'PLANNING', null)).toEqual([
      'Understood: 1 item',
      'Chini: found at 7 shops',
      'Tape: found at 1 shop',
      'Glue: not in past answers',
    ]);
  });

  describe('"not found" is final only after the shops had their say (Day 14c)', () => {
    const none = (label: string) =>
      tool('find_item_nearby', { itemId: 'i' }, { label, count: 0, freshCount: 0 });
    const ask = (label: string, requestId: string) =>
      tool('ask_shops', { itemId: 'i' }, { label, requestId });
    const sent = { pingsSent: { r1: 4 } };

    it('before any shop is asked it only says there are no past answers', () => {
      expect(buildProgress([none('chandan itr')], 'PLANNING', null)).toEqual([
        'Chandan itr: not in past answers',
      ]);
    });

    it('while the shops are being asked it says so', () => {
      const steps = [none('chandan itr'), ask('chandan itr', 'r1')];
      expect(buildProgress(steps, 'WAITING_FOR_SHOPS', null, sent)).toEqual([
        'Chandan itr: not in past answers, asking shops',
        'Asking 4 shops: chandan itr',
        'Waiting for shops…',
      ]);
    });

    it('after the wait, with no shop having it, it is final: "no shop has it"', () => {
      const steps = [none('chandan itr'), ask('chandan itr', 'r1')];
      expect(buildProgress(steps, 'PLAN_READY', null, sent)).toContain(
        'Chandan itr: no shop has it',
      );
      expect(buildProgress(steps, 'EXPIRED', null, sent)).toContain(
        'Chandan itr: no shop has it',
      );
    });

    it('if a shop did say yes, it is never called final', () => {
      const steps = [none('chandan itr'), ask('chandan itr', 'r1')];
      const lines = buildProgress(steps, 'PLAN_READY', null, {
        ...sent,
        answers: [{ shopName: 'Mishra', pricePaise: 5000, at: new Date(), requestId: 'r1' }],
      });
      expect(lines).toContain('Chandan itr: not in past answers');
      expect(lines.join('\n')).not.toMatch(/no shop has it/);
    });

    it('an item nobody was asked about is never final either', () => {
      expect(buildProgress([none('glue')], 'PLAN_READY', null)).toEqual([
        'Glue: not in past answers',
      ]);
    });
  });

  it('says when a word was not understood', () => {
    const steps = [tool('resolve_item', { text: 'xyzzy' }, { status: 'unresolved' })];
    expect(buildProgress(steps, 'PLANNING', null).join('\n')).toMatch(/Could not understand "xyzzy"/);
  });

  it('reports the route and the finished plan', () => {
    const steps = [
      tool('plan_route', { shopIds: ['a'] }, { stops: 3, totalM: 2400 }),
      tool('submit_plan', {}, { likely: 3, notFound: 1 }),
    ];
    expect(buildProgress(steps, 'PLAN_READY', null)).toEqual([
      'Route ready: 3 stops, 2.4 km',
      'Plan ready: 3 items found, 1 not found',
    ]);
  });

  it('ends with a plain line when the errand failed', () => {
    const lines = buildProgress([], 'FAILED', 'step_limit');
    expect(lines.at(-1)).toMatch(/could not make a plan/i);
  });

  describe('waiting, answers and questions (Day 13)', () => {
    const at = (sec: number) => new Date(Date.UTC(2026, 9, 24, 10, 0, sec));
    const ask = (label: string, requestId: string, sec: number): StepView => ({
      ...tool('ask_shops', { itemId: 'i' }, { label, requestId }),
      at: at(sec),
    });

    it('says how many shops were asked, per item: "Asking 6 shops: phenyl"', () => {
      const lines = buildProgress([ask('phenyl', 'r1', 1)], 'PLANNING', null, {
        pingsSent: { r1: 6 },
      });
      expect(lines).toEqual(['Asking 6 shops: phenyl']);
    });

    it('uses the singular for one shop', () => {
      expect(
        buildProgress([ask('jhaadu', 'r1', 1)], 'PLANNING', null, { pingsSent: { r1: 1 } }),
      ).toEqual(['Asking 1 shop: jhaadu']);
    });

    describe('every asking line has its count (Day 14b)', () => {
      const created = at(0);
      const facts = (sent: number, nowSec: number) => ({
        pingsSent: { r1: sent },
        requestCreated: { r1: created },
        now: at(nowSec),
      });

      it('waits for the count while the pings are still being sent', () => {
        expect(buildProgress([ask('diya', 'r1', 1)], 'PLANNING', null, facts(0, 3))).toEqual([]);
        expect(buildProgress([ask('diya', 'r1', 1)], 'PLANNING', null)).toEqual([]);
      });

      it('shows the count as soon as there is one', () => {
        expect(buildProgress([ask('diya', 'r1', 1)], 'PLANNING', null, facts(4, 3))).toEqual([
          'Asking 4 shops: diya',
        ]);
      });

      it('says so when nobody could be asked, once the fan-out has had time to run', () => {
        expect(
          buildProgress([ask('diya', 'r1', 1)], 'WAITING_FOR_SHOPS', null, facts(0, 40)),
        ).toEqual(['No shop to ask: diya', 'Waiting for shops…']);
      });
    });

    it('ends with "Waiting for shops…" while the errand waits for shops', () => {
      const lines = buildProgress([ask('phenyl', 'r1', 1)], 'WAITING_FOR_SHOPS', null, {
        pingsSent: { r1: 3 },
      });
      expect(lines).toEqual(['Asking 3 shops: phenyl', 'Waiting for shops…']);
    });

    it('reports each yes in time order with its price: "Mishra Kirana has it ₹42"', () => {
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
        'Asking 2 shops: phenyl',
        'Mishra Kirana has it ₹42',
        'Gupta Store has it',
        'X: not in past answers',
        'Waiting for shops…',
      ]);
    });

    it('shows paise as a decimal rupee amount when needed', () => {
      const lines = buildProgress([], 'WAITING_FOR_SHOPS', null, {
        answers: [{ shopName: 'A', pricePaise: 4250, at: at(1) }],
      });
      expect(lines[0]).toBe('A has it ₹42.50');
    });

    describe('answers that arrive after the plan is ready (Day 14b)', () => {
      const plan: StepView = {
        ...tool('submit_plan', {}, { confirmed: 1, likely: 0, notFound: 0, items: 1 }),
        at: at(30),
      };
      const answers = [
        { shopName: 'Early Shop', pricePaise: 4200, at: at(10) },
        { shopName: 'Late Shop', pricePaise: 3900, at: at(45) },
        { shopName: 'Later Shop', pricePaise: null, at: at(50) },
      ];

      it('keeps them out of the main timeline', () => {
        const lines = buildProgress([plan], 'PLAN_READY', null, { answers });
        expect(lines.join('\n')).toContain('Early Shop has it ₹42');
        expect(lines.join('\n')).not.toContain('Late Shop');
        expect(lines.join('\n')).not.toContain('Later Shop');
      });

      it('lists them on their own, in time order', () => {
        expect(lateAnswerLines([plan], { answers })).toEqual([
          'Late Shop has it ₹39',
          'Later Shop has it',
        ]);
      });

      it('has none before a plan exists', () => {
        expect(lateAnswerLines([], { answers })).toEqual([]);
        expect(buildProgress([], 'WAITING_FOR_SHOPS', null, { answers }).join('\n')).toContain(
          'Late Shop',
        );
      });
    });

    it('shows the question the agent asked: "Question for you: …"', () => {
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
      expect(lines).toEqual(['Question for you: Kaunsa phenyl chahiye?']);
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
