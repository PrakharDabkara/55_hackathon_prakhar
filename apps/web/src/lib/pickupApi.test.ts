import { describe, expect, it, vi } from 'vitest';
import { createPickupApi } from './pickupApi.js';

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

function setup(respond: (url: string, init: RequestInit) => Response) {
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) =>
    respond(String(url), init ?? {}),
  );
  const api = createPickupApi({
    getToken: () => 'tok-9',
    onUnauthorized: vi.fn(),
    fetchImpl: fetchImpl as unknown as typeof fetch,
  });
  const last = () => fetchImpl.mock.calls.at(-1) as unknown as [string, RequestInit];
  return { api, last };
}

describe('createPickupApi (ADR-0035)', () => {
  it('records the tap on "Raasta" for a search', async () => {
    const { api, last } = setup(() => json(204));
    await api.recordPickup({ shopId: 's1', itemId: 'i1', requestId: 'r1' });
    const [url, init] = last();
    expect(url).toBe('/pickups');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      shopId: 's1',
      itemId: 'i1',
      requestId: 'r1',
    });
  });

  it('records it for an errand', async () => {
    const { api, last } = setup(() => json(204));
    await api.recordPickup({ shopId: 's1', itemId: 'i1', errandId: 'e1' });
    expect(JSON.parse(last()[1].body as string)).toEqual({
      shopId: 's1',
      itemId: 'i1',
      errandId: 'e1',
    });
  });

  it('asks for the questions waiting', async () => {
    const waiting = [
      { id: 'p1', item: { nameEn: 'sugar', nameHi: 'चीनी' }, shop: { name: 'Sharma' } },
    ];
    const { api, last } = setup(() => json(200, waiting));
    expect(await api.pendingPickups()).toEqual(waiting);
    expect(last()[0]).toBe('/pickups/pending');
  });

  it('sends the answer for one question', async () => {
    const { api, last } = setup(() => json(204));
    await api.answerPickup('p 1', 'not_there');
    const [url, init] = last();
    expect(url).toBe('/pickups/p%201/answer');
    expect(JSON.parse(init.body as string)).toEqual({ answer: 'not_there' });
  });
});
