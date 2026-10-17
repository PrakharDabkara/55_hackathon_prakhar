import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createAiClient, AiUnavailableError, type AiCallRow, type Recorder } from './client.js';
import { createFakeProvider } from './fake.js';
import { ProviderError } from './types.js';

const schema = z.object({ ok: z.boolean() });
const opts = {
  system: 's',
  user: 'u',
  schema,
  maxOutputTokens: 50,
  purpose: 'resolve_query' as const,
};

function setup(overrides: Partial<Parameters<typeof createAiClient>[0]> = {}) {
  const rows: AiCallRow[] = [];
  const recorder: Recorder = {
    record: async (row) => {
      rows.push(row);
      return `call-${rows.length}`;
    },
    markInvalid: async () => undefined,
  };
  const provider = createFakeProvider();
  provider.onGenerate(() => ({ ok: true }));
  let clock = 1_000_000;
  const sleeps: number[] = [];
  const client = createAiClient({
    provider,
    recorder,
    now: () => clock,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    backoffMs: 250,
    ...overrides,
  });
  return { client, provider, rows, sleeps, advance: (ms: number) => (clock += ms) };
}

describe('createAiClient', () => {
  it('returns the data and writes one ai_calls row with tokens, latency and no prompt text', async () => {
    const { client, rows } = setup();
    const result = await client.generateJson({ ...opts, requestId: 'req-1' });
    expect(result.data).toEqual({ ok: true });
    expect(result.callId).toBe('call-1');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      purpose: 'resolve_query',
      provider: 'fake',
      outcome: 'ok',
      requestId: 'req-1',
    });
    expect(rows[0]?.inputTokens).toBeGreaterThanOrEqual(0);
    expect(rows[0]?.latencyMs).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(rows[0])).not.toMatch(/"s"|"u"/);
    expect(Object.keys(rows[0] ?? {}).sort()).toEqual(
      [
        'inputTokens',
        'latencyMs',
        'model',
        'outcome',
        'outputTokens',
        'provider',
        'purpose',
        'requestId',
      ].sort(),
    );
  });

  it('records embeddings too', async () => {
    const { client, rows } = setup();
    const out = await client.embed(['a', 'b'], 'embed_query', 'req-2');
    expect(out.vectors).toHaveLength(2);
    expect(rows[0]).toMatchObject({ purpose: 'embed_query', outcome: 'ok', requestId: 'req-2' });
  });

  describe('retries', () => {
    it.each([429, 500, 503])('retries once with a backoff on %i, then succeeds', async (status) => {
      const { client, provider, rows, sleeps } = setup();
      let calls = 0;
      provider.onGenerate(() => {
        if (calls++ === 0) throw new ProviderError('busy', status);
        return { ok: true };
      });
      await expect(client.generateJson(opts)).resolves.toMatchObject({ data: { ok: true } });
      expect(calls).toBe(2);
      expect(sleeps).toEqual([250]);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.outcome).toBe('ok');
    });

    it('gives up after one retry and records an error', async () => {
      const { client, provider, rows } = setup();
      let calls = 0;
      provider.onGenerate(() => {
        calls++;
        throw new ProviderError('down', 503);
      });
      await expect(client.generateJson(opts)).rejects.toMatchObject({ kind: 'http' });
      expect(calls).toBe(2);
      expect(rows.map((r) => r.outcome)).toEqual(['http']);
    });

    it('does not retry a client error such as 400 or 401', async () => {
      const { client, provider } = setup();
      let calls = 0;
      provider.onGenerate(() => {
        calls++;
        throw new ProviderError('bad key', 401);
      });
      await expect(client.generateJson(opts)).rejects.toBeInstanceOf(AiUnavailableError);
      expect(calls).toBe(1);
    });
  });

  describe('timeout', () => {
    it('gives up after the time limit, whatever the provider is doing', async () => {
      const { client, provider, rows } = setup({ timeoutMs: 40, retries: 0 });
      provider.onGenerate(() => new Promise(() => undefined));
      const started = Date.now();
      await expect(client.generateJson(opts)).rejects.toMatchObject({ kind: 'timeout' });
      expect(Date.now() - started).toBeLessThan(1000);
      expect(rows[0]?.outcome).toBe('timeout');
    });

    it('defaults to 8 seconds', () => {
      expect(createAiClient.DEFAULT_TIMEOUT_MS).toBe(8000);
    });
  });

  describe('invalid output', () => {
    it('is recorded as invalid_output, not retried, and does not count against the breaker', async () => {
      const { client, provider, rows } = setup();
      let calls = 0;
      provider.onGenerate(() => {
        calls++;
        return { wrong: 'shape' };
      });
      for (let i = 0; i < 8; i++) {
        await expect(client.generateJson(opts)).rejects.toMatchObject({ kind: 'invalid_output' });
      }
      expect(calls).toBe(8); // the breaker never opened
      expect(rows.every((r) => r.outcome === 'invalid_output')).toBe(true);
    });

    it('can be marked after the fact, when the answer parsed but broke a rule', async () => {
      const markInvalid = vi.fn(async () => undefined);
      const { client } = setup({ recorder: { record: async () => 'c1', markInvalid } });
      const result = await client.generateJson(opts);
      await client.markInvalid(result.callId);
      expect(markInvalid).toHaveBeenCalledWith('c1');
      await client.markInvalid(null); // no row, nothing to do
      expect(markInvalid).toHaveBeenCalledTimes(1);
    });
  });

  describe('circuit breaker', () => {
    const failing = (provider: ReturnType<typeof createFakeProvider>) => {
      let calls = 0;
      provider.onGenerate(() => {
        calls++;
        throw new ProviderError('down', 500);
      });
      return () => calls;
    };

    it('opens after 5 failures in a row: the 6th call skips the provider and is recorded as breaker', async () => {
      const { client, provider, rows } = setup({ retries: 0 });
      const calls = failing(provider);
      for (let i = 0; i < 5; i++)
        await expect(client.generateJson(opts)).rejects.toMatchObject({ kind: 'http' });
      expect(calls()).toBe(5);
      await expect(client.generateJson(opts)).rejects.toMatchObject({ kind: 'breaker' });
      expect(calls()).toBe(5);
      expect(rows.at(-1)).toMatchObject({
        outcome: 'breaker',
        inputTokens: 0,
        outputTokens: 0,
      });
    });

    it('keeps one breaker for generating and one for embedding, so one failing does not stop the other', async () => {
      const { client, provider } = setup({ retries: 0 });
      failing(provider);
      for (let i = 0; i < 5; i++) await client.generateJson(opts).catch(() => undefined);
      await expect(client.generateJson(opts)).rejects.toMatchObject({ kind: 'breaker' });
      await expect(client.embed(['x'], 'embed_query')).resolves.toMatchObject({
        vectors: expect.any(Array),
      });
    });

    it('a success of the other kind does not reset the count', async () => {
      const { client, provider } = setup({ retries: 0 });
      const calls = failing(provider);
      for (let i = 0; i < 5; i++) {
        await client.generateJson(opts).catch(() => undefined);
        await client.embed(['x'], 'embed_query'); // works every time
      }
      await expect(client.generateJson(opts)).rejects.toMatchObject({ kind: 'breaker' });
      expect(calls()).toBe(5);
    });

    it('closes again after 60 seconds: one trial call, and success resets it', async () => {
      const { client, provider, advance } = setup({ retries: 0 });
      failing(provider);
      for (let i = 0; i < 5; i++) await client.generateJson(opts).catch(() => undefined);
      advance(59_000);
      await expect(client.generateJson(opts)).rejects.toMatchObject({ kind: 'breaker' });
      advance(2000);
      provider.onGenerate(() => ({ ok: true }));
      await expect(client.generateJson(opts)).resolves.toMatchObject({ data: { ok: true } });
      await expect(client.generateJson(opts)).resolves.toBeDefined(); // closed for good
    });

    it('a failed trial reopens it for another 60 seconds', async () => {
      const { client, provider, advance } = setup({ retries: 0 });
      const calls = failing(provider);
      for (let i = 0; i < 5; i++) await client.generateJson(opts).catch(() => undefined);
      advance(61_000);
      await expect(client.generateJson(opts)).rejects.toMatchObject({ kind: 'http' });
      expect(calls()).toBe(6);
      await expect(client.generateJson(opts)).rejects.toMatchObject({ kind: 'breaker' });
    });

    it('a success in between resets the count', async () => {
      const { client, provider } = setup({ retries: 0 });
      let n = 0;
      provider.onGenerate(() => {
        if (++n % 5 === 0) return { ok: true };
        throw new ProviderError('down', 500);
      });
      for (let i = 0; i < 20; i++) {
        await client.generateJson(opts).catch(() => undefined);
      }
      expect(n).toBe(20); // 4 failures then a success, over and over: never 5 in a row
    });
  });

  it('never fails because the audit row could not be written', async () => {
    const { client } = setup({
      recorder: {
        record: async () => {
          throw new Error('db is down');
        },
        markInvalid: async () => undefined,
      },
    });
    await expect(client.generateJson(opts)).resolves.toMatchObject({
      data: { ok: true },
      callId: null,
    });
  });
});

describe('createAiClient: a model per purpose (Day 14c)', () => {
  const chat = { system: 's', messages: [], tools: [], purpose: 'errand' as const };
  const models = { errand: { model: 'errand-model', fallbackModel: 'errand-fallback' } };

  it('runs the errand agent on its own model and leaves every other purpose on the provider’s', async () => {
    const { client, provider } = setup({ models });
    provider.onChat(() => ({ text: 'ok' }));
    await client.chatWithTools(chat as never);
    await client.generateJson({ ...opts, requestId: 'r' });
    const chatCall = provider.calls.find((c) => c.kind === 'chat');
    const jsonCall = provider.calls.find((c) => c.kind === 'generate');
    expect(chatCall).toMatchObject({ model: 'errand-model' });
    expect(jsonCall?.model).toBeUndefined();
  });

  it('after a 503 the errand agent tries its own fallback, not the provider’s', async () => {
    const { client, provider } = setup({ models });
    let n = 0;
    provider.onChat(() => {
      if (n++ === 0) throw new ProviderError('busy', 503, { kind: 'http' });
      return { text: 'ok' };
    });
    await client.chatWithTools({ ...chat, retries: 1 } as never);
    const models_ = provider.calls.filter((c) => c.kind === 'chat').map((c) => c.model);
    expect(models_).toEqual(['errand-model', 'errand-fallback']);
  });

  it('an errand model with no fallback never switches model on a retry', async () => {
    const { client, provider } = setup({
      models: { errand: { model: 'errand-model', fallbackModel: null } },
    });
    let n = 0;
    provider.onChat(() => {
      if (n++ === 0) throw new ProviderError('busy', 503, { kind: 'http' });
      return { text: 'ok' };
    });
    await client.chatWithTools({ ...chat, retries: 1 } as never);
    expect(provider.calls.filter((c) => c.kind === 'chat').map((c) => c.model)).toEqual([
      'errand-model',
      'errand-model',
    ]);
  });

  it('with no per-purpose models nothing changes', async () => {
    const { client, provider } = setup();
    provider.onChat(() => ({ text: 'ok' }));
    await client.chatWithTools(chat as never);
    expect(provider.calls.find((c) => c.kind === 'chat')?.model).toBeUndefined();
  });
});
