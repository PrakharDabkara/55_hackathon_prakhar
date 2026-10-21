import { describe, expect, it } from 'vitest';
import { ORDER_STATES, type OrderState } from './stateMachine.js';
import { seekerOrderView, shopOrderView } from './view.js';
import type { OrderRecord } from './types.js';

const ADDRESS = 'Flat 4B, Sapna Apartments, Vijay Nagar';

const order = (over: Partial<OrderRecord> = {}): OrderRecord => ({
  id: 'o1',
  userId: 'u1',
  shopId: 's1',
  shopName: 'Sharma Kirana',
  shopOwnerUserId: 'owner1',
  requestId: 'r1',
  errandId: null,
  listId: null,
  state: 'REQUESTED',
  lines: [{ name: 'Chini', count: 2, pricePaise: 4500 }],
  itemsTotalPaise: 9000,
  unknownPriceCount: 0,
  feePaise: 3000,
  feeMinutes: 45,
  addressText: ADDRESS,
  customerFirstName: null,
  lat: 22.72,
  lng: 75.86,
  note: null,
  acceptedAt: null,
  outForDeliveryAt: null,
  receiveBy: null,
  cancelledBy: null,
  cancelReason: null,
  cancelText: null,
  expiresAt: new Date('2026-10-18T10:10:00Z'),
  createdAt: new Date('2026-10-18T10:00:00Z'),
  updatedAt: new Date('2026-10-18T10:00:00Z'),
  ...over,
});

const SEEN: OrderState[] = ['ACCEPTED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'NOT_CONFIRMED'];

describe('what the shop sees of an order (ADR-0031)', () => {
  for (const state of ORDER_STATES) {
    const seen = SEEN.includes(state);
    it(`${state}: ${seen ? 'address, map link' : 'no address, no map link, no pin'}`, () => {
      const view = shopOrderView(order({ state }));
      if (seen) {
        expect(view.addressText).toBe(ADDRESS);
        expect(view.mapUrl).toMatch(
          /^https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=22\.72,75\.86$/,
        );
      } else {
        expect(view).not.toHaveProperty('addressText');
        expect(view).not.toHaveProperty('mapUrl');
        expect(JSON.stringify(view)).not.toContain('Sapna');
        expect(JSON.stringify(view)).not.toContain('22.72');
      }
    });
  }

  it('the contact line is the first name if given, else "Customer"', () => {
    expect(shopOrderView(order({ customerFirstName: 'Asha' })).contactName).toBe('Asha');
    expect(shopOrderView(order({ customerFirstName: null })).contactName).toBe('Customer');
  });

  it('never carries a phone or a user id, whatever the state', () => {
    for (const state of ORDER_STATES) {
      const json = JSON.stringify(shopOrderView(order({ state })));
      expect(json).not.toMatch(/\+91|phone|userId|u1/);
    }
  });
});

describe('what the customer sees of an order', () => {
  it('has when the shop accepted and when it set out, as ISO times, or null', () => {
    expect(seekerOrderView(order())).toMatchObject({ acceptedAt: null, outForDeliveryAt: null });
    const view = seekerOrderView(
      order({
        acceptedAt: new Date('2026-10-18T10:02:00Z'),
        outForDeliveryAt: new Date('2026-10-18T10:20:00Z'),
      }),
    );
    expect(view.acceptedAt).toBe('2026-10-18T10:02:00.000Z');
    expect(view.outForDeliveryAt).toBe('2026-10-18T10:20:00.000Z');
  });

  it('has their own address, the cash-on-delivery line and the shop name', () => {
    const view = seekerOrderView(order());
    expect(view).toMatchObject({
      addressText: ADDRESS,
      shopName: 'Sharma Kirana',
      payment: 'cash_on_delivery',
      feePaise: 3000,
    });
  });

  it('says a declined or expired order falls back to pickup', () => {
    expect(seekerOrderView(order({ state: 'DECLINED' })).pickupFallback).toBe(true);
    expect(seekerOrderView(order({ state: 'EXPIRED' })).pickupFallback).toBe(true);
    expect(seekerOrderView(order({ state: 'ACCEPTED' })).pickupFallback).toBe(false);
    expect(seekerOrderView(order({ state: 'CANCELLED' })).pickupFallback).toBe(false);
  });
});

describe('Delivery v2 additions', () => {
  it('the shop sees the customer note before accepting, still no address', () => {
    const view = shopOrderView(order({ state: 'REQUESTED', note: 'Ring the bell twice' }));
    expect(view.note).toBe('Ring the bell twice');
    expect(view).not.toHaveProperty('addressText');
  });

  it('the shop sees why it cancelled; the customer sees the reason and who cancelled', () => {
    const cancelled = order({
      state: 'CANCELLED',
      cancelledBy: 'shop',
      cancelReason: 'out_of_stock',
      cancelText: 'sold out',
    });
    expect(shopOrderView(cancelled)).toMatchObject({ cancelReason: 'out_of_stock' });
    expect(seekerOrderView(cancelled)).toMatchObject({
      cancelledBy: 'shop',
      cancelReason: 'out_of_stock',
      cancelText: 'sold out',
    });
  });

  it('NOT_CONFIRMED is final and keeps the address for the shop (it did go out)', () => {
    const view = shopOrderView(order({ state: 'NOT_CONFIRMED' }));
    expect(view.final).toBe(true);
    expect(view.addressText).toBe(ADDRESS);
  });

  it('the customer view carries the note and the receive deadline', () => {
    const view = seekerOrderView(
      order({
        state: 'OUT_FOR_DELIVERY',
        note: 'Gate 2',
        receiveBy: new Date('2026-10-18T13:00:00Z'),
      }),
    );
    expect(view).toMatchObject({ note: 'Gate 2', receiveBy: '2026-10-18T13:00:00.000Z' });
  });
});

describe('packed lines (ADR-0055)', () => {
  const lines = [
    { name: 'Sugar', count: 1, pricePaise: 4800, packed: true },
    { name: 'Rice', count: 1, pricePaise: 6000 },
    { name: 'Bolt', count: 1, pricePaise: null, packed: true },
    { name: 'Pen', count: 1, pricePaise: 1000, packed: false },
  ];

  it('the shop sees each flag and "2 of 4 packed"', () => {
    const view = shopOrderView(order({ lines }));
    expect(view.lines.map((l) => l.packed)).toEqual([true, false, true, false]);
    expect(view).toMatchObject({ packedCount: 2, lineCount: 4, unpackedCount: 2 });
  });

  it('the customer sees the same count', () => {
    expect(seekerOrderView(order({ lines })).packedCount).toBe(2);
    expect(seekerOrderView(order()).packedCount).toBe(0);
  });

  it('an order of a list says so', () => {
    expect(seekerOrderView(order({ listId: 'l1', requestId: null })).listId).toBe('l1');
  });
});
