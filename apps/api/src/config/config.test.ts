import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

const valid = {
  DATABASE_URL: 'postgres://u:p@localhost:5433/db',
  REDIS_URL: 'redis://localhost:6379',
};

describe('loadConfig', () => {
  it('applies defaults', () => {
    const config = loadConfig(valid);

    expect(config).toMatchObject({
      nodeEnv: 'development',
      port: 3000,
      logLevel: 'info',
      databaseUrl: valid.DATABASE_URL,
      gitSha: 'unknown',
      otpMode: 'simulated',
      trigramThreshold: 0.4,
      redisUrl: valid.REDIS_URL,
      minStockResults: 3,
      requestTtlMinutes: 15,
      maxPingsPerRequest: 10,
      pingDedupeMinutes: 30,
      workersEnabled: true,
      adminPhones: [],
      errandMaxItems: 10,
      errandFewerStopsMaxExtraPaise: 3000,
      errandMaxSteps: 8,
      errandTokenBudget: 20_000,
      errandUserHourlyLimit: 5,
      errandTaskMaxChars: 500,
      errandMaxAskShops: 6,
      errandMaxQuestions: 2,
      errandResumeAfterMs: 45_000,
      errandMaxWaitMs: 300_000,
      errandAnswerTimeoutMs: 600_000,
      errandExpiryMs: 900_000,
      errandResumeDebounceMs: 1000,
    });
  });

  it('reads the Day 13 errand patience settings from the environment', () => {
    expect(
      loadConfig({
        ...valid,
        ERRAND_MAX_ASK_SHOPS: '3',
        ERRAND_MAX_QUESTIONS: '1',
        ERRAND_RESUME_AFTER_MS: '20000',
        ERRAND_MAX_WAIT_MS: '60000',
        ERRAND_ANSWER_TIMEOUT_MS: '120000',
        ERRAND_EXPIRY_MS: '600000',
        ERRAND_RESUME_DEBOUNCE_MS: '500',
      }),
    ).toMatchObject({
      errandMaxAskShops: 3,
      errandMaxQuestions: 1,
      errandResumeAfterMs: 20_000,
      errandMaxWaitMs: 60_000,
      errandAnswerTimeoutMs: 120_000,
      errandExpiryMs: 600_000,
      errandResumeDebounceMs: 500,
    });
  });

  it('refuses nonsense patience settings', () => {
    expect(() => loadConfig({ ...valid, ERRAND_MAX_WAIT_MS: '10' })).toThrow();
    expect(() => loadConfig({ ...valid, ERRAND_MAX_ASK_SHOPS: '0' })).toThrow();
  });

  it('reads the errand guardrails from the environment', () => {
    const config = loadConfig({
      ...valid,
      ERRAND_MAX_ITEMS: '6',
      ERRAND_MAX_STEPS: '5',
      ERRAND_TOKEN_BUDGET: '9000',
      ERRAND_USER_HOURLY_LIMIT: '2',
      ERRAND_TASK_MAX_CHARS: '300',
    });
    expect(config).toMatchObject({
      errandMaxItems: 6,
      errandMaxSteps: 5,
      errandTokenBudget: 9000,
      errandUserHourlyLimit: 2,
      errandTaskMaxChars: 300,
    });
  });

  it('refuses nonsense errand guardrails', () => {
    expect(() => loadConfig({ ...valid, ERRAND_MAX_STEPS: '0' })).toThrow(/ERRAND_MAX_STEPS/);
    expect(() => loadConfig({ ...valid, ERRAND_MAX_ITEMS: '9000' })).toThrow(/ERRAND_MAX_ITEMS/);
  });

  describe('LLM provider (ADR-0020)', () => {
    it('defaults to the fake provider outside production, so nothing leaves the machine by accident', () => {
      for (const NODE_ENV of ['development', 'test'] as const) {
        expect(loadConfig({ ...valid, NODE_ENV }).llmProvider).toBe('fake');
      }
      expect(loadConfig(valid).geminiApiKey).toBeNull();
    });

    it('must be set explicitly in production (fails closed)', () => {
      const prod = { ...valid, NODE_ENV: 'production', OTP_MODE: 'simulated' };
      expect(() => loadConfig(prod)).toThrowError(/LLM_PROVIDER/);
      expect(loadConfig({ ...prod, LLM_PROVIDER: 'fake' }).llmProvider).toBe('fake');
      expect(loadConfig({ ...prod, LLM_PROVIDER: 'gemini', GEMINI_API_KEY: 'k' }).llmProvider).toBe(
        'gemini',
      );
    });

    it('needs GEMINI_API_KEY when the provider is gemini, and never repeats the key', () => {
      expect(() => loadConfig({ ...valid, LLM_PROVIDER: 'gemini' })).toThrowError(/GEMINI_API_KEY/);
      expect(
        loadConfig({ ...valid, LLM_PROVIDER: 'gemini', GEMINI_API_KEY: 'secret-key-123' })
          .geminiApiKey,
      ).toBe('secret-key-123');
      expect(() =>
        loadConfig({ ...valid, LLM_PROVIDER: 'nope', GEMINI_API_KEY: 'secret-key-123' }),
      ).toThrowError(/LLM_PROVIDER/);
      try {
        loadConfig({ ...valid, LLM_PROVIDER: 'nope', GEMINI_API_KEY: 'secret-key-123' });
      } catch (error) {
        expect((error as Error).message).not.toContain('secret-key-123');
      }
    });

    it('treats an empty GEMINI_API_KEY as unset, as .env.example ships it', () => {
      expect(loadConfig({ ...valid, GEMINI_API_KEY: '' }).geminiApiKey).toBeNull();
      expect(() =>
        loadConfig({ ...valid, LLM_PROVIDER: 'gemini', GEMINI_API_KEY: '' }),
      ).toThrowError(/GEMINI_API_KEY/);
    });

    it('reads the model names, the embedding size and the two embedding thresholds', () => {
      expect(loadConfig(valid)).toMatchObject({
        geminiModel: expect.any(String),
        geminiEmbedModel: expect.any(String),
        embedDim: 768,
      });
      const c = loadConfig({
        ...valid,
        GEMINI_MODEL: 'm1',
        GEMINI_EMBED_MODEL: 'e1',
        EMBED_DIM: '256',
        EMBED_THRESHOLD: '0.75',
        EMBED_MARGIN: '0.05',
      });
      expect(c).toMatchObject({
        geminiModel: 'm1',
        geminiEmbedModel: 'e1',
        embedDim: 256,
        embedThreshold: 0.75,
        embedMargin: 0.05,
      });
    });

    it('keeps the thresholds inside sensible limits', () => {
      for (const bad of [
        { EMBED_THRESHOLD: '1.5' },
        { EMBED_THRESHOLD: '0' },
        { EMBED_MARGIN: '-0.1' },
        { EMBED_DIM: '0' },
      ]) {
        expect(() => loadConfig({ ...valid, ...bad })).toThrowError();
      }
    });
  });

  describe('ADMIN_PHONES', () => {
    it('is empty by default, so there is no admin (fails closed)', () => {
      expect(loadConfig(valid).adminPhones).toEqual([]);
      expect(loadConfig({ ...valid, ADMIN_PHONES: '' }).adminPhones).toEqual([]);
      expect(loadConfig({ ...valid, ADMIN_PHONES: ' , ,' }).adminPhones).toEqual([]);
    });

    it('reads a comma-separated list and normalises each phone', () => {
      const config = loadConfig({
        ...valid,
        ADMIN_PHONES: '9876543210, +91 98765 43211 ,09876543212',
      });
      expect(config.adminPhones).toEqual(['+919876543210', '+919876543211', '+919876543212']);
    });

    it('fails fast on a bad phone, naming the variable and never its value', () => {
      let message = '';
      try {
        loadConfig({ ...valid, ADMIN_PHONES: '9876543210,12345' });
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toMatch(/ADMIN_PHONES/);
      expect(message).not.toContain('12345');
      expect(message).not.toContain('9876543210');
    });
  });

  it('accepts OTP_MODE=simulated', () => {
    expect(loadConfig({ ...valid, OTP_MODE: 'simulated' }).otpMode).toBe('simulated');
  });

  it('requires OTP_MODE in production (fails closed) and defaults it elsewhere', () => {
    expect(() => loadConfig({ ...valid, NODE_ENV: 'production' })).toThrowError(/OTP_MODE/);
    expect(
      loadConfig({ ...valid, NODE_ENV: 'production', OTP_MODE: 'simulated', LLM_PROVIDER: 'fake' })
        .otpMode,
    ).toBe('simulated');
    expect(loadConfig({ ...valid, NODE_ENV: 'development' }).otpMode).toBe('simulated');
    expect(loadConfig({ ...valid, NODE_ENV: 'test' }).otpMode).toBe('simulated');
  });

  it('fails fast on any other OTP_MODE (sms is not implemented)', () => {
    expect(() => loadConfig({ ...valid, OTP_MODE: 'sms' })).toThrowError(/OTP_MODE/);
    expect(() => loadConfig({ ...valid, OTP_MODE: '' })).toThrowError(/OTP_MODE/);
  });

  it('reads TRIGRAM_THRESHOLD, between 0.3 and 1', () => {
    expect(loadConfig({ ...valid, TRIGRAM_THRESHOLD: '0.55' }).trigramThreshold).toBe(0.55);
    for (const bad of ['0.2', '1.1', 'abc']) {
      expect(() => loadConfig({ ...valid, TRIGRAM_THRESHOLD: bad })).toThrowError(
        /TRIGRAM_THRESHOLD/,
      );
    }
  });

  it('reads MIN_STOCK_RESULTS and REQUEST_TTL_MINUTES as positive integers', () => {
    const config = loadConfig({ ...valid, MIN_STOCK_RESULTS: '5', REQUEST_TTL_MINUTES: '30' });
    expect(config.minStockResults).toBe(5);
    expect(config.requestTtlMinutes).toBe(30);
    for (const name of ['MIN_STOCK_RESULTS', 'REQUEST_TTL_MINUTES']) {
      for (const bad of ['0', '-1', '2.5', 'abc']) {
        expect(() => loadConfig({ ...valid, [name]: bad }), `${name}=${bad}`).toThrowError(name);
      }
    }
  });

  it('reads MAX_PINGS_PER_REQUEST and PING_DEDUPE_MINUTES as positive integers', () => {
    expect(loadConfig(valid)).toMatchObject({ maxPingsPerRequest: 10, pingDedupeMinutes: 30 });
    const config = loadConfig({ ...valid, MAX_PINGS_PER_REQUEST: '4', PING_DEDUPE_MINUTES: '5' });
    expect(config).toMatchObject({ maxPingsPerRequest: 4, pingDedupeMinutes: 5 });
    for (const name of ['MAX_PINGS_PER_REQUEST', 'PING_DEDUPE_MINUTES']) {
      for (const bad of ['0', '-3', '1.5', 'x']) {
        expect(() => loadConfig({ ...valid, [name]: bad }), `${name}=${bad}`).toThrowError(name);
      }
    }
  });

  it('WORKERS_ENABLED is true/false, and workers need REDIS_URL', () => {
    expect(loadConfig({ ...valid, WORKERS_ENABLED: 'false' }).workersEnabled).toBe(false);
    expect(() => loadConfig({ ...valid, WORKERS_ENABLED: 'yes' })).toThrowError(/WORKERS_ENABLED/);
    const noRedis = { DATABASE_URL: valid.DATABASE_URL };
    expect(() => loadConfig(noRedis)).toThrowError(/REDIS_URL/);
    const off = loadConfig({ ...noRedis, WORKERS_ENABLED: 'false' });
    expect(off.redisUrl).toBeNull();
  });

  it('coerces PORT to a number', () => {
    expect(loadConfig({ ...valid, PORT: '10000' }).port).toBe(10000);
  });

  it('prefers GIT_SHA, then RENDER_GIT_COMMIT, then unknown', () => {
    expect(loadConfig({ ...valid, GIT_SHA: 'a', RENDER_GIT_COMMIT: 'b' }).gitSha).toBe('a');
    expect(loadConfig({ ...valid, RENDER_GIT_COMMIT: 'b' }).gitSha).toBe('b');
    expect(loadConfig(valid).gitSha).toBe('unknown');
  });

  it('treats a blank or "unknown" GIT_SHA (the Docker build default) as unset', () => {
    expect(loadConfig({ ...valid, GIT_SHA: '', RENDER_GIT_COMMIT: 'b' }).gitSha).toBe('b');
    expect(loadConfig({ ...valid, GIT_SHA: 'unknown', RENDER_GIT_COMMIT: 'b' }).gitSha).toBe('b');
  });

  it('fails fast and names every bad variable', () => {
    expect(() => loadConfig({ PORT: 'abc', NODE_ENV: 'staging' })).toThrowError(
      /DATABASE_URL[\s\S]*PORT[\s\S]*NODE_ENV|PORT[\s\S]*DATABASE_URL|NODE_ENV[\s\S]*DATABASE_URL/,
    );
    try {
      loadConfig({ PORT: 'abc', NODE_ENV: 'staging' });
    } catch (err) {
      const message = (err as Error).message;
      for (const name of ['DATABASE_URL', 'PORT', 'NODE_ENV']) expect(message).toContain(name);
    }
  });

  it('never echoes a secret value in the error', () => {
    try {
      loadConfig({ DATABASE_URL: 'not-a-url-s3cret' });
      expect.unreachable();
    } catch (err) {
      expect((err as Error).message).not.toContain('s3cret');
    }
  });
});

describe('AI reliability settings', () => {
  const base = {
    DATABASE_URL: 'postgres://u:p@localhost:5433/db',
    REDIS_URL: 'redis://localhost:6379',
  };

  it('defaults: errand calls get 30 s, no fallback model', () => {
    expect(loadConfig(base)).toMatchObject({
      errandAiTimeoutMs: 30_000,
      geminiFallbackModel: null,
    });
  });

  it('reads ERRAND_AI_TIMEOUT_MS and GEMINI_FALLBACK_MODEL; blank means none', () => {
    expect(
      loadConfig({
        ...base,
        ERRAND_AI_TIMEOUT_MS: '45000',
        GEMINI_FALLBACK_MODEL: 'gemini-3.5-flash',
      }),
    ).toMatchObject({ errandAiTimeoutMs: 45_000, geminiFallbackModel: 'gemini-3.5-flash' });
    expect(loadConfig({ ...base, GEMINI_FALLBACK_MODEL: '' }).geminiFallbackModel).toBeNull();
  });

  it('refuses a timeout that is too short or too long', () => {
    expect(() => loadConfig({ ...base, ERRAND_AI_TIMEOUT_MS: '500' })).toThrow(
      /ERRAND_AI_TIMEOUT_MS/,
    );
    expect(() => loadConfig({ ...base, ERRAND_AI_TIMEOUT_MS: '900000' })).toThrow(
      /ERRAND_AI_TIMEOUT_MS/,
    );
  });
});
