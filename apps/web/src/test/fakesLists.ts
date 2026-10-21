import type { LineView, ListView } from '../lib/listApi.js';

/** A line the catalog understood. */
export const itemLine = (
  position: number,
  text: string,
  overrides: Partial<LineView> = {},
): LineView => ({
  position,
  text,
  status: 'item',
  item: { id: `item-${position}`, nameEn: text, nameHi: text, category: 'grocery' },
  asked: 3,
  ...overrides,
});

/** A line whose typed word is an everyday word for a catalog item: "chini" is sugar. */
const everyday = (
  position: number,
  text: string,
  nameEn: string,
  overrides: Partial<LineView> = {},
) =>
  itemLine(position, text, {
    displayName: text.charAt(0).toUpperCase() + text.slice(1),
    item: { id: `item-${position}`, nameEn, nameHi: text, category: 'grocery' },
    ...overrides,
  });

type Cell = number | 'no' | 'not_sent';

/** One shop's answer: a price in paise for "have", or 'no' / 'not_sent'. */
export function answerOf(
  shopId: string,
  name: string,
  distanceM: number,
  cells: Cell[],
  overrides: Partial<ListView['answers'][number]> = {},
): ListView['answers'][number] {
  const lines = cells.map((cell, position) =>
    typeof cell === 'number'
      ? { position, status: 'have' as const, pricePaise: cell }
      : { position, status: cell },
  );
  const have = lines.filter((l) => l.status === 'have');
  return {
    shopId,
    name,
    logoUrl: null,
    distanceM,
    lat: 22.7196 + distanceM / 100_000,
    lng: 75.8577,
    haveCount: have.length,
    totalPaise: have.reduce((sum, l) => sum + (l.pricePaise ?? 0), 0),
    canDeliver: false,
    deliveryFeePaise: null,
    answeredAt: '2026-10-21T10:02:00.000Z',
    lines,
    ...overrides,
  };
}

/**
 * Five lines, three shops. Mishra (400 m) has Sugar, Turmeric and Rice and delivers for ₹20; Gupta
 * (900 m) has Sugar, Rice and the bolt and does not deliver; Jain (1.2 km) has the notebook and
 * delivers with no fee named. The default plan: 0, 1 to Mishra; 2 to Jain; 3, 4 to Gupta (₹218).
 */
export function openList(overrides: Partial<ListView> = {}): ListView {
  const mishra = answerOf('shop-m', 'Mishra Kirana', 400, [4800, 4500, 'not_sent', 'no', 6000], {
    canDeliver: true,
    deliveryFeePaise: 2000,
  });
  const gupta = answerOf('shop-g', 'Gupta Store', 900, [5000, 'no', 'not_sent', 3000, 5500]);
  const jain = answerOf(
    'shop-j',
    'Jain Stationers',
    1200,
    ['not_sent', 'not_sent', 4000, 'not_sent', 'not_sent'],
    {
      canDeliver: true,
      deliveryFeePaise: null,
    },
  );
  return {
    id: 'list-1',
    state: 'OPEN',
    listening: true,
    binding: true,
    wantsDelivery: false,
    maxAnswers: 8,
    shopsAsked: 6,
    shopsAnswered: 3,
    lat: 22.7196,
    lng: 75.8577,
    lines: [
      everyday(0, 'chini', 'sugar'),
      everyday(1, 'haldi', 'turmeric powder'),
      itemLine(2, 'notebook', {
        item: { id: 'item-2', nameEn: 'notebook', nameHi: 'copy', category: 'stationery' },
      }),
      { position: 3, text: 'tractor spare bolt', status: 'other', asked: 6 },
      everyday(4, 'chawal', 'rice'),
    ],
    answers: [mishra, gupta, jain],
    plan: {
      assignments: [
        { position: 0, shopId: 'shop-m', pricePaise: 4800 },
        { position: 1, shopId: 'shop-m', pricePaise: 4500 },
        { position: 2, shopId: 'shop-j', pricePaise: 4000 },
        { position: 3, shopId: 'shop-g', pricePaise: 3000 },
        { position: 4, shopId: 'shop-g', pricePaise: 5500 },
      ],
      stops: [
        { shopId: 'shop-m', name: 'Mishra Kirana', lat: mishra.lat, lng: mishra.lng },
        { shopId: 'shop-g', name: 'Gupta Store', lat: gupta.lat, lng: gupta.lng },
        { shopId: 'shop-j', name: 'Jain Stationers', lat: jain.lat, lng: jain.lng },
      ],
      totalM: 2400,
      totalPaise: 21_800,
      missing: [],
    },
    createdAt: '2026-10-21T10:00:00.000Z',
    sentAt: '2026-10-21T10:00:01.000Z',
    expiresAt: '2026-10-21T10:15:01.000Z',
    ...overrides,
  };
}

/** A sorted draft: one clear line, one question, one "other", one refused. */
export function draftList(overrides: Partial<ListView> = {}): ListView {
  return {
    id: 'list-draft',
    state: 'DRAFT',
    listening: false,
    binding: false,
    wantsDelivery: false,
    maxAnswers: 8,
    shopsAsked: 0,
    shopsAnswered: 0,
    lat: null,
    lng: null,
    lines: [
      everyday(0, 'chini', 'sugar', { quantity: { quantity: 2, unit: 'kg' } }),
      {
        position: 1,
        text: 'mirchi',
        status: 'ambiguous',
        question: 'Which mirchi?',
        options: [
          { itemId: 'item-green', nameEn: 'Green chilli', nameHi: 'hari mirch' },
          { itemId: 'item-red', nameEn: 'Red chilli powder', nameHi: 'lal mirch' },
        ],
        asked: 0,
      },
      { position: 2, text: 'tractor spare bolt', status: 'other', asked: 0 },
      { position: 3, text: 'a gun', status: 'refused', reason: 'blocked', asked: 0 },
      { position: 4, text: 'something nice', status: 'refused', reason: 'unclear', asked: 0 },
    ],
    answers: [],
    plan: null,
    createdAt: '2026-10-21T10:00:00.000Z',
    sentAt: null,
    expiresAt: '2026-10-21T10:15:00.000Z',
    ...overrides,
  };
}

/** The entry at a place that must exist (a test fixture), without a non-null assertion. */
export function at<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) throw new Error(`no entry at ${index}`);
  return item;
}

/** The open list with its default plan changed: only these assignments, and these lines missing. */
export function planWith(
  keep: (a: { position: number }) => boolean,
  missing: number[],
  base: ListView = openList(),
): ListView {
  const plan = base.plan;
  if (!plan) throw new Error('the list has no plan');
  return { ...base, plan: { ...plan, assignments: plan.assignments.filter(keep), missing } };
}
