import { describe, expect, it, vi } from 'vitest';
import { ApiUnreachableError, createHttpApiClient, NotLoggedInError } from './apiClient.js';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('createHttpApiClient', () => {
  it('sends the seeker token as a bearer token, builds the query string and parses JSON', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json(200, { hello: 'world' }));
    const api = createHttpApiClient({
      baseUrl: 'https://api.example/',
      getToken: () => 'tok',
      fetch: fetchImpl,
    });
    const res = await api.call({
      method: 'GET',
      path: '/search',
      query: { itemId: 'abc', lat: 22.7, radius_m: undefined },
    });
    expect(res).toEqual({ status: 200, body: { hello: 'world' } });
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.example/search?itemId=abc&lat=22.7');
    expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer tok');
  });

  it('sends a JSON body and extra headers on POST', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json(201, { id: 'r1' }));
    const api = createHttpApiClient({
      baseUrl: 'https://a',
      getToken: () => 't',
      fetch: fetchImpl,
    });
    await api.call({
      method: 'POST',
      path: '/requests',
      body: { lat: 1 },
      headers: { 'idempotency-key': 'k1' },
    });
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"lat":1}');
    const headers = init.headers as Record<string, string>;
    expect(headers['content-type']).toBe('application/json');
    expect(headers['idempotency-key']).toBe('k1');
  });

  it('returns error statuses as data, not exceptions', async () => {
    const api = createHttpApiClient({
      baseUrl: 'https://a',
      getToken: () => 't',
      fetch: async () => json(422, { error: { code: 'item_ambiguous' } }),
    });
    expect(await api.call({ method: 'GET', path: '/x' })).toEqual({
      status: 422,
      body: { error: { code: 'item_ambiguous' } },
    });
  });

  it('throws NotLoggedInError without calling the API when there is no token', async () => {
    const fetchImpl = vi.fn();
    const api = createHttpApiClient({
      baseUrl: 'https://a',
      getToken: () => null,
      fetch: fetchImpl,
    });
    await expect(api.call({ method: 'GET', path: '/x' })).rejects.toBeInstanceOf(NotLoggedInError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('wraps a network failure as ApiUnreachableError that names the address, not the token', async () => {
    const api = createHttpApiClient({
      baseUrl: 'https://down.example',
      getToken: () => 'secret-token',
      fetch: async () => {
        throw new TypeError('fetch failed');
      },
    });
    const error = await api.call({ method: 'GET', path: '/x' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiUnreachableError);
    expect((error as Error).message).toContain('https://down.example');
    expect((error as Error).message).not.toContain('secret-token');
  });

  it('times out a hung request', async () => {
    const api = createHttpApiClient({
      baseUrl: 'https://slow',
      getToken: () => 't',
      timeoutMs: 20,
      fetch: (_url, init) =>
        new Promise((_resolve, reject) => {
          (init as RequestInit).signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        }),
    });
    await expect(api.call({ method: 'GET', path: '/x' })).rejects.toBeInstanceOf(
      ApiUnreachableError,
    );
  });
});
