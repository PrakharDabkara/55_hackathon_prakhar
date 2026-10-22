import { GoogleGenAI } from '@google/genai';
import type { Logger } from 'pino';
import { z } from 'zod';
import { assertNoPrivateData, PrivacyGuardError } from './privacyGuard.js';
import { sanitiseMessage } from './failure.js';
import { rateLimitInfo, type RateLimitBody } from './quota.js';
import {
  InvalidOutputError,
  ProviderError,
  type EmbedPurpose,
  type EmbedResult,
  type GenerateJsonOptions,
  type ChatMessage,
  type ChatWithToolsOptions,
  type ChatWithToolsResult,
  type GenerateJsonResult,
  type LlmProvider,
} from './types.js';

/** The slice of the Google SDK we use, so tests can stand in for it. */
export interface GeminiClientLike {
  models: {
    generateContent(params: unknown): Promise<{
      text?: string | undefined;
      candidates?:
        | {
            content?:
              | {
                  parts?:
                    | {
                        text?: string | undefined;
                        thought?: boolean | undefined;
                        thoughtSignature?: string | undefined;
                        functionCall?:
                          | {
                              id?: string | undefined;
                              name?: string | undefined;
                              args?: Record<string, unknown> | undefined;
                            }
                          | undefined;
                      }[]
                    | undefined;
                }
              | undefined;
          }[]
        | undefined;
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
  fallbackModel?: string | null;
  embedModel: string;
  embedDim: number;
  /** Where a blocked prompt is logged (the reason only). */
  logger?: Pick<Logger, 'warn'>;
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

type Part = Record<string, unknown>;

/**
 * Our messages as Gemini contents. Tool results and plain user text both have the role "user", and
 * Gemini wants one turn per role change, so neighbours with the same role are merged.
 */
function toContents(messages: ChatMessage[]): { role: 'user' | 'model'; parts: Part[] }[] {
  const contents: { role: 'user' | 'model'; parts: Part[] }[] = [];
  const push = (role: 'user' | 'model', parts: Part[]) => {
    const last = contents.at(-1);
    if (last?.role === role) last.parts.push(...parts);
    else contents.push({ role, parts });
  };
  for (const m of messages) {
    if (m.role === 'user') push('user', [{ text: m.text }]);
    else if (m.role === 'tool')
      push(
        'user',
        m.results.map((r) => ({
          functionResponse: { name: r.name, response: { output: r.result } },
        })),
      );
    else {
      const parts: Part[] = [];
      if (m.text) parts.push({ text: m.text });
      for (const c of m.toolCalls ?? [])
        parts.push({
          functionCall: { name: c.name, args: c.args },
          ...(c.signature && { thoughtSignature: c.signature }),
        });
      if (parts.length > 0) push('model', parts);
    }
  }
  return contents;
}

const NETWORK_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ENOTFOUND',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'EPIPE',
  'ECONNABORTED',
  'UND_ERR_SOCKET',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
]);

/** Google's error text is JSON: {"error": {"code", "message", "status": "UNAVAILABLE"}}. */
function parseBody(message: unknown): RateLimitBody | null {
  if (typeof message !== 'string') return null;
  try {
    const error = (
      JSON.parse(message) as {
        error?: { message?: unknown; status?: unknown; details?: unknown };
      }
    ).error;
    return {
      ...(error?.details !== undefined && { details: error.details }),
      ...(typeof error?.message === 'string' && { message: error.message }),
      ...(typeof error?.status === 'string' &&
        /^[A-Z_]{3,40}$/.test(error.status) && { status: error.status }),
    };
  } catch {
    return null;
  }
}

/**
 * Sorts what the SDK throws: an HTTP status (kind http, with Google's own status word as the code),
 * an abort (timeout), a dropped connection (network) or anything else. Only Google's short reason
 * for a 429 or 5xx is kept; any other text could echo the request, so it is dropped.
 */
function wrap(error: unknown): ProviderError {
  const e = (error ?? {}) as {
    status?: unknown;
    name?: unknown;
    message?: unknown;
    cause?: { code?: unknown };
  };
  if (typeof e.status === 'number') {
    const body = parseBody(e.message);
    const why =
      body?.message && (e.status === 429 || e.status >= 500)
        ? sanitiseMessage(body.message)
        : `HTTP ${e.status}`;
    return new ProviderError(`the Gemini call failed: ${why}`, e.status, {
      kind: 'http',
      ...(body?.status && { code: body.status }),
      ...(e.status === 429 && body && { rateLimit: rateLimitInfo(body) }),
    });
  }
  if (e.name === 'AbortError') {
    return new ProviderError('the Gemini call was aborted', undefined, { kind: 'timeout' });
  }
  const causeCode = typeof e.cause?.code === 'string' ? e.cause.code : undefined;
  if ((causeCode && NETWORK_CODES.has(causeCode)) || e.message === 'fetch failed') {
    return new ProviderError('the Gemini connection failed', undefined, {
      kind: 'network',
      ...(causeCode && { code: causeCode }),
    });
  }
  return new ProviderError('the Gemini call failed', undefined, { kind: 'other' });
}

/** Gemini through Google's official SDK: JSON output with a response schema at temperature 0. */
export function createGeminiProvider({
  apiKey,
  client,
  model,
  fallbackModel = null,
  embedModel,
  embedDim,
  logger,
}: Options): LlmProvider {
  const ai: GeminiClientLike =
    client ?? (new GoogleGenAI({ apiKey: apiKey as string }) as unknown as GeminiClientLike);

  /** The final check before every request (ADR-0060): nothing private goes to the model. */
  const guard = (purpose: string, texts: string[]) => {
    try {
      assertNoPrivateData(texts);
    } catch (error) {
      if (error instanceof PrivacyGuardError)
        logger?.warn(
          { purpose, reason: error.reason },
          'model request blocked by the privacy guard',
        );
      throw error;
    }
  };

  return {
    name: 'gemini',
    model,
    fallbackModel,
    embedModel,

    async generateJson<T>(options: GenerateJsonOptions<T>): Promise<GenerateJsonResult<T>> {
      const started = Date.now();
      const used = options.model ?? model;
      guard(options.purpose, [options.system, options.user]);
      let response;
      try {
        response = await ai.models.generateContent({
          model: used,
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
        model: used,
        latencyMs: Date.now() - started,
      };
    },

    async chatWithTools(options: ChatWithToolsOptions): Promise<ChatWithToolsResult> {
      const started = Date.now();
      const used = options.model ?? model;
      const contents = toContents(options.messages);
      // The vendor's thought signatures are opaque blobs, not text we wrote.
      guard(options.purpose, [
        options.system,
        JSON.stringify(contents, (key, value: unknown) =>
          key === 'thoughtSignature' ? undefined : value,
        ),
      ]);
      let response;
      try {
        response = await ai.models.generateContent({
          model: used,
          contents,
          config: {
            systemInstruction: options.system,
            temperature: 0,
            maxOutputTokens: options.maxOutputTokens,
            tools: [
              {
                functionDeclarations: options.tools.map((t) => ({
                  name: t.name,
                  description: t.description,
                  parametersJsonSchema: jsonSchemaFor(t.input),
                })),
              },
            ],
            ...(options.forceTool && {
              toolConfig: {
                functionCallingConfig: { mode: 'ANY', allowedFunctionNames: [options.forceTool] },
              },
            }),
            ...(options.signal && { abortSignal: options.signal }),
          },
        });
      } catch (error) {
        throw wrap(error);
      }

      const parts = response.candidates?.[0]?.content?.parts ?? [];
      const toolCalls = parts.flatMap((part, i) =>
        part.functionCall?.name
          ? [
              {
                id: part.functionCall.id ?? `call-${i}-${part.functionCall.name}`,
                name: part.functionCall.name,
                args: part.functionCall.args ?? {},
                ...(part.thoughtSignature && { signature: part.thoughtSignature }),
              },
            ]
          : [],
      );
      const text = parts
        .filter((p) => p.text && !p.thought)
        .map((p) => p.text)
        .join('');
      const usage = response.usageMetadata ?? {};
      return {
        toolCalls,
        text: toolCalls.length > 0 ? null : text,
        usage: {
          inputTokens: usage.promptTokenCount ?? 0,
          outputTokens: (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0),
        },
        model: used,
        latencyMs: Date.now() - started,
      };
    },

    async embed(texts, purpose, signal): Promise<EmbedResult> {
      const started = Date.now();
      guard(purpose, texts);
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
