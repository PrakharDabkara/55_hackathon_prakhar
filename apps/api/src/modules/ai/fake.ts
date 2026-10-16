import { createHash } from 'node:crypto';
import {
  InvalidOutputError,
  type ChatMessage,
  type ChatWithToolsOptions,
  type ChatWithToolsResult,
  type EmbedPurpose,
  type EmbedResult,
  type GenerateJsonOptions,
  type GenerateJsonResult,
  type LlmProvider,
  type Purpose,
  type Usage,
} from './types.js';

export type FakeCall =
  | { kind: 'generate'; system: string; user: string; purpose: Purpose; model?: string }
  | { kind: 'embed'; texts: string[]; purpose: EmbedPurpose }
  | {
      kind: 'chat';
      system: string;
      /** A copy: the caller keeps appending to its own list. */
      messages: ChatMessage[];
      toolNames: string[];
      purpose: Purpose;
      model?: string;
      forceTool?: string;
    };

/** What a scripted model does in one turn: call tools, or answer in text. An Error is thrown. */
export type FakeChatTurn =
  | { toolCalls?: { name: string; args: Record<string, unknown>; signature?: string }[]; text?: string; usage?: Usage }
  | Error;
export type FakeChatScript =
  FakeChatTurn | ((request: ChatWithToolsOptions) => FakeChatTurn | Promise<FakeChatTurn>);

export interface FakeProvider extends LlmProvider {
  /** Everything that was sent, in order, so a test can check what would have left the machine. */
  calls: FakeCall[];
  /** Script the answer to the next and every later generateJson call. Throw to fail. */
  onGenerate(
    handler: (options: { system: string; user: string; purpose: Purpose }) => unknown,
  ): void;
  /** Script the vectors; the default turns text into a fixed pseudo-random unit vector. */
  onEmbed(
    handler: (texts: string[], purpose: EmbedPurpose) => number[][] | Promise<number[][]>,
  ): void;
  /** Script the answer to every chatWithTools call (a handler may be async, return a turn or throw). */
  onChat(handler: (request: ChatWithToolsOptions) => FakeChatTurn | Promise<FakeChatTurn>): void;
  /** Script chatWithTools turns in order; a call after the last one fails. */
  playChat(turns: FakeChatScript[]): void;
}

const words = (text: string) => text.split(/\s+/).filter(Boolean).length;

/** A fixed unit vector per text: the same text always gives the same one, different texts are nearly orthogonal. */
function hashVector(text: string, dim: number): number[] {
  const v: number[] = [];
  for (let block = 0; v.length < dim; block++) {
    const digest = createHash('sha256').update(`${block}:${text}`).digest();
    for (const byte of digest) {
      if (v.length < dim) v.push(byte - 127.5);
    }
  }
  const norm = Math.hypot(...v);
  return v.map((x) => x / norm);
}

/**
 * A deterministic stand-in for a real model, for tests and for local work without a key. By default
 * it answers "none of these"; a test scripts anything else.
 */
export function createFakeProvider({
  dim = 768,
  fallbackModel = null,
}: { dim?: number; fallbackModel?: string | null } = {}): FakeProvider {
  let generate: Parameters<FakeProvider['onGenerate']>[0] = () => ({
    itemId: null,
    needsClarification: false,
  });
  let embed: Parameters<FakeProvider['onEmbed']>[0] = (texts) =>
    texts.map((t) => hashVector(t, dim));
  const calls: FakeCall[] = [];
  let chat: Parameters<FakeProvider['onChat']>[0] = () => {
    throw new Error('no scripted turn: call playChat or onChat first');
  };
  let toolCallCounter = 0;

  return {
    name: 'fake',
    model: 'fake-model',
    fallbackModel,
    embedModel: 'fake-embed',
    calls,
    onGenerate: (handler) => void (generate = handler),
    onEmbed: (handler) => void (embed = handler),
    onChat: (handler) => void (chat = handler),
    playChat(turns) {
      const queue = [...turns];
      chat = async (request) => {
        const next = queue.shift();
        if (next === undefined) throw new Error('no scripted turn left');
        return typeof next === 'function' ? next(request) : next;
      };
    },

    async chatWithTools(options): Promise<ChatWithToolsResult> {
      calls.push({
        kind: 'chat',
        system: options.system,
        messages: structuredClone(options.messages),
        toolNames: options.tools.map((t) => t.name),
        purpose: options.purpose,
        ...(options.model && { model: options.model }),
        ...(options.forceTool && { forceTool: options.forceTool }),
      });
      const turn = await chat(options);
      if (turn instanceof Error) throw turn;
      const toolCalls = (turn.toolCalls ?? []).map((c) => ({
        id: `fake-call-${++toolCallCounter}`,
        name: c.name,
        args: c.args,
        ...(c.signature && { signature: c.signature }),
      }));
      return {
        toolCalls,
        text: toolCalls.length > 0 ? null : (turn.text ?? ''),
        usage: turn.usage ?? {
          inputTokens: words(options.system) + words(JSON.stringify(options.messages)),
          outputTokens: words(JSON.stringify(turn)),
        },
        model: options.model ?? 'fake-model',
        latencyMs: 1,
      };
    },

    async generateJson<T>(options: GenerateJsonOptions<T>): Promise<GenerateJsonResult<T>> {
      const { system, user, purpose } = options;
      calls.push({
        kind: 'generate',
        system,
        user,
        purpose,
        ...(options.model && { model: options.model }),
      });
      const raw = await generate({ system, user, purpose });
      const parsed = options.schema.safeParse(raw);
      if (!parsed.success)
        throw new InvalidOutputError('the fake answer does not match the schema');
      return {
        data: parsed.data,
        usage: {
          inputTokens: words(system) + words(user),
          outputTokens: words(JSON.stringify(raw)),
        },
        model: options.model ?? 'fake-model',
        latencyMs: 1,
      };
    },

    async embed(texts, purpose): Promise<EmbedResult> {
      calls.push({ kind: 'embed', texts, purpose });
      return {
        vectors: await embed(texts, purpose),
        usage: { inputTokens: texts.reduce((n, t) => n + words(t), 0), outputTokens: 0 },
        model: 'fake-embed',
        latencyMs: 1,
      };
    },
  };
}
