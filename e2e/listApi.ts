import { PORT } from './playwright.config.js';
import { newPhone } from './orderFlow.js';

// The customer's side of a shopping list (ADR-0055), through the public API: the browser under
// test is the SHOP's. Nothing here touches the database. A customer logs in once with a fresh
// phone (the demo code is read from the dev inbox), sorts and sends a list, and orders from it.
const BASE = `http://localhost:${PORT}`;

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface Customer {
  token: string;
  call: (method: string, path: string, body?: unknown) => Promise<{ status: number; body: Json }>;
}

export async function customerApi(): Promise<Customer> {
  const phone = newPhone();
  const raw = async (method: string, path: string, body?: unknown, token?: string) => {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        ...(body !== undefined && { 'Content-Type': 'application/json' }),
        ...(token && { Authorization: `Bearer ${token}` }),
      },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
    const text = await res.text();
    return { status: res.status, body: (text ? JSON.parse(text) : {}) as Json };
  };
  await raw('POST', '/auth/otp/request', { phone });
  const { body: inbox } = await raw('GET', `/dev/otp-inbox?phone=${phone}`);
  const verified = await raw('POST', '/auth/otp/verify', {
    phone,
    code: inbox['code'],
    role: 'seeker',
  });
  const token = verified.body['token'] as string;
  return { token, call: (method, path, body) => raw(method, path, body, token) };
}

/** Sorts and sends a list from `at`. Lines that need a question would fail the test: use clear words. */
export async function sendList(
  customer: Customer,
  lines: string[],
  at: { latitude: number; longitude: number },
  { wantsDelivery = false }: { wantsDelivery?: boolean } = {},
): Promise<string> {
  const sorted = await customer.call('POST', '/lists/sort', { lines });
  if (sorted.status !== 201) throw new Error(`sort failed: ${JSON.stringify(sorted.body)}`);
  const sent = await customer.call('POST', `/lists/${sorted.body['id']}/send`, {
    lat: at.latitude,
    lng: at.longitude,
    ...(wantsDelivery && { wantsDelivery: true }),
  });
  if (sent.status !== 200) throw new Error(`send failed: ${JSON.stringify(sent.body)}`);
  return sorted.body['id'] as string;
}

/** The customer's view of the list. */
export const listView = async (customer: Customer, id: string): Promise<Json> =>
  (await customer.call('GET', `/lists/${id}`)).body;

/** Orders every line from one shop, for delivery to `address` or for pickup. */
export async function orderAll(
  customer: Customer,
  id: string,
  shopId: string,
  lineCount: number,
  mode: 'delivery' | 'pickup',
  address = 'Flat 4B, Sapna Apartments, Vijay Nagar, Indore',
): Promise<Json> {
  const res = await customer.call('POST', `/lists/${id}/order`, {
    assignments: Array.from({ length: lineCount }, (_, position) => ({ position, shopId })),
    modes: { [shopId]: mode },
    ...(mode === 'delivery' && { addressText: address, customerName: 'Asha' }),
  });
  if (res.status !== 201) throw new Error(`order failed: ${JSON.stringify(res.body)}`);
  return res.body;
}

export const stopList = (customer: Customer, id: string) =>
  customer.call('POST', `/lists/${id}/stop`);
