import { randomUUID } from 'node:crypto';

// Incoming ids end up in every log line, so accept only a short, plain charset.
const SAFE_ID = /^[A-Za-z0-9._-]{1,128}$/;

/** Reuses the caller's x-request-id when it is safe, otherwise generates one. */
export function pickRequestId(incoming: string | string[] | undefined): string {
  return typeof incoming === 'string' && SAFE_ID.test(incoming) ? incoming : randomUUID();
}
