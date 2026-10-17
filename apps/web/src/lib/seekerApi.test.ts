import { describe, expect, it, vi } from 'vitest';
import { ApiError } from './api.js';
import { createSeekerApi } from './seekerApi.js';

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
  const api = createSeekerApi({
    getToken: () => 'tok-9',
    onUnauthorized,
    fetchImpl: fetchImpl as unknown as Fetch,
  });
  const last = () => fetchImpl.mock.calls.at(-1) as unknown as [string, RequestInit];
  return { api, fetchImpl, onUnauthorized, last };
}

describe('createSeekerApi', () => {
  it('logs in with the seeker role', async () => {
    const { api, last } = setup(() => json(200, { token: 't', user: { role: 'seeker' } }));
    expect(await api.verifyOtp('9876543210', '123456')).toEqual({ token: 't' });
    expect(JSON.parse(last()[1].body as string)).toEqual({
      phone: '9876543210',
      code: '123456',
      role: 'seeker',
    });
  });

  it('creates a request with the bearer token and an Idempotency-Key, price in paise', async () => {
    const { api, last } = setup(() => json(201, { id: 'r1' }));
    await api.createRequest({ q: 'chini', lat: 22.7196, lng: 75.8577, targetPricePaise: 6000 });
    const [url, init] = last();
    expect(url).toBe('/requests');
    expect(init.method).toBe('POST');
    const headers = new Headers(init.headers);
    expect(headers.get('authorization')).toBe('Bearer tok-9');
    expect(headers.get('idempotency-key')).toMatch(/.{8,}/);
    expect(JSON.parse(init.body as string)).toEqual({
      q: 'chini',
      lat: 22.7196,
      lng: 75.8577,
      targetPricePaise: 6000,
    });
  });

  it('leaves the price out when there is none', async () => {
    const { api, last } = setup(() => json(201, { id: 'r1' }));
    await api.createRequest({ q: 'chini', lat: 1, lng: 2 });
    expect(JSON.parse(last()[1].body as string)).not.toHaveProperty('targetPricePaise');
  });

  it('turns item_unresolved (422) into an ApiError the screen can recognise', async () => {
    const { api } = setup(() =>
      json(422, { error: { code: 'item_unresolved', message: 'We could not tell' } }),
    );
    const error = await api.createRequest({ q: 'xyz', lat: 1, lng: 2 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 422, code: 'item_unresolved' });
  });

  it('passes the chosen itemId along when the customer picked one', async () => {
    const { api, last } = setup(() => json(201, { id: 'r1' }));
    await api.createRequest({ q: 'clip', lat: 1, lng: 2, itemId: 'item-paper' });
    expect(JSON.parse(last()[1].body as string)).toEqual({
      q: 'clip',
      lat: 1,
      lng: 2,
      itemId: 'item-paper',
    });
  });

  it('keeps the question and options of an item_ambiguous answer on the error', async () => {
    const { api } = setup(() =>
      json(422, {
        error: {
          code: 'item_ambiguous',
          message: 'Which one?',
          question: 'Kaunsa?',
          options: [{ itemId: 'a', nameEn: 'a', nameHi: 'अ' }],
        },
      }),
    );
    const error = (await api
      .createRequest({ q: 'clip', lat: 1, lng: 2 })
      .catch((e: unknown) => e)) as ApiError;
    expect(error.code).toBe('item_ambiguous');
    expect(error.details).toEqual({
      question: 'Kaunsa?',
      options: [{ itemId: 'a', nameEn: 'a', nameHi: 'अ' }],
    });
  });

  it('reads and closes a request by id', async () => {
    const { api, last } = setup(() => json(200, { id: 'r/1' }));
    await api.getRequest('r/1');
    expect(last()[0]).toBe('/requests/r%2F1');
    await api.closeRequest('r/1');
    expect(last()[0]).toBe('/requests/r%2F1/close');
    expect(last()[1].method).toBe('POST');
  });

  it('asks for an event ticket and returns only the ticket', async () => {
    const { api, last } = setup(() => json(200, { ticket: 'tk', expiresInSeconds: 60 }));
    expect(await api.eventTicket()).toBe('tk');
    expect(last()[0]).toBe('/events/ticket');
  });

  it('tells the app when the login is no longer valid', async () => {
    const { api, onUnauthorized } = setup(() =>
      json(401, { error: { code: 'unauthorized', message: 'Log in' } }),
    );
    await api.getRequest('r1').catch(() => undefined);
    expect(onUnauthorized).toHaveBeenCalled();
  });

  describe('errands', () => {
    it('creates an errand with the budget in paise and no idempotency header', async () => {
      const { api, last } = setup(() => json(201, { id: 'e1', state: 'PLANNING' }));
      expect(
        await api.createErrand({
          task: 'puja ka saaman',
          lat: 22.7,
          lng: 75.8,
          budgetPaise: 50000,
        }),
      ).toEqual({ id: 'e1', state: 'PLANNING' });
      const [url, init] = last();
      expect(url).toBe('/errands');
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body as string)).toEqual({
        task: 'puja ka saaman',
        lat: 22.7,
        lng: 75.8,
        budgetPaise: 50000,
      });
    });

    it('reads an errand, answers it by option or by text, and cancels it', async () => {
      const { api, last } = setup(() => json(200, { id: 'e 1', state: 'PLANNING' }));
      await api.getErrand('e 1');
      expect(last()[0]).toBe('/errands/e%201');
      await api.answerErrand('e1', { optionIndex: 1 });
      expect(last()[0]).toBe('/errands/e1/answer');
      expect(JSON.parse(last()[1].body as string)).toEqual({ optionIndex: 1 });
      await api.answerErrand('e1', { text: 'Dust chai' });
      expect(JSON.parse(last()[1].body as string)).toEqual({ text: 'Dust chai' });
      await api.cancelErrand('e1');
      expect(last()[0]).toBe('/errands/e1/cancel');
      expect(last()[1].method).toBe('POST');
    });

    it('turns a refusal into an ApiError with its code', async () => {
      const { api } = setup(() => json(422, { error: { code: 'task_rejected', message: 'no' } }));
      await expect(api.createErrand({ task: 'x', lat: 1, lng: 1 })).rejects.toMatchObject({
        status: 422,
        code: 'task_rejected',
      });
      expect(ApiError).toBeDefined();
    });
  });
});
