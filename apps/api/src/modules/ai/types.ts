import type { ZodType } from 'zod';

/** Why a call is made. Stored in ai_calls so cost can be traced to a feature. */
export type Purpose = 'resolve_query' | 'embed_query' | 'embed_catalog';
export type EmbedPurpose = Extract<Purpose, 'embed_query' | 'embed_catalog'>;

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

export interface GenerateJsonOptions<T> {
  system: string;
  user: string;
  /** The answer is validated against this; anything else is invalid output. */
  schema: ZodType<T>;
  maxOutputTokens: number;
  purpose: Purpose;
  signal?: AbortSignal;
}

export interface GenerateJsonResult<T> {
  data: T;
  usage: Usage;
  model: string;
  latencyMs: number;
}

export interface EmbedResult {
  vectors: number[][];
  usage: Usage;
  model: string;
  latencyMs: number;
}

/**
 * The only way the rest of the code talks to a language model (ADR-0020). A new vendor is a new
 * adapter behind this interface. Send it query text and catalog names only: never phone numbers,
 * user ids, locations or shop data, because free-tier prompts may be reviewed by the vendor.
 */
export interface LlmProvider {
  readonly name: string;
  readonly model: string;
  /** The embedding model; part of what an item's stored vector was made with. */
  readonly embedModel: string;
  generateJson<T>(options: GenerateJsonOptions<T>): Promise<GenerateJsonResult<T>>;
  embed(texts: string[], purpose: EmbedPurpose, signal?: AbortSignal): Promise<EmbedResult>;
}

/** The provider failed. `status` is the HTTP status when there was one (429 and 5xx are retried). */
export class ProviderError extends Error {
  readonly status: number | undefined;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'ProviderError';
    this.status = status;
  }
}

/** The provider answered, but not in the shape we asked for. Never retried. */
export class InvalidOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidOutputError';
  }
}
