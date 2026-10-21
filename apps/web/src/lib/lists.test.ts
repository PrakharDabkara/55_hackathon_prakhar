import { afterEach, describe, expect, it, vi } from 'vitest';
import { answerOf, draftList, itemLine, openList } from '../test/fakesLists.js';
import {
  alternativesFor,
  initialPlan,
  loadFindMode,
  loadListDraft,
  looksLikeSeveral,
  lineLabel,
  movePlanLine,
  needsCheck,
  saveFindMode,
  saveListDraft,
  setPlanMode,
  splitItems,
  summarizePlan,
} from './lists.js';

const HERE = { lat: 22.7196, lng: 75.8577 };

describe('splitItems', () => {
  it('splits on commas and new lines and drops empty parts', () => {
    expect(splitItems('milk, sugar\n\n tea ,')).toEqual(['milk', 'sugar', 'tea']);
  });

  it('strips bullets and numbers a pasted list may carry', () => {
    expect(splitItems('1. atta\n2) rice\n- dal\n• namak')).toEqual([
      'atta',
      'rice',
      'dal',
      'namak',
    ]);
  });

  it('keeps a quantity with the item before it', () => {
    expect(splitItems('atta, 2 kg, sugar')).toEqual(['atta, 2 kg', 'sugar']);
    expect(splitItems('javitri, 50 g')).toEqual(['javitri, 50 g']);
  });

  it('splits on " and " only when asked to', () => {
    expect(splitItems('atta and sugar')).toEqual(['atta and sugar']);
    expect(splitItems('atta and sugar', { and: true })).toEqual(['atta', 'sugar']);
    expect(splitItems('Atta AND sugar, tea', { and: true })).toEqual(['Atta', 'sugar', 'tea']);
  });
});

describe('looksLikeSeveral', () => {
  it('is true for two or more things', () => {
    expect(looksLikeSeveral('atta, sugar')).toBe(true);
    expect(looksLikeSeveral('atta and sugar')).toBe(true);
    expect(looksLikeSeveral('atta\nsugar')).toBe(true);
  });

  it('is false for one thing, even with a quantity', () => {
    expect(looksLikeSeveral('')).toBe(false);
    expect(looksLikeSeveral('atta')).toBe(false);
    expect(looksLikeSeveral('javitri, 50 g')).toBe(false);
    expect(looksLikeSeveral('brand')).toBe(false);
  });
});

describe('what the device remembers', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
    sessionStorage.clear();
  });

  it('remembers One thing or A list per device, one thing by default', () => {
    expect(loadFindMode()).toBe('one');
    saveFindMode('list');
    expect(loadFindMode()).toBe('list');
    localStorage.setItem('km-find-mode', 'junk');
    expect(loadFindMode()).toBe('one');
  });

  it('never throws when storage is blocked', () => {
    vi.stubGlobal('localStorage', {
      getItem() {
        throw new Error('blocked');
      },
      setItem() {
        throw new Error('blocked');
      },
    });
    expect(loadFindMode()).toBe('one');
    expect(() => saveFindMode('list')).not.toThrow();
  });

  it('keeps the lines of the list being typed', () => {
    expect(loadListDraft()).toEqual([]);
    saveListDraft(['atta', '', 'rice']);
    expect(loadListDraft()).toEqual(['atta', 'rice']);
  });
});

describe('needsCheck', () => {
  it('is true when a line is a question or refused', () => {
    expect(needsCheck(draftList())).toBe(true);
    expect(needsCheck(draftList({ lines: [draftList().lines[3]!] }))).toBe(true);
  });

  it('is false when every line is understood or "other"', () => {
    expect(needsCheck(draftList({ lines: [itemLine(0, 'atta'), draftList().lines[2]!] }))).toBe(
      false,
    );
  });
});

describe('lineLabel', () => {
  it('prefers the everyday word, then the item, then the typed words', () => {
    const list = openList();
    expect(lineLabel(list.lines[0]!)).toBe('Sugar');
    expect(lineLabel(list.lines[3]!)).toBe('Tractor spare bolt');
    expect(
      lineLabel(
        itemLine(7, 'rice', {
          item: { id: 'x', nameEn: 'basmati rice', nameHi: '', category: 'grocery' },
        }),
      ),
    ).toBe('Basmati rice');
  });
});

describe('the plan recompute', () => {
  it('starts from the default plan, everyone on pick up', () => {
    const list = openList();
    const choice = initialPlan(list);
    expect(choice.assignments).toEqual({
      0: 'shop-m',
      1: 'shop-m',
      2: 'shop-j',
      3: 'shop-g',
      4: 'shop-g',
    });
    expect(choice.modes).toEqual({});
    const summary = summarizePlan(list, choice, HERE);
    expect(summary).toMatchObject({
      shops: 3,
      covered: 5,
      total: 5,
      itemsPaise: 21_800,
      feePaise: 0,
      cashPaise: 21_800,
      missing: [],
    });
  });

  it('orders the shops nearest first from the customer', () => {
    const list = openList();
    const summary = summarizePlan(list, initialPlan(list), HERE);
    expect(summary.groups.map((g) => g.answer.name)).toEqual([
      'Mishra Kirana',
      'Gupta Store',
      'Jain Stationers',
    ]);
    // From a spot beside Jain the order turns round.
    const nearJain = { lat: 22.7316, lng: 75.8577 };
    expect(
      summarizePlan(list, initialPlan(list), nearJain).groups.map((g) => g.answer.name),
    ).toEqual(['Jain Stationers', 'Gupta Store', 'Mishra Kirana']);
  });

  it('adds the fee of a shop set to Deliver to the cash total', () => {
    const list = openList();
    const choice = setPlanMode(initialPlan(list), list, 'shop-m', 'delivery');
    const summary = summarizePlan(list, choice, HERE);
    expect(summary.feePaise).toBe(2000);
    expect(summary.cashPaise).toBe(23_800);
    expect(summary.deliveryShops).toBe(1);
    expect(summary.groups[0]).toMatchObject({ mode: 'delivery', feePaise: 2000 });
  });

  it('counts a delivery with no named fee as unknown, never as ₹0 paid', () => {
    const list = openList();
    const choice = setPlanMode(initialPlan(list), list, 'shop-j', 'delivery');
    const summary = summarizePlan(list, choice, HERE);
    expect(summary.unknownFeeCount).toBe(1);
    expect(summary.cashPaise).toBe(21_800);
  });

  it('refuses Deliver for a shop that does not deliver', () => {
    const list = openList();
    const choice = setPlanMode(initialPlan(list), list, 'shop-g', 'delivery');
    expect(choice.modes['shop-g']).toBeUndefined();
  });

  it('moves a line to another shop that has it and recomputes', () => {
    const list = openList();
    const choice = movePlanLine(initialPlan(list), list, 4, 'shop-m');
    const summary = summarizePlan(list, choice, HERE);
    expect(summary.itemsPaise).toBe(22_300); // rice ₹55 → ₹60
    expect(summary.groups.find((g) => g.shopId === 'shop-m')?.lines.map((l) => l.position)).toEqual(
      [0, 1, 4],
    );
    expect(summary.groups.find((g) => g.shopId === 'shop-g')?.lines.map((l) => l.position)).toEqual(
      [3],
    );
  });

  it('refuses a move to a shop that does not have the line', () => {
    const list = openList();
    const choice = initialPlan(list);
    expect(movePlanLine(choice, list, 3, 'shop-m')).toEqual(choice);
  });

  it('drops a shop that has no lines left, and forgets its mode', () => {
    const a = answerOf('shop-a', 'A', 300, [1000, 2000], {
      canDeliver: true,
      deliveryFeePaise: 500,
    });
    const b = answerOf('shop-b', 'B', 600, [1100, 2100]);
    const list = openList({
      lines: [itemLine(0, 'tea'), itemLine(1, 'salt')],
      answers: [a, b],
      plan: {
        assignments: [
          { position: 0, shopId: 'shop-a', pricePaise: 1000 },
          { position: 1, shopId: 'shop-a', pricePaise: 2000 },
        ],
        stops: [{ shopId: 'shop-a', name: 'A', lat: a.lat, lng: a.lng }],
        totalM: 300,
        totalPaise: 3000,
        missing: [],
      },
    });
    let choice = setPlanMode(initialPlan(list), list, 'shop-a', 'delivery');
    choice = movePlanLine(choice, list, 0, 'shop-b');
    choice = movePlanLine(choice, list, 1, 'shop-b');
    const summary = summarizePlan(list, choice, HERE);
    expect(summary.shops).toBe(1);
    expect(summary.groups.map((g) => g.shopId)).toEqual(['shop-b']);
    expect(summary.feePaise).toBe(0);
    expect(summary.cashPaise).toBe(3200);
    expect(summary.deliveryShops).toBe(0);
  });

  it('lists lines nobody has as missing and covers the rest', () => {
    const list = openList({
      plan: {
        ...openList().plan!,
        assignments: openList().plan!.assignments.filter((a) => a.position !== 3),
        missing: [3],
      },
    });
    const summary = summarizePlan(list, initialPlan(list), HERE);
    expect(summary.missing).toEqual([3]);
    expect(summary.covered).toBe(4);
    expect(summary.total).toBe(5);
  });

  it('offers the other shops that have a line, cheapest first', () => {
    const list = openList();
    expect(alternativesFor(list, 4).map((o) => [o.answer.name, o.pricePaise])).toEqual([
      ['Gupta Store', 5500],
      ['Mishra Kirana', 6000],
    ]);
    expect(alternativesFor(list, 3).map((o) => o.answer.name)).toEqual(['Gupta Store']);
  });
});
