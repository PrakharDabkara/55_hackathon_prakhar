import { GoogleGenAI } from '@google/genai';
import { z } from 'zod';
import {
  InvalidOutputError,
  ProviderError,
  type EmbedPurpose,
  type EmbedResult,
  type GenerateJsonOptions,
  type GenerateJsonResult,
  type LlmProvider,
} from './types.js';

/** The slice of the Google SDK we use, so tests can stand in for it. */
export interface GeminiClientLike {
  models: {
    generateContent(params: unknown): Promise<{
      text?: string | undefined;
      usageMetadata?:
        | { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number }
        | undefined;
    }>;
    embedContent(
      params: unknown,
    ): Promise<{ embeddings?: { values?: number[] | undefined }[] | undefined }>;
  };
}

interface Options {
  apiKey?: string;
  client?: GeminiClientLike;
  model: string;
  embedModel: string;
  embedDim: number;
}

const TASK_TYPE: Record<EmbedPurpose, string> = {
  embed_query: 'RETRIEVAL_QUERY',
  embed_catalog: 'RETRIEVAL_DOCUMENT',
};

/** Roughly four characters per token: embedding calls report no usage, and this is only for the audit table. */
const estimateTokens = (text: string) => Math.ceil(text.length / 4);

/** The schema as the API wants it: plain JSON Schema without the `$schema` marker. */
function jsonSchemaFor(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema) as Record<string, unknown>;
  delete json['$schema'];
  return json;
}

/** The SDK's errors carry the HTTP status; keep it, drop everything else (messages can echo a request). */
function wrap(error: unknown): ProviderError {
  const status = (error as { status?: unknown })?.status;
  return new ProviderError(
    'the Gemini call failed',
    typeof status === 'number' ? status : undefined,
  );
}

/** Gemini through Google's official SDK: JSON output with a response schema at temperature 0. */
export function createGeminiProvider({
  apiKey,
  client,
  model,
  embedModel,
  embedDim,
}: Options): LlmProvider {
  const ai: GeminiClientLike =
    client ?? (new GoogleGenAI({ apiKey: apiKey as string }) as unknown as GeminiClientLike);

  return {
    name: 'gemini',
    model,
    embedModel,

    async generateJson<T>(options: GenerateJsonOptions<T>): Promise<GenerateJsonResult<T>> {
      const started = Date.now();
      let response;
      try {
        response = await ai.models.generateContent({
          model,
          contents: options.user,
          config: {
            systemInstruction: options.system,
            temperature: 0,
            maxOutputTokens: options.maxOutputTokens,
            responseMimeType: 'application/json',
            responseJsonSchema: jsonSchemaFor(options.schema),
            ...(options.signal && { abortSignal: options.signal }),
          },
        });
      } catch (error) {
        throw wrap(error);
      }

      let data: unknown;
      try {
        data = JSON.parse(response.text ?? '');
      } catch {
        throw new InvalidOutputError('the answer is not JSON');
      }
      const parsed = options.schema.safeParse(data);
      if (!parsed.success) throw new InvalidOutputError('the answer does not match the schema');

      const usage = response.usageMetadata ?? {};
      return {
        data: parsed.data,
        // Thinking tokens are billed as output.
        usage: {
          inputTokens: usage.promptTokenCount ?? 0,
          outputTokens: (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0),
        },
        model,
        latencyMs: Date.now() - started,
      };
    },

    async embed(texts, purpose, signal): Promise<EmbedResult> {
      const started = Date.now();
      let response;
      try {
        response = await ai.models.embedContent({
          model: embedModel,
          contents: texts,
          config: {
            taskType: TASK_TYPE[purpose],
            outputDimensionality: embedDim,
            ...(signal && { abortSignal: signal }),
          },
        });
      } catch (error) {
        throw wrap(error);
      }

      const rows = response.embeddings ?? [];
      if (rows.length !== texts.length || rows.some((r) => r.values?.length !== embedDim)) {
        throw new InvalidOutputError('the embeddings do not match the request');
      }
      // A cut-down embedding is not unit length; cosine search is simplest when it is.
      const vectors = rows.map((r) => {
        const values = r.values as number[];
        const norm = Math.hypot(...values) || 1;
        return values.map((x) => x / norm);
      });
      return {
        vectors,
        usage: { inputTokens: texts.reduce((n, t) => n + estimateTokens(t), 0), outputTokens: 0 },
        model: embedModel,
        latencyMs: Date.now() - started,
      };
    },
  };
}
