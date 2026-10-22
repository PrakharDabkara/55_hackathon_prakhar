import { pino, stdSerializers, type DestinationStream, type Logger } from 'pino';
import { redactPrivateData } from './modules/ai/index.js';

/**
 * Keys that hold a person's data. Whatever a log call passes under one of these names, at the top
 * or one level down, is written as "[Redacted]" (ADR-0060). Callers log a masked phone as
 * `phoneMasked`; ids, counts, states and error codes are not here and stay readable.
 */
const SENSITIVE = [
  'phone',
  'otp',
  'otpCode',
  'token',
  'authorization',
  'cookie',
  'password',
  'address',
  'addressText',
  'q',
  'query',
  'rawQuery',
  'text',
  'task',
  'note',
  'lat',
  'lng',
];

export const LOG_REDACT = [
  'req.headers.authorization',
  'req.headers.cookie',
  ...SENSITIVE.flatMap((key) => [key, `*.${key}`]),
];

/** Postgres fields that quote the values of the failing statement. */
const DATABASE_DETAIL = ['detail', 'where', 'parameters', 'internalQuery', 'hint'];

/** The standard error, minus what a database error quotes, and with phones and emails cut from the text. */
function errorSerializer(error: unknown): unknown {
  const std = stdSerializers.err(error as Error) as unknown as Record<string, unknown>;
  const out = Object.fromEntries(
    Object.entries(std).filter(([key]) => !DATABASE_DETAIL.includes(key)),
  );
  for (const key of ['message', 'stack'])
    if (typeof out[key] === 'string') out[key] = redactPrivateData(out[key]);
  return out;
}

/** The one logger of the server: JSON lines, with the redaction and the error serializer above. */
export function createLogger(level: string, destination?: DestinationStream): Logger {
  return pino(
    { level, redact: LOG_REDACT, serializers: { err: errorSerializer } },
    destination as DestinationStream,
  );
}
