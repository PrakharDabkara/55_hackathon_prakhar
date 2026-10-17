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
  downgraded: string | null;
  /** True when the item is not what the customer's words would lead them to expect. */
  matchedAs: boolean;
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
}

export interface ErrandPlan {
  items: PlanItem[];
  notes: string | null;
  route: PlanRoute | null;
  totalPricePaise: number;
  savingsPaise: number;
  plans: Record<PlanKind, PlanVariant>;
  recommended: PlanKind;
  recommendation: {
    extraPaise: number;
    stopsSaved: number;
    reason: 'no_stops_saved' | 'fewer_stops_within_limit' | 'fewer_stops_too_dear';
  };
}

export interface ErrandView {
  id: string;
  state: ErrandState;
  task: string;
  budgetPaise: number | null;
  /** Short Hinglish lines, built by the server from the step log. */
  progress: string[];
  /** Shops that said yes after the plan was ready. */
  lateAnswers: string[];
  /** A finished plan, or (for a failed or expired errand) what was found so far. */
  plan: ErrandPlan | null;
  failureReason: string | null;
  usage: { steps: number; tokensIn: number; tokensOut: number };
  question: { question: string; options?: string[] } | null;
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
export interface SeekerApi extends Pick<
  ShopApi,
  'requestOtp' | 'devInbox' | 'verifyOtp' | 'eventTicket'
> {
  createRequest(input: NewRequest): Promise<SeekerRequest>;
  getRequest(id: string): Promise<SeekerRequest>;
  closeRequest(id: string): Promise<SeekerRequest>;
  createErrand(input: NewErrand): Promise<{ id: string; state: ErrandState }>;
  getErrand(id: string): Promise<ErrandView>;
  answerErrand(id: string, answer: { text: string } | { optionIndex: number }): Promise<ErrandView>;
  cancelErrand(id: string): Promise<ErrandView>;
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
    createErrand: (input) => call<{ id: string; state: ErrandState }>('POST', '/errands', input),
    getErrand: (errandId) => call<ErrandView>('GET', `/errands/${id(errandId)}`),
    answerErrand: (errandId, answer) =>
      call<ErrandView>('POST', `/errands/${id(errandId)}/answer`, answer),
    cancelErrand: (errandId) => call<ErrandView>('POST', `/errands/${id(errandId)}/cancel`),
  };
}
