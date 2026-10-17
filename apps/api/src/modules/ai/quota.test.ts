import { describe, expect, it, vi } from 'vitest';
import { createGeminiProvider, type GeminiClientLike } from './gemini.js';
import { QuotaWatch, rateLimitInfo, watchProvider } from './quota.js';
import { ProviderError, type LlmProvider } from './types.js';

const dailyBody = {
  message: 'You exceeded your current quota. Please retry in 34.5s.',
  status: 'RESOURCE_EXHAUSTED',
  details: [
    {
      '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
      violations: [
        {
          quotaMetric: 'generativelanguage.googleapis.com/embed_content_free_tier_requests',
          quotaId: 'EmbedContentRequestsPerDayPerProjectPerModel-FreeTier',
        },
      ],
    },
    { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '34s' },
  ],
};

const perMinuteBody = {
  message: 'Quota exceeded. Please retry in 12s.',
  status: 'RESOURCE_EXHAUSTED',
  details: [
    {
      '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
      violations: [{ quotaId: 'GenerateRequestsPerMinutePerProjectPerModel-FreeTier' }],
    },
    { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '12s' },
  ],
};

const rateLimited = (perDay: boolean, retryAfterSec: number | null) =>
  new ProviderError('429', 429, {
    code: 'RESOURCE_EXHAUSTED',
    rateLimit: { perDay, retryAfterSec },
  });

describe('rateLimitInfo', () => {
  it('calls a quota id that says PerDay a daily limit, and reads the retry delay', () => {
    expect(rateLimitInfo(dailyBody)).toEqual({ perDay: true, retryAfterSec: 34 });
  });

  it('calls a per-minute RESOURCE_EXHAUSTED an ordinary rate limit', () => {
    expect(rateLimitInfo(perMinuteBody)).toEqual({ perDay: false, retryAfterSec: 12 });
  });

  it('finds the daily limit in the message when there are no details', () => {
    expect(rateLimitInfo({ message: 'Quota exceeded: requests per day limit: 20' }).perDay).toBe(
      true,
    );
  });

  it('takes the retry hint from the message when RetryInfo is missing, and rounds up', () => {
    expect(rateLimitInfo({ message: 'Please retry in 41.2s.' }).retryAfterSec).toBe(42);
  });

  it('has no opinion about a body it cannot read', () => {
    expect(rateLimitInfo({})).toEqual({ perDay: false, retryAfterSec: null });
    expect(rateLimitInfo({ details: 'nope' as never })).toEqual({
      perDay: false,
      retryAfterSec: null,
    });
  });
});

describe('QuotaWatch', () => {
  it('stops at once on a daily-quota 429', () => {
    const watch = new QuotaWatch();
    expect(watch.failure(rateLimited(true, 5))).toMatch(/daily quota/i);
  });

  it('lets a few ordinary per-minute 429s through', () => {
    const watch = new QuotaWatch();
    expect(watch.failure(rateLimited(false, 12))).toBeNull();
    expect(watch.failure(rateLimited(false, 12))).toBeNull();
    expect(watch.failure(rateLimited(false, 12))).toBeNull();
    expect(watch.failure(rateLimited(false, 12))).toBeNull();
  });

  it('stops on the third consecutive 429 whose retry hint is over 60 s', () => {
    const watch = new QuotaWatch();
    expect(watch.failure(rateLimited(false, 61))).toBeNull();
    expect(watch.failure(rateLimited(false, 90))).toBeNull();
    expect(watch.failure(rateLimited(false, 75))).toMatch(/3 .*429/);
  });

  it('does not count a hint of exactly 60 s, or a missing hint', () => {
    const watch = new QuotaWatch();
    for (let i = 0; i < 5; i++) {
      expect(watch.failure(rateLimited(false, 60))).toBeNull();
      expect(watch.failure(rateLimited(false, null))).toBeNull();
    }
  });

  it('starts counting again after a success, a short hint, or a different error', () => {
    const watch = new QuotaWatch();
    watch.failure(rateLimited(false, 90));
    watch.failure(rateLimited(false, 90));
    watch.success();
    expect(watch.failure(rateLimited(false, 90))).toBeNull();
    watch.failure(rateLimited(false, 90));
    expect(watch.failure(rateLimited(false, 10))).toBeNull(); // short hint breaks the run
    watch.failure(rateLimited(false, 90));
    watch.failure(rateLimited(false, 90));
    expect(watch.failure(new ProviderError('busy', 503, { code: 'UNAVAILABLE' }))).toBeNull();
    expect(watch.failure(rateLimited(false, 90))).toBeNull();
  });

  it('ignores errors that are not 429s', () => {
    const watch = new QuotaWatch();
    expect(watch.failure(new Error('boom'))).toBeNull();
    expect(watch.failure(new ProviderError('busy', 503))).toBeNull();
  });
});

describe('watchProvider', () => {
  const failing = (error: Error): LlmProvider => ({
    name: 'x',
    model: 'm',
    fallbackModel: null,
    embedModel: 'e',
    generateJson: async () => {
      throw error;
    },
    embed: async () => {
      throw error;
    },
    chatWithTools: async () => {
      throw error;
    },
  });

  it('reports the exhausted quota once, then keeps throwing the original error', async () => {
    const onExhausted = vi.fn();
    const error = rateLimited(true, 3);
    const provider = watchProvider(failing(error), new QuotaWatch(), onExhausted);
    await expect(provider.embed(['a'], 'embed_query')).rejects.toBe(error);
    expect(onExhausted).toHaveBeenCalledTimes(1);
    expect(onExhausted.mock.calls[0]?.[0]).toMatch(/daily quota/i);
  });

  it('keeps the provider properties', () => {
    const provider = watchProvider(failing(new Error('x')), new QuotaWatch(), vi.fn());
    expect([provider.name, provider.model, provider.embedModel]).toEqual(['x', 'm', 'e']);
  });
});

describe('the Gemini adapter keeps the rate-limit facts of a 429', () => {
  it("turns Google's error body into ProviderError.rateLimit", async () => {
    const client: GeminiClientLike = {
      models: {
        generateContent: async () => {
          throw Object.assign(new Error(JSON.stringify({ error: { code: 429, ...dailyBody } })), {
            status: 429,
          });
        },
        embedContent: async () => ({ embeddings: [] }),
      },
    };
    const provider = createGeminiProvider({
      client,
      model: 'm',
      embedModel: 'e',
      embedDim: 4,
    });
    await expect(
      provider.generateJson({
        system: 's',
        user: 'u',
        schema: (await import('zod')).z.object({}),
        maxOutputTokens: 8,
        purpose: 'resolve_query',
      }),
    ).rejects.toMatchObject({
      status: 429,
      code: 'RESOURCE_EXHAUSTED',
      rateLimit: { perDay: true, retryAfterSec: 34 },
    });
  });
});
