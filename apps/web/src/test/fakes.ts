import { vi } from 'vitest';
import type { MyShop, ShopApi, ShopPing } from '../lib/api.js';
import type { PhotoApi } from '../lib/photoApi.js';
import type {
  ErrandPlan,
  ErrandView,
  PlanItem,
  PlanVariant,
  SeekerApi,
  SeekerRequest,
  ShopResult,
} from '../lib/seekerApi.js';

export const ping = (overrides: Partial<ShopPing> = {}): ShopPing => ({
  id: 'ping-1',
  item: { slug: 'wheat-flour', nameEn: 'wheat flour', nameHi: 'आटा' },
  distanceBand: 'under 1 km',
  sentAt: '2026-10-16T10:00:00.000Z',
  expiresAt: '2026-10-16T10:15:00.000Z',
  ...overrides,
});

export const shop = (overrides: Partial<MyShop> = {}): MyShop => ({
  open: true,
  deliversDefault: false,
  defaultFeePaise: null,
  defaultMinutes: null,
  id: 'shop-1',
  name: 'Sharma Kirana',
  lat: 22.7196,
  lng: 75.8577,
  categories: ['grocery'],
  ...overrides,
});

/** The photo half of both apps: every call is a spy that succeeds. */
export const fakePhotos = (overrides: Partial<PhotoApi> = {}): PhotoApi => ({
  uploadPhoto: vi.fn(async () => ({ id: 'photo-1' })),
  photoSrc: vi.fn(async () => 'data:image/jpeg;base64,/9j/4AAQ'),
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
    setShopOpen: vi.fn(async (open: boolean) => shop({ open })),
    updateDelivery: vi.fn(async (delivery) =>
      shop({
        deliversDefault: delivery !== null,
        defaultFeePaise: delivery?.feePaise ?? null,
        defaultMinutes: delivery?.minutes ?? null,
      }),
    ),
    eventTicket: vi.fn(async () => 'ticket-1'),
    ...fakePhotos(),
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

export const result = (overrides: Partial<ShopResult> = {}): ShopResult => ({
  shopId: 'shop-1',
  name: 'Sharma Kirana',
  distanceM: 350,
  lat: 22.72,
  lng: 75.86,
  pricePaise: 5500,
  quantityHint: null,
  lastConfirmedAt: '2026-10-16T10:00:00.000Z',
  freshness: 'Confirmed just now',
  source: 'live',
  ...overrides,
});

export const seekerRequest = (overrides: Partial<SeekerRequest> = {}): SeekerRequest => ({
  id: 'req-1',
  state: 'PINGING',
  item: {
    id: 'i1',
    slug: 'sugar',
    nameEn: 'sugar',
    nameHi: 'चीनी',
    category: 'grocery',
    unverified: false,
  },
  radiusM: 2000,
  results: [],
  pingStats: { sent: 0, yes: 0, no: 0, pending: 0 },
  expiresAt: '2026-10-16T10:15:00.000Z',
  createdAt: '2026-10-16T10:00:00.000Z',
  ...overrides,
});

/** A SeekerApi where every call is a spy that succeeds; override what a test cares about. */
export function fakeSeekerApi(overrides: Partial<SeekerApi> = {}): SeekerApi {
  return {
    requestOtp: vi.fn(async () => undefined),
    devInbox: vi.fn(async () => '123456'),
    verifyOtp: vi.fn(async () => ({ token: 'seeker-token' })),
    createRequest: vi.fn(async () => seekerRequest()),
    getRequest: vi.fn(async () => seekerRequest()),
    closeRequest: vi.fn(async () => seekerRequest({ state: 'CLOSED' })),
    eventTicket: vi.fn(async () => 'ticket-1'),
    createErrand: vi.fn(async () => ({ id: 'errand-1', state: 'PLANNING' as const })),
    getErrand: vi.fn(async () => errandView()),
    answerErrand: vi.fn(async () => errandView()),
    cancelErrand: vi.fn(async () => errandView({ state: 'CANCELLED' })),
    setDeliveryMode: vi.fn(async () => errandView()),
    ...fakePhotos(),
    ...overrides,
  };
}

export const planItem = (overrides: Partial<PlanItem> = {}): PlanItem => ({
  text: 'chini',
  itemId: 'i-sugar',
  itemName: 'sugar',
  quantity: 1,
  status: 'confirmed',
  shopId: 's1',
  shopName: 'Mishra Kirana',
  distanceM: 400,
  pricePaise: 5100,
  referencePricePaise: 6000,
  freshness: 'Confirmed 2 min ago',
  downgraded: null,
  matchedAs: false,
  isNew: false,
  refused: null,
  ...overrides,
});

const stop = (n: number) => ({
  shopId: `s${n}`,
  label: n === 1 ? 'Mishra Kirana' : 'Gupta Store',
  lat: Number((22.72 + n / 1000).toFixed(3)),
  lng: 75.86,
});

/** Both plans of the chai errand: sasta uses 2 shops, kam_dukaan 1 (₹25 more). */
export function errandPlan(overrides: Partial<ErrandPlan> = {}): ErrandPlan {
  const kam: PlanVariant = {
    kind: 'kam_dukaan',
    items: [
      planItem({ text: 'chai patti', itemName: 'tea leaves', pricePaise: 9900 }),
      planItem({ text: 'chini', itemName: 'sugar', pricePaise: 5100 }),
    ],
    route: { orderedStops: [stop(1)], legsM: [400], totalM: 400 },
    totalPricePaise: 15000,
    totalDistanceM: 400,
    shopCount: 1,
    savingsPaise: 2400,
  };
  const sasta: PlanVariant = {
    kind: 'sasta',
    items: [
      planItem({ text: 'chai patti', itemName: 'tea leaves', pricePaise: 9900 }),
      planItem({
        text: 'chini',
        itemName: 'sugar',
        pricePaise: 3800,
        status: 'likely',
        shopId: 's2',
        shopName: 'Gupta Store',
        freshness: '2 days ago',
      }),
    ],
    route: { orderedStops: [stop(1), stop(2)], legsM: [400, 900], totalM: 1300 },
    totalPricePaise: 12500,
    totalDistanceM: 1300,
    shopCount: 2,
    savingsPaise: 4900,
  };
  return {
    items: kam.items,
    route: kam.route,
    totalPricePaise: kam.totalPricePaise,
    savingsPaise: kam.savingsPaise,
    plans: { sasta, kam_dukaan: kam },
    recommended: 'kam_dukaan',
    recommendation: { extraPaise: 2500, stopsSaved: 1, reason: 'fewer_stops_within_limit' },
    ...overrides,
  };
}

export const errandView = (overrides: Partial<ErrandView> = {}): ErrandView => ({
  id: 'errand-1',
  state: 'PLANNING',
  task: 'chai banane ka saaman',
  budgetPaise: null,
  lat: 22.7196,
  lng: 75.8577,
  progress: [],
  lateAnswers: [],
  plan: null,
  failureReason: null,
  usage: { steps: 0, tokensIn: 0, tokensOut: 0 },
  question: null,
  expiresAt: '2026-10-16T10:15:00.000Z',
  createdAt: '2026-10-16T10:00:00.000Z',
  updatedAt: '2026-10-16T10:00:05.000Z',
  ...overrides,
});
