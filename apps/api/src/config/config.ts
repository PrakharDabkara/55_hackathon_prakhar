import { z } from 'zod';
import { normalisePhone } from '../modules/identity/index.js';

const bool = z.enum(['true', 'false']).transform((v) => v === 'true');

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(0).max(65535).default(3000),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    DATABASE_URL: z.url(),
    // Only 'simulated' exists: the code is read from a demo inbox. 'sms' is not implemented, so it fails fast.
    // Unset defaults to simulated in development and test, but production must say so (fail closed).
    OTP_MODE: z.literal('simulated').optional(),
    // Lowest similarity at which a typo still counts as a match. Floor 0.3 is pg_trgm's own default.
    TRIGRAM_THRESHOLD: z.coerce.number().min(0.3).max(1).default(0.4),
    REDIS_URL: z.url().optional(),
    // Learned results at or above this count answer a request without pinging shops.
    MIN_STOCK_RESULTS: z.coerce.number().int().min(1).default(3),
    REQUEST_TTL_MINUTES: z.coerce.number().int().min(1).default(15),
    // Shops pinged per request, and the quiet period before the same shop is asked about the same item.
    MAX_PINGS_PER_REQUEST: z.coerce.number().int().min(1).default(10),
    PING_DEDUPE_MINUTES: z.coerce.number().int().min(1).default(30),
    // Run the request-expiry worker inside the API process.
    WORKERS_ENABLED: bool.default(true),
    // Phones that become admin on login. Empty (the default) means no admin exists and every
    // admin endpoint answers 404: fail closed. The simulator needs one; set it by hand on the host.
    ADMIN_PHONES: z
      .string()
      .default('')
      .transform((raw, ctx) => {
        const phones: string[] = [];
        for (const part of raw.split(',').map((p) => p.trim())) {
          if (!part) continue;
          const phone = normalisePhone(part);
          if (!phone) {
            // The message never repeats the value: it is a phone number.
            ctx.addIssue({
              code: 'custom',
              message: 'must be a comma-separated list of Indian mobile numbers',
            });
            return z.NEVER;
          }
          phones.push(phone);
        }
        return phones;
      }),
    // Which model answers when the dictionary cannot (ADR-0020). Default fake outside production,
    // so nothing leaves the machine by accident; production must choose.
    LLM_PROVIDER: z.enum(['gemini', 'fake']).optional(),
    // An empty value (as .env.example ships it) means not set.
    GEMINI_API_KEY: z
      .string()
      .optional()
      .transform((key) => (key === '' ? undefined : key)),
    // Names come from `npm run ai:models`, which lists what the key can use.
    GEMINI_MODEL: z.string().min(1).default('gemini-3.1-flash-lite'),
    // A second free model for the attempts after a timeout, 429 or 503 from the primary. Blank: none.
    GEMINI_FALLBACK_MODEL: z
      .string()
      .optional()
      .transform((m) => (m === '' ? undefined : m)),
    GEMINI_EMBED_MODEL: z.string().min(1).default('gemini-embedding-001'),
    // The size of items.embedding (migration 008). Changing it needs a new migration.
    EMBED_DIM: z.coerce.number().int().min(8).max(3072).default(768),
    // An embedding answers a query when the best item is at least this similar (cosine)...
    EMBED_THRESHOLD: z.coerce.number().gt(0).lte(1).default(0.7),
    // ...and ahead of the second best by at least this much.
    EMBED_MARGIN: z.coerce.number().min(0).lt(1).default(0.04),
    // Errand agent guardrails (ADR-0024). The model never decides these.
    ERRAND_MAX_ITEMS: z.coerce.number().int().min(1).max(10).default(10),
    ERRAND_MAX_STEPS: z.coerce.number().int().min(1).max(30).default(8),
    ERRAND_TOKEN_BUDGET: z.coerce.number().int().min(500).max(1_000_000).default(20_000),
    ERRAND_USER_HOURLY_LIMIT: z.coerce.number().int().min(1).max(1000).default(5),
    // How long one errand model call (with tool schemas) may take; resolve calls keep their 8 s.
    ERRAND_AI_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120_000).default(30_000),
    ERRAND_TASK_MAX_CHARS: z.coerce.number().int().min(20).max(2000).default(500),
    // Day 13 (ADR-0024 amendment): asking shops, waiting, asking the user.
    ERRAND_MAX_ASK_SHOPS: z.coerce.number().int().min(1).max(10).default(6),
    ERRAND_MAX_QUESTIONS: z.coerce.number().int().min(0).max(5).default(2),
    ERRAND_RESUME_AFTER_MS: z.coerce.number().int().min(10).max(600_000).default(45_000),
    ERRAND_MAX_WAIT_MS: z.coerce.number().int().min(100).max(1_800_000).default(300_000),
    ERRAND_ANSWER_TIMEOUT_MS: z.coerce.number().int().min(1000).max(3_600_000).default(600_000),
    ERRAND_EXPIRY_MS: z.coerce.number().int().min(1000).max(7_200_000).default(900_000),
    ERRAND_RESUME_DEBOUNCE_MS: z.coerce.number().int().min(0).max(30_000).default(1000),
    GIT_SHA: z.string().optional(),
    RENDER_GIT_COMMIT: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && env.OTP_MODE === undefined) {
      ctx.addIssue({ code: 'custom', path: ['OTP_MODE'], message: 'must be set in production' });
    }
    if (env.NODE_ENV === 'production' && env.LLM_PROVIDER === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['LLM_PROVIDER'],
        message: 'must be set in production',
      });
    }
    if (env.LLM_PROVIDER === 'gemini' && !env.GEMINI_API_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['GEMINI_API_KEY'],
        message: 'required when LLM_PROVIDER is gemini',
      });
    }
    if (env.WORKERS_ENABLED && !env.REDIS_URL) {
      ctx.addIssue({
        code: 'custom',
        path: ['REDIS_URL'],
        message: 'required when WORKERS_ENABLED',
      });
    }
  });

export interface Config {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  logLevel: string;
  databaseUrl: string;
  otpMode: 'simulated';
  trigramThreshold: number;
  redisUrl: string | null;
  minStockResults: number;
  requestTtlMinutes: number;
  maxPingsPerRequest: number;
  pingDedupeMinutes: number;
  workersEnabled: boolean;
  /** E.164 phones that get the admin role on login. Empty: no admin. */
  adminPhones: string[];
  llmProvider: 'gemini' | 'fake';
  geminiApiKey: string | null;
  geminiModel: string;
  geminiFallbackModel: string | null;
  geminiEmbedModel: string;
  embedDim: number;
  embedThreshold: number;
  embedMargin: number;
  errandMaxItems: number;
  errandMaxSteps: number;
  /** Input plus output tokens one errand may spend before it is told to submit its plan. */
  errandTokenBudget: number;
  errandUserHourlyLimit: number;
  errandTaskMaxChars: number;
  /** Time limit of one errand model call, in milliseconds. */
  errandAiTimeoutMs: number;
  /** Requests one errand may open with ask_shops (one per item). */
  errandMaxAskShops: number;
  /** Questions one errand may put to the user. */
  errandMaxQuestions: number;
  /** A waiting errand resumes after this long even if shops are slow. */
  errandResumeAfterMs: number;
  /** Total time one errand may spend waiting for shops; after it the agent must submit. */
  errandMaxWaitMs: number;
  /** An unanswered question gives up after this long. */
  errandAnswerTimeoutMs: number;
  /** Overall life of an errand; past it, EXPIRED. */
  errandExpiryMs: number;
  /** A burst of answers within this window causes one resume check. */
  errandResumeDebounceMs: number;
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
    otpMode: e.OTP_MODE ?? 'simulated',
    trigramThreshold: e.TRIGRAM_THRESHOLD,
    redisUrl: e.REDIS_URL ?? null,
    minStockResults: e.MIN_STOCK_RESULTS,
    requestTtlMinutes: e.REQUEST_TTL_MINUTES,
    maxPingsPerRequest: e.MAX_PINGS_PER_REQUEST,
    pingDedupeMinutes: e.PING_DEDUPE_MINUTES,
    workersEnabled: e.WORKERS_ENABLED,
    adminPhones: e.ADMIN_PHONES,
    llmProvider: e.LLM_PROVIDER ?? 'fake',
    geminiApiKey: e.GEMINI_API_KEY ?? null,
    geminiModel: e.GEMINI_MODEL,
    geminiFallbackModel: e.GEMINI_FALLBACK_MODEL ?? null,
    geminiEmbedModel: e.GEMINI_EMBED_MODEL,
    embedDim: e.EMBED_DIM,
    embedThreshold: e.EMBED_THRESHOLD,
    embedMargin: e.EMBED_MARGIN,
    errandMaxItems: e.ERRAND_MAX_ITEMS,
    errandMaxSteps: e.ERRAND_MAX_STEPS,
    errandTokenBudget: e.ERRAND_TOKEN_BUDGET,
    errandUserHourlyLimit: e.ERRAND_USER_HOURLY_LIMIT,
    errandTaskMaxChars: e.ERRAND_TASK_MAX_CHARS,
    errandAiTimeoutMs: e.ERRAND_AI_TIMEOUT_MS,
    errandMaxAskShops: e.ERRAND_MAX_ASK_SHOPS,
    errandMaxQuestions: e.ERRAND_MAX_QUESTIONS,
    errandResumeAfterMs: e.ERRAND_RESUME_AFTER_MS,
    errandMaxWaitMs: e.ERRAND_MAX_WAIT_MS,
    errandAnswerTimeoutMs: e.ERRAND_ANSWER_TIMEOUT_MS,
    errandExpiryMs: e.ERRAND_EXPIRY_MS,
    errandResumeDebounceMs: e.ERRAND_RESUME_DEBOUNCE_MS,
    gitSha: known(e.GIT_SHA) ?? known(e.RENDER_GIT_COMMIT) ?? 'unknown',
  };
}
