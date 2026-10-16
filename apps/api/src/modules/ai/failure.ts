import { InvalidOutputError, ProviderError, type FailureKind } from './types.js';

/** A message that is safe and short enough for a log line: no API key, one line, 160 characters. */
export function sanitiseMessage(text: string, max = 160): string {
  return text
    .replace(/AIza[\w-]{10,}/g, '[key]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

export interface Failure {
  kind: Exclude<FailureKind, 'breaker'>;
  status?: number;
  code?: string;
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
      message: sanitiseMessage(error.message),
    };
  }
  // Not ours: say only what kind of error it was, never its text.
  return { kind: 'other', message: error instanceof Error ? error.name : 'unknown error' };
}
