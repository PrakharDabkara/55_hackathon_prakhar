import { describe, expect, it, vi } from 'vitest';
import { installClientErrorReporter, noteRequestId } from './clientErrors.js';

function setup(extra: Partial<Parameters<typeof installClientErrorReporter>[0]> = {}) {
  const listeners: Record<string, (event: unknown) => void> = {};
  const target = {
    addEventListener: (type: string, fn: (event: unknown) => void) => void (listeners[type] = fn),
  };
  const fetchImpl = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(
    async () => new Response(null, { status: 204 }),
  );
  installClientErrorReporter({
    target,
    fetchImpl: fetchImpl as unknown as typeof fetch,
    route: () => '/app/orders?phone=9800000001',
    version: 'abc1234',
    ...extra,
  });
  const sent = () =>
    fetchImpl.mock.calls.map((c) => JSON.parse(String((c[1] as RequestInit).body)));
  return { listeners, fetchImpl, sent };
}

describe('the browser error reporter (O1)', () => {
  it('sends an uncaught error with the message, route, version and the last request ref', () => {
    noteRequestId('7F3A2C');
    const { listeners, fetchImpl, sent } = setup();
    listeners['error']?.({
      message: 'x is not a function',
      error: new Error('x is not a function'),
    });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/client-errors');
    expect(init.method).toBe('POST');
    expect(Object.keys(sent()[0]).sort()).toEqual(
      ['appVersion', 'message', 'requestId', 'route', 'stack'].sort(),
    );
    expect(sent()[0]).toMatchObject({
      route: '/app/orders',
      appVersion: 'abc1234',
      requestId: '7F3A2C',
    });
  });

  it('trims the stack to 2 kb', () => {
    const { listeners, sent } = setup();
    const error = new Error('big');
    error.stack = 'x'.repeat(5000);
    listeners['error']?.({ message: 'big', error });
    expect(sent()[0].stack).toHaveLength(2048);
  });

  it('reports an unhandled rejection, whatever was thrown', () => {
    const { listeners, sent } = setup();
    listeners['unhandledrejection']?.({ reason: 'plain string' });
    expect(sent()[0].message).toBe('plain string');
  });

  it('sends at most five reports a page', () => {
    const { listeners, fetchImpl } = setup();
    for (let i = 0; i < 8; i++) listeners['error']?.({ message: `e${i}` });
    expect(fetchImpl.mock.calls.length).toBe(5);
  });

  it('never throws when the report cannot be sent', () => {
    const { listeners } = setup({
      fetchImpl: (async () => {
        throw new Error('offline');
      }) as unknown as typeof fetch,
    });
    expect(() => listeners['error']?.({ message: 'e' })).not.toThrow();
  });
});
