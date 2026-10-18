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
  expiresAt: new Date('2026-10-18T10:10:00Z'),
  createdAt: new Date('2026-10-18T10:00:00Z'),
  updatedAt: new Date('2026-10-18T10:00:00Z'),
  ...over,
});

const SEEN: OrderState[] = ['ACCEPTED', 'OUT_FOR_DELIVERY', 'DELIVERED'];

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

  it('the contact line is the first name if given, else "Grahak"', () => {
    expect(shopOrderView(order({ customerFirstName: 'Asha' })).contactName).toBe('Asha');
    expect(shopOrderView(order({ customerFirstName: null })).contactName).toBe('Grahak');
  });

  it('never carries a phone or a user id, whatever the state', () => {
    for (const state of ORDER_STATES) {
      const json = JSON.stringify(shopOrderView(order({ state })));
      expect(json).not.toMatch(/\+91|phone|userId|u1/);
    }
  });
});

describe('what the customer sees of an order', () => {
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
