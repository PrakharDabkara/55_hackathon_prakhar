import { createCaller, type ClientOptions } from './api.js';
import type { SeekerOrder } from './orders.js';

export type ListState = 'DRAFT' | 'OPEN' | 'FULL' | 'ORDERED' | 'STOPPED' | 'EXPIRED';

/** One line of a list as the customer sees it (ADR-0055). */
export interface LineView {
  position: number;
  /** The customer's own words, cleaned. */
  text: string;
  status: 'item' | 'ambiguous' | 'other' | 'refused';
  item?: { id: string; nameEn: string; nameHi: string; category: string };
  /** The everyday word the text matched ("Chini"), when it differs from the item's name. */
  displayName?: string;
  quantity?: { quantity: number; unit: string };
  /** An ambiguous line: the server's question and up to 3 options ("as I typed" is always also allowed). */
  question?: string;
  options?: { itemId: string; nameEn: string; nameHi: string }[];
  asTyped?: true;
  reason?: 'blocked' | 'unclear';
  /** How many shops this line was sent to. */
  asked: number;
}

export interface AnswerView {
  shopId: string;
  name: string;
  logoUrl: string | null;
  distanceM: number;
  lat: number;
  lng: number;
  haveCount: number;
  totalPaise: number;
  canDeliver: boolean;
  /** One fee for the whole list; null when the shop did not name one. */
  deliveryFeePaise: number | null;
  answeredAt: string;
  lines: { position: number; status: 'have' | 'no' | 'not_sent'; pricePaise?: number }[];
}

export interface PlanView {
  assignments: { position: number; shopId: string; pricePaise: number }[];
  /** In route order from the customer. */
  stops: { shopId: string; name: string; lat: number; lng: number }[];
  totalM: number;
  totalPaise: number;
  /** "Nobody has this yet". */
  missing: number[];
}

export interface ListView {
  id: string;
  state: ListState;
  /** Still collecting answers (OPEN). */
  listening: boolean;
  /** Answers can still be ordered at once (OPEN or FULL). */
  binding: boolean;
  wantsDelivery: boolean;
  /** Where the customer sent it from; null for a draft. */
  lat: number | null;
  lng: number | null;
  maxAnswers: number;
  shopsAsked: number;
  shopsAnswered: number;
  lines: LineView[];
  /** Ranked by the server: more lines first, then nearer, then cheaper. */
  answers: AnswerView[];
  plan: PlanView | null;
  createdAt: string;
  sentAt: string | null;
  expiresAt: string;
}

export interface SendListInput {
  lat: number;
  lng: number;
  radiusM?: number;
  choices?: ({ position: number; itemId: string } | { position: number; asTyped: true })[];
}

export interface OrderListInput {
  assignments: { position: number; shopId: string }[];
  modes: Record<string, 'pickup' | 'delivery'>;
  /** Left out when the saved address is used. */
  addressText?: string;
  customerName?: string;
  note?: string;
  saveAddress?: boolean;
}

export interface OrderListResult {
  list: ListView;
  orders: SeekerOrder[];
  pickups: unknown[];
}

/** The shopping-list half of the customer app (ADR-0055). */
export interface ListApi {
  sortList(lines: string[]): Promise<ListView>;
  sendList(id: string, input: SendListInput): Promise<ListView>;
  getList(id: string): Promise<ListView>;
  stopList(id: string): Promise<ListView>;
  orderList(id: string, input: OrderListInput): Promise<OrderListResult>;
}

export function createListApi(options: ClientOptions): ListApi {
  const call = createCaller(options);
  const id = (value: string) => encodeURIComponent(value);
  return {
    sortList: (lines) => call<ListView>('POST', '/lists/sort', { lines }),
    sendList: (listId, input) => call<ListView>('POST', `/lists/${id(listId)}/send`, input),
    getList: (listId) => call<ListView>('GET', `/lists/${id(listId)}`),
    stopList: (listId) => call<ListView>('POST', `/lists/${id(listId)}/stop`),
    orderList: (listId, input) =>
      call<OrderListResult>('POST', `/lists/${id(listId)}/order`, input),
  };
}
