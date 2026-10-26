import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { AiUnavailableError, createAiClient, type AiCallRow } from './client.js';
import { withDeadline } from './deadline.js';
import type { AiContext } from './index.js';
import { ProviderError, type GenerateJsonOptions, type LlmProvider } from './types.js';

/**
 * App round 3 (C-16): production ref 342D34 waited 8 s on the primary, then 8 s on the fallback,
 * and the 15 s cap ended the Find first. A slow primary now gets a second model alongside it after
 * a few seconds; the first valid answer wins and the other call is cancelled.
 */
const observed = JSON.parse(
  readFileSync(path.join(import.meta.dirname, 'fixtures/prod-resolve-timeout-342D34.json'), 'utf8'),
) as {
  primary: { model: string; latencyMs: number };
  switchedTo: { model: string; latencyMs: number };
  capMs: number;
};

const PRIMARY = observed.primary.model;
const FALLBACK = observed.switchedTo.model;
const schema = z.object({ ok: z.boolean() });
const options = {
  system: 's',
  user: 'u',
  schema,
  maxOutputTokens: 20,
  purpose: 'resolve_query' as const,
  requestId: '342D34',
};

type Behaviour = { after: number; fail?: ProviderError | undefined };
/** A provider whose models answer (or fail) after a stated time on the fake clock. */
function fakeModels(behaviour: Record<string, Behaviour>) {
  const started: { model: string; at: number }[] = [];
  const aborted: string[] = [];
  const begin = Date.now();
  const generateJson = <T>(o: GenerateJsonOptions<T>) => {
    const model = o.model ?? PRIMARY;
    started.push({ model, at: Date.now() - begin });
    const plan = behaviour[model] as Behaviour;
    return new Promise<never>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (plan.fail) reject(plan.fail);
        else
          resolve({
            data: { ok: true },
            usage: { inputTokens: 1, outputTokens: 1 },
            model,
            latencyMs: plan.after,
          } as never);
      }, plan.after);
      o.signal?.addEventListener('abort', () => {
        clearTimeout(timer);
        aborted.push(model);
        reject(new ProviderError('aborted', undefined, { kind: 'timeout' }));
      });
    });
  };
  const provider: LlmProvider = {
    name: 'fake',
    model: PRIMARY,
    fallbackModel: FALLBACK,
    embedModel: 'embed',
    generateJson: generateJson as LlmProvider['generateJson'],
    embed: async () => {
      throw new Error('not used');
    },
    chatWithTools: async () => {
      throw new Error('not used');
    },
  };
  return { provider, started, aborted };
}

function clientFor(
  provider: LlmProvider,
  extra: Partial<Parameters<typeof createAiClient>[0]> = {},
) {
  const rows: AiCallRow[] = [];
  const logs: { level: string; obj: Record<string, unknown>; msg: string }[] = [];
  const log =
    (level: string) =>
    (obj: Record<string, unknown>, msg: string): void =>
      void logs.push({ level, obj, msg });
  const client = createAiClient({
    provider,
    recorder: { record: async (r) => (rows.push(r), 'id'), markInvalid: async () => undefined },
    timeoutMs: 8000,
    retries: 1,
    random: () => 1,
    sleep: async () => undefined,
    breaker: { threshold: 1000 },
    logger: {
      warn: log('warn'),
      error: log('error'),
      info: log('info'),
      debug: log('debug'),
    } as never,
    ...extra,
  });
  return { client, rows, logs };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const finishedAt = async (call: Promise<unknown>, limit = 30_000) => {
  const start = Date.now();
  let done: number | null = null;
  void call.then(
    () => (done ??= Date.now() - start),
    () => (done ??= Date.now() - start),
  );
  for (let t = 0; t < limit && done === null; t += 10) await vi.advanceTimersByTimeAsync(10);
  return done;
};

describe('hedging a slow primary (C-16b)', () => {
  it('starts the fallback after 4 s and takes its answer; the slow primary is cancelled', async () => {
    const { provider, started, aborted } = fakeModels({
      [PRIMARY]: { after: observed.primary.latencyMs },
      [FALLBACK]: { after: 1000 },
    });
    const { client, rows, logs } = clientFor(provider);
    const call = client.generateJson(options);
    const at = await finishedAt(call);
    expect(at).toBe(5000);
    expect((await call).model).toBe(FALLBACK);
    expect(started).toEqual([
      { model: PRIMARY, at: 0 },
      { model: FALLBACK, at: 4000 },
    ]);
    expect(aborted).toEqual([PRIMARY]);
    expect(rows.map((r) => [r.model, r.outcome])).toEqual([[FALLBACK, 'ok']]);
    const hedge = logs.find((l) => l.msg === 'AI call hedged');
    expect(hedge?.obj).toMatchObject({
      purpose: 'resolve_query',
      requestId: '342D34',
      primary: PRIMARY,
      hedge: FALLBACK,
      afterMs: 4000,
      winner: FALLBACK,
    });
  });

  it('does not start a second call when the primary answers in time', async () => {
    const { provider, started } = fakeModels({
      [PRIMARY]: { after: 3900 },
      [FALLBACK]: { after: 10 },
    });
    const { client, logs } = clientFor(provider);
    const call = client.generateJson(options);
    expect(await finishedAt(call)).toBe(3900);
    expect((await call).model).toBe(PRIMARY);
    expect(started.map((s) => s.model)).toEqual([PRIMARY]);
    expect(logs.some((l) => l.msg === 'AI call hedged')).toBe(false);
  });

  it('the first valid answer wins, also when it is the primary after all', async () => {
    const { provider, aborted } = fakeModels({
      [PRIMARY]: { after: 4500 },
      [FALLBACK]: { after: 2000 },
    });
    const { client } = clientFor(provider);
    const call = client.generateJson(options);
    expect(await finishedAt(call)).toBe(4500);
    expect((await call).model).toBe(PRIMARY);
    expect(aborted).toEqual([FALLBACK]);
  });

  it('is configurable, and 0 turns it off (the old order: primary first, then fallback)', async () => {
    const { provider, started } = fakeModels({
      [PRIMARY]: { after: 20_000 },
      [FALLBACK]: { after: 500 },
    });
    const off = clientFor(provider, { hedgeAfterMs: 0 });
    const call = off.client.generateJson(options);
    expect(await finishedAt(call)).toBe(8500);
    expect(started.map((s) => s.at)).toEqual([0, 8000]);

    const quick = fakeModels({ [PRIMARY]: { after: 20_000 }, [FALLBACK]: { after: 500 } });
    const early = clientFor(quick.provider, { hedgeAfterMs: 1500 });
    const second = early.client.generateJson(options);
    expect(await finishedAt(second)).toBe(2000);
  });

  it('never hedges without a fallback model, or for a purpose that is not a short classification', async () => {
    const solo = fakeModels({ [PRIMARY]: { after: 6000 } });
    solo.provider = { ...solo.provider, fallbackModel: null } as never;
    const none = clientFor({ ...solo.provider, fallbackModel: null });
    const a = none.client.generateJson(options);
    expect(await finishedAt(a)).toBe(6000);
    expect(solo.started).toHaveLength(1);

    const errand = fakeModels({ [PRIMARY]: { after: 6000 }, [FALLBACK]: { after: 10 } });
    const b = clientFor(errand.provider, { purposeTimeoutMs: { errand: 30_000 } });
    const call = b.client.generateJson({ ...options, purpose: 'errand' });
    expect(await finishedAt(call)).toBe(6000);
    expect(errand.started).toHaveLength(1);
  });
});

describe('hedging keeps every failure rule (C-16b)', () => {
  const daily = new ProviderError('quota', 429, {
    kind: 'http',
    code: 'RESOURCE_EXHAUSTED',
    rateLimit: {
      perDay: true,
      quotaFailure: true,
      quotaId: 'GenerateRequestsPerDayPerProjectPerModel',
    } as never,
  });
  const gone = new ProviderError('gone', 404, { kind: 'http', modelGone: true });

  it('a primary that fails with a spent daily quota while hedged is marked used up; the fallback answers', async () => {
    const { provider } = fakeModels({
      [PRIMARY]: { after: 5000, fail: daily },
      [FALLBACK]: { after: 3000 },
    });
    const { client } = clientFor(provider);
    const call = client.generateJson(options);
    expect(await finishedAt(call)).toBe(7000);
    expect((await call).model).toBe(FALLBACK);
    const status = client.modelStatus().find((s) => s.role === 'chat');
    expect(status?.primary.state).toBe('exhausted');
    expect(status?.activeModel).toBe(FALLBACK);
  });

  it('a retired fallback that fails while hedged is marked unavailable; the primary still answers', async () => {
    const { provider } = fakeModels({
      [PRIMARY]: { after: 6000 },
      [FALLBACK]: { after: 100, fail: gone },
    });
    const { client } = clientFor(provider);
    const call = client.generateJson(options);
    expect(await finishedAt(call)).toBe(6000);
    expect((await call).model).toBe(PRIMARY);
    expect(client.modelStatus().find((s) => s.role === 'chat')?.fallback?.state).toBe(
      'unavailable',
    );
  });
});

describe('the observed failure of ref 342D34, replayed (C-16c)', () => {
  it('without the hedge it ended at the 15 s cap with the second model still running', async () => {
    const { provider, started } = fakeModels({
      [PRIMARY]: { after: 60_000 },
      [FALLBACK]: { after: observed.switchedTo.latencyMs },
    });
    const { client } = clientFor(provider, { hedgeAfterMs: 0 });
    const ai = withDeadline({ client } as unknown as AiContext, observed.capMs).client;
    const call = ai.generateJson(options);
    const at = await finishedAt(call);
    expect(at).toBe(observed.capMs);
    expect(started.map((s) => s.at)).toEqual([0, 8000]);
    await expect(call).rejects.toBeInstanceOf(AiUnavailableError);
  });

  it('with the hedge the fallback is started at 4 s, so a normal answer arrives in time', async () => {
    const { provider } = fakeModels({
      [PRIMARY]: { after: 60_000 },
      [FALLBACK]: { after: 2500 },
    });
    const { client } = clientFor(provider);
    const ai = withDeadline({ client } as unknown as AiContext, observed.capMs).client;
    const call = ai.generateJson(options);
    expect(await finishedAt(call)).toBe(6500);
    expect((await call).model).toBe(FALLBACK);
  });

  it('when both models are as slow as in production the Find ends in 12 s, before the cap, not after a retry', async () => {
    const { provider, started } = fakeModels({
      [PRIMARY]: { after: 60_000 },
      [FALLBACK]: { after: 60_000 },
    });
    const { client, rows } = clientFor(provider);
    const call = client.generateJson(options);
    const failure = call.catch((error: unknown) => error);
    expect(await finishedAt(call)).toBe(12_000);
    expect(await failure).toBeInstanceOf(AiUnavailableError);
    expect(((await failure) as AiUnavailableError).kind).toBe('timeout');
    expect(started).toHaveLength(2);
    expect(rows.map((r) => r.outcome)).toEqual(['timeout']);
  });
});
