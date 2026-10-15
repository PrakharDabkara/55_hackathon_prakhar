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
    eventTicket: vi.fn(async () => 'ticket-1'),
    ...overrides,
  };
}

/** An EventSource the test drives by hand. */
export class FakeEventSource {
  static instances: FakeEventSource[] = [];
  static reset() {
    FakeEventSource.instances = [];
  }
  static last(): FakeEventSource {
    return FakeEventSource.instances[FakeEventSource.instances.length - 1] as FakeEventSource;
  }

  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  private listeners = new Map<string, ((event: { data: string }) => void)[]>();

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: (event: { data: string }) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  close() {
    this.closed = true;
  }

  open() {
    (this.onopen as (() => void) | null)?.();
  }

  fail() {
    (this.onerror as (() => void) | null)?.();
  }

  emit(type: string, data: unknown = {}) {
    for (const l of this.listeners.get(type) ?? []) l({ data: JSON.stringify(data) });
  }
}
