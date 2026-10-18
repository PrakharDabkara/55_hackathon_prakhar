import { describe, expect, it } from 'vitest';
import { applyModes, type ModeVariant } from './delivery.js';

const START = { lat: 22.7196, lng: 75.8577 };
const north = (km: number) => START.lat + km / 111;

const item = (shopId: string, over: Record<string, unknown> = {}) => ({
  text: `item-${shopId}`,
  itemId: `i-${shopId}`,
  quantity: 1,
  status: 'confirmed' as const,
  shopId,
  shopName: `Shop ${shopId}`,
  distanceM: 500,
  pricePaise: 5000,
  delivery: null as { feePaise: number | null; minutes: number | null } | null,
  ...over,
});

const stop = (shopId: string, km: number) => ({
  shopId,
  label: `Shop ${shopId}`,
  lat: north(km),
  lng: START.lng,
});

/** A plan over shops A (0.4 km), B (1 km, delivers for ₹30) and C (2 km, delivers, fee not told). */
const variant = (): ModeVariant => ({
  kind: 'sasta',
  items: [
    item('A'),
    item('B', { delivery: { feePaise: 3000, minutes: 45 } }),
    item('B', { text: 'second at B', itemId: 'i-B2', delivery: { feePaise: 3000, minutes: 45 } }),
    item('C', { delivery: { feePaise: null, minutes: null } }),
  ],
  route: {
    orderedStops: [stop('A', 0.4), stop('B', 1), stop('C', 2)],
    legsM: [400, 600, 1000],
    totalM: 2000,
  },
  totalPricePaise: 20000,
  totalDistanceM: 2000,
  shopCount: 3,
  savingsPaise: 0,
  unknownPriceCount: 0,
});

describe('applyModes: pickup or delivery for each shop (ADR-0031)', () => {
  it('with no choice everything is pickup: same route, no fees, grand total = items', () => {
    const v = applyModes(variant(), START, {});
    expect(v.items.every((i) => i.mode === 'pickup')).toBe(true);
    expect(v.route?.orderedStops.map((s) => s.shopId)).toEqual(['A', 'B', 'C']);
    expect(v.deliveryFeePaise).toBe(0);
    expect(v.unknownFeeCount).toBe(0);
    expect(v.grandTotalPaise).toBe(20000);
    expect(v.shopCount).toBe(3);
    expect(v.deliveryShopCount).toBe(0);
  });

  it('delivery adds one fee per shop, however many items come from it', () => {
    const v = applyModes(variant(), START, { B: 'delivery' });
    expect(v.deliveryFeePaise).toBe(3000);
    expect(v.grandTotalPaise).toBe(23000);
    expect(v.items.filter((i) => i.shopId === 'B').every((i) => i.mode === 'delivery')).toBe(true);
    expect(v.totalPricePaise).toBe(20000); // the items cost the same either way
  });

  it('delivery counts the route distance as 0: the shop leaves the route', () => {
    const v = applyModes(variant(), START, { B: 'delivery' });
    expect(v.route?.orderedStops.map((s) => s.shopId)).toEqual(['A', 'C']);
    expect(v.shopCount).toBe(2);
    expect(v.deliveryShopCount).toBe(1);
    expect(v.totalDistanceM).toBeLessThan(2000);
    expect(v.totalDistanceM).toBe(v.route?.totalM);
  });

  it('every shop on delivery leaves no route at all', () => {
    const v = applyModes(variant(), START, { A: 'delivery', B: 'delivery', C: 'delivery' });
    // A does not deliver: it stays on the route.
    expect(v.route?.orderedStops.map((s) => s.shopId)).toEqual(['A']);
    const onlyDelivering = applyModes(
      { ...variant(), items: variant().items.filter((i) => i.shopId !== 'A') },
      START,
      { B: 'delivery', C: 'delivery' },
    );
    expect(onlyDelivering.route).toBeNull();
    expect(onlyDelivering.totalDistanceM).toBe(0);
    expect(onlyDelivering.shopCount).toBe(0);
  });

  it('a shop that does not deliver stays pickup, whatever was asked', () => {
    const v = applyModes(variant(), START, { A: 'delivery' });
    expect(v.items.find((i) => i.shopId === 'A')?.mode).toBe('pickup');
    expect(v.deliveryFeePaise).toBe(0);
  });

  it('a fee nobody told is unknown, never ₹0: counted, not added', () => {
    const v = applyModes(variant(), START, { C: 'delivery' });
    expect(v.unknownFeeCount).toBe(1);
    expect(v.deliveryFeePaise).toBe(0);
    expect(v.grandTotalPaise).toBe(20000);
    expect(v.comparablePricePaise).toBeGreaterThan(20000); // ranked with a typical fee
  });

  it('a fee of 0 is a free delivery, not an unknown one', () => {
    const free = variant();
    free.items = free.items.map((i) =>
      i.shopId === 'B' ? { ...i, delivery: { feePaise: 0, minutes: 30 } } : i,
    );
    const v = applyModes(free, START, { B: 'delivery' });
    expect(v.unknownFeeCount).toBe(0);
    expect(v.deliveryFeePaise).toBe(0);
  });

  it('if a shop gave different fees for different items, the largest is the one fee (never understate)', () => {
    const mixed = variant();
    mixed.items = mixed.items.map((i) =>
      i.itemId === 'i-B2' ? { ...i, delivery: { feePaise: 4000, minutes: 45 } } : i,
    );
    expect(applyModes(mixed, START, { B: 'delivery' }).deliveryFeePaise).toBe(4000);
  });

  it('keeps unknown item prices unknown and carries the count through', () => {
    const v = applyModes({ ...variant(), unknownPriceCount: 2 }, START, { B: 'delivery' });
    expect(v.unknownPriceCount).toBe(2);
  });

  it('does not change the input', () => {
    const input = variant();
    const copy = JSON.parse(JSON.stringify(input));
    applyModes(input, START, { B: 'delivery' });
    expect(input).toEqual(copy);
  });
});
