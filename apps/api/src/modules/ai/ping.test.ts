import { pino } from 'pino';
import { describe, expect, it, vi } from 'vitest';
import { createAi, createFakeProvider, ProviderError } from './index.js';

function setup(fallbackModel?: string, client: { timeoutMs?: number } = {}) {
  const query = vi.fn(async () => ({ rows: [{ id: 'x' }] }));
  const provider = createFakeProvider(fallbackModel ? { fallbackModel } : {});
  const ai = createAi({
    provider,
    db: { query } as never,
    logger: pino({ level: 'silent' }),
    embedThreshold: 0.8,
    embedMargin: 0.05,
    limiter: { allow: async () => true },
    client,
  });
  return { ai, provider, query };
}

describe('ai.ping (the demo-day health check)', () => {
  it('runs a tiny generateJson and a tiny chatWithTools call with each configured model', async () => {
    const { ai, provider } = setup('fb-model');
    provider.onGenerate(() => ({ ok: true }));
    provider.onChat(() => ({ toolCalls: [{ name: 'pong', args: {} }] }));
    const results = await ai.ping();
    expect(results.map((r) => [r.call, r.model])).toEqual([
      ['generateJson', 'fake-model'],
      ['chatWithTools', 'fake-model'],
      ['generateJson', 'fb-model'],
      ['chatWithTools', 'fb-model'],
    ]);
    for (const r of results)
      expect(r).toMatchObject({
        ok: true,
        kind: null,
        status: null,
        latencyMs: expect.any(Number),
      });
  });

  it('with no fallback model it checks the primary only', async () => {
    const { ai, provider } = setup();
    provider.onGenerate(() => ({ ok: true }));
    provider.onChat(() => ({ text: 'ok' }));
    expect((await ai.ping()).map((r) => r.model)).toEqual(['fake-model', 'fake-model']);
  });

  it('reports each failure by kind and status instead of throwing', async () => {
    const { ai, provider } = setup();
    provider.onGenerate(() => {
      throw new ProviderError('busy', 503, { code: 'UNAVAILABLE' });
    });
    provider.onChat(() => {
      throw new ProviderError('quota', 429);
    });
    const [g, c] = await ai.ping();
    expect(g).toMatchObject({ call: 'generateJson', ok: false, kind: 'http', status: 503 });
    expect(c).toMatchObject({ call: 'chatWithTools', ok: false, kind: 'http', status: 429 });
  });

  it('reports a call that takes too long as a timeout', async () => {
    const { ai, provider } = setup(undefined, { timeoutMs: 20 });
    provider.onGenerate(() => new Promise(() => undefined));
    provider.onChat(() => ({ text: 'ok' }));
    const [g, c] = await ai.ping();
    expect(g).toMatchObject({ ok: false, kind: 'timeout' });
    expect(c).toMatchObject({ ok: true });
  });

  it('does not touch the database, the breakers or the audit table', async () => {
    const { ai, provider, query } = setup();
    provider.onGenerate(() => {
      throw new ProviderError('down', 500);
    });
    provider.onChat(() => {
      throw new ProviderError('down', 500);
    });
    for (let i = 0; i < 7; i++) await ai.ping();
    expect(query).not.toHaveBeenCalled();
    provider.onGenerate(() => ({ ok: true }));
    expect((await ai.ping())[0]).toMatchObject({ ok: true });
  });
});
