import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AiUnavailableError, createAiClient, type Recorder } from './client.js';
import { createFakeProvider } from './fake.js';
import { QuotaWatch, watchProvider } from './quota.js';
import { ProviderError } from './types.js';

const opts = {
  system: 's',
  user: 'u',
  schema: z.object({ ok: z.boolean() }),
  maxOutputTokens: 50,
  purpose: 'resolve_query' as const,
};
const recorder: Recorder = { record: async () => 'id', markInvalid: async () => undefined };
const busy = () => {
  throw new ProviderError('busy', 503);
};
const limited = (retryAfterSec: number | null, perDay = false) =>
  new ProviderError('429', 429, {
    code: 'RESOURCE_EXHAUSTED',
    rateLimit: { perDay, retryAfterSec, quotaFailure: true },
  });

function setup(o: Partial<Parameters<typeof createAiClient>[0]> = {}) {
  const provider = createFakeProvider();
  const sleeps: number[] = [];
  const client = createAiClient({
    provider,
    recorder,
    sleep: async (ms) => void sleeps.push(ms),
    random: () => 0.5,
    breaker: { threshold: 1000 },
    ...o,
  });
  return { provider, client, sleeps };
}

describe('retries are capped at 3', () => {
  it('asking for 10 retries makes 4 calls, not 11', async () => {
    const s = setup({ retries: 10 });
    s.provider.onGenerate(busy);
    await expect(s.client.generateJson(opts)).rejects.toBeInstanceOf(AiUnavailableError);
    expect(s.provider.calls).toHaveLength(4);
    expect(s.sleeps).toHaveLength(3);
  });

  it('a per-call override is capped too', async () => {
    const s = setup();
    s.provider.onChat(busy);
    await expect(
      s.client.chatWithTools({
        system: 's',
        messages: [{ role: 'user', text: 'u' }],
        tools: [],
        maxOutputTokens: 50,
        purpose: 'errand',
        retries: 9,
      }),
    ).rejects.toBeInstanceOf(AiUnavailableError);
    expect(s.provider.calls).toHaveLength(4);
  });

  it('the default stays at one retry', async () => {
    const s = setup();
    s.provider.onGenerate(busy);
    await expect(s.client.generateJson(opts)).rejects.toBeInstanceOf(AiUnavailableError);
    expect(s.provider.calls).toHaveLength(2);
  });
});

describe('the pause between attempts', () => {
  it('doubles each time, with jitter between half and the full step', async () => {
    const low = setup({ retries: 3, backoffMs: 1000, random: () => 0 });
    low.provider.onGenerate(busy);
    await low.client.generateJson(opts).catch(() => undefined);
    expect(low.sleeps).toEqual([500, 1000, 2000]);

    const high = setup({ retries: 3, backoffMs: 1000, random: () => 0.999999 });
    high.provider.onGenerate(busy);
    await high.client.generateJson(opts).catch(() => undefined);
    expect(high.sleeps.map(Math.round)).toEqual([1000, 2000, 4000]);
  });

  it('never exceeds 30 seconds', async () => {
    const s = setup({ retries: 3, backoffMs: 60_000, random: () => 0.999999 });
    s.provider.onGenerate(busy);
    await s.client.generateJson(opts).catch(() => undefined);
    expect(Math.max(...s.sleeps)).toBeLessThanOrEqual(30_000);
  });

  it('honours Retry-After from a 429', async () => {
    const s = setup({ retries: 1, backoffMs: 100, waitBudgetMs: { resolve_query: 60_000 } });
    let n = 0;
    s.provider.onGenerate(() => {
      if (n++ === 0) throw limited(12);
      return { ok: true };
    });
    await s.client.generateJson(opts);
    expect(s.sleeps).toEqual([12_000]);
  });

  it('waits the whole Retry-After, also past 30 seconds, when the budget allows it', async () => {
    const s = setup({ retries: 1, waitBudgetMs: { resolve_query: 60_000 } });
    let n = 0;
    s.provider.onGenerate(() => {
      if (n++ === 0) throw limited(55);
      return { ok: true };
    });
    await s.client.generateJson(opts);
    expect(s.sleeps).toEqual([55_000]);
  });

  it('does not wait for a Retry-After over the budget: the call fails (no fallback here)', async () => {
    const s = setup({ retries: 1 });
    s.provider.onGenerate(() => {
      throw limited(55);
    });
    await expect(s.client.generateJson(opts)).rejects.toBeInstanceOf(AiUnavailableError);
    expect(s.sleeps).toEqual([]);
    expect(s.provider.calls).toHaveLength(1);
  });
});

describe('a daily quota is not retried', () => {
  it('a per-day 429 fails the call at once, and the watch is told once', async () => {
    const watch = new QuotaWatch();
    const reasons: string[] = [];
    const fake = createFakeProvider();
    const s = setup({
      provider: watchProvider(fake, watch, (r) => reasons.push(r)),
      retries: 3,
    });
    fake.onGenerate(() => {
      throw limited(34, true);
    });
    await expect(s.client.generateJson(opts)).rejects.toBeInstanceOf(AiUnavailableError);
    expect(fake.calls).toHaveLength(1);
    expect(s.sleeps).toEqual([]);
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toMatch(/daily quota/);
  });
});
