import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createGeminiProvider, type GeminiClientLike } from './gemini.js';
import { InvalidOutputError, ProviderError } from './types.js';

const schema = z.object({ itemId: z.string().nullable(), needsClarification: z.boolean() });

function setup(overrides: Partial<GeminiClientLike['models']> = {}) {
  const generateContent = vi.fn<GeminiClientLike['models']['generateContent']>(async () => ({
    text: '{"itemId":"abc","needsClarification":false}',
    usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 15 },
  }));
  const embedContent = vi.fn<GeminiClientLike['models']['embedContent']>(async () => ({
    embeddings: [{ values: [3, 4, 0, 0] }, { values: [0, 0, 6, 8] }],
  }));
  const client: GeminiClientLike = { models: { generateContent, embedContent, ...overrides } };
  const provider = createGeminiProvider({
    client,
    model: 'flash-x',
    embedModel: 'embed-x',
    embedDim: 4,
  });
  return { provider, generateContent, embedContent };
}

const opts = {
  system: 'SYS',
  user: 'USER',
  schema,
  maxOutputTokens: 64,
  purpose: 'resolve_query' as const,
};

describe('gemini generateJson', () => {
  it('asks for JSON at temperature 0 with the schema, the system prompt and a token cap', async () => {
    const { provider, generateContent } = setup();
    await provider.generateJson(opts);
    const params = generateContent.mock.calls[0]?.[0] as {
      model: string;
      contents: string;
      config: Record<string, unknown>;
    };
    expect(params.model).toBe('flash-x');
    expect(params.contents).toBe('USER');
    expect(params.config).toMatchObject({
      systemInstruction: 'SYS',
      temperature: 0,
      maxOutputTokens: 64,
      responseMimeType: 'application/json',
    });
    const jsonSchema = params.config['responseJsonSchema'] as {
      properties: Record<string, unknown>;
    };
    expect(Object.keys(jsonSchema.properties).sort()).toEqual(['itemId', 'needsClarification']);
  });

  it('returns the parsed data, the token usage, the model and the latency', async () => {
    const { provider } = setup();
    const result = await provider.generateJson(opts);
    expect(result.data).toEqual({ itemId: 'abc', needsClarification: false });
    expect(result.usage).toEqual({ inputTokens: 120, outputTokens: 15 });
    expect(result.model).toBe('flash-x');
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('counts thinking tokens as output, because they are billed as output', async () => {
    const { provider } = setup({
      generateContent: async () => ({
        text: '{"itemId":null,"needsClarification":false}',
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, thoughtsTokenCount: 40 },
      }),
    });
    expect((await provider.generateJson(opts)).usage).toEqual({
      inputTokens: 10,
      outputTokens: 45,
    });
  });

  it('rejects text that is not JSON, or JSON of the wrong shape, as invalid output', async () => {
    for (const text of ['not json', '{"itemId":5}', '', undefined]) {
      const { provider } = setup({ generateContent: async () => ({ text, usageMetadata: {} }) });
      await expect(provider.generateJson(opts)).rejects.toBeInstanceOf(InvalidOutputError);
    }
  });

  it('turns an SDK error into a ProviderError that keeps the HTTP status', async () => {
    const { provider } = setup({
      generateContent: async () => {
        throw Object.assign(new Error('quota'), { status: 429 });
      },
    });
    await expect(provider.generateJson(opts)).rejects.toMatchObject({
      name: 'ProviderError',
      status: 429,
    });
    await expect(provider.generateJson(opts)).rejects.toBeInstanceOf(ProviderError);
  });

  it('never puts the API key or the prompt in an error message', async () => {
    const { provider } = setup({
      generateContent: async () => {
        throw Object.assign(new Error('boom'), { status: 500 });
      },
    });
    const error = (await provider.generateJson(opts).catch((e: Error) => e)) as Error;
    expect(error.message).not.toMatch(/USER|SYS/);
  });
});

describe('gemini embed', () => {
  it('embeds a batch with the right task type and size, and returns unit vectors', async () => {
    const { provider, embedContent } = setup();
    const out = await provider.embed(['pen', 'sugar'], 'embed_query');
    const params = embedContent.mock.calls[0]?.[0] as {
      model: string;
      contents: string[];
      config: Record<string, unknown>;
    };
    expect(params).toMatchObject({
      model: 'embed-x',
      contents: ['pen', 'sugar'],
      config: { taskType: 'RETRIEVAL_QUERY', outputDimensionality: 4 },
    });
    // Cut-down embeddings are not unit length; cosine search wants them that way.
    expect(out.vectors).toEqual([
      [0.6, 0.8, 0, 0],
      [0, 0, 0.6, 0.8],
    ]);
  });

  it('uses the document task type for the catalog', async () => {
    const { provider, embedContent } = setup();
    await provider.embed(['a', 'b'], 'embed_catalog');
    expect(
      (embedContent.mock.calls[0]?.[0] as { config: { taskType: string } }).config.taskType,
    ).toBe('RETRIEVAL_DOCUMENT');
  });

  it('refuses an answer with the wrong number or size of vectors', async () => {
    const wrongCount = setup({
      embedContent: async () => ({ embeddings: [{ values: [1, 0, 0, 0] }] }),
    });
    await expect(wrongCount.provider.embed(['a', 'b'], 'embed_query')).rejects.toBeInstanceOf(
      InvalidOutputError,
    );
    const wrongSize = setup({
      embedContent: async () => ({ embeddings: [{ values: [1, 0] }, { values: [1, 0] }] }),
    });
    await expect(wrongSize.provider.embed(['a', 'b'], 'embed_query')).rejects.toBeInstanceOf(
      InvalidOutputError,
    );
  });

  it('estimates usage from the text, since embedding calls report none', async () => {
    const { provider } = setup();
    const out = await provider.embed(['ball pen', 'sugar'], 'embed_query');
    expect(out.usage.inputTokens).toBeGreaterThan(0);
    expect(out.usage.outputTokens).toBe(0);
  });
});
