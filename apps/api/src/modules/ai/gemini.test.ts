import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createGeminiProvider, type GeminiClientLike } from './gemini.js';
import { PrivacyGuardError } from './privacyGuard.js';
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

describe('gemini privacy guard', () => {
  const planted = 'sugar 9876543210';

  it('blocks a prompt with a phone number before the request leaves, for every kind of call', async () => {
    const { provider, generateContent, embedContent } = setup();
    await expect(provider.generateJson({ ...opts, user: planted })).rejects.toBeInstanceOf(
      PrivacyGuardError,
    );
    await expect(provider.generateJson({ ...opts, system: planted })).rejects.toBeInstanceOf(
      PrivacyGuardError,
    );
    await expect(
      provider.chatWithTools({
        system: 'SYS',
        messages: [{ role: 'user', text: planted }],
        tools: [],
        maxOutputTokens: 64,
        purpose: 'errand',
      }),
    ).rejects.toBeInstanceOf(PrivacyGuardError);
    await expect(
      provider.chatWithTools({
        system: 'SYS',
        messages: [
          { role: 'model', toolCalls: [{ id: 'c1', name: 'find_item_nearby', args: {} }] },
          {
            role: 'tool',
            results: [
              {
                id: 'c1',
                name: 'find_item_nearby',
                result: { shops: [{ name: 'Gupta 98765 43210' }] },
              },
            ],
          },
        ],
        tools: [],
        maxOutputTokens: 64,
        purpose: 'errand',
      }),
    ).rejects.toBeInstanceOf(PrivacyGuardError);
    await expect(provider.embed([planted], 'embed_query')).rejects.toBeInstanceOf(
      PrivacyGuardError,
    );
    expect(generateContent).not.toHaveBeenCalled();
    expect(embedContent).not.toHaveBeenCalled();
  });

  it('blocks an email, a coordinate pair and an address field too', async () => {
    const { provider, generateContent } = setup();
    for (const user of ['a@b.com', '22.7196, 75.8577', '{"address":"Flat 4"}'])
      await expect(provider.generateJson({ ...opts, user })).rejects.toBeInstanceOf(
        PrivacyGuardError,
      );
    expect(generateContent).not.toHaveBeenCalled();
  });

  it('logs why, without the content', async () => {
    const warn = vi.fn();
    const client: GeminiClientLike = {
      models: { generateContent: vi.fn(), embedContent: vi.fn() },
    };
    const provider = createGeminiProvider({
      client,
      model: 'm',
      embedModel: 'e',
      embedDim: 4,
      logger: { warn } as never,
    });
    await provider.generateJson({ ...opts, user: planted }).catch(() => undefined);
    expect(warn).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).toMatch(/phone/);
    expect(logged).not.toContain('9876543210');
  });

  it('lets a clean request through unchanged', async () => {
    const { provider, generateContent } = setup();
    await provider.generateJson(opts);
    expect(generateContent).toHaveBeenCalledTimes(1);
  });
});

// App round 3 (C-16a): the short classification calls do not need the model to think first. Left on
// its default, a Gemini 3 model spends seconds (and billed tokens) thinking about a one-line answer.
describe('gemini generateJson: thinking for short calls (C-16a)', () => {
  const configOf = async (
    model: string,
    extra: { thinking?: 'minimal' | 'model_default' } = {},
  ) => {
    const generateContent = vi.fn<GeminiClientLike['models']['generateContent']>(async () => ({
      text: '{"itemId":null,"needsClarification":false}',
    }));
    const provider = createGeminiProvider({
      client: { models: { generateContent, embedContent: vi.fn() } } as GeminiClientLike,
      model,
      embedModel: 'e',
      embedDim: 4,
      ...extra,
    });
    await provider.generateJson(opts);
    return (generateContent.mock.calls[0]?.[0] as { config: Record<string, unknown> }).config;
  };

  it('asks a Gemini 3 model for the minimal thinking level', async () => {
    expect((await configOf('gemini-3.1-flash-lite'))['thinkingConfig']).toEqual({
      thinkingLevel: 'MINIMAL',
    });
    expect((await configOf('gemini-3.5-flash-lite'))['thinkingConfig']).toEqual({
      thinkingLevel: 'MINIMAL',
    });
  });

  it('switches thinking off on a Gemini 2.5 flash model, which counts a budget instead', async () => {
    expect((await configOf('gemini-2.5-flash-lite'))['thinkingConfig']).toEqual({
      thinkingBudget: 0,
    });
  });

  it('sends nothing for a model it does not know, or when the model default is chosen', async () => {
    expect(await configOf('some-other-model')).not.toHaveProperty('thinkingConfig');
    expect(
      await configOf('gemini-3.1-flash-lite', { thinking: 'model_default' }),
    ).not.toHaveProperty('thinkingConfig');
  });

  it('follows the model of the call: a fallback is configured for its own family', async () => {
    const generateContent = vi.fn<GeminiClientLike['models']['generateContent']>(async () => ({
      text: '{"itemId":null,"needsClarification":false}',
    }));
    const provider = createGeminiProvider({
      client: { models: { generateContent, embedContent: vi.fn() } } as GeminiClientLike,
      model: 'gemini-3.1-flash-lite',
      fallbackModel: 'gemini-2.5-flash-lite',
      embedModel: 'e',
      embedDim: 4,
    });
    await provider.generateJson({ ...opts, model: 'gemini-2.5-flash-lite' });
    const config = (generateContent.mock.calls[0]?.[0] as { config: Record<string, unknown> })
      .config;
    expect(config['thinkingConfig']).toEqual({ thinkingBudget: 0 });
  });
});
