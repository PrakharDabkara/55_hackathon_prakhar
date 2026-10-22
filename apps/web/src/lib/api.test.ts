import { describe, expect, it, vi } from 'vitest';
import { ApiError, createApi } from './api.js';

type Fetch = typeof fetch;

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

function setup(respond: (url: string, init: RequestInit) => Response) {
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) =>
    respond(String(url), init ?? {}),
  );
  const onUnauthorized = vi.fn();
  const api = createApi({
    getToken: () => 'tok-1',
    onUnauthorized,
    fetchImpl: fetchImpl as unknown as Fetch,
  });
  return { api, fetchImpl, onUnauthorized };
}

const headersOf = (init: RequestInit) => new Headers(init.headers);

describe('createApi', () => {
  it('sends the bearer token and reads the pings', async () => {
    const { api, fetchImpl } = setup(() => json(200, [{ id: 'p1' }]));
    expect(await api.listPings()).toEqual([{ id: 'p1' }]);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/shops/me/pings');
    expect(headersOf(init).get('authorization')).toBe('Bearer tok-1');
  });

  it('asks for a one-time event ticket with the bearer token, and returns only the ticket', async () => {
    const { api, fetchImpl } = setup(() => json(200, { ticket: 'tk-1', expiresInSeconds: 60 }));
    expect(await api.eventTicket()).toBe('tk-1');
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/events/ticket');
    expect(init.method).toBe('POST');
    expect(headersOf(init).get('authorization')).toBe('Bearer tok-1');
  });

  it('posts an answer as JSON to the ping', async () => {
    const { api, fetchImpl } = setup(() => json(200, { state: 'YES' }));
    await api.answerPing('p-9', { answer: 'yes', pricePaise: 4500 });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/pings/p-9/answer');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ answer: 'yes', pricePaise: 4500 });
    expect(headersOf(init).get('content-type')).toBe('application/json');
  });

  it('logs in as a shop', async () => {
    const { api, fetchImpl } = setup(() => json(200, { token: 'abc', user: { id: 'u' } }));
    expect(await api.verifyOtp('9876543210', '123456')).toEqual({ token: 'abc' });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/auth/otp/verify');
    expect(JSON.parse(String(init.body))).toEqual({
      phone: '9876543210',
      code: '123456',
      role: 'shop',
    });
  });

  it('reads the demo inbox, and gives null when there is no code', async () => {
    const found = setup(() => json(200, { code: '482913' }));
    expect(await found.api.devInbox('9876543210')).toBe('482913');
    expect(found.fetchImpl.mock.calls[0]?.[0]).toBe('/dev/otp-inbox?phone=9876543210');

    const none = setup(() => json(404, { error: { code: 'not_found', message: 'x' } }));
    expect(await none.api.devInbox('9876543210')).toBeNull();
  });

  it('returns null for a shop that does not exist yet (404), and throws for a customer (403)', async () => {
    const none = setup(() => json(404, { error: { code: 'not_found', message: 'x' } }));
    expect(await none.api.getMyShop()).toBeNull();

    const customer = setup(() => json(403, { error: { code: 'forbidden', message: 'x' } }));
    await expect(customer.api.getMyShop()).rejects.toMatchObject({
      status: 403,
      code: 'forbidden',
    });
  });

  it('turns an error body into an ApiError with its code', async () => {
    const { api } = setup(() =>
      json(429, { error: { code: 'rate_limited', message: 'slow down' } }),
    );
    const error = await api.requestOtp('9876543210').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 429, code: 'rate_limited', message: 'slow down' });
  });

  it('tells the app when the session is no longer valid (401)', async () => {
    const { api, onUnauthorized } = setup(() =>
      json(401, { error: { code: 'unauthorized', message: 'x' } }),
    );
    await expect(api.listPings()).rejects.toMatchObject({ status: 401 });
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('survives a response that is not JSON', async () => {
    const { api } = setup(() => new Response('<html>oops</html>', { status: 502 }));
    await expect(api.listPings()).rejects.toMatchObject({ status: 502, code: 'unknown' });
  });
});

describe('createApi: delivery orders (ADR-0031)', () => {
  it('lists the shop’s orders', async () => {
    const { api, fetchImpl } = setup(() => json(200, []));
    expect(await api.listOrders()).toEqual([]);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('/shops/me/orders');
  });

  it.each([
    ['accept', '/orders/o%201/accept'],
    ['decline', '/orders/o%201/decline'],
    ['out', '/orders/o%201/out'],
  ] as const)('moves an order with %s', async (verb, url) => {
    const { api, fetchImpl } = setup(() => json(200, { id: 'o 1' }));
    await api.orderAction('o 1', verb);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(url);
    expect((fetchImpl.mock.calls[0]?.[1] as RequestInit).method).toBe('POST');
  });

  it('the shop cancels an order with a reason and words (Delivery v2)', async () => {
    const { api, fetchImpl } = setup(() => json(200, { id: 'o 1' }));
    await api.cancelOrder('o 1', { reason: 'other', text: 'Rider bimar' });
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('/orders/o%201/cancel');
    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ reason: 'other', text: 'Rider bimar' });
  });

  it('sets the delivery limit in km, or null for none, as a top-level field', async () => {
    const { api, fetchImpl } = setup(() => json(200, {}));
    await api.updateShop({ deliveryMaxKm: 2.5 });
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('/shops/me');
    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(String(init.body))).toEqual({ deliveryMaxKm: 2.5 });
    await api.updateShop({ deliveryMaxKm: null });
    expect(JSON.parse(String((fetchImpl.mock.calls[1]?.[1] as RequestInit).body))).toEqual({
      deliveryMaxKm: null,
    });
  });

  it('reads the demand for one day or seven', async () => {
    const { api, fetchImpl } = setup(() => json(200, { days: 7 }));
    await api.shopDemand(7);
    await api.shopDemand();
    const urls = fetchImpl.mock.calls.map((c) => String(c[0]));
    expect(urls).toEqual(['/shops/me/demand?days=7', '/shops/me/demand?days=1']);
  });

  it('patches the shop with only what changed', async () => {
    const { api, fetchImpl } = setup(() => json(200, { id: 's1' }));
    await api.updateShop({ delivery: { feePaise: 2000, minutes: 30 }, deliveryMaxKm: null });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/shops/me');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(String(init.body))).toEqual({
      delivery: { feePaise: 2000, minutes: 30 },
      deliveryMaxKm: null,
    });
  });

  it('uploads a logo as a raw image body, not JSON or multipart', async () => {
    const { api, fetchImpl } = setup(() => json(201, { logoUrl: '/photos/abc' }));
    const image = new Blob(['x'], { type: 'image/webp' });
    expect(await api.uploadLogo(image)).toBe('/photos/abc');
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/shops/me/logo');
    expect(init.method).toBe('POST');
    expect(init.body).toBe(image);
    expect(headersOf(init).get('content-type')).toBe('image/webp');
    expect(headersOf(init).get('authorization')).toBe('Bearer tok-1');
  });

  it('logs out on all devices with one empty POST', async () => {
    const { api, fetchImpl } = setup(() => json(204));
    await api.logoutAll();
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/account/logout-all');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({});
    expect(headersOf(init).get('authorization')).toBe('Bearer tok-1');
  });

  it('removes the logo', async () => {
    const { api, fetchImpl } = setup(() => json(204));
    await api.deleteLogo();
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/shops/me/logo');
    expect(init.method).toBe('DELETE');
  });

  it('turns a too-large logo into a typed error', async () => {
    const { api } = setup(() => json(413, { error: { code: 'photo_too_large', message: 'big' } }));
    await expect(api.uploadLogo(new Blob(['x'], { type: 'image/jpeg' }))).rejects.toMatchObject({
      status: 413,
      code: 'photo_too_large',
    });
  });
});
