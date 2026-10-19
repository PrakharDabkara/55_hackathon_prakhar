import type { Category } from '@kahanmilega/shared';
import type { ShopCancelReason, ShopOrder, ShopOrderVerb } from './orders.js';
import { createPhotoApi, type PhotoApi } from './photoApi.js';
import { createPushApi, type PushApi } from './pushApi.js';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    /** Extra fields the server put in the error, such as a question and options. */
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export interface ShopPing {
  id: string;
  item: { slug: string; nameEn: string; nameHi: string };
  quantity?: { quantity: number; unit: string };
  targetPricePaise?: number;
  distanceBand: string;
  /** The customer's photo of what they want, if they added one. */
  photoId?: string;
  /** The customer wants it delivered (Delivery v2). Their address is not here. */
  wantsDelivery: boolean;
  /** This shop delivers that far; false hides "will deliver". */
  canDeliver: boolean;
  sentAt: string;
  expiresAt: string;
}

/** What a shop offers for delivery: a fee and a time, either may be left out (a fee of 0 is free). */
export interface DeliveryDefaults {
  feePaise?: number;
  minutes?: number;
}

export interface MyShop {
  id: string;
  name: string;
  lat: number;
  lng: number;
  categories: Category[];
  /** False while the shop is closed for the day. */
  open: boolean;
  deliversDefault: boolean;
  defaultFeePaise: number | null;
  defaultMinutes: number | null;
  /** How far the shop delivers, in km; null means no limit. */
  deliveryMaxKm?: number | null;
}

/** "Aaj ki maang": today's numbers and aggregate demand. Never anything about a customer (ADR-0035). */
export interface ShopDemand {
  today: { received: number; answered: number; yes: number };
  /** Asked of this shop today and said no to, or never answered. */
  asked: { item: { nameEn: string; nameHi: string }; count: number }[];
  /** Asked near the shop today by 3 or more different customers. */
  nearby: { item: { nameEn: string; nameHi: string }; customers: number }[];
}

export interface NewShop {
  name: string;
  lat: number;
  lng: number;
  categories: Category[];
  delivery?: DeliveryDefaults;
}

export interface AnswerBody {
  answer: 'yes' | 'no';
  pricePaise?: number;
  quantityHint?: 'few' | 'plenty';
  /** The shop's own photo of the item, only with a yes. */
  photoId?: string;
  /** An exact quantity next to the price, only with a yes. */
  quantity?: { amount: number; unit: 'kg' | 'g' | 'l' | 'ml' | 'piece' | 'packet' };
  /** "Ghar bhej denge", only with a yes: present means the shop delivers. */
  delivery?: DeliveryDefaults;
}

/** Everything the shop app asks of the server. */
export interface ShopApi extends PhotoApi, PushApi {
  requestOtp(phone: string): Promise<void>;
  /** Demo mode: the code the server would have sent by SMS, or null if there is none. */
  devInbox(phone: string): Promise<string | null>;
  verifyOtp(phone: string, code: string): Promise<{ token: string }>;
  /** null when this account has no shop yet. Throws ApiError 403 for a customer account. */
  getMyShop(): Promise<MyShop | null>;
  createShop(input: NewShop): Promise<MyShop>;
  listPings(): Promise<ShopPing[]>;
  answerPing(id: string, body: AnswerBody): Promise<void>;
  /** The shop's delivery orders: open ones, and finished ones from the last two hours. */
  listOrders(): Promise<ShopOrder[]>;
  /** Accepts or declines an order, or sets it out. Only the customer marks it delivered. */
  orderAction(id: string, verb: ShopOrderVerb): Promise<ShopOrder>;
  /** Cancels an ACCEPTED order, with a reason (and up to 140 characters of words). */
  cancelOrder(id: string, input: { reason: ShopCancelReason; text?: string }): Promise<ShopOrder>;
  /** Opens or closes the shop for the day ("Dukaan aaj band hai"). */
  setShopOpen(open: boolean): Promise<MyShop>;
  /** The standing delivery offer, or null to stop offering it. */
  updateDelivery(delivery: DeliveryDefaults | null): Promise<MyShop>;
  /** How far the shop delivers in km, or null for no limit. */
  setDeliveryLimit(maxKm: number | null): Promise<MyShop>;
  /** Today's demand for the shop screen. */
  shopDemand(): Promise<ShopDemand>;
  /** A one-time ticket that opens the live event stream. Never put the login token in a URL. */
  eventTicket(): Promise<string>;
}

/** The pieces every client needs. */
export interface ClientOptions {
  getToken: () => string | null;
  /** Called when the server says the login is no longer valid. */
  onUnauthorized: () => void;
  fetchImpl?: typeof fetch;
}

export type Call = <T>(
  method: string,
  path: string,
  body?: unknown,
  extraHeaders?: Record<string, string>,
) => Promise<T>;

/** JSON over fetch with the bearer token; non-2xx becomes an ApiError. Shared by both apps. */
export function createCaller({ getToken, onUnauthorized, fetchImpl = fetch }: ClientOptions): Call {
  async function call<T>(
    method: string,
    path: string,
    body?: unknown,
    extraHeaders: Record<string, string> = {},
  ): Promise<T> {
    const headers = new Headers(extraHeaders);
    const token = getToken();
    if (token) headers.set('Authorization', `Bearer ${token}`);
    if (body !== undefined) headers.set('Content-Type', 'application/json');

    const res = await fetchImpl(path, {
      method,
      headers,
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });

    if (!res.ok) {
      let code = 'unknown';
      let message = res.statusText || 'Request failed';
      let details: Record<string, unknown> = {};
      try {
        const data = (await res.json()) as { error?: Record<string, unknown> };
        const { code: c, message: m, ...rest } = data.error ?? {};
        code = typeof c === 'string' ? c : code;
        message = typeof m === 'string' ? m : message;
        details = rest;
      } catch {
        // Not JSON (a proxy error page, say): keep the defaults.
      }
      // A wrong OTP is also a 401; only an expired or revoked login should end the session.
      if (res.status === 401 && code === 'unauthorized') onUnauthorized();
      throw new ApiError(res.status, code, message, details);
    }
    return (res.status === 204 ? undefined : await res.json()) as T;
  }
  return call;
}

export function createApi(options: ClientOptions): ShopApi {
  const call = createCaller(options);

  return {
    ...createPhotoApi(options),
    ...createPushApi(options),
    async requestOtp(phone) {
      await call('POST', '/auth/otp/request', { phone });
    },
    async devInbox(phone) {
      try {
        const data = await call<{ code: string }>(
          'GET',
          `/dev/otp-inbox?phone=${encodeURIComponent(phone)}`,
        );
        return data.code;
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return null;
        throw error;
      }
    },
    async verifyOtp(phone, code) {
      const data = await call<{ token: string }>('POST', '/auth/otp/verify', {
        phone,
        code,
        role: 'shop',
      });
      return { token: data.token };
    },
    async getMyShop() {
      try {
        return await call<MyShop>('GET', '/shops/me');
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return null;
        throw error;
      }
    },
    createShop: (input) => call<MyShop>('POST', '/shops', input),
    listPings: () => call<ShopPing[]>('GET', '/shops/me/pings'),
    async eventTicket() {
      return (await call<{ ticket: string }>('POST', '/events/ticket')).ticket;
    },
    shopDemand: () => call<ShopDemand>('GET', '/shops/me/demand'),
    listOrders: () => call<ShopOrder[]>('GET', '/shops/me/orders'),
    orderAction: (id, verb) => call<ShopOrder>('POST', `/orders/${encodeURIComponent(id)}/${verb}`),
    setShopOpen: (open) => call<MyShop>('PUT', '/shops/me/open', { open }),
    updateDelivery: (delivery) => call<MyShop>('PATCH', '/shops/me', { delivery }),
    setDeliveryLimit: (maxKm) => call<MyShop>('PATCH', '/shops/me', { deliveryMaxKm: maxKm }),
    cancelOrder: (id, input) =>
      call<ShopOrder>('POST', `/orders/${encodeURIComponent(id)}/cancel`, input),
    async answerPing(id, body) {
      await call('POST', `/pings/${encodeURIComponent(id)}/answer`, body);
    },
  };
}
