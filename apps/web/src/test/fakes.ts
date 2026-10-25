import { vi } from 'vitest';
import type { MyShop, ShopApi, ShopListParchi, ShopPing } from '../lib/api.js';
import type { ListView } from '../lib/listApi.js';
import type { SeekerOrder, ShopOrder } from '../lib/orders.js';
import type { PhotoApi } from '../lib/photoApi.js';
import type { PickupApi } from '../lib/pickupApi.js';
import type { PushApi } from '../lib/pushApi.js';
import type {
  ErrandListItem,
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
  lastPricePaise: null,
  distanceBand: 'under 1 km',
  wantsDelivery: false,
  canDeliver: true,
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
  logoUrl: null,
  ...overrides,
});

/** The photo half of both apps: every call is a spy that succeeds. */
export const fakePhotos = (overrides: Partial<PhotoApi> = {}): PhotoApi => ({
  uploadPhoto: vi.fn(async () => ({ id: 'photo-1' })),
  photoSrc: vi.fn(async () => 'data:image/jpeg;base64,/9j/4AAQ'),
  ...overrides,
});

/** The push half of both apps: server push is switched off unless a test turns it on. */
export const fakePush = (overrides: Partial<PushApi> = {}): PushApi => ({
  pushConfig: vi.fn(async () => ({ enabled: false as const })),
  pushSubscribe: vi.fn(async () => undefined),
  pushUnsubscribe: vi.fn(async () => undefined),
  ...overrides,
});

/** The "Le liya?" half of the customer app: nothing waiting, and every call succeeds. */
export const fakePickups = (overrides: Partial<PickupApi> = {}): PickupApi => ({
  recordPickup: vi.fn(async () => undefined),
  pendingPickups: vi.fn(async () => []),
  answerPickup: vi.fn(async () => undefined),
  ...overrides,
});

/** A ShopApi where every call is a spy that succeeds; override what a test cares about. */
export function fakeApi(overrides: Partial<ShopApi> = {}): ShopApi {
  return {
    requestOtp: vi.fn(async () => undefined),
    devInbox: vi.fn(async () => '123456'),
    verifyOtp: vi.fn(async () => ({ token: 'token-1' })),
    demoNumbers: vi.fn(async () => ({ demo: true, numbers: ['9000000102', '9000000103'] })),
    account: vi.fn(async () => ({ phoneMasked: '+91 90••• ••102' })),
    getMyShop: vi.fn(async () => shop()),
    createShop: vi.fn(async (input) => shop({ ...input })),
    listPings: vi.fn(async () => []),
    answerPing: vi.fn(async () => undefined),
    listParchis: vi.fn(async () => []),
    answerList: vi.fn(async () => undefined),
    packLine: vi.fn(async () => undefined),
    setShopOpen: vi.fn(async (open: boolean) => shop({ open })),
    listOrders: vi.fn(async () => []),
    orderAction: vi.fn(async () => shopOrder()),
    cancelOrder: vi.fn(async () => shopOrder({ state: 'CANCELLED', final: true })),
    eventTicket: vi.fn(async () => 'ticket-1'),
    shopDemand: vi.fn(async (days = 1) => ({
      days,
      today: { received: 0, answered: 0, yes: 0 },
      avgReplySeconds: null,
      asked: [],
      nearby: [],
    })),
    updateShop: vi.fn(async (patch) =>
      shop({
        ...patch,
        ...(patch.delivery !== undefined && {
          deliversDefault: patch.delivery !== null,
          defaultFeePaise: patch.delivery?.feePaise ?? null,
          defaultMinutes: patch.delivery?.minutes ?? null,
        }),
      } as Partial<MyShop>),
    ),
    uploadLogo: vi.fn(async () => '/photos/logo-1'),
    deleteLogo: vi.fn(async () => undefined),
    logoutAll: vi.fn(async () => undefined),
    ...fakePhotos(),
    ...fakePush(),
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

/** The smallest list the fake API can return; tests that read a list pass their own. */
const listStub = (id: string, state: ListView['state']): ListView => ({
  id,
  state,
  listening: state === 'OPEN',
  binding: state === 'OPEN' || state === 'FULL',
  wantsDelivery: false,
  maxAnswers: 8,
  shopsAsked: 0,
  shopsAnswered: 0,
  lat: null,
  lng: null,
  lines: [],
  answers: [],
  plan: null,
  createdAt: '2026-10-21T10:00:00.000Z',
  sentAt: null,
  expiresAt: '2026-10-21T10:15:00.000Z',
});

/** A SeekerApi where every call is a spy that succeeds; override what a test cares about. */
export function fakeSeekerApi(overrides: Partial<SeekerApi> = {}): SeekerApi {
  return {
    requestOtp: vi.fn(async () => undefined),
    devInbox: vi.fn(async () => '123456'),
    verifyOtp: vi.fn(async () => ({ token: 'seeker-token' })),
    demoNumbers: vi.fn(async () => ({ demo: true, numbers: ['9000000202', '9000000203'] })),
    createRequest: vi.fn(async () => seekerRequest()),
    getRequest: vi.fn(async () => seekerRequest()),
    closeRequest: vi.fn(async () => seekerRequest({ state: 'CLOSED' })),
    askShopsNow: vi.fn(async () => seekerRequest({ state: 'PINGING', asking: true })),
    activeSearches: vi.fn(async () => ({ limit: 3, searches: [] })),
    eventTicket: vi.fn(async () => 'ticket-1'),
    createErrand: vi.fn(async () => ({ id: 'errand-1', state: 'PLANNING' as const })),
    getErrand: vi.fn(async () => errandView()),
    answerErrand: vi.fn(async () => errandView()),
    cancelErrand: vi.fn(async () => errandView({ state: 'CANCELLED' })),
    setDeliveryMode: vi.fn(async () => errandView()),
    placeOrder: vi.fn(async () => seekerOrder()),
    listOrders: vi.fn(async () => []),
    myOrders: vi.fn(async () => []),
    myErrands: vi.fn(async () => []),
    getOrder: vi.fn(async () => seekerOrder()),
    cancelOrder: vi.fn(async () => seekerOrder({ state: 'CANCELLED' })),
    savedAddress: vi.fn(async () => ({ id: null, addressText: null, customerName: null })),
    keepAddress: vi.fn(async () => ({ id: 'addr-1', addressText: 'x', customerName: null })),
    receiveOrder: vi.fn(async () => seekerOrder({ state: 'DELIVERED' })),
    forgetAddress: vi.fn(async () => undefined),
    account: vi.fn(async () => ({ phoneMasked: '+91 98••• ••210' })),
    logout: vi.fn(async () => undefined),
    logoutAll: vi.fn(async () => undefined),
    deleteAccount: vi.fn(async () => undefined),
    recentWork: vi.fn(async () => []),
    collectOrder: vi.fn(async () => seekerOrder({ state: 'COLLECTED', fulfilment: 'pickup' })),
    sortList: vi.fn(async () => listStub('list-1', 'DRAFT')),
    sendList: vi.fn(async () => listStub('list-1', 'OPEN')),
    getList: vi.fn(async () => listStub('list-1', 'OPEN')),
    stopList: vi.fn(async () => listStub('list-1', 'STOPPED')),
    orderList: vi.fn(async () => ({
      list: listStub('list-1', 'ORDERED'),
      orders: [],
      pickups: [],
    })),
    ...fakePhotos(),
    ...fakePush(),
    ...fakePickups(),
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

/** A delivery order as the customer sees it (ADR-0031). */
export const seekerOrder = (overrides: Partial<SeekerOrder> = {}): SeekerOrder => ({
  id: 'order-1',
  state: 'REQUESTED',
  fulfilment: 'delivery',
  shopLocation: { lat: 22.72, lng: 75.86 },
  shopId: 's1',
  shopName: 'Mishra Kirana',
  requestId: 'req-1',
  errandId: null,
  listId: null,
  packedCount: 0,
  lines: [{ name: 'sugar', count: 2, pricePaise: 4500 }],
  itemsTotalPaise: 9000,
  unknownPriceCount: 0,
  feePaise: 3000,
  feeMinutes: 45,
  addressText: 'Flat 4B, Sapna Apartments, Vijay Nagar',
  customerName: null,
  payment: 'cash_on_delivery',
  pickupFallback: false,
  note: null,
  receiveBy: null,
  cancelledBy: null,
  cancelReason: null,
  cancelText: null,
  expiresAt: '2026-10-16T10:10:00.000Z',
  createdAt: '2026-10-16T10:00:00.000Z',
  updatedAt: '2026-10-16T10:00:00.000Z',
  ...overrides,
});

/** A delivery order as its shop sees it: no address until it has accepted. */
export const shopOrder = (overrides: Partial<ShopOrder> = {}): ShopOrder => {
  const lines = overrides.lines ?? [{ name: 'sugar', count: 2, pricePaise: 4500 }];
  const packed = lines.filter((line) => line.packed === true).length;
  return {
    id: 'order-1',
    state: 'REQUESTED',
    fulfilment: 'delivery',
    lines,
    lineCount: lines.length,
    packedCount: packed,
    unpackedCount: lines.length - packed,
    itemsTotalPaise: 9000,
    unknownPriceCount: 0,
    feePaise: 3000,
    contactName: 'Grahak',
    final: false,
    note: null,
    cancelReason: null,
    expiresAt: '2026-10-16T10:10:00.000Z',
    createdAt: '2026-10-16T10:00:00.000Z',
    updatedAt: '2026-10-16T10:00:00.000Z',
    ...overrides,
  };
};

/** A list parchi as its shop sees it: two category lines (sugar, ball pen) and one "other" line. */
export const shopListParchi = (overrides: Partial<ShopListParchi> = {}): ShopListParchi => ({
  id: 'lp-1',
  distanceBand: 'under 1 km',
  wantsDelivery: false,
  canDeliver: true,
  sentAt: '2026-10-16T10:00:00.000Z',
  expiresAt: '2026-10-16T10:15:00.000Z',
  lines: [
    { lineId: 'l1', name: 'Sugar', displayName: 'Chini', other: false, lastPricePaise: 4500 },
    { lineId: 'l2', name: 'Ball pen', other: false, lastPricePaise: null },
    { lineId: 'l3', name: 'Tractor bolt', other: true, lastPricePaise: null },
  ],
  ...overrides,
});

/** One row of GET /errands. */
export const errandListItem = (overrides: Partial<ErrandListItem> = {}): ErrandListItem => ({
  id: 'errand-1',
  state: 'WAITING_FOR_SHOPS',
  task: 'school things for Riya',
  createdAt: '2026-10-16T10:00:00.000Z',
  expiresAt: '2099-10-16T10:15:00.000Z',
  ...overrides,
});

/** The item at `index`, or a clear failure: tests index into arrays without `!`. */
export function at<T>(list: readonly T[], index: number): T {
  const item = list[index];
  if (item === undefined) throw new Error(`no item at ${index}`);
  return item;
}
