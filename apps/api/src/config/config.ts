import { z } from 'zod';
import { normalisePhone } from '../modules/identity/index.js';

/** An empty value, as .env.example ships it, means not set. */
const blankIsUnset = z
  .string()
  .optional()
  .transform((v) => (v === undefined || v.trim() === '' ? undefined : v.trim()));

/** Per-IP requests per 10 minutes on the sign-in routes (ADR-0058). */
export const DEFAULT_OTP_IP_LIMITS = { request: 10, verify: 20, inbox: 30 } as const;

const bool = z.enum(['true', 'false']).transform((v) => v === 'true');

/** A comma-separated list of Indian mobiles, as E.164. The message never repeats a value. */
const phoneList = z
  .string()
  .default('')
  .transform((raw, ctx) => {
    const phones: string[] = [];
    for (const part of raw.split(',').map((p) => p.trim())) {
      if (!part) continue;
      const phone = normalisePhone(part);
      if (!phone) {
        ctx.addIssue({
          code: 'custom',
          message: 'must be a comma-separated list of Indian mobile numbers',
        });
        return z.NEVER;
      }
      phones.push(phone);
    }
    return phones;
  });

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
    // The secret that opens the admin endpoints (the simulator, AI stats). Unset: there is no admin
    // and those routes are not mounted (404). At least 32 characters; set it by hand on the host.
    ADMIN_TOKEN: z
      .string()
      .optional()
      .transform((v) => (v === undefined || v.trim() === '' ? undefined : v.trim()))
      .pipe(z.string().min(32, 'must be at least 32 characters').optional()),
    // Server-side simulated shops for the live demo (ADR-0062): answers pings and parchis for
    // is_simulated shops from inside the API. Only the word "on" turns it on.
    DEMO_AUTOPILOT: z
      .string()
      .default('off')
      .transform((v) => (v.trim() === '' ? 'off' : v.trim()))
      .pipe(z.enum(['on', 'off'])),
    // Most answers (and order moves) the autopilot starts in one minute; the rest are not answered.
    DEMO_AUTOPILOT_MAX_PER_MINUTE: z.coerce.number().int().min(1).max(600).default(30),
    // Retired (ADR-0058): a phone can no longer become admin. Read only so that production can
    // refuse to start while it is still set.
    ADMIN_PHONES: blankIsUnset,
    // The only phones that get a code in the demo inbox, comma-separated. Production needs at least
    // one. Anyone else can still ask for a code, but nothing can read it.
    DEMO_PHONES: phoneList,
    // Shown as tap-to-fill chips on the login screens (A-03). Only numbers that are also in
    // DEMO_PHONES survive; the rest of DEMO_PHONES is never served.
    PUBLIC_DEMO_SHOP_PHONES: phoneList,
    PUBLIC_DEMO_CUSTOMER_PHONES: phoneList,
    // Tests only: every phone gets a code in the demo inbox. Production refuses any value.
    OTP_INBOX_OPEN: z.enum(['true', 'false']).optional(),
    // Requests per IP per 10 minutes. Production refuses a value above the default.
    OTP_IP_REQUEST_MAX: z.coerce.number().int().min(1).default(DEFAULT_OTP_IP_LIMITS.request),
    OTP_IP_VERIFY_MAX: z.coerce.number().int().min(1).default(DEFAULT_OTP_IP_LIMITS.verify),
    OTP_IP_INBOX_MAX: z.coerce.number().int().min(1).default(DEFAULT_OTP_IP_LIMITS.inbox),
    // Multiplies every API rate limit (the ones in http/routeLimits.ts and the per-IP baseline), so
    // a test run or a load test can lift them. Production refuses a value above 1 (ADR-0059).
    RATE_LIMIT_SCALE: z.coerce.number().positive().default(1),
    // Proxies in front of the API that set X-Forwarded-For. Render is one hop. 0 trusts no header.
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(1),
    // Which model answers when the dictionary cannot (ADR-0020). Default fake outside production,
    // so nothing leaves the machine by accident; production must choose.
    LLM_PROVIDER: z.enum(['gemini', 'fake']).optional(),
    // A file of scripted model turns for the fake provider (end-to-end runs only).
    FAKE_LLM_SCENARIO: z.string().min(1).optional(),
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
    // The errand agent's own models. Unset (or blank): the errand agent uses GEMINI_MODEL and
    // GEMINI_FALLBACK_MODEL, as before. Query resolution never reads these two.
    GEMINI_ERRAND_MODEL: z
      .string()
      .optional()
      .transform((m) => (m === '' ? undefined : m)),
    GEMINI_ERRAND_FALLBACK_MODEL: z
      .string()
      .optional()
      .transform((m) => (m === '' ? undefined : m)),
    // Most photos Postgres may hold, in MB: Neon's free plan has 0.5 GB for everything (ADR-0030).
    PHOTO_STORAGE_CAP_MB: z.coerce.number().positive().default(300),
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
    // Short resolve/classify calls: how much a Gemini model thinks first (round 3 C-16a), and when a
    // slow primary gets the fallback model alongside it in ms; 0 turns the hedge off (C-16b).
    GEMINI_THINKING: z.enum(['minimal', 'model_default']).default('minimal'),
    AI_HEDGE_AFTER_MS: z.coerce.number().int().min(0).max(8000).default(4000),
    ERRAND_TASK_MAX_CHARS: z.coerce.number().int().min(20).max(2000).default(500),
    // Day 13 (ADR-0024 amendment): asking shops, waiting, asking the user.
    ERRAND_MAX_ASK_SHOPS: z.coerce.number().int().min(1).max(10).default(6),
    ERRAND_MAX_QUESTIONS: z.coerce.number().int().min(0).max(5).default(2),
    ERRAND_RESUME_AFTER_MS: z.coerce.number().int().min(10).max(600_000).default(45_000),
    ERRAND_MAX_WAIT_MS: z.coerce.number().int().min(100).max(1_800_000).default(300_000),
    ERRAND_ANSWER_TIMEOUT_MS: z.coerce.number().int().min(1000).max(3_600_000).default(600_000),
    ERRAND_EXPIRY_MS: z.coerce.number().int().min(1000).max(7_200_000).default(900_000),
    ERRAND_FEWER_STOPS_MAX_EXTRA_PAISE: z.coerce.number().int().min(0).max(1_000_000).default(3000),
    ERRAND_RESUME_DEBOUNCE_MS: z.coerce.number().int().min(0).max(30_000).default(1000),
    // Web Push (ADR-0034). All three set turns push on; anything less leaves it off. The private key
    // is a secret: set it on the host, never in the repo. `npm run push:keys` makes a pair.
    VAPID_PUBLIC_KEY: blankIsUnset,
    VAPID_PRIVATE_KEY: blankIsUnset,
    VAPID_SUBJECT: blankIsUnset,
    // Most pushes one person gets in a minute; the rest are dropped, so a busy shop is not spammed.
    PUSH_MAX_PER_MINUTE: z.coerce.number().int().min(1).max(1000).default(5),
    // "Le liya?" (ADR-0035): how long after a tap on "Raasta" the home screen starts asking.
    PICKUP_ASK_AFTER_MINUTES: z.coerce.number().int().min(0).max(240).default(15),
    GIT_SHA: z.string().optional(),
    RENDER_GIT_COMMIT: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production') {
      if (env.DEMO_PHONES.length === 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['DEMO_PHONES'],
          message: 'must list at least one demo phone in production',
        });
      }
      if (env.OTP_INBOX_OPEN !== undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['OTP_INBOX_OPEN'],
          message: 'is for tests only and is refused in production: unset it',
        });
      }
      if (env.ADMIN_PHONES !== undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['ADMIN_PHONES'],
          message: 'no longer exists (admin is ADMIN_TOKEN only): unset it',
        });
      }
      if (env.RATE_LIMIT_SCALE > 1) {
        ctx.addIssue({
          code: 'custom',
          path: ['RATE_LIMIT_SCALE'],
          message: 'cannot be above 1 in production',
        });
      }
      const limits = [
        ['OTP_IP_REQUEST_MAX', env.OTP_IP_REQUEST_MAX, DEFAULT_OTP_IP_LIMITS.request],
        ['OTP_IP_VERIFY_MAX', env.OTP_IP_VERIFY_MAX, DEFAULT_OTP_IP_LIMITS.verify],
        ['OTP_IP_INBOX_MAX', env.OTP_IP_INBOX_MAX, DEFAULT_OTP_IP_LIMITS.inbox],
      ] as const;
      for (const [name, value, max] of limits) {
        if (value > max) {
          ctx.addIssue({
            code: 'custom',
            path: [name],
            message: `cannot be above ${max} in production`,
          });
        }
      }
    }
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
    // The fake and scripted models are for tests, e2e and local runs. Production never runs them,
    // and there is no variable that allows it (fail closed, Day 14c).
    if (env.NODE_ENV === 'production' && env.LLM_PROVIDER === 'fake') {
      ctx.addIssue({
        code: 'custom',
        path: ['LLM_PROVIDER'],
        message: 'the fake model is never allowed in production: set LLM_PROVIDER=gemini',
      });
    }
    if (env.NODE_ENV === 'production' && env.FAKE_LLM_SCENARIO !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['FAKE_LLM_SCENARIO'],
        message: 'a scripted model is never allowed in production: unset FAKE_LLM_SCENARIO',
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
  /** Opens the admin endpoints (Authorization: Bearer). Null: there is no admin (ADR-0058). */
  adminToken: string | null;
  /** Whether simulated shops are answered by the API itself (ADR-0062). */
  demoAutopilot: boolean;
  /** The most answers the autopilot starts in a minute. */
  demoAutopilotMaxPerMinute: number;
  /** E.164 phones that get a code in the demo inbox. */
  demoPhones: string[];
  /** The demo shop numbers the shop login offers as chips; always a subset of `demoPhones`. */
  publicDemoShopPhones: string[];
  /** The demo customer numbers the customer login offers as chips; a subset of `demoPhones`. */
  publicDemoCustomerPhones: string[];
  /** How many listed public numbers were dropped for not being in `demoPhones` (the server warns). */
  publicDemoDropped: number;
  /** Tests only: every phone gets a code in the demo inbox. Never true in production. */
  otpInboxOpen: boolean;
  /** Most requests one IP may make in 10 minutes to request, verify and the demo inbox. */
  otpIpLimits: { request: number; verify: number; inbox: number };
  /** Proxy hops whose X-Forwarded-For is believed (`trust proxy`). */
  /** Multiplies the API rate limits; 1 in production (ADR-0059). */
  rateLimitScale: number;
  trustProxyHops: number;
  llmProvider: 'gemini' | 'fake';
  /** A file of scripted turns for the fake provider (end-to-end runs only). */
  fakeLlmScenario: string | null;
  geminiApiKey: string | null;
  geminiModel: string;
  geminiFallbackModel: string | null;
  /** The model the errand agent runs on: GEMINI_ERRAND_MODEL, else GEMINI_MODEL. */
  errandModel: string;
  /** Its fallback: GEMINI_ERRAND_FALLBACK_MODEL, else GEMINI_FALLBACK_MODEL, else none. */
  errandFallbackModel: string | null;
  geminiEmbedModel: string;
  /** The most photo bytes Postgres may hold (MB): uploads over it are refused. */
  photoStorageCapMb: number;
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
  geminiThinking: 'minimal' | 'model_default';
  aiHedgeAfterMs: number;
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
  /** ADR-0025: kam_dukaan is recommended if it costs at most this many paise more than sasta. */
  errandFewerStopsMaxExtraPaise: number;
  /** Web Push keys; null leaves push off (nothing else changes). ADR-0034. */
  vapid: { publicKey: string; privateKey: string; subject: string } | null;
  /** Pushes per person per minute. */
  pushMaxPerMinute: number;
  /** Minutes after a tap on "Raasta" before the home screen asks "Le liya?" (ADR-0035). */
  pickupAskAfterMinutes: number;
  gitSha: string;
}

/** All three set and the subject a mailto: or https: address, else push stays off (never a crash). */
function vapidFrom(e: {
  VAPID_PUBLIC_KEY?: string | undefined;
  VAPID_PRIVATE_KEY?: string | undefined;
  VAPID_SUBJECT?: string | undefined;
}): Config['vapid'] {
  const { VAPID_PUBLIC_KEY: publicKey, VAPID_PRIVATE_KEY: privateKey, VAPID_SUBJECT: subject } = e;
  if (!publicKey || !privateKey || !subject) return null;
  if (!/^(mailto:|https:\/\/)\S+$/.test(subject)) return null;
  return { publicKey, privateKey, subject };
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
  const inDemo = (phones: string[]) => phones.filter((p) => e.DEMO_PHONES.includes(p));
  const publicShop = inDemo(e.PUBLIC_DEMO_SHOP_PHONES);
  const publicCustomer = inDemo(e.PUBLIC_DEMO_CUSTOMER_PHONES);
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
    adminToken: e.ADMIN_TOKEN ?? null,
    demoAutopilot: e.DEMO_AUTOPILOT === 'on',
    demoAutopilotMaxPerMinute: e.DEMO_AUTOPILOT_MAX_PER_MINUTE,
    demoPhones: e.DEMO_PHONES,
    publicDemoShopPhones: publicShop,
    publicDemoCustomerPhones: publicCustomer,
    publicDemoDropped:
      e.PUBLIC_DEMO_SHOP_PHONES.length +
      e.PUBLIC_DEMO_CUSTOMER_PHONES.length -
      publicShop.length -
      publicCustomer.length,
    otpInboxOpen: e.OTP_INBOX_OPEN === 'true',
    otpIpLimits: {
      request: e.OTP_IP_REQUEST_MAX,
      verify: e.OTP_IP_VERIFY_MAX,
      inbox: e.OTP_IP_INBOX_MAX,
    },
    rateLimitScale: e.RATE_LIMIT_SCALE,
    trustProxyHops: e.TRUST_PROXY_HOPS,
    llmProvider: e.LLM_PROVIDER ?? 'fake',
    fakeLlmScenario: e.FAKE_LLM_SCENARIO ?? null,
    geminiApiKey: e.GEMINI_API_KEY ?? null,
    geminiModel: e.GEMINI_MODEL,
    geminiFallbackModel: e.GEMINI_FALLBACK_MODEL ?? null,
    errandModel: e.GEMINI_ERRAND_MODEL ?? e.GEMINI_MODEL,
    errandFallbackModel: e.GEMINI_ERRAND_FALLBACK_MODEL ?? e.GEMINI_FALLBACK_MODEL ?? null,
    geminiEmbedModel: e.GEMINI_EMBED_MODEL,
    photoStorageCapMb: e.PHOTO_STORAGE_CAP_MB,
    embedDim: e.EMBED_DIM,
    embedThreshold: e.EMBED_THRESHOLD,
    embedMargin: e.EMBED_MARGIN,
    errandMaxItems: e.ERRAND_MAX_ITEMS,
    errandMaxSteps: e.ERRAND_MAX_STEPS,
    errandTokenBudget: e.ERRAND_TOKEN_BUDGET,
    errandUserHourlyLimit: e.ERRAND_USER_HOURLY_LIMIT,
    errandTaskMaxChars: e.ERRAND_TASK_MAX_CHARS,
    errandAiTimeoutMs: e.ERRAND_AI_TIMEOUT_MS,
    geminiThinking: e.GEMINI_THINKING,
    aiHedgeAfterMs: e.AI_HEDGE_AFTER_MS,
    errandMaxAskShops: e.ERRAND_MAX_ASK_SHOPS,
    errandMaxQuestions: e.ERRAND_MAX_QUESTIONS,
    errandResumeAfterMs: e.ERRAND_RESUME_AFTER_MS,
    errandMaxWaitMs: e.ERRAND_MAX_WAIT_MS,
    errandAnswerTimeoutMs: e.ERRAND_ANSWER_TIMEOUT_MS,
    errandExpiryMs: e.ERRAND_EXPIRY_MS,
    errandResumeDebounceMs: e.ERRAND_RESUME_DEBOUNCE_MS,
    errandFewerStopsMaxExtraPaise: e.ERRAND_FEWER_STOPS_MAX_EXTRA_PAISE,
    vapid: vapidFrom(e),
    pushMaxPerMinute: e.PUSH_MAX_PER_MINUTE,
    pickupAskAfterMinutes: e.PICKUP_ASK_AFTER_MINUTES,
    gitSha: known(e.GIT_SHA) ?? known(e.RENDER_GIT_COMMIT) ?? 'unknown',
  };
}
