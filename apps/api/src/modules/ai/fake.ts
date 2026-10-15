import { createHash } from 'node:crypto';
import {
  InvalidOutputError,
  type EmbedPurpose,
  type EmbedResult,
  type GenerateJsonOptions,
  type GenerateJsonResult,
  type LlmProvider,
  type Purpose,
} from './types.js';

export type FakeCall =
  | { kind: 'generate'; system: string; user: string; purpose: Purpose }
  | { kind: 'embed'; texts: string[]; purpose: EmbedPurpose };

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
export function createFakeProvider({ dim = 768 }: { dim?: number } = {}): FakeProvider {
  let generate: Parameters<FakeProvider['onGenerate']>[0] = () => ({
    itemId: null,
    needsClarification: false,
  });
  let embed: Parameters<FakeProvider['onEmbed']>[0] = (texts) =>
    texts.map((t) => hashVector(t, dim));
  const calls: FakeCall[] = [];

  return {
    name: 'fake',
    model: 'fake-model',
    embedModel: 'fake-embed',
    calls,
    onGenerate: (handler) => void (generate = handler),
    onEmbed: (handler) => void (embed = handler),

    async generateJson<T>(options: GenerateJsonOptions<T>): Promise<GenerateJsonResult<T>> {
      const { system, user, purpose } = options;
      calls.push({ kind: 'generate', system, user, purpose });
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
        model: 'fake-model',
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
