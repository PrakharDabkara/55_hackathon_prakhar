import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createFakeProvider } from './fake.js';
import { InvalidOutputError } from './types.js';

const schema = z.object({ n: z.number() });
const generate = {
  system: 's',
  user: 'u',
  schema,
  maxOutputTokens: 10,
  purpose: 'resolve_query' as const,
};

describe('fake provider', () => {
  it('returns what the test scripts and validates it with the schema', async () => {
    const p = createFakeProvider();
    p.onGenerate(() => ({ n: 3 }));
    expect((await p.generateJson(generate)).data).toEqual({ n: 3 });
    p.onGenerate(() => ({ n: 'three' }));
    await expect(p.generateJson(generate)).rejects.toBeInstanceOf(InvalidOutputError);
  });

  it('records every call so a test can inspect what would have been sent', async () => {
    const p = createFakeProvider();
    p.onGenerate(() => ({ n: 1 }));
    await p.generateJson(generate);
    await p.embed(['a'], 'embed_query');
    expect(p.calls.map((c) => c.kind)).toEqual(['generate', 'embed']);
    expect(p.calls[0]).toMatchObject({
      kind: 'generate',
      user: 'u',
      system: 's',
      purpose: 'resolve_query',
    });
  });

  it('embeds deterministically into unit vectors of the configured size', async () => {
    const p = createFakeProvider({ dim: 16 });
    const [a1, b] = (await p.embed(['pen', 'sugar'], 'embed_query')).vectors;
    const [a2] = (await p.embed(['pen'], 'embed_catalog')).vectors;
    expect(a1).toEqual(a2);
    expect(a1).not.toEqual(b);
    expect(a1).toHaveLength(16);
    expect(Math.hypot(...(a1 as number[]))).toBeCloseTo(1, 6);
  });

  it('lets a test script the vectors', async () => {
    const p = createFakeProvider({ dim: 4 });
    p.onEmbed((texts) => texts.map(() => [1, 0, 0, 0]));
    expect((await p.embed(['x'], 'embed_query')).vectors).toEqual([[1, 0, 0, 0]]);
  });
});
