import { afterEach, describe, expect, it, vi } from 'vitest';
import { createClient } from './client.js';

const answerWith = (status: number) =>
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () => new Response(JSON.stringify({ error: { code: 'x', message: 'y' } }), { status }),
    ),
  );

afterEach(() => vi.unstubAllGlobals());

describe('shopIsAlive', () => {
  it('is true when the shop answers', async () => {
    answerWith(200);
    expect(await createClient('http://api').shopIsAlive('t')).toBe(true);
  });

  it.each([401, 403, 404])('is false for %s: the token or the shop is gone', async (status) => {
    answerWith(status);
    expect(await createClient('http://api').shopIsAlive('t')).toBe(false);
  });

  // A limit or an outage says nothing about the shop (ADR-0059): do not throw its shops away.
  it.each([429, 500, 502, 503])(
    'is true for %s: the API is busy, not the shop gone',
    async (status) => {
      answerWith(status);
      expect(await createClient('http://api').shopIsAlive('t')).toBe(true);
    },
  );
});
