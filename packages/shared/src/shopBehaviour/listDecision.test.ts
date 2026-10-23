import { describe, expect, it } from 'vitest';
import { decideList, type ListPingInfo } from './decision.js';
import { createRng } from './rng.js';

const ping = (over: Partial<ListPingInfo> = {}): ListPingInfo => ({
  listPingId: 'lp1',
  shopId: 's1',
  wantsDelivery: false,
  canDeliver: true,
  shopCategories: ['grocery'],
  lines: [
    {
      lineId: 'a',
      name: 'Sugar',
      category: 'grocery',
      itemCategories: ['grocery'],
      refPricePaise: 4500,
      other: false,
    },
    {
      lineId: 'b',
      name: 'Rice',
      category: 'grocery',
      itemCategories: ['grocery'],
      refPricePaise: 6000,
      other: false,
    },
    {
      lineId: 'c',
      name: 'Tractor spare bolt',
      category: null,
      itemCategories: [],
      refPricePaise: null,
      other: true,
    },
  ],
  ...over,
});
const eager = { replyProbability: 1, alwaysNo: false };

describe('decideList (the simulator answers a parchi)', () => {
  it('answers every line with have true or false and a whole-rupee price when it has it', () => {
    for (let seed = 1; seed < 30; seed++) {
      const d = decideList(eager, ping(), createRng(seed), 1);
      expect(d.kind).toBe('answer');
      if (d.kind !== 'answer') continue;
      expect(d.body.lines.map((l) => l.lineId)).toEqual(['a', 'b', 'c']);
      for (const l of d.body.lines) {
        if (l.have) {
          expect(Number.isInteger(l.priceRupees)).toBe(true);
          expect(l.priceRupees).toBeGreaterThan(0);
        } else expect(l.priceRupees).toBeUndefined();
      }
    }
  });

  it('is random per line: over many seeds both outcomes happen, and prices stay plausible', () => {
    const haves: boolean[] = [];
    const sugar: number[] = [];
    for (let seed = 1; seed < 80; seed++) {
      const d = decideList(eager, ping(), createRng(seed), 1);
      if (d.kind !== 'answer') continue;
      for (const l of d.body.lines) haves.push(l.have);
      const s = d.body.lines[0];
      if (s?.have && s.priceRupees !== undefined) sugar.push(s.priceRupees);
    }
    expect(haves).toContain(true);
    expect(haves).toContain(false);
    expect(Math.min(...sugar)).toBeGreaterThanOrEqual(25);
    expect(Math.max(...sugar)).toBeLessThanOrEqual(70);
  });

  it('sometimes can deliver, with one fee in whole rupees, never when the shop cannot reach', () => {
    const fees: (number | undefined)[] = [];
    for (let seed = 1; seed < 200; seed++) {
      const d = decideList(eager, ping({ wantsDelivery: true }), createRng(seed), 1);
      if (d.kind === 'answer' && d.body.canDeliver) fees.push(d.body.deliveryFeeRupees);
      const far = decideList(eager, ping({ canDeliver: false }), createRng(seed), 1);
      if (far.kind === 'answer') expect(far.body.canDeliver).not.toBe(true);
    }
    expect(fees.length).toBeGreaterThan(5);
    for (const f of fees) expect(f === undefined || Number.isInteger(f)).toBe(true);
  });

  it('a shop that never has anything says no to every line; a busy shop sometimes skips', () => {
    const no = decideList({ replyProbability: 1, alwaysNo: true }, ping(), createRng(3), 1);
    expect(no.kind === 'answer' && no.body.lines.every((l) => !l.have)).toBe(true);
    const kinds = new Set(
      Array.from(
        { length: 40 },
        (_, i) =>
          decideList({ replyProbability: 0.3, alwaysNo: false }, ping(), createRng(i + 1), 1).kind,
      ),
    );
    expect(kinds.has('skip')).toBe(true);
  });

  it("a line outside the shop's own kinds is a no, and the same seed gives the same answer", () => {
    const p = ping({ shopCategories: ['hardware'] });
    const d = decideList(eager, p, createRng(9), 1);
    if (d.kind !== 'answer') throw new Error('expected an answer');
    expect(d.body.lines.filter((l) => l.lineId !== 'c').every((l) => !l.have)).toBe(true);
    expect(decideList(eager, p, createRng(9), 1)).toEqual(d);
  });

  it('the delay is 5 to 90 seconds divided by speed', () => {
    const d = decideList(eager, ping(), createRng(5), 10);
    if (d.kind !== 'answer') throw new Error('expected an answer');
    expect(d.delayMs).toBeGreaterThanOrEqual(500);
    expect(d.delayMs).toBeLessThanOrEqual(9000);
  });
});
