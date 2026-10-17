import { describe, expect, it } from 'vitest';
import { optimise, recommend, type Offer, type OptimisedPlan, type Wanted } from './optimiser.js';

// Shops sit north of the start, one degree of latitude is about 111 km.
const START = { lat: 22.7196, lng: 75.8577 };
const north = (km: number) => START.lat + km / 111;

const offer = (
  itemId: string,
  shopId: string,
  pricePaise: number | null,
  km: number,
  status: Offer['status'] = 'confirmed',
): Offer => ({
  itemId,
  shopId,
  shopName: `Shop ${shopId}`,
  lat: north(km),
  lng: START.lng,
  distanceM: Math.round(km * 1000),
  pricePaise,
  status,
  freshness: null,
});

const want = (itemId: string, quantity = 1, referencePricePaise: number | null = null): Wanted => ({
  key: itemId,
  itemId,
  quantity,
  referencePricePaise,
});

const shopsOf = (p: OptimisedPlan) => [...p.shopIds].sort();
const pickOf = (p: OptimisedPlan, key: string) => p.assignments.find((a) => a.key === key);

describe('optimise: sasta (cheapest) and kam_dukaan (fewest shops)', () => {
  const items = [want('chai'), want('chini'), want('doodh')];
  // A has everything but is dearer; B and C are cheap but each has only some.
  const offers = [
    offer('chai', 'A', 14000, 0.3),
    offer('chini', 'A', 5000, 0.3),
    offer('doodh', 'A', 3000, 0.3),
    offer('chai', 'B', 12000, 0.5),
    offer('chini', 'B', 4500, 0.5),
    offer('doodh', 'C', 2800, 0.9),
  ];

  it('sasta takes the cheapest offer for each item, whatever the number of shops', () => {
    const { sasta } = optimise(START, items, offers);
    expect(pickOf(sasta, 'chai')?.shopId).toBe('B');
    expect(pickOf(sasta, 'chini')?.shopId).toBe('B');
    expect(pickOf(sasta, 'doodh')?.shopId).toBe('C');
    expect(shopsOf(sasta)).toEqual(['B', 'C']);
    expect(sasta.totalPricePaise).toBe(12000 + 4500 + 2800);
  });

  it('kam_dukaan uses the fewest shops that cover every found item', () => {
    const { kam_dukaan } = optimise(START, items, offers);
    expect(shopsOf(kam_dukaan)).toEqual(['A']);
    expect(kam_dukaan.totalPricePaise).toBe(14000 + 5000 + 3000);
  });

  it('inside the fewest shops, kam_dukaan buys each item at its cheapest of those shops', () => {
    const plan = optimise(
      START,
      [want('x'), want('y'), want('z')],
      [
        offer('x', 'A', 1000, 0.2),
        offer('y', 'A', 1000, 0.2),
        offer('y', 'B', 900, 0.4),
        offer('z', 'B', 1000, 0.4),
        offer('x', 'B', 800, 0.4),
      ],
    );
    // B alone covers x, y and z, so one shop is enough.
    expect(shopsOf(plan.kam_dukaan)).toEqual(['B']);
    expect(plan.kam_dukaan.totalPricePaise).toBe(800 + 900 + 1000);
  });

  it('breaks a tie in shop count by total price, then by route distance', () => {
    // Two shops are needed either way. {A,C} is cheaper than {A,B}; {D,E} ties {A,C} on price but is farther.
    const wanted = [want('p'), want('q')];
    const cheaper = optimise(START, wanted, [
      offer('p', 'A', 1000, 0.3),
      offer('q', 'B', 1500, 0.3),
      offer('q', 'C', 1200, 0.4),
    ]);
    expect(shopsOf(cheaper.kam_dukaan)).toEqual(['A', 'C']);

    const nearer = optimise(START, wanted, [
      offer('p', 'D', 1000, 2),
      offer('q', 'E', 1000, 2.2),
      offer('p', 'A', 1000, 0.3),
      offer('q', 'B', 1000, 0.4),
    ]);
    expect(shopsOf(nearer.kam_dukaan)).toEqual(['A', 'B']);
  });

  it('sasta breaks equal prices in favour of fewer shops, then a shorter route', () => {
    const { sasta } = optimise(
      START,
      [want('p'), want('q')],
      [
        offer('p', 'A', 1000, 0.3),
        offer('p', 'B', 1000, 0.5),
        offer('q', 'B', 1000, 0.5),
        offer('q', 'C', 1000, 0.2),
      ],
    );
    expect(shopsOf(sasta)).toEqual(['B']);
  });

  it('is exact where a greedy cover fails', () => {
    // Greedy takes BIG (4 items) first and then needs two more shops; X + Y alone cover all six.
    const wanted = ['a', 'b', 'c', 'd', 'e', 'f'].map((k) => want(k));
    const plan = optimise(START, wanted, [
      ...['a', 'b', 'c', 'd'].map((k) => offer(k, 'BIG', 1000, 0.3)),
      ...['a', 'b', 'e'].map((k) => offer(k, 'X', 1000, 0.4)),
      ...['c', 'd', 'f'].map((k) => offer(k, 'Y', 1000, 0.5)),
      offer('e', 'Z', 1000, 0.6),
      offer('f', 'W', 1000, 0.7),
    ]);
    expect(shopsOf(plan.kam_dukaan)).toEqual(['X', 'Y']);
    expect(plan.kam_dukaan.assignments).toHaveLength(6);
  });

  it('multiplies by quantity in the total', () => {
    const { sasta } = optimise(START, [want('chai', 3)], [offer('chai', 'A', 1000, 0.3)]);
    expect(sasta.totalPricePaise).toBe(3000);
  });

  it('reports savings against reference prices, negative when dearer, ignoring unknown ones', () => {
    const { sasta } = optimise(
      START,
      [want('a', 2, 1500), want('b', 1, 500), want('c', 1, null)],
      [offer('a', 'A', 1000, 0.3), offer('b', 'A', 700, 0.3), offer('c', 'A', 400, 0.3)],
    );
    // a: (1500-1000)*2 = 1000, b: 500-700 = -200, c: unknown reference
    expect(sasta.savingsPaise).toBe(800);
    expect(sasta.totalPricePaise).toBe(2000 + 700 + 400);
  });

  it('plans the route over the chosen shops with the existing planner, and reports its distance', () => {
    const { kam_dukaan } = optimise(START, [want('a')], [offer('a', 'A', 1000, 1)]);
    expect(kam_dukaan.route?.orderedStops.map((s) => s.shopId)).toEqual(['A']);
    expect(kam_dukaan.route?.totalM).toBeGreaterThan(990);
    expect(kam_dukaan.route?.totalM).toBeLessThan(1010);
    expect(kam_dukaan.totalDistanceM).toBe(kam_dukaan.route?.totalM);
  });
});

describe('optimise: which offers count', () => {
  it('prefers confirmed over likely for the same item, even if the likely one is cheaper', () => {
    const { sasta, kam_dukaan } = optimise(
      START,
      [want('a')],
      [offer('a', 'LIKELY', 500, 0.1, 'likely'), offer('a', 'SURE', 900, 0.9, 'confirmed')],
    );
    for (const p of [sasta, kam_dukaan]) {
      expect(pickOf(p, 'a')).toMatchObject({ shopId: 'SURE', status: 'confirmed' });
    }
  });

  it('uses likely offers only when no confirmed offer exists for that item', () => {
    const { sasta } = optimise(
      START,
      [want('a'), want('b')],
      [
        offer('a', 'S1', 900, 0.5, 'confirmed'),
        offer('b', 'S2', 400, 0.5, 'likely'),
        offer('b', 'S3', 300, 0.6, 'likely'),
      ],
    );
    expect(pickOf(sasta, 'a')?.status).toBe('confirmed');
    expect(pickOf(sasta, 'b')).toMatchObject({ shopId: 'S3', status: 'likely' });
  });

  it('keeps one offer per shop and item, confirmed winning over likely', () => {
    const { sasta } = optimise(
      START,
      [want('a')],
      [offer('a', 'S', 500, 0.3, 'likely'), offer('a', 'S', 700, 0.3, 'confirmed')],
    );
    expect(pickOf(sasta, 'a')).toMatchObject({ shopId: 'S', status: 'confirmed', pricePaise: 700 });
  });

  it('uses a shop with an unknown price only when no shop has quoted a price', () => {
    const priced = optimise(
      START,
      [want('a')],
      [offer('a', 'NOPRICE', null, 0.1), offer('a', 'PRICED', 800, 0.9)],
    );
    expect(pickOf(priced.sasta, 'a')?.shopId).toBe('PRICED');
    const unpriced = optimise(START, [want('a')], [offer('a', 'NOPRICE', null, 0.1)]);
    expect(pickOf(unpriced.sasta, 'a')).toMatchObject({ shopId: 'NOPRICE', pricePaise: null });
    expect(unpriced.sasta.totalPricePaise).toBe(0);
  });

  it('leaves out an item nobody has and still plans the rest', () => {
    const { sasta, kam_dukaan } = optimise(
      START,
      [want('a'), want('ghost')],
      [offer('a', 'S', 500, 0.3)],
    );
    for (const p of [sasta, kam_dukaan]) {
      expect(p.assignments.map((a) => a.key)).toEqual(['a']);
      expect(p.notFound).toEqual(['ghost']);
    }
  });

  it('gives two plans of nothing when nothing was found', () => {
    const { sasta, kam_dukaan } = optimise(START, [want('ghost')], []);
    for (const p of [sasta, kam_dukaan]) {
      expect(p.assignments).toEqual([]);
      expect(p.route).toBeNull();
      expect(p.totalPricePaise).toBe(0);
      expect(p.totalDistanceM).toBe(0);
      expect(p.notFound).toEqual(['ghost']);
    }
  });

  it('is deterministic: the same input in another order gives the same plans', () => {
    const wanted = [want('a'), want('b'), want('c')];
    const offs = [
      offer('a', 'S1', 1000, 0.3),
      offer('a', 'S2', 1000, 0.3),
      offer('b', 'S1', 1000, 0.3),
      offer('b', 'S2', 1000, 0.3),
      offer('c', 'S3', 1000, 0.3),
    ];
    const one = optimise(START, wanted, offs);
    const two = optimise(START, [...wanted].reverse(), [...offs].reverse());
    expect(shopsOf(one.sasta)).toEqual(shopsOf(two.sasta));
    expect(shopsOf(one.kam_dukaan)).toEqual(shopsOf(two.kam_dukaan));
  });

  it('plans at most 8 stops; items of farther shops beyond that are dropped', () => {
    const wanted = Array.from({ length: 10 }, (_, i) => want(`i${i}`));
    const offs = wanted.map((w, i) => offer(w.itemId, `S${i}`, 1000, 0.1 * (i + 1)));
    const { kam_dukaan } = optimise(START, wanted, offs);
    expect(kam_dukaan.shopIds).toHaveLength(8);
    expect(kam_dukaan.route?.orderedStops).toHaveLength(8);
    expect(kam_dukaan.tooManyShops).toEqual(['i8', 'i9']);
    expect(kam_dukaan.assignments).toHaveLength(8);
  });

  it('is fast enough for ten items and many offers', () => {
    const wanted = Array.from({ length: 10 }, (_, i) => want(`i${i}`));
    const offs: Offer[] = [];
    for (let s = 0; s < 14; s++)
      for (let i = 0; i < 10; i++)
        if ((s * 7 + i * 3) % 4 !== 0)
          offs.push(offer(`i${i}`, `S${s}`, 500 + ((s * 31 + i * 17) % 400), 0.2 + s * 0.1));
    const started = Date.now();
    const { sasta, kam_dukaan } = optimise(START, wanted, offs);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(sasta.assignments).toHaveLength(10);
    expect(kam_dukaan.shopIds.length).toBeLessThanOrEqual(sasta.shopIds.length);
  });
});

describe('recommend', () => {
  const plan = (shops: number, totalPricePaise: number): OptimisedPlan =>
    ({
      kind: 'sasta',
      shopIds: Array.from({ length: shops }, (_, i) => `S${i}`),
      totalPricePaise,
    }) as unknown as OptimisedPlan;

  it('recommends kam_dukaan when it saves a stop and costs at most the extra limit more', () => {
    expect(recommend(plan(3, 20000), plan(1, 22900), { maxExtraPaise: 3000 })).toMatchObject({
      recommended: 'kam_dukaan',
      extraPaise: 2900,
    });
    expect(recommend(plan(3, 20000), plan(1, 23000), { maxExtraPaise: 3000 }).recommended).toBe(
      'kam_dukaan',
    );
  });

  it('also accepts an extra cost of up to 10 % of the cheapest plan', () => {
    expect(recommend(plan(3, 100000), plan(1, 109000), { maxExtraPaise: 3000 }).recommended).toBe(
      'kam_dukaan',
    );
    expect(recommend(plan(3, 100000), plan(1, 110000), { maxExtraPaise: 3000 }).recommended).toBe(
      'kam_dukaan',
    );
  });

  it('recommends sasta when fewer shops cost more than both limits', () => {
    expect(recommend(plan(3, 20000), plan(1, 23001), { maxExtraPaise: 3000 })).toMatchObject({
      recommended: 'sasta',
      extraPaise: 3001,
    });
    expect(recommend(plan(3, 100000), plan(1, 110001), { maxExtraPaise: 3000 }).recommended).toBe(
      'sasta',
    );
  });

  it('recommends sasta when kam_dukaan does not save any stop', () => {
    expect(recommend(plan(2, 20000), plan(2, 20000), { maxExtraPaise: 3000 }).recommended).toBe(
      'sasta',
    );
  });

  it('honours a different limit', () => {
    expect(recommend(plan(3, 20000), plan(1, 20500), { maxExtraPaise: 100 }).recommended).toBe(
      'kam_dukaan', // 500 is still inside 10 % of 20000
    );
    expect(recommend(plan(3, 5000), plan(1, 5600), { maxExtraPaise: 100 }).recommended).toBe(
      'sasta',
    );
  });
});
