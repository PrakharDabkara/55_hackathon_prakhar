import { vi } from 'vitest';
import type { MyShop, ShopApi, ShopPing } from '../lib/api.js';

export const ping = (overrides: Partial<ShopPing> = {}): ShopPing => ({
  id: 'ping-1',
  item: { slug: 'wheat-flour', nameEn: 'wheat flour', nameHi: 'आटा' },
  distanceBand: 'under 1 km',
  sentAt: '2026-10-16T10:00:00.000Z',
  expiresAt: '2026-10-16T10:15:00.000Z',
  ...overrides,
});

export const shop = (overrides: Partial<MyShop> = {}): MyShop => ({
  id: 'shop-1',
  name: 'Sharma Kirana',
  lat: 22.7196,
  lng: 75.8577,
  categories: ['grocery'],
  ...overrides,
});

/** A ShopApi where every call is a spy that succeeds; override what a test cares about. */
export function fakeApi(overrides: Partial<ShopApi> = {}): ShopApi {
  return {
    requestOtp: vi.fn(async () => undefined),
    devInbox: vi.fn(async () => '123456'),
    verifyOtp: vi.fn(async () => ({ token: 'token-1' })),
    getMyShop: vi.fn(async () => shop()),
    createShop: vi.fn(async (input) => shop({ ...input })),
    listPings: vi.fn(async () => []),
    answerPing: vi.fn(async () => undefined),
    ...overrides,
  };
}
