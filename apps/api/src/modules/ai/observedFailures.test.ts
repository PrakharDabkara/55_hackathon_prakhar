import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createAiClient, AiUnavailableError, type AiCallRow } from './client.js';
import { classifyError } from './failure.js';
import { createGeminiProvider, type GeminiClientLike } from './gemini.js';
import { QuotaWatch } from './quota.js';
import { ProviderError } from './types.js';

/**
 * Contract tests (PR F1): the errors Google really sent, replayed through our own error handling.
 * The fixtures are in testing/observed/. Two kinds:
 *  - gemini-ci-dev-errors.json: our own log lines from CI dev eval runs (real, but already parsed
 *    and cut to 160 characters, so the raw body is rebuilt here from the fields that were logged);
 *  - gemini-*.json written by scripts/probe/*.sh: the raw status, headers and body. Those tests
 *    switch themselves on when the files are committed.
 */
const observedDir = path.resolve(import.meta.dirname, '../../testing/observed');
const read = (file: string) => JSON.parse(readFileSync(path.join(observedDir, file), 'utf8'));

interface LoggedFailure {
  purpose: string;
  kind: 'http' | 'timeout' | 'network';
  status: number | null;
  code: string | null;
  message: string;
  count: number;
}
const logged: LoggedFailure[] = read('gemini-ci-dev-errors.json').failures;
const withoutPrefix = (m: string) => m.replace(/^the Gemini call failed: /, '');

/** What @google/genai throws for an HTTP error: status on the error, Google's JSON as its message. */
const sdkHttpError = (status: number, body: unknown) =>
  Object.assign(new Error(JSON.stringify(body)), { status });

const schema = z.object({ ok: z.boolean() });
const generate = {
  system: 's',
  user: 'u',
  schema,
  maxOutputTokens: 20,
  purpose: 'resolve_query' as const,
};

function harness(
  responses: (() => unknown)[],
  { retries = 3, fallbackModel = 'fallback' as string | null } = {},
) {
  const models: string[] = [];
  let i = 0;
  const generateContent = vi.fn(async (params: unknown) => {
    models.push((params as { model: string }).model);
    const next = responses[Math.min(i++, responses.length - 1)] as () => unknown;
    return next() as never;
  });
  const embedContent = vi.fn(async () => {
    const next = responses[Math.min(i++, responses.length - 1)] as () => unknown;
    return next() as never;
  });
  const provider = createGeminiProvider({
    client: { models: { generateContent, embedContent } } as unknown as GeminiClientLike,
    model: 'primary',
    fallbackModel,
    embedModel: 'embed',
    embedDim: 3,
  });
  const rows: AiCallRow[] = [];
  const sleeps: number[] = [];
  const client = createAiClient({
    provider,
    recorder: { record: async (r) => (rows.push(r), 'id'), markInvalid: async () => undefined },
    retries,
    random: () => 1,
    sleep: async (ms) => void sleeps.push(ms),
  });
  return { client, provider, models, rows, sleeps, calls: () => generateContent.mock.calls.length };
}

const answer = () => ({ text: '{"ok":true}', usageMetadata: {} });
const fail = (error: unknown) => () => {
  throw error;
};

describe('the HTTP errors seen in CI (dev eval runs)', () => {
  const http = logged.filter((f) => f.kind === 'http');

  it('has evidence for 503 UNAVAILABLE and for 429 RESOURCE_EXHAUSTED', () => {
    expect(http.some((f) => f.status === 503 && f.code === 'UNAVAILABLE')).toBe(true);
    expect(http.some((f) => f.status === 429 && f.code === 'RESOURCE_EXHAUSTED')).toBe(true);
  });

  it.each(http.map((f) => [`${f.status} ${f.code}: ${f.message.slice(24, 70)}`, f] as const))(
    'classifies %s exactly as it was logged',
    async (_name, f) => {
      const body = { error: { code: f.status, message: withoutPrefix(f.message), status: f.code } };
      const { provider } = harness([fail(sdkHttpError(f.status as number, body))]);
      const error = (await provider.generateJson(generate).catch((e) => e)) as ProviderError;
      expect(classifyError(error)).toMatchObject({
        kind: 'http',
        status: f.status,
        code: f.code,
        message: f.message,
      });
    },
  );

  it('a 503 that clears on the next try is answered by the fallback model, and the user sees no failure', async () => {
    const busy = logged.find((f) => f.status === 503) as LoggedFailure;
    const body = {
      error: { code: 503, message: withoutPrefix(busy.message), status: 'UNAVAILABLE' },
    };
    const h = harness([fail(sdkHttpError(503, body)), answer]);
    await expect(h.client.generateJson(generate)).resolves.toMatchObject({ data: { ok: true } });
    expect(h.models).toEqual(['primary', 'fallback']);
    expect(h.rows.map((r) => r.outcome)).toEqual(['ok']);
  });

  it('a 503 that never clears ends as AiUnavailableError(http) after the first try and three retries', async () => {
    const body = { error: { code: 503, message: 'This model is busy.', status: 'UNAVAILABLE' } };
    const h = harness([fail(sdkHttpError(503, body))]);
    const error = await h.client.generateJson(generate).catch((e) => e);
    expect(error).toBeInstanceOf(AiUnavailableError);
    expect((error as AiUnavailableError).kind).toBe('http');
    expect(h.calls()).toBe(4);
    expect(h.models).toEqual(['primary', 'fallback', 'fallback', 'fallback']);
  });

  it('the 429 we saw says only "exceeded your current quota": it is NOT read as a daily limit', async () => {
    // What CI logged for the embedding 429. The text has no "per day"; whether Google's details do is
    // unknown until the quota probe fixtures exist (below). Until then a daily 429 would be retried.
    const quota = http.find((f) => f.status === 429) as LoggedFailure;
    const body = {
      error: { code: 429, message: withoutPrefix(quota.message), status: 'RESOURCE_EXHAUSTED' },
    };
    const error = await harness([fail(sdkHttpError(429, body))])
      .provider.generateJson(generate)
      .catch((e) => e);
    expect(classifyError(error)).toMatchObject({ kind: 'http', status: 429 });
    expect(classifyError(error).perDay).toBeUndefined();
    expect(new QuotaWatch().failure(error)).toBeNull();
  });
});

describe('the network and timeout errors seen in CI', () => {
  const network = logged.find((f) => f.kind === 'network') as LoggedFailure;

  it('a dropped connection (ECONNRESET, seen 3 times) is kind network with its code, and retried', async () => {
    const dropped = () =>
      Object.assign(new TypeError('fetch failed'), { cause: { code: network.code } });
    const h = harness([fail(dropped()), answer]);
    await expect(h.client.generateJson(generate)).resolves.toMatchObject({ data: { ok: true } });
    expect(h.calls()).toBe(2);
    const error = await harness([fail(dropped())])
      .provider.generateJson(generate)
      .catch((e) => e);
    expect(classifyError(error)).toMatchObject({ kind: 'network', code: 'ECONNRESET' });
  });

  it('a call that never answers ends as a timeout at the purpose limit, and the fallback model gets the retry', async () => {
    const timeouts = logged.filter((f) => f.kind === 'timeout');
    expect(timeouts.map((f) => f.message)).toContain('no answer within 30000 ms');
    const h = harness([() => new Promise(() => undefined), answer]);
    const client = createAiClient({
      provider: h.provider,
      recorder: { record: async () => 'id', markInvalid: async () => undefined },
      timeoutMs: 20,
      retries: 1,
      sleep: async () => undefined,
    });
    await expect(client.generateJson(generate)).resolves.toMatchObject({ data: { ok: true } });
    expect(h.models).toEqual(['primary', 'fallback']);
  });
});

/** Fixtures written by the probe scripts: raw status, headers and body, as Google sent them. */
const probeFiles = existsSync(observedDir)
  ? readdirSync(observedDir).filter((f) => {
      if (!f.endsWith('.json')) return false;
      const fixture = read(f) as { source?: string; status?: unknown };
      return (
        (fixture.source ?? '').startsWith('scripts/probe/') && typeof fixture.status === 'number'
      );
    })
  : [];
const ofKind = (kind: string) => probeFiles.find((f) => read(f).kind === kind);

describe.skipIf(probeFiles.length === 0)('raw responses captured by scripts/probe', () => {
  it.each(probeFiles)('%s: our handling follows what Google said', async (file) => {
    const fixture = read(file) as { status: number; body: { error?: { status?: string } } };
    const sdk = sdkHttpError(fixture.status, fixture.body);
    const error = (await harness([fail(sdk)])
      .provider.generateJson(generate)
      .catch((e) => e)) as ProviderError;
    const f = classifyError(error);
    expect(f).toMatchObject({ kind: 'http', status: fixture.status });
    // Google's own status word survives as the code.
    expect(f.code).toBe(fixture.body.error?.status);
    if (f.perDay) expect(new QuotaWatch().failure(error)).toMatch(/daily quota/);
  });

  it.skipIf(!ofKind('429-per-day'))(
    'a real per-day 429 is recognised as per-day, so nothing is retried',
    async () => {
      const fixture = read(ofKind('429-per-day') as string);
      const error = await harness([fail(sdkHttpError(429, fixture.body))])
        .provider.generateJson(generate)
        .catch((e) => e);
      expect(classifyError(error).perDay).toBe(true);
    },
  );

  it.skipIf(!ofKind('429-per-minute'))(
    'a real per-minute 429 is not per-day, and its retry delay is used when Google gave one',
    async () => {
      const fixture = read(ofKind('429-per-minute') as string);
      const error = await harness([fail(sdkHttpError(429, fixture.body))])
        .provider.generateJson(generate)
        .catch((e) => e);
      const f = classifyError(error);
      expect(f.perDay).toBeUndefined();
      const delay = JSON.stringify(fixture.body).match(/"retryDelay":"(\d+(?:\.\d+)?)s"/)?.[1];
      if (delay) expect(f.retryAfterSec).toBe(Math.ceil(parseFloat(delay)));
    },
  );
});

/** The probe fixture of one kind, as the SDK would throw it. */
const probed = (kind: string) => {
  const file = probeFiles.find((f) => read(f).kind === kind);
  if (!file) throw new Error(`no observed fixture of kind ${kind}`);
  return sdkHttpError(read(file).status, read(file).body);
};
const quotaIdOf = (kind: string) =>
  (read(probeFiles.find((f) => read(f).kind === kind) as string).body.error.details as unknown[])
    .flatMap((d) => (d as { violations?: { quotaId: string }[] }).violations ?? [])
    .map((v) => v.quotaId)[0];

describe('the three 429s Google sent (gemini-3.6-flash, free tier, all observed)', () => {
  it('tells them apart by QuotaFailure.violations[].quotaId, each with RetryInfo', () => {
    expect(quotaIdOf('429-per-minute')).toBe(
      'GenerateRequestsPerMinutePerProjectPerModel-FreeTier',
    );
    expect(quotaIdOf('429-per-day')).toBe('GenerateRequestsPerDayPerProjectPerModel-FreeTier');
    expect(quotaIdOf('oversize-input')).toBe(
      'GenerateContentInputTokensPerModelPerMinute-FreeTier',
    );
  });

  it('the daily 429 is per-day, carries the seconds to the reset, and is never retried', async () => {
    const h = harness([fail(probed('429-per-day'))]);
    const error = await h.client.generateJson(generate).catch((e) => e);
    expect(error).toBeInstanceOf(AiUnavailableError);
    expect(h.calls()).toBe(2); // the primary once, then the fallback model (R2); no waiting
    expect(h.sleeps).toEqual([]);
    const failure = classifyError(
      await harness([fail(probed('429-per-day'))])
        .provider.generateJson(generate)
        .catch((e) => e),
    );
    expect(failure).toMatchObject({
      kind: 'http',
      status: 429,
      code: 'RESOURCE_EXHAUSTED',
      perDay: true,
    });
    // Observed 05:10:20 UTC with retryDelay 6579 s: 07:00:00 UTC, midnight Pacific.
    expect(failure.retryAfterSec).toBe(6579);
  });

  it('the per-minute 429 is not per-day; Google asked for 56 s, which no longer gets a 30 s pause (R2: see modelFailover.test.ts)', async () => {
    const h = harness([fail(probed('429-per-minute'))]);
    await h.client.generateJson(generate).catch(() => undefined);
    expect(h.sleeps).not.toContain(30_000);
  });

  it('an input-token 429 is not retried when the request itself is over the limit, because waiting cannot make it smaller', async () => {
    const h = harness([fail(probed('oversize-input'))]);
    await h.client
      .generateJson({ ...generate, user: 'word '.repeat(220_000) })
      .catch(() => undefined);
    expect(h.calls()).toBe(1);
  });
});

describe('a model that is retired or unknown answers 404 NOT_FOUND (observed)', () => {
  it('is classified http 404 NOT_FOUND and never retried on the same model', async () => {
    for (const kind of ['404-NOT_FOUND-retired', 'unknown-model']) {
      const h = harness([fail(probed(kind))]);
      await h.client.generateJson(generate).catch(() => undefined);
      expect(h.models).toEqual(['primary', 'fallback']);
    }
    const failure = classifyError(
      await harness([fail(probed('404-NOT_FOUND-retired'))])
        .provider.generateJson(generate)
        .catch((e) => e),
    );
    expect(failure).toMatchObject({ kind: 'http', status: 404, code: 'NOT_FOUND' });
  });

  it('a retired primary falls back to GEMINI_FALLBACK_MODEL', async () => {
    const h = harness([fail(probed('404-NOT_FOUND-retired')), answer]);
    await expect(h.client.generateJson(generate)).resolves.toMatchObject({ data: { ok: true } });
    expect(h.models).toEqual(['primary', 'fallback']);
  });
});

describe('embeddings take the same path', () => {
  it('a 429 on an embedding is classified and retried like a generation call', async () => {
    const quota = logged.find((f) => f.purpose === 'embed_catalog') as LoggedFailure;
    const body = {
      error: { code: 429, message: withoutPrefix(quota.message), status: 'RESOURCE_EXHAUSTED' },
    };
    const h = harness([fail(sdkHttpError(429, body))]);
    const error = await h.client.embed(['x'], 'embed_catalog').catch((e) => e);
    expect(error).toBeInstanceOf(AiUnavailableError);
    expect(h.rows).toHaveLength(1);
    expect(h.rows[0]).toMatchObject({ outcome: 'http' });
  });
});
