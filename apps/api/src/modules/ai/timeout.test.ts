import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createAiClient, type Recorder } from './client.js';
import { createFakeProvider } from './fake.js';
import { REQUEST_TIMEOUT_MS, withRequestTimeout } from './timeout.js';
import { ProviderError } from './types.js';

const opts = {
  system: 's',
  user: 'u',
  schema: z.object({ ok: z.boolean() }),
  maxOutputTokens: 50,
  purpose: 'resolve_query' as const,
};
const hang = () => new Promise<never>(() => undefined);
const recorder: Recorder = { record: async () => 'id', markInvalid: async () => undefined };

describe('withRequestTimeout', () => {
  it('is 30 seconds by default', () => {
    expect(REQUEST_TIMEOUT_MS).toBe(30_000);
  });

  it.each(['generate', 'embed', 'chat'] as const)('a hanging %s call times out', async (kind) => {
    const fake = createFakeProvider();
    fake.onGenerate(hang);
    fake.onEmbed(hang);
    fake.onChat(hang);
    const p = withRequestTimeout(fake, 20);
    const call =
      kind === 'generate'
        ? p.generateJson(opts)
        : kind === 'embed'
          ? p.embed(['x'], 'embed_query')
          : p.chatWithTools({
              system: 's',
              messages: [{ role: 'user', text: 'u' }],
              tools: [],
              maxOutputTokens: 50,
              purpose: 'errand',
            });
    await expect(call).rejects.toMatchObject({ name: 'ProviderError', kind: 'timeout' });
  });

  it('aborts the signal the provider was given', async () => {
    const fake = createFakeProvider();
    fake.onGenerate(hang);
    let seen: AbortSignal | undefined;
    const spy: typeof fake = {
      ...fake,
      generateJson: (o) => ((seen = o.signal), fake.generateJson(o)),
    };
    await expect(withRequestTimeout(spy, 20).generateJson(opts)).rejects.toBeInstanceOf(
      ProviderError,
    );
    expect(seen?.aborted).toBe(true);
  });

  it('also stops when the caller aborts first', async () => {
    const fake = createFakeProvider();
    fake.onGenerate(hang);
    const caller = new AbortController();
    const call = withRequestTimeout(fake, 5_000).generateJson({ ...opts, signal: caller.signal });
    caller.abort();
    await expect(call).rejects.toMatchObject({ kind: 'timeout' });
  });

  it('passes a fast answer through untouched', async () => {
    const fake = createFakeProvider();
    fake.onGenerate(() => ({ ok: true }));
    const r = await withRequestTimeout(fake, 1_000).generateJson(opts);
    expect(r.data).toEqual({ ok: true });
  });

  it('keeps the provider identity (names, models)', () => {
    const fake = createFakeProvider({ fallbackModel: 'fb' });
    const p = withRequestTimeout(fake, 1_000);
    expect([p.name, p.model, p.fallbackModel, p.embedModel]).toEqual([
      'fake',
      'fake-model',
      'fb',
      'fake-embed',
    ]);
  });

  it('in production a timeout counts as a failure and the client falls back to the fallback model', async () => {
    const fake = createFakeProvider({ fallbackModel: 'fb-model' });
    let n = 0;
    fake.onGenerate(() => (n++ === 0 ? hang() : { ok: true }));
    const client = createAiClient({
      provider: withRequestTimeout(fake, 20),
      recorder,
      timeoutMs: 10_000, // the client's own limit is longer, so only the provider timeout fires
      retries: 1,
      sleep: async () => undefined,
    });
    const result = await client.generateJson(opts);
    expect(result.model).toBe('fb-model');
    expect(n).toBe(2);
  });
});
