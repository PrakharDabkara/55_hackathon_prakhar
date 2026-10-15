import { createCaller, type ClientOptions, type ShopApi } from './api.js';

export interface ShopResult {
  shopId: string;
  name: string;
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
  item: { id: string; slug: string; nameEn: string; nameHi: string; category: string } | null;
  radiusM: number;
  targetPricePaise?: number;
  results: ShopResult[];
  pingStats: PingStats;
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
}

/** Everything the customer app asks of the server. */
export interface SeekerApi extends Pick<
  ShopApi,
  'requestOtp' | 'devInbox' | 'verifyOtp' | 'eventTicket'
> {
  createRequest(input: NewRequest): Promise<SeekerRequest>;
  getRequest(id: string): Promise<SeekerRequest>;
  closeRequest(id: string): Promise<SeekerRequest>;
}

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
    async eventTicket() {
      return (await call<{ ticket: string }>('POST', '/events/ticket')).ticket;
    },
    createRequest: (input) =>
      call<SeekerRequest>('POST', '/requests', input, { 'Idempotency-Key': idempotencyKey() }),
    getRequest: (requestId) => call<SeekerRequest>('GET', `/requests/${id(requestId)}`),
    closeRequest: (requestId) => call<SeekerRequest>('POST', `/requests/${id(requestId)}/close`),
  };
}
