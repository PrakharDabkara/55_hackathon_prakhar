import { pino } from 'pino';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createAiClient, type AiCallRow, type Recorder } from './client.js';
import { createFakeProvider } from './fake.js';
import { createGeminiProvider, type GeminiClientLike } from './gemini.js';
import { ProviderError, type ChatTool } from './types.js';

const schema = z.object({ ok: z.boolean() });
const opts = {
  system: 'SYSTEMTEXT',
  user: 'SECRETUSERTEXT',
  schema,
  maxOutputTokens: 50,
  purpose: 'resolve_query' as const,
};
const tools: ChatTool[] = [{ name: 't', description: 'd', input: z.object({}) }];
const chat = {
  system: 'SYSTEMTEXT',
  messages: [{ role: 'user' as const, text: 'SECRETUSERTEXT' }],
  tools,
  maxOutputTokens: 50,
  purpose: 'errand' as const,
};
const hang = () => new Promise<never>(() => undefined);
const later = <T>(ms: number, value: T) => new Promise<T>((r) => setTimeout(() => r(value), ms));

function setup(o: Partial<Parameters<typeof createAiClient>[0]> & { fallbackModel?: string } = {}) {
  const lines: Record<string, unknown>[] = [];
  const logger = pino(
    { level: 'debug' },
    { write: (chunk: string) => void lines.push(JSON.parse(chunk)) },
  );
  const rows: AiCallRow[] = [];
  const recorder: Recorder = {
    record: async (row) => (rows.push(row), `call-${rows.length}`),
    markInvalid: async () => undefined,
  };
  const { fallbackModel, ...rest } = o;
  const provider = createFakeProvider(fallbackModel ? { fallbackModel } : {});
  provider.onGenerate(() => ({ ok: true }));
  provider.onChat(() => ({ text: 'fine' }));
  const client = createAiClient({
    provider,
    recorder,
    logger,
    sleep: async () => undefined,
    retries: 0,
    ...rest,
  });
  const failures = () => lines.filter((l) => l['msg'] === 'AI call failed');
  return { client, provider, rows, lines, failures };
}

describe('every AI failure is logged with what an operator needs, and recorded by kind', () => {
  const cases: {
    kind: string;
    run: (s: ReturnType<typeof setup>) => void;
    options?: Parameters<typeof createAiClient>[0] extends infer T ? Partial<T> : never;
    status?: number;
    code?: string;
  }[] = [
    {
      kind: 'timeout',
      run: (s) => s.provider.onGenerate(hang),
      options: { timeoutMs: 20 },
    },
    {
      kind: 'http',
      run: (s) =>
        s.provider.onGenerate(() => {
          throw new ProviderError('bad', 400, { code: 'INVALID_ARGUMENT' });
        }),
      status: 400,
      code: 'INVALID_ARGUMENT',
    },
    {
      kind: 'network',
      run: (s) =>
        s.provider.onGenerate(() => {
          throw new ProviderError('socket hang up', undefined, {
            kind: 'network',
            code: 'ECONNRESET',
          });
        }),
      code: 'ECONNRESET',
    },
    { kind: 'invalid_output', run: (s) => s.provider.onGenerate(() => ({ wrong: 1 })) },
    {
      kind: 'other',
      run: (s) =>
        s.provider.onGenerate(() => {
          throw new TypeError('boom');
        }),
    },
  ];

  it.each(cases)('$kind', async ({ kind, run, options, status, code }) => {
    const s = setup(options);
    run(s);
    await expect(s.client.generateJson({ ...opts, requestId: 'r1' })).rejects.toMatchObject({
      name: 'AiUnavailableError',
      kind,
    });
    expect(s.failures()).toHaveLength(1);
    const line = s.failures()[0] as Record<string, unknown>;
    expect(line).toMatchObject({ purpose: 'resolve_query', model: 'fake-model', attempt: 0, kind });
    expect(line['status']).toBe(status);
    expect(line['code']).toBe(code);
    expect(typeof line['latencyMs']).toBe('number');
    expect(typeof line['message']).toBe('string');
    expect(s.rows).toHaveLength(1);
    expect(s.rows[0]?.outcome).toBe(kind);
  });

  it('breaker: the skip is logged as kind=breaker and recorded as breaker', async () => {
    const s = setup({ breaker: { threshold: 1 } });
    s.provider.onGenerate(() => {
      throw new ProviderError('down', 500);
    });
    await s.client.generateJson(opts).catch(() => undefined);
    await expect(s.client.generateJson(opts)).rejects.toMatchObject({ kind: 'breaker' });
    const skip = s.lines.find((l) => l['kind'] === 'breaker') as Record<string, unknown>;
    expect(skip).toMatchObject({
      purpose: 'resolve_query',
      model: 'fake-model',
      kind: 'breaker',
      attempt: 0,
      latencyMs: 0,
    });
    expect(s.rows.at(-1)?.outcome).toBe('breaker');
  });

  it('numbers the attempts: 0, then 1 after a retry', async () => {
    const s = setup({ retries: 1 });
    s.provider.onGenerate(() => {
      throw new ProviderError('busy', 503, { code: 'UNAVAILABLE' });
    });
    await s.client.generateJson(opts).catch(() => undefined);
    expect(s.failures().map((l) => l['attempt'])).toEqual([0, 1]);
    expect(s.rows.map((r) => r.outcome)).toEqual(['http']);
  });

  it('logs a short message with no key, prompt text or user data', async () => {
    const s = setup();
    s.provider.onGenerate(() => {
      throw new ProviderError(
        `quota exceeded for key AIzaSyA1234567890abcdefghijklmn ${'x'.repeat(500)}`,
        429,
      );
    });
    await s.client.generateJson({ ...opts, system: 'SYSTEMTEXT' }).catch(() => undefined);
    const everything = JSON.stringify(s.lines);
    expect(everything).not.toContain('AIzaSy');
    expect(everything).not.toContain('SECRETUSERTEXT');
    expect(everything).not.toContain('SYSTEMTEXT');
    expect(
      String((s.failures()[0] as Record<string, unknown>)['message']).length,
    ).toBeLessThanOrEqual(200);
  });

  it('chatWithTools failures are logged the same way, with purpose errand', async () => {
    const s = setup();
    s.provider.onChat(() => {
      throw new ProviderError('busy', 503, { code: 'UNAVAILABLE' });
    });
    await expect(s.client.chatWithTools(chat)).rejects.toMatchObject({ kind: 'http' });
    expect(s.failures()[0]).toMatchObject({
      purpose: 'errand',
      kind: 'http',
      status: 503,
      code: 'UNAVAILABLE',
    });
  });
});

describe('timeouts per purpose', () => {
  it('resolve keeps the short limit while an errand call gets its own', async () => {
    const s = setup({ timeoutMs: 20, purposeTimeoutMs: { errand: 1000 } });
    s.provider.onGenerate(() => later(80, { ok: true }));
    s.provider.onChat(() => later(80, { text: 'slow but fine' }));
    await expect(s.client.generateJson(opts)).rejects.toMatchObject({ kind: 'timeout' });
    await expect(s.client.chatWithTools(chat)).resolves.toMatchObject({ text: 'slow but fine' });
  });

  it('an errand call that outlasts its own limit is a timeout', async () => {
    const s = setup({ timeoutMs: 1000, purposeTimeoutMs: { errand: 20 } });
    s.provider.onChat(hang);
    await expect(s.client.chatWithTools(chat)).rejects.toMatchObject({ kind: 'timeout' });
    expect(s.client.timeoutFor('errand')).toBe(20);
    expect(s.client.timeoutFor('resolve_query')).toBe(1000);
  });

  it('retries after a timeout', async () => {
    const s = setup({ timeoutMs: 20, retries: 1 });
    let n = 0;
    s.provider.onGenerate(() => (n++ === 0 ? hang() : { ok: true }));
    await expect(s.client.generateJson(opts)).resolves.toMatchObject({ data: { ok: true } });
    expect(n).toBe(2);
  });
});

describe('the fallback model', () => {
  const generateModels = (s: ReturnType<typeof setup>) =>
    s.provider.calls
      .filter((c) => c.kind === 'generate')
      .map((c) => (c as { model?: string }).model);

  it.each([
    [
      '503',
      () => {
        throw new ProviderError('busy', 503);
      },
    ],
    [
      '429',
      () => {
        // A per-minute limit whose delay is over the budget (a bare 429 retries once first, R2).
        throw new ProviderError('quota', 429, {
          rateLimit: { perDay: false, retryAfterSec: 60, quotaFailure: true },
        });
      },
    ],
    ['a timeout', hang],
  ])(
    'after %s from the primary the next attempt uses the fallback, and says so',
    async (_name, fail) => {
      const s = setup({ retries: 1, timeoutMs: 30, fallbackModel: 'fb-model' });
      let n = 0;
      s.provider.onGenerate(() => (n++ === 0 ? fail() : { ok: true }));
      const result = await s.client.generateJson(opts);
      expect(result.model).toBe('fb-model');
      expect(generateModels(s)).toEqual([undefined, 'fb-model']);
      expect(s.rows).toHaveLength(1);
      expect(s.rows[0]).toMatchObject({ model: 'fb-model', outcome: 'ok' });
      expect(s.lines.find((l) => l['fallback'] === true)).toMatchObject({
        purpose: 'resolve_query',
        model: 'fb-model',
        attempt: 1,
      });
    },
  );

  it('works for errand calls too', async () => {
    const s = setup({ retries: 1, fallbackModel: 'fb-model' });
    let n = 0;
    s.provider.onChat(() => {
      if (n++ === 0) throw new ProviderError('busy', 503);
      return { text: 'ok' };
    });
    expect((await s.client.chatWithTools(chat)).model).toBe('fb-model');
    expect(
      s.provider.calls.filter((c) => c.kind === 'chat').map((c) => (c as { model?: string }).model),
    ).toEqual([undefined, 'fb-model']);
  });

  it('stays on the fallback for the rest of that call, and the next call starts on the primary', async () => {
    const s = setup({ retries: 2, fallbackModel: 'fb-model' });
    let n = 0;
    s.provider.onGenerate(() => {
      if (n++ < 2) throw new ProviderError('busy', 503);
      return { ok: true };
    });
    await s.client.generateJson(opts);
    expect(generateModels(s)).toEqual([undefined, 'fb-model', 'fb-model']);
    await s.client.generateJson(opts);
    expect(generateModels(s).at(-1)).toBeUndefined();
  });

  it('is not used for a 500 (retried on the primary), a 400 (not retried) or when none is set', async () => {
    const a = setup({ retries: 1, fallbackModel: 'fb-model' });
    let n = 0;
    a.provider.onGenerate(() => {
      if (n++ === 0) throw new ProviderError('oops', 500);
      return { ok: true };
    });
    await a.client.generateJson(opts);
    expect(generateModels(a)).toEqual([undefined, undefined]);

    const b = setup({ retries: 1, fallbackModel: 'fb-model' });
    b.provider.onGenerate(() => {
      throw new ProviderError('bad', 400);
    });
    await b.client.generateJson(opts).catch(() => undefined);
    expect(generateModels(b)).toHaveLength(1);

    const c = setup({ retries: 1 });
    let m = 0;
    c.provider.onGenerate(() => {
      if (m++ === 0) throw new ProviderError('busy', 503);
      return { ok: true };
    });
    expect((await c.client.generateJson(opts)).model).toBe('fake-model');
    expect(generateModels(c)).toEqual([undefined, undefined]);
  });
});

describe('one breaker per purpose', () => {
  it('resolve failures cannot open the errand breaker, nor errand failures the resolve one', async () => {
    const s = setup({ breaker: { threshold: 2 } });
    s.provider.onGenerate(() => {
      throw new ProviderError('down', 500);
    });
    for (let i = 0; i < 2; i++) await s.client.generateJson(opts).catch(() => undefined);
    await expect(s.client.generateJson(opts)).rejects.toMatchObject({ kind: 'breaker' });
    await expect(s.client.chatWithTools(chat)).resolves.toMatchObject({ text: 'fine' });

    const t = setup({ breaker: { threshold: 2 } });
    t.provider.onChat(() => {
      throw new ProviderError('down', 500);
    });
    for (let i = 0; i < 2; i++) await t.client.chatWithTools(chat).catch(() => undefined);
    await expect(t.client.chatWithTools(chat)).rejects.toMatchObject({ kind: 'breaker' });
    await expect(t.client.generateJson(opts)).resolves.toMatchObject({ data: { ok: true } });
    expect(t.lines.some((l) => l['kind'] === 'breaker' && l['purpose'] === 'errand')).toBe(true);
  });

  it('embedding purposes have their own breakers too', async () => {
    const s = setup({ breaker: { threshold: 1 } });
    s.provider.onEmbed((texts, purpose) => {
      if (purpose === 'embed_query') throw new ProviderError('down', 500);
      return texts.map(() => [1]);
    });
    await s.client.embed(['x'], 'embed_query').catch(() => undefined);
    await expect(s.client.embed(['x'], 'embed_query')).rejects.toMatchObject({ kind: 'breaker' });
    await expect(s.client.embed(['x'], 'embed_catalog')).resolves.toBeDefined();
  });
});

describe('the Gemini adapter classifies what the SDK throws', () => {
  function gemini(error: unknown, extra: { fallbackModel?: string } = {}) {
    const generateContent = vi.fn<GeminiClientLike['models']['generateContent']>(async () => {
      throw error;
    });
    const provider = createGeminiProvider({
      client: { models: { generateContent, embedContent: vi.fn() } as never },
      model: 'primary',
      embedModel: 'e',
      embedDim: 4,
      ...extra,
    });
    return { provider, generateContent };
  }
  const failure = async (error: unknown) =>
    (await gemini(error)
      .provider.chatWithTools(chat)
      .catch((e) => e)) as ProviderError;

  it("a 503 with Google's JSON body: kind http, status, the code, and the short reason", async () => {
    const body = JSON.stringify({
      error: {
        code: 503,
        message: 'This model is currently experiencing high demand.',
        status: 'UNAVAILABLE',
      },
    });
    const e = await failure(Object.assign(new Error(body), { status: 503 }));
    expect(e).toMatchObject({ kind: 'http', status: 503, code: 'UNAVAILABLE' });
    expect(e.message).toMatch(/high demand/);
  });

  it("an error whose message is not Google's JSON is never echoed", async () => {
    const e = await failure(Object.assign(new Error('secret prompt echo'), { status: 429 }));
    expect(e).toMatchObject({ kind: 'http', status: 429 });
    expect(e.message).not.toMatch(/secret/);
  });

  it('a dropped connection is kind network with the system error code', async () => {
    const e = await failure(
      Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } }),
    );
    expect(e).toMatchObject({ kind: 'network', code: 'ECONNRESET' });
    expect(e.status).toBeUndefined();
  });

  it('an abort is kind timeout, anything else is other', async () => {
    expect(await failure(Object.assign(new Error('x'), { name: 'AbortError' }))).toMatchObject({
      kind: 'timeout',
    });
    expect(await failure(new RangeError('weird'))).toMatchObject({ kind: 'other' });
  });

  it('uses the model asked for on a call, and names the fallback it was built with', async () => {
    const generateContent = vi.fn<GeminiClientLike['models']['generateContent']>(async () => ({
      text: '{"ok":true}',
      candidates: [{ content: { parts: [{ text: 'hi' }] } }],
    }));
    const provider = createGeminiProvider({
      client: { models: { generateContent, embedContent: vi.fn() } as never },
      model: 'primary',
      embedModel: 'e',
      embedDim: 4,
      fallbackModel: 'backup',
    });
    expect(provider.fallbackModel).toBe('backup');
    expect((await provider.chatWithTools({ ...chat, model: 'backup' })).model).toBe('backup');
    expect((await provider.generateJson({ ...opts, model: 'backup' })).model).toBe('backup');
    expect((generateContent.mock.calls[0]?.[0] as { model: string }).model).toBe('backup');
    expect((generateContent.mock.calls[1]?.[0] as { model: string }).model).toBe('backup');
    expect((await provider.chatWithTools(chat)).model).toBe('primary');
    expect(
      createGeminiProvider({
        client: { models: { generateContent, embedContent: vi.fn() } as never },
        model: 'p',
        embedModel: 'e',
        embedDim: 4,
      }).fallbackModel,
    ).toBeNull();
  });
});
