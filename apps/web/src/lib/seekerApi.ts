import type { QuantityUnit } from '@askbuy/shared';
import { createCaller, type ClientOptions, type DemoNumbers, type ShopApi } from './api.js';
import { createListApi, type ListApi } from './listApi.js';
import type { NewOrder, OrderSource, SeekerOrder } from './orders.js';
import { createPhotoApi, type PhotoApi } from './photoApi.js';
import { createPickupApi, type PickupApi } from './pickupApi.js';
import { createPushApi, type PushApi } from './pushApi.js';

export interface ShopResult {
  shopId: string;
  name: string;
  /** The shop's published logo (a /photos path), or null: show initials. */
  logoUrl?: string | null;
  distanceM: number;
  lat: number;
  lng: number;
  pricePaise: number | null;
  quantityHint: 'few' | 'plenty' | null;
  lastConfirmedAt: string;
  /** Written by the server in English, e.g. "Confirmed 5 min ago" or "Had it yesterday". */
  freshness: string;
  /** `live`: said yes to this request. `learned`: remembered from an earlier yes. */
  source: 'live' | 'learned';
  savingsPaise?: number;
  /** The shop's photo of the item, if it added one with its yes. */
  photoId?: string;
  /** What the shop has: said now (live) or last time (learned: remembered, never a promise). */
  quantity?: { amount: number; unit: QuantityUnit };
  /** Is it enough for what the customer typed? Live answers only. */
  quantityCheck?: 'enough' | 'short' | 'unknown';
  /** "Ghar bhej denge": a fee (0 is free, null not told) and a time. */
  delivery?: { feePaise: number | null; minutes: number | null };
  /** A customer went there and found it. Learned answers only (ADR-0035). */
  customerVerified?: true;
}

export interface SavedAddress {
  id: string | null;
  addressText: string | null;
  customerName: string | null;
}

export interface PingStats {
  sent: number;
  yes: number;
  no: number;
  pending: number;
}

export interface SeekerRequest {
  id: string;
  state: 'OPEN' | 'PINGING' | 'ANSWERED' | 'EXPIRED' | 'CLOSED';
  item: {
    id: string;
    slug: string;
    nameEn: string;
    nameHi: string;
    category: string;
    /** A customer-made item that no shop has confirmed yet (ADR-0028). */
    unverified: boolean;
  } | null;
  radiusM: number;
  /** The customer's own words, as typed (ADR-0047). */
  typed?: string;
  /** The everyday catalog word those words matched ("Maida"), when it is not the item's own name. */
  displayName?: string;
  /** What the customer typed after the item ("2 kg"); the server's parse, unit as the query wrote it. */
  quantity?: { quantity: number; unit: string };
  targetPricePaise?: number;
  results: ShopResult[];
  pingStats: PingStats;
  /** The customer ticked "Deliver to me" on Find. */
  wantsDelivery?: boolean;
  expiresAt: string;
  createdAt: string;
}

export interface NewRequest {
  q: string;
  lat: number;
  lng: number;
  targetPricePaise?: number;
  /** The item the customer picked after a question: skips matching the text. */
  itemId?: string;
  /** What they did with "Kya aapka matlab…?": said yes, or changed it. Counted by the server. */
  understanding?: 'confirmed' | 'changed';
  /** A photo of what is wanted, uploaded first with POST /photos (optional). */
  photoId?: string;
  /** "Search for exactly what I typed": the customer's words become the item (ADR-0045). */
  asTyped?: true;
  /** "Deliver to me": with the id of one of the customer's saved addresses. */
  wantsDelivery?: true;
  deliveryAddressId?: string;
}

/** One row of the customer's errand list: just enough to find the way back. */
export interface ErrandListItem {
  id: string;
  state: ErrandState;
  task: string;
  createdAt: string;
  expiresAt: string;
}

export type ErrandState =
  | 'PLANNING'
  | 'WAITING_FOR_SHOPS'
  | 'NEEDS_INPUT'
  | 'PLAN_READY'
  | 'FAILED'
  | 'EXPIRED'
  | 'CANCELLED';

export type PlanKind = 'sasta' | 'kam_dukaan';

/** One thing the customer wants, as the plan shows it (ADR-0025). */
export interface PlanItem {
  /** The customer's own words. */
  text: string;
  itemId: string | null;
  /** The catalog item that was actually resolved and confirmed. */
  itemName: string | null;
  quantity: number;
  status: 'confirmed' | 'likely' | 'not_found';
  shopId: string | null;
  shopName: string | null;
  distanceM: number | null;
  pricePaise: number | null;
  referencePricePaise: number | null;
  /** Written by the server in English: "Confirmed 2 min ago". */
  freshness: string | null;
  /** The shop's photo of the item with its yes (GET /photos/:id). */
  photoId?: string | null;
  /** The delivery the shop offered, with its yes or last time. */
  delivery?: { feePaise: number | null; minutes: number | null } | null;
  offeredQuantity?: { amount: number; unit: QuantityUnit } | null;
  /** "Thoda hai" or "Bahut hai", from the shop's earlier answer. */
  quantityHint?: 'few' | 'plenty' | null;
  quantityCheck?: 'enough' | 'short' | 'unknown' | null;
  /** A customer went to this shop and found the item ("Grahak ne confirm kiya"). */
  customerVerified?: true;
  /** The customer's choice for this item's shop. */
  mode?: 'pickup' | 'delivery';
  downgraded: string | null;
  /** True when the item is not what the customer's words would lead them to expect. */
  matchedAs: boolean;
  /** A customer-made item no shop has confirmed yet. */
  isNew: boolean;
  /** Why the item was never sent to shops, if it was not (ADR-0029). */
  refused: 'blocked' | 'unavailable' | 'limit' | null;
}

export interface PlanRoute {
  orderedStops: { shopId: string; label: string; lat: number; lng: number }[];
  legsM: number[];
  totalM: number;
}

export interface PlanVariant {
  kind: PlanKind;
  items: PlanItem[];
  route: PlanRoute | null;
  totalPricePaise: number;
  totalDistanceM: number;
  shopCount: number;
  savingsPaise: number;
  /** Items whose shop gave no price: left out of the total, never ₹0. */
  unknownPriceCount?: number;
  /** Fees of the shops the customer chose delivery from (once per shop). */
  deliveryFeePaise?: number;
  /** Shops that deliver without saying what it costs. */
  unknownFeeCount?: number;
  deliveryShopCount?: number;
  /** Items plus the known fees: what the customer will pay. */
  grandTotalPaise?: number;
}

export interface ErrandPlan {
  items: PlanItem[];
  route: PlanRoute | null;
  totalPricePaise: number;
  savingsPaise: number;
  plans: Record<PlanKind, PlanVariant>;
  recommended: PlanKind;
  /** The customer's pickup or delivery choice per shop (a shop not listed is pickup). */
  modes?: Record<string, 'pickup' | 'delivery'>;
  recommendation: {
    extraPaise: number;
    stopsSaved: number;
    reason: 'no_stops_saved' | 'fewer_stops_within_limit' | 'fewer_stops_too_dear';
  };
}

/** What the agent asks. With `multiSelect` the options are ticked, `preselected` ones from the start. */
export interface ErrandQuestion {
  question: string;
  options?: string[];
  multiSelect?: boolean;
  preselected?: number[];
}

export type ErrandAnswer =
  { text: string } | { optionIndex: number } | { selected: number[]; text?: string };

export interface ErrandView {
  id: string;
  state: ErrandState;
  task: string;
  budgetPaise: number | null;
  /** Where the customer asked from: the map's origin, and the place of a restart. */
  lat: number;
  lng: number;
  /** Short Hinglish lines, built by the server from the step log. */
  progress: string[];
  /** Shops that said yes after the plan was ready. */
  lateAnswers: string[];
  /** A finished plan, or (for a failed or expired errand) what was found so far. */
  plan: ErrandPlan | null;
  failureReason: string | null;
  usage: { steps: number; tokensIn: number; tokensOut: number };
  question: ErrandQuestion | null;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface NewErrand {
  task: string;
  lat: number;
  lng: number;
  budgetPaise?: number;
}

/** Everything the customer app asks of the server. */
export interface SeekerApi
  extends
    Pick<ShopApi, 'requestOtp' | 'devInbox' | 'verifyOtp' | 'demoNumbers' | 'eventTicket'>,
    PhotoApi,
    PickupApi,
    PushApi,
    ListApi {
  createRequest(input: NewRequest): Promise<SeekerRequest>;
  getRequest(id: string): Promise<SeekerRequest>;
  closeRequest(id: string): Promise<SeekerRequest>;
  createErrand(input: NewErrand): Promise<{ id: string; state: ErrandState }>;
  getErrand(id: string): Promise<ErrandView>;
  answerErrand(id: string, answer: ErrandAnswer): Promise<ErrandView>;
  cancelErrand(id: string): Promise<ErrandView>;
  /** Pickup or delivery for one shop of the finished plan. */
  setDeliveryMode(id: string, shopId: string, mode: 'pickup' | 'delivery'): Promise<ErrandView>;
  /** Asks a shop to bring what it said yes to (cash on delivery). The address is typed text. */
  placeOrder(input: NewOrder): Promise<SeekerOrder>;
  /** The customer's orders for one request or errand, newest first. */
  listOrders(source: OrderSource): Promise<SeekerOrder[]>;
  /** Cancels while the shop has not set out; the reason is optional free text (≤140). */
  cancelOrder(id: string, text?: string): Promise<SeekerOrder>;
  /** Every order of the customer (Mere orders). */
  myOrders(): Promise<SeekerOrder[]>;
  /** The customer's own last 20 errands, newest first. */
  myErrands(): Promise<ErrandListItem[]>;
  getOrder(id: string): Promise<SeekerOrder>;
  /** The address the customer chose to keep ("Is pate ko yaad rakhein"), if any. */
  savedAddress(): Promise<SavedAddress>;
  /** Keeps the customer's address (one per customer) so Find can point a request at it. */
  keepAddress(input: { addressText: string; customerName?: string }): Promise<SavedAddress>;
  /** The customer confirms the delivery arrived. */
  receiveOrder(id: string): Promise<SeekerOrder>;
  /** The customer picked up a READY pickup order ("Got it"). */
  collectOrder(id: string): Promise<SeekerOrder>;
  forgetAddress(): Promise<void>;
  /** Who the customer is, as the Account screen may show it: the phone partly hidden. */
  account(): Promise<{ phoneMasked: string | null }>;
  /** Ends this login on the server, and forgets this browser's alerts if its endpoint is given. */
  logout(pushEndpoint?: string | null): Promise<void>;
  /** Ends every login of this account, forgets all alerts and closes live streams (ADR-0060). */
  logoutAll(): Promise<void>;
  /** Soft delete (ADR-0054). 409 while an order or request is open. */
  deleteAccount(): Promise<void>;
  /** The last 10 searches and errands, newest first ("Haal ke kaam"). */
  recentWork(): Promise<RecentItem[]>;
}

/** One line of "Haal ke kaam": a single search or a whole errand. */
export interface RecentItem {
  kind: 'search' | 'errand';
  id: string;
  /** The customer's own words. */
  label: string;
  state: string;
  createdAt: string;
}

const RECENT_COUNT = 10;

/** A key that is new for each search, so a double tap cannot start two requests. */
function idempotencyKey(): string {
  return (
    globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}

export function createSeekerApi(options: ClientOptions): SeekerApi {
  const call = createCaller(options);
  const id = (value: string) => encodeURIComponent(value);

  return {
    ...createPhotoApi(options),
    ...createPushApi(options),
    ...createPickupApi(options),
    ...createListApi(options),
    async requestOtp(phone) {
      await call('POST', '/auth/otp/request', { phone });
    },
    async devInbox(phone) {
      try {
        return (
          await call<{ code: string }>('GET', `/dev/otp-inbox?phone=${encodeURIComponent(phone)}`)
        ).code;
      } catch (error) {
        if (error instanceof Error && 'status' in error && error.status === 404) return null;
        throw error;
      }
    },
    async verifyOtp(phone, code) {
      const data = await call<{ token: string }>('POST', '/auth/otp/verify', {
        phone,
        code,
        role: 'seeker',
      });
      return { token: data.token };
    },
    demoNumbers: () => call<DemoNumbers>('GET', '/auth/demo-numbers?role=seeker'),
    async eventTicket() {
      return (await call<{ ticket: string }>('POST', '/events/ticket')).ticket;
    },
    createRequest: (input) =>
      call<SeekerRequest>('POST', '/requests', input, { 'Idempotency-Key': idempotencyKey() }),
    getRequest: (requestId) => call<SeekerRequest>('GET', `/requests/${id(requestId)}`),
    closeRequest: (requestId) => call<SeekerRequest>('POST', `/requests/${id(requestId)}/close`),
    createErrand: (input) => call<{ id: string; state: ErrandState }>('POST', '/errands', input),
    getErrand: (errandId) => call<ErrandView>('GET', `/errands/${id(errandId)}`),
    answerErrand: (errandId, answer) =>
      call<ErrandView>('POST', `/errands/${id(errandId)}/answer`, answer),
    cancelErrand: (errandId) => call<ErrandView>('POST', `/errands/${id(errandId)}/cancel`),
    setDeliveryMode: (errandId, shopId, mode) =>
      call<ErrandView>('POST', `/errands/${id(errandId)}/modes`, { shopId, mode }),
    placeOrder: (input) => call<SeekerOrder>('POST', '/orders', input),
    listOrders: (source) =>
      call<SeekerOrder[]>(
        'GET',
        'requestId' in source
          ? `/orders?requestId=${id(source.requestId)}`
          : 'listId' in source
            ? `/orders?listId=${id(source.listId)}`
            : `/orders?errandId=${id(source.errandId)}`,
      ),
    cancelOrder: (orderId, text) =>
      call<SeekerOrder>('POST', `/orders/${id(orderId)}/cancel`, text ? { text } : undefined),
    myOrders: () => call<SeekerOrder[]>('GET', '/orders'),
    myErrands: () => call<ErrandListItem[]>('GET', '/errands'),
    getOrder: (orderId) => call<SeekerOrder>('GET', `/orders/${id(orderId)}`),
    forgetAddress: async () => {
      await call('DELETE', '/orders/saved-address');
    },
    async recentWork() {
      // Two lists; if one fails the other still shows.
      const [searches, errands] = await Promise.all([
        call<{ id: string; state: string; query: string; createdAt: string }[]>(
          'GET',
          '/requests',
        ).catch(() => []),
        call<{ id: string; state: string; task: string; createdAt: string }[]>(
          'GET',
          '/errands',
        ).catch(() => []),
      ]);
      return [
        ...searches.map((s): RecentItem => ({
          kind: 'search',
          id: s.id,
          label: s.query,
          state: s.state,
          createdAt: s.createdAt,
        })),
        ...errands.map((e): RecentItem => ({
          kind: 'errand',
          id: e.id,
          label: e.task,
          state: e.state,
          createdAt: e.createdAt,
        })),
      ]
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, RECENT_COUNT);
    },
    account: () => call<{ phoneMasked: string | null }>('GET', '/account'),
    async logout(pushEndpoint) {
      await call('POST', '/account/logout', pushEndpoint ? { pushEndpoint } : {});
    },
    async logoutAll() {
      await call('POST', '/account/logout-all', {});
    },
    async deleteAccount() {
      await call('DELETE', '/account');
    },
    savedAddress: () => call<SavedAddress>('GET', '/orders/saved-address'),
    keepAddress: (input) => call<SavedAddress>('PUT', '/orders/saved-address', input),
    receiveOrder: (orderId) => call<SeekerOrder>('POST', `/orders/${id(orderId)}/received`),
    collectOrder: (orderId) => call<SeekerOrder>('POST', `/orders/${id(orderId)}/collected`),
  };
}
