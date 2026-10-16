import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createAiClient, AiUnavailableError, type AiCallRow, type Recorder } from './client.js';
import { createFakeProvider } from './fake.js';
import { createGeminiProvider, type GeminiClientLike } from './gemini.js';
import { ProviderError, type ChatMessage, type ChatTool } from './types.js';

const tools: ChatTool[] = [
  {
    name: 'find_thing',
    description: 'Find a thing near the user.',
    input: z.object({ itemId: z.string().describe('the item id'), radiusM: z.number().optional() }),
  },
  { name: 'submit', description: 'Finish.', input: z.object({ notes: z.string().optional() }) },
];
const messages: ChatMessage[] = [{ role: 'user', text: 'chini lao' }];
const base = { system: 'SYS', messages, tools, maxOutputTokens: 500, purpose: 'errand' as const };

describe('the fake provider plays scripted chat turns', () => {
  it('returns the scripted tool calls, then text, with usage and model', async () => {
    const provider = createFakeProvider();
    provider.playChat([
      {
        toolCalls: [{ name: 'find_thing', args: { itemId: 'x' } }],
        usage: { inputTokens: 7, outputTokens: 3 },
      },
      { text: 'done' },
    ]);
    const first = await provider.chatWithTools(base);
    expect(first.toolCalls).toHaveLength(1);
    expect(first.toolCalls[0]).toMatchObject({ name: 'find_thing', args: { itemId: 'x' } });
    expect(first.toolCalls[0]?.id).toBeTruthy();
    expect(first.text).toBeNull();
    expect(first.usage).toEqual({ inputTokens: 7, outputTokens: 3 });
    expect(first.model).toBe('fake-model');

    const second = await provider.chatWithTools(base);
    expect(second.toolCalls).toEqual([]);
    expect(second.text).toBe('done');
  });

  it('records what it was sent, and fails when the script runs out or a turn is an error', async () => {
    const provider = createFakeProvider();
    provider.playChat([new ProviderError('boom', 503)]);
    await expect(provider.chatWithTools(base)).rejects.toBeInstanceOf(ProviderError);
    await expect(provider.chatWithTools(base)).rejects.toThrow(/no scripted turn/i);
    expect(provider.calls.filter((c) => c.kind === 'chat')).toHaveLength(2);
    expect(provider.calls[0]).toMatchObject({
      kind: 'chat',
      system: 'SYS',
      purpose: 'errand',
      toolNames: ['find_thing', 'submit'],
    });
  });

  it('lets a turn be a function of the request', async () => {
    const provider = createFakeProvider();
    provider.playChat([(req) => ({ text: `saw ${req.messages.length} message` })]);
    expect((await provider.chatWithTools(base)).text).toBe('saw 1 message');
  });
});

describe('gemini chatWithTools', () => {
  function setup(response: unknown = { candidates: [{ content: { parts: [{ text: 'hi' }] } }] }) {
    const generateContent = vi.fn<GeminiClientLike['models']['generateContent']>(
      async () => response as never,
    );
    const client: GeminiClientLike = {
      models: { generateContent, embedContent: vi.fn() as never },
    };
    const provider = createGeminiProvider({
      client,
      model: 'flash-x',
      embedModel: 'e',
      embedDim: 4,
    });
    return { provider, generateContent };
  }
  const paramsOf = (fn: ReturnType<typeof setup>['generateContent']) =>
    fn.mock.calls[0]?.[0] as {
      model: string;
      contents: { role: string; parts: Record<string, unknown>[] }[];
      config: {
        tools: {
          functionDeclarations: {
            name: string;
            description: string;
            parametersJsonSchema: unknown;
          }[];
        }[];
        [key: string]: unknown;
      };
    };

  it('declares the functions from the zod schemas, at temperature 0 with a token cap', async () => {
    const { provider, generateContent } = setup();
    await provider.chatWithTools(base);
    const p = paramsOf(generateContent);
    expect(p.model).toBe('flash-x');
    expect(p.config).toMatchObject({
      systemInstruction: 'SYS',
      temperature: 0,
      maxOutputTokens: 500,
    });
    const decls = p.config.tools[0]?.functionDeclarations ?? [];
    expect(decls.map((d: { name: string }) => d.name)).toEqual(['find_thing', 'submit']);
    expect(decls[0]?.description).toBe('Find a thing near the user.');
    expect(decls[0]?.parametersJsonSchema).toMatchObject({
      type: 'object',
      required: ['itemId'],
      properties: { itemId: { type: 'string', description: 'the item id' } },
    });
    expect(decls[0]?.parametersJsonSchema).not.toHaveProperty('$schema');
  });

  it('forces one function when asked', async () => {
    const { provider, generateContent } = setup();
    await provider.chatWithTools({ ...base, forceTool: 'submit' });
    expect(paramsOf(generateContent).config['toolConfig']).toEqual({
      functionCallingConfig: { mode: 'ANY', allowedFunctionNames: ['submit'] },
    });
  });

  it('maps our messages to Gemini contents, merging consecutive user turns', async () => {
    const { provider, generateContent } = setup();
    await provider.chatWithTools({
      ...base,
      messages: [
        { role: 'user', text: 'task' },
        {
          role: 'model',
          toolCalls: [{ id: 'c1', name: 'find_thing', args: { itemId: 'x' }, signature: 'sig' }],
        },
        { role: 'tool', results: [{ id: 'c1', name: 'find_thing', result: { count: 2 } }] },
        { role: 'user', text: 'budget reached' },
      ],
    });
    const { contents } = paramsOf(generateContent);
    expect(contents.map((c) => c.role)).toEqual(['user', 'model', 'user']);
    expect(contents[1]?.parts[0]).toMatchObject({
      functionCall: { name: 'find_thing', args: { itemId: 'x' } },
      thoughtSignature: 'sig',
    });
    expect(contents[2]?.parts[0]).toMatchObject({
      functionResponse: { name: 'find_thing', response: { output: { count: 2 } } },
    });
    expect(contents[2]?.parts[1]).toEqual({ text: 'budget reached' });
  });

  it('returns the function calls with their signatures, usage and latency', async () => {
    const { provider } = setup({
      candidates: [
        {
          content: {
            parts: [
              {
                functionCall: { name: 'find_thing', args: { itemId: 'x' } },
                thoughtSignature: 's1',
              },
              { functionCall: { id: 'given', name: 'submit', args: {} } },
            ],
          },
        },
      ],
      usageMetadata: { promptTokenCount: 200, candidatesTokenCount: 20, thoughtsTokenCount: 5 },
    });
    const result = await provider.chatWithTools(base);
    expect(result.toolCalls).toHaveLength(2);
    expect(result.toolCalls[0]).toMatchObject({
      name: 'find_thing',
      args: { itemId: 'x' },
      signature: 's1',
    });
    expect(result.toolCalls[1]?.id).toBe('given');
    expect(result.text).toBeNull();
    expect(result.usage).toEqual({ inputTokens: 200, outputTokens: 25 });
    expect(result.model).toBe('flash-x');
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('returns text when there are no function calls', async () => {
    const { provider } = setup();
    const result = await provider.chatWithTools(base);
    expect(result.toolCalls).toEqual([]);
    expect(result.text).toBe('hi');
  });

  it('keeps only the HTTP status of a failure', async () => {
    const generateContent = vi.fn(async () => {
      throw Object.assign(new Error('secret prompt echo'), { status: 429 });
    });
    const provider = createGeminiProvider({
      client: { models: { generateContent, embedContent: vi.fn() } as never },
      model: 'm',
      embedModel: 'e',
      embedDim: 4,
    });
    const error = await provider.chatWithTools(base).catch((e) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect(error.status).toBe(429);
    expect(error.message).not.toMatch(/secret/);
  });
});

describe('createAiClient.chatWithTools', () => {
  function setup() {
    const rows: AiCallRow[] = [];
    const recorder: Recorder = {
      record: async (row) => (rows.push(row), `call-${rows.length}`),
      markInvalid: async () => undefined,
    };
    const provider = createFakeProvider();
    const client = createAiClient({ provider, recorder, sleep: async () => undefined });
    return { provider, client, rows };
  }

  it('writes one ai_calls row with purpose "errand", tokens and the request id', async () => {
    const { provider, client, rows } = setup();
    provider.playChat([{ text: 'ok', usage: { inputTokens: 40, outputTokens: 9 } }]);
    const result = await client.chatWithTools({ ...base, requestId: 'req-9' });
    expect(result.text).toBe('ok');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      purpose: 'errand',
      provider: 'fake',
      inputTokens: 40,
      outputTokens: 9,
      outcome: 'ok',
      requestId: 'req-9',
    });
  });

  it('retries once on a 503 and then gives up with AiUnavailableError', async () => {
    const { provider, client, rows } = setup();
    provider.playChat([new ProviderError('x', 503), new ProviderError('x', 503)]);
    await expect(client.chatWithTools(base)).rejects.toBeInstanceOf(AiUnavailableError);
    expect(provider.calls.filter((c) => c.kind === 'chat')).toHaveLength(2);
    expect(rows.map((r) => r.outcome)).toEqual(['http']);
  });

  it('retries as often as the caller asks, and no more', async () => {
    const { provider, client } = setup();
    const busy = () => new ProviderError('x', 503);
    provider.playChat([busy(), busy(), busy(), { text: 'at last' }]);
    expect((await client.chatWithTools({ ...base, retries: 3 })).text).toBe('at last');
    provider.playChat([busy(), busy(), busy(), busy(), busy()]);
    await expect(client.chatWithTools({ ...base, retries: 3 })).rejects.toBeInstanceOf(
      AiUnavailableError,
    );
    expect(provider.calls.filter((c) => c.kind === 'chat')).toHaveLength(4 + 4);
  });

  it('succeeds when the retry does', async () => {
    const { provider, client } = setup();
    provider.playChat([new ProviderError('x', 503), { text: 'fine' }]);
    expect((await client.chatWithTools(base)).text).toBe('fine');
  });
});
