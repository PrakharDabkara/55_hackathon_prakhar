import { InvalidOutputError, ProviderError, type FailureKind } from './types.js';

/**
 * Google API keys in both formats: the classic `AIza` + 35 characters and the newer `AQ.` + 40 to
 * 80. Looser than a validator on purpose: a cut-off or mangled key must still be hidden.
 */
export function redactApiKeys(text: string): string {
  return text.replace(/AIza[\w-]{10,}/g, '[key]').replace(/AQ\.[\w-]{10,}/g, '[key]');
}

/** A message that is safe and short enough for a log line: no API key, one line, 160 characters. */
export function sanitiseMessage(text: string, max = 160): string {
  return redactApiKeys(text).replace(/\s+/g, ' ').trim().slice(0, max);
}

export interface Failure {
  kind: Exclude<FailureKind, 'breaker'>;
  status?: number;
  code?: string;
  /** On a 429: the wait Google asked for, in seconds. */
  retryAfterSec?: number;
  /** On a 429: a per-day quota is used up, so waiting minutes will not help. */
  perDay?: boolean;
  /** On a 429: which limit (QuotaFailure.violations[].quotaId), its value, and whether Google named one. */
  quotaId?: string;
  quotaValue?: number;
  quotaFailure?: boolean;
  /** On an input-token 429 whose request is itself over the limit. */
  requestTooLarge?: boolean;
  /** On a 404 about the model: it is retired or unknown. */
  modelGone?: boolean;
  message: string;
}

/** Sorts anything an AI call can throw into a kind, with the status and code when there are any. */
export function classifyError(error: unknown): Failure {
  if (error instanceof InvalidOutputError)
    return { kind: 'invalid_output', message: sanitiseMessage(error.message) };
  if (error instanceof ProviderError) {
    return {
      kind: error.kind,
      ...(error.status !== undefined && { status: error.status }),
      ...(error.code !== undefined && { code: error.code }),
      ...(error.rateLimit?.retryAfterSec != null && {
        retryAfterSec: error.rateLimit.retryAfterSec,
      }),
      ...(error.rateLimit?.perDay && { perDay: true }),
      ...(error.rateLimit?.quotaId !== undefined && { quotaId: error.rateLimit.quotaId }),
      ...(error.rateLimit?.quotaValue !== undefined && { quotaValue: error.rateLimit.quotaValue }),
      ...(error.rateLimit?.quotaFailure && { quotaFailure: true }),
      ...(error.rateLimit?.requestTooLarge && { requestTooLarge: true }),
      ...(error.modelGone && { modelGone: true }),
      message: sanitiseMessage(error.message),
    };
  }
  // Not ours: say only what kind of error it was, never its text.
  return { kind: 'other', message: error instanceof Error ? error.name : 'unknown error' };
}
