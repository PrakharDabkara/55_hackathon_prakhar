import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(0).max(65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.url(),
  // Only 'simulated' exists: the code is read from a demo inbox. 'sms' is not implemented, so it fails fast.
  OTP_MODE: z.literal('simulated').default('simulated'),
  GIT_SHA: z.string().optional(),
  RENDER_GIT_COMMIT: z.string().optional(),
});

export interface Config {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  logLevel: string;
  databaseUrl: string;
  otpMode: 'simulated';
  gitSha: string;
}

/** The Docker build bakes in GIT_SHA=unknown when no build arg is passed; treat it and blanks as unset. */
const known = (v: string | undefined) => (v && v !== 'unknown' ? v : undefined);

/** Validates env vars once at startup. Throws a message naming every bad variable, never its value. */
export function loadConfig(env: Record<string, string | undefined>): Config {
  const result = schema.safeParse(env);
  if (!result.success) {
    const problems = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n- ${problems.join('\n- ')}`);
  }
  const e = result.data;
  return {
    nodeEnv: e.NODE_ENV,
    port: e.PORT,
    logLevel: e.LOG_LEVEL,
    databaseUrl: e.DATABASE_URL,
    otpMode: e.OTP_MODE,
    gitSha: known(e.GIT_SHA) ?? known(e.RENDER_GIT_COMMIT) ?? 'unknown',
  };
}
