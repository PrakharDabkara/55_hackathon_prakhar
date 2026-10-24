import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { AiUnavailableError, createAiClient, type AiCallRow } from './client.js';
import { createGeminiProvider, type GeminiClientLike } from './gemini.js';
import { nextMidnightPacific } from './modelHealth.js';

/**
 * PR R2: what the AI client does with each failure Google really sent (fixtures in testing/observed/,
 * recorded in F1). Every case replays a real response through the Gemini adapter and the client.
 */
const observedDir = path.resolve(import.meta.dirname, '../../testing/observed');
const read = (file: string) => JSON.parse(readFileSync(path.join(observedDir, file), 'utf8'));
const fixtures = readdirSync(observedDir)
  .filter((f) => f.endsWith('.json') && !f.startsWith('gemini-ci'))
  .map((f) => read(f))
  .filter((f) => (f.source ?? '').startsWith('scripts/probe/') && typeof f.status === 'number');
const probed = (kind: string) => {
  const f = fixtures.find((x) => x.kind === kind);
  if (!f) throw new Error(`no observed fixture of kind ${kind}`);
  return Object.assign(new Error(JSON.stringify(f.body)), { status: f.status as number });
};
const sdkError = (status: number, body: unknown) =>
  Object.assign(new Error(JSON.stringify(body)), { status });

const schema = z.object({ ok: z.boolean() });
const generate = {
  system: 's',
  user: 'u',
  schema,
  maxOutputTokens: 20,
  purpose: 'resolve_query' as const,
};
const answer = () => ({ text: '{"ok":true}', usageMetadata: {} });
const fail = (error: unknown) => () => {
  throw error;
};
const T0 = Date.parse('2026-10-24T05:10:20Z'); // when the real daily 429 was recorded

function setup({
  responses,
  fallbackModel = 'fallback' as string | null,
  retries = 3,
  waitBudgetMs,
}: {
  responses: (() => unknown)[];
  fallbackModel?: string | null;
  retries?: number;
  waitBudgetMs?: Parameters<typeof createAiClient>[0]['waitBudgetMs'];
}) {
  const models: string[] = [];
  let i = 0;
  const next = () => (responses[Math.min(i++, responses.length - 1)] as () => unknown)() as never;
  const generateContent = vi.fn(async (params: unknown) => {
    models.push((params as { model: string }).model);
    return next();
  });
  const embedContent = vi.fn(async () => next());
  const provider = createGeminiProvider({
    client: { models: { generateContent, embedContent } } as unknown as GeminiClientLike,
    model: 'primary',
    fallbackModel,
    embedModel: 'embed',
    embedDim: 3,
  });
  const rows: AiCallRow[] = [];
  const sleeps: number[] = [];
  const logs: { level: string; obj: Record<string, unknown>; msg: string }[] = [];
  const log =
    (level: string) =>
    (obj: Record<string, unknown>, msg: string): void => {
      logs.push({ level, obj, msg });
    };
  const clock = { now: T0 };
  const client = createAiClient({
    provider,
    recorder: { record: async (r) => (rows.push(r), 'id'), markInvalid: async () => undefined },
    retries,
    random: () => 1,
    sleep: async (ms) => void sleeps.push(ms),
    now: () => clock.now,
    breaker: { threshold: 1000 },
    logger: {
      warn: log('warn'),
      error: log('error'),
      info: log('info'),
      debug: log('debug'),
    } as never,
    ...(waitBudgetMs && { waitBudgetMs }),
  });
  return {
    client,
    models,
    rows,
    sleeps,
    logs,
    clock,
    calls: () => generateContent.mock.calls.length,
  };
}

describe('503, timeouts and dropped connections: a bounded retry, then the fallback model', () => {
  const busy = () =>
    sdkError(503, {
      error: {
        code: 503,
        message: 'This model is currently experiencing high demand.',
        status: 'UNAVAILABLE',
      },
    });

  it('503 UNAVAILABLE that clears: retried on the fallback, the user sees nothing', async () => {
    const s = setup({ responses: [fail(busy()), answer] });
    await expect(s.client.generateJson(generate)).resolves.toMatchObject({ data: { ok: true } });
    expect(s.models).toEqual(['primary', 'fallback']);
  });

  it('ECONNRESET goes to the fallback model too (it did not before)', async () => {
    const dropped = Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } });
    const s = setup({ responses: [fail(dropped), answer] });
    await expect(s.client.generateJson(generate)).resolves.toMatchObject({ data: { ok: true } });
    expect(s.models).toEqual(['primary', 'fallback']);
  });

  it('a 503 that never clears stops after the first try and three retries', async () => {
    const s = setup({ responses: [fail(busy())] });
    await expect(s.client.generateJson(generate)).rejects.toBeInstanceOf(AiUnavailableError);
    expect(s.calls()).toBe(4);
  });
});

describe('per-minute 429 (observed: retryDelay 56 s)', () => {
  it('waits the FULL retryDelay when it fits the budget, then retries the same model', async () => {
    const s = setup({
      responses: [fail(probed('429-per-minute')), answer],
      waitBudgetMs: { resolve_query: 90_000 },
    });
    await expect(s.client.generateJson(generate)).resolves.toMatchObject({ data: { ok: true } });
    expect(s.sleeps).toEqual([56_000]);
    expect(s.models).toEqual(['primary', 'primary']);
  });

  it('does not wait when the delay is over the budget: the fallback model answers this call', async () => {
    const s = setup({ responses: [fail(probed('429-per-minute')), answer] }); // resolve budget is short
    await expect(s.client.generateJson(generate)).resolves.toMatchObject({ data: { ok: true } });
    expect(s.sleeps).toEqual([]);
    expect(s.models).toEqual(['primary', 'fallback']);
    // Only this call: the primary is still ok for the next one.
    expect(s.client.modelStatus()[0]?.primary.state).toBe('ok');
  });

  it('with no fallback and no room to wait, it fails at once', async () => {
    const s = setup({ responses: [fail(probed('429-per-minute'))], fallbackModel: null });
    await expect(s.client.generateJson(generate)).rejects.toBeInstanceOf(AiUnavailableError);
    expect(s.calls()).toBe(1);
    expect(s.sleeps).toEqual([]);
  });

  it('the waits of one call together stay within the budget', async () => {
    const s = setup({
      responses: [fail(probed('429-per-minute'))],
      fallbackModel: null,
      waitBudgetMs: { resolve_query: 100_000 },
    });
    await expect(s.client.generateJson(generate)).rejects.toBeInstanceOf(AiUnavailableError);
    expect(s.sleeps).toEqual([56_000]); // a second 56 s would be 112 s
  });
});

describe('input tokens per minute (observed: quotaValue 250000)', () => {
  it('a request whose own input exceeds the limit is never retried and never sent elsewhere', async () => {
    const s = setup({ responses: [fail(probed('oversize-input')), answer] });
    const huge = { ...generate, user: 'x'.repeat(1_100_000) }; // about 275,000 tokens
    await expect(s.client.generateJson(huge)).rejects.toBeInstanceOf(AiUnavailableError);
    expect(s.calls()).toBe(1);
    expect(s.sleeps).toEqual([]);
  });

  it('a small request that hits the same limit (other traffic filled the minute) is a per-minute 429', async () => {
    const s = setup({
      responses: [fail(probed('oversize-input')), answer],
      waitBudgetMs: { resolve_query: 90_000 },
    });
    await expect(s.client.generateJson(generate)).resolves.toMatchObject({ data: { ok: true } });
    expect(s.sleeps).toEqual([26_000]);
  });
});

describe('daily 429 (observed: PerDay, retryDelay 6579 s = midnight Pacific)', () => {
  it('marks the model exhausted until now + retryDelay and uses the fallback until then', async () => {
    const s = setup({ responses: [fail(probed('429-per-day')), answer] });
    await s.client.generateJson(generate);
    expect(s.models).toEqual(['primary', 'fallback']);
    expect(s.sleeps).toEqual([]);
    const primary = s.client.modelStatus()[0] as ReturnType<typeof s.client.modelStatus>[number];
    expect(primary).toMatchObject({
      role: 'chat',
      activeModel: 'fallback',
      primary: {
        model: 'primary',
        state: 'exhausted',
        until: new Date(T0 + 6579_000).toISOString(),
      },
    });
    expect(primary.primary.reason).toContain('GenerateRequestsPerDayPerProjectPerModel');

    s.models.length = 0;
    await s.client.generateJson(generate); // the next call does not even try the primary
    expect(s.models).toEqual(['fallback']);

    s.clock.now = T0 + 6579_000 + 1;
    s.models.length = 0;
    await s.client.generateJson(generate);
    expect(s.models).toEqual(['primary']);
    expect(s.client.modelStatus()[0]?.primary.state).toBe('ok');
  });

  it('nextMidnightPacific follows daylight saving', () => {
    // 13:00 PDT on Oct 24 -> midnight PDT (UTC-7) at 07:00Z the next day.
    expect(new Date(nextMidnightPacific(Date.parse('2026-10-24T20:00:00Z'))).toISOString()).toBe(
      '2026-10-25T07:00:00.000Z',
    );
    // Nov 10 is PST (UTC-8): midnight is 08:00Z.
    expect(new Date(nextMidnightPacific(Date.parse('2026-11-10T12:00:00Z'))).toISOString()).toBe(
      '2026-11-11T08:00:00.000Z',
    );
    // Just after midnight Pacific: a full day ahead.
    expect(new Date(nextMidnightPacific(Date.parse('2026-10-24T07:00:01Z'))).toISOString()).toBe(
      '2026-10-25T07:00:00.000Z',
    );
  });

  it('a daily 429 with no RetryInfo uses that next midnight', async () => {
    const body = JSON.parse(JSON.stringify(fixtures.find((x) => x.kind === '429-per-day').body));
    body.error.details = body.error.details.filter(
      (d: { retryDelay?: string }) => d.retryDelay === undefined,
    );
    const s = setup({ responses: [fail(sdkError(429, body)), answer] });
    await s.client.generateJson(generate);
    expect(s.client.modelStatus()[0]?.primary).toMatchObject({
      state: 'exhausted',
      until: new Date(nextMidnightPacific(T0)).toISOString(),
    });
  });
});

describe('404 NOT_FOUND on a configured model (observed: "no longer available")', () => {
  it('marks it unavailable until restart, answers from the fallback, logs ERROR once', async () => {
    const s = setup({ responses: [fail(probed('404-NOT_FOUND-retired')), answer] });
    await expect(s.client.generateJson(generate)).resolves.toMatchObject({ data: { ok: true } });
    expect(s.models).toEqual(['primary', 'fallback']);
    expect(s.client.modelStatus()[0]).toMatchObject({
      activeModel: 'fallback',
      primary: { model: 'primary', state: 'unavailable' },
    });

    s.clock.now += 30 * 24 * 3600_000; // a month later it is still unavailable
    s.models.length = 0;
    await s.client.generateJson(generate);
    expect(s.models).toEqual(['fallback']);
    expect(s.logs.filter((l) => l.level === 'error')).toHaveLength(1);
    expect(s.logs.find((l) => l.level === 'error')?.obj).toMatchObject({ model: 'primary' });
  });

  it('"not found" (an unknown name) is handled the same way', async () => {
    const s = setup({ responses: [fail(probed('unknown-model')), answer] });
    await s.client.generateJson(generate);
    expect(s.models).toEqual(['primary', 'fallback']);
  });
});

describe('a 429 with no QuotaFailure', () => {
  const bare = () =>
    sdkError(429, {
      error: { code: 429, message: 'Resource has been exhausted.', status: 'RESOURCE_EXHAUSTED' },
    });

  it('is retried once, then treated as daily: fallback until the next midnight Pacific', async () => {
    const s = setup({ responses: [fail(bare()), fail(bare()), answer] });
    await s.client.generateJson(generate);
    expect(s.models).toEqual(['primary', 'primary', 'fallback']);
    expect(s.client.modelStatus()[0]?.primary).toMatchObject({
      state: 'exhausted',
      until: new Date(nextMidnightPacific(T0)).toISOString(),
    });
  });

  it('a bare 429 that clears on the retry changes nothing', async () => {
    const s = setup({ responses: [fail(bare()), answer] });
    await s.client.generateJson(generate);
    expect(s.models).toEqual(['primary', 'primary']);
    expect(s.client.modelStatus()[0]?.primary.state).toBe('ok');
  });
});

describe('both models unavailable', () => {
  it('fails as before (AiUnavailableError) without calling anyone', async () => {
    const s = setup({
      responses: [fail(probed('404-NOT_FOUND-retired'))],
    });
    await expect(s.client.generateJson(generate)).rejects.toBeInstanceOf(AiUnavailableError);
    const before = s.calls();
    await expect(s.client.generateJson(generate)).rejects.toBeInstanceOf(AiUnavailableError);
    expect(s.calls()).toBe(before);
    expect(s.client.modelStatus()[0]?.activeModel).toBeNull();
    expect(s.rows.at(-1)?.outcome).toBe('http');
  });
});

describe('logs', () => {
  it('every failed attempt logs quotaId and retryDelay; every switch logs one warn with the request ref', async () => {
    const s = setup({ responses: [fail(probed('429-per-minute')), answer] });
    await s.client.generateJson({ ...generate, requestId: 'req-42' });
    const failed = s.logs.find((l) => l.msg === 'AI call failed');
    expect(failed?.obj).toMatchObject({
      quotaId: 'GenerateRequestsPerMinutePerProjectPerModel-FreeTier',
      retryDelaySec: 56,
      requestId: 'req-42',
    });
    const switches = s.logs.filter((l) => l.msg === 'AI model switched');
    expect(switches).toHaveLength(1);
    expect(switches[0]).toMatchObject({
      level: 'warn',
      obj: { from: 'primary', to: 'fallback', requestId: 'req-42' },
    });
  });
});

describe('embeddings', () => {
  it('a daily 429 on the embedding model skips it until the reset (callers keep the trigram path)', async () => {
    const s = setup({ responses: [fail(probed('429-per-day'))] });
    await expect(s.client.embed(['x'], 'embed_query')).rejects.toBeInstanceOf(AiUnavailableError);
    const calls = s.calls();
    await expect(s.client.embed(['x'], 'embed_query')).rejects.toBeInstanceOf(AiUnavailableError);
    expect(s.calls()).toBe(calls);
    const embedding = s.client.modelStatus().find((m) => m.role === 'embedding');
    expect(embedding).toMatchObject({
      activeModel: null,
      fallback: null,
      primary: { model: 'embed', state: 'exhausted' },
    });
  });

  it('an embedding never goes to the chat fallback model', async () => {
    const s = setup({ responses: [fail(probed('429-per-minute')), answer] });
    await s.client.embed(['x'], 'embed_query').catch(() => undefined);
    expect(s.models).toEqual([]); // generateContent was never used
  });
});

describe('modelStatus per role', () => {
  it('lists chat, errand and embedding', () => {
    const s = setup({ responses: [answer] });
    expect(s.client.modelStatus().map((m) => m.role)).toEqual(['chat', 'errand', 'embedding']);
  });
});
