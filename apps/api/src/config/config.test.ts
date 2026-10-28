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
      adminToken: null,
      demoPhones: [],
      otpInboxOpen: false,
      errandMaxItems: 10,
      errandFewerStopsMaxExtraPaise: 3000,
      fakeLlmScenario: null,
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
      const prod = {
        ...valid,
        NODE_ENV: 'production',
        OTP_MODE: 'simulated',
        DEMO_PHONES: '9000000001',
      };
      expect(() => loadConfig(prod)).toThrowError(/LLM_PROVIDER/);
      expect(() => loadConfig({ ...prod, LLM_PROVIDER: 'fake' })).toThrowError(/fake.*production/i);
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

  describe('ADMIN_TOKEN', () => {
    const token = 'a'.repeat(32);

    it('is unset by default, so there is no admin (fails closed)', () => {
      expect(loadConfig(valid).adminToken).toBeNull();
      expect(loadConfig({ ...valid, ADMIN_TOKEN: '' }).adminToken).toBeNull();
    });

    it('is kept as given when it has at least 32 characters', () => {
      expect(loadConfig({ ...valid, ADMIN_TOKEN: token }).adminToken).toBe(token);
    });

    it('fails fast when shorter than 32, naming the variable and never its value', () => {
      let message = '';
      try {
        loadConfig({ ...valid, ADMIN_TOKEN: 'short-secret-31-chars-xxxxxxxxx' });
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toMatch(/ADMIN_TOKEN/);
      expect(message).not.toContain('short-secret');
    });
  });

  describe('DEMO_PHONES', () => {
    it('is empty by default', () => {
      expect(loadConfig(valid).demoPhones).toEqual([]);
      expect(loadConfig({ ...valid, DEMO_PHONES: ' , ,' }).demoPhones).toEqual([]);
    });

    it('reads a comma-separated list and normalises each phone', () => {
      const config = loadConfig({
        ...valid,
        DEMO_PHONES: '9000000001, +91 90000 00002 ,09000000003',
      });
      expect(config.demoPhones).toEqual(['+919000000001', '+919000000002', '+919000000003']);
    });

    it('fails fast on a bad phone, naming the variable and never its value', () => {
      let message = '';
      try {
        loadConfig({ ...valid, DEMO_PHONES: '9000000001,12345' });
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toMatch(/DEMO_PHONES/);
      expect(message).not.toContain('12345');
      expect(message).not.toContain('9000000001');
    });
  });

  describe('PUBLIC_DEMO_SHOP_PHONES and PUBLIC_DEMO_CUSTOMER_PHONES', () => {
    const demo = {
      ...valid,
      DEMO_PHONES: '9000000101,9000000102,9000000201,9000000202,9000000999',
    };

    it('are empty by default', () => {
      const config = loadConfig(valid);
      expect(config.publicDemoShopPhones).toEqual([]);
      expect(config.publicDemoCustomerPhones).toEqual([]);
      expect(config.publicDemoDropped).toBe(0);
    });

    it('keep the listed numbers that are also in DEMO_PHONES, normalised', () => {
      const config = loadConfig({
        ...demo,
        PUBLIC_DEMO_SHOP_PHONES: '9000000101, +91 90000 00102',
        PUBLIC_DEMO_CUSTOMER_PHONES: '9000000201',
      });
      expect(config.publicDemoShopPhones).toEqual(['+919000000101', '+919000000102']);
      expect(config.publicDemoCustomerPhones).toEqual(['+919000000201']);
      expect(config.publicDemoDropped).toBe(0);
    });

    it('drop a number that is not in DEMO_PHONES and count it, so the server can warn', () => {
      const config = loadConfig({
        ...demo,
        PUBLIC_DEMO_SHOP_PHONES: '9000000101,9000000555',
        PUBLIC_DEMO_CUSTOMER_PHONES: '9000000666,9000000202',
      });
      expect(config.publicDemoShopPhones).toEqual(['+919000000101']);
      expect(config.publicDemoCustomerPhones).toEqual(['+919000000202']);
      expect(config.publicDemoDropped).toBe(2);
    });

    it('never make DEMO_PHONES longer', () => {
      const config = loadConfig({ ...demo, PUBLIC_DEMO_SHOP_PHONES: '9000000555' });
      expect(config.demoPhones).toHaveLength(5);
    });

    it('fail fast on a bad phone, naming the variable and never its value', () => {
      let message = '';
      try {
        loadConfig({ ...demo, PUBLIC_DEMO_CUSTOMER_PHONES: '9999999999' });
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toMatch(/PUBLIC_DEMO_CUSTOMER_PHONES/);
      expect(message).not.toContain('9999999999');
    });
  });

  describe('OTP_INBOX_OPEN and the sign-in limits', () => {
    it('is closed by default and can be opened outside production', () => {
      expect(loadConfig(valid).otpInboxOpen).toBe(false);
      expect(loadConfig({ ...valid, OTP_INBOX_OPEN: 'true' }).otpInboxOpen).toBe(true);
      expect(loadConfig({ ...valid, NODE_ENV: 'test', OTP_INBOX_OPEN: 'true' }).otpInboxOpen).toBe(
        true,
      );
    });

    it('defaults to 10, 20 and 30 requests per IP per 10 minutes', () => {
      expect(loadConfig(valid).otpIpLimits).toEqual({ request: 10, verify: 20, inbox: 30 });
    });

    it('trusts exactly one proxy hop by default', () => {
      expect(loadConfig(valid).trustProxyHops).toBe(1);
      expect(loadConfig({ ...valid, TRUST_PROXY_HOPS: '2' }).trustProxyHops).toBe(2);
      expect(() => loadConfig({ ...valid, TRUST_PROXY_HOPS: '-1' })).toThrowError(
        /TRUST_PROXY_HOPS/,
      );
    });
  });

  describe('production fails closed on the sign-in settings (ADR-0058)', () => {
    const prod = {
      ...valid,
      NODE_ENV: 'production',
      DEMO_PHONES: '9000000001',
      OTP_MODE: 'simulated',
      LLM_PROVIDER: 'gemini',
      GEMINI_API_KEY: 'k',
    };

    it('accepts a production config with a demo phone', () => {
      expect(loadConfig(prod).demoPhones).toEqual(['+919000000001']);
    });

    it('refuses an empty DEMO_PHONES', () => {
      expect(() => loadConfig({ ...prod, DEMO_PHONES: '' })).toThrowError(/DEMO_PHONES/);
      expect(() => loadConfig({ ...prod, DEMO_PHONES: undefined })).toThrowError(/DEMO_PHONES/);
    });

    it('refuses OTP_INBOX_OPEN, whatever its value', () => {
      expect(() => loadConfig({ ...prod, OTP_INBOX_OPEN: 'true' })).toThrowError(/OTP_INBOX_OPEN/);
      expect(() => loadConfig({ ...prod, OTP_INBOX_OPEN: 'false' })).toThrowError(/OTP_INBOX_OPEN/);
    });

    it('refuses ADMIN_PHONES, which no longer exists', () => {
      let message = '';
      try {
        loadConfig({ ...prod, ADMIN_PHONES: '9000000002' });
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toMatch(/ADMIN_PHONES/);
      expect(message).not.toContain('9000000002');
      // A blank value is the same as not set.
      expect(loadConfig({ ...prod, ADMIN_PHONES: '' }).demoPhones).toHaveLength(1);
    });

    it('refuses sign-in limits looser than the defaults, and accepts tighter ones', () => {
      expect(() => loadConfig({ ...prod, OTP_IP_REQUEST_MAX: '11' })).toThrowError(
        /OTP_IP_REQUEST_MAX/,
      );
      expect(() => loadConfig({ ...prod, OTP_IP_VERIFY_MAX: '21' })).toThrowError(
        /OTP_IP_VERIFY_MAX/,
      );
      expect(() => loadConfig({ ...prod, OTP_IP_INBOX_MAX: '31' })).toThrowError(
        /OTP_IP_INBOX_MAX/,
      );
      expect(loadConfig({ ...prod, OTP_IP_REQUEST_MAX: '5' }).otpIpLimits.request).toBe(5);
    });

    it('refuses a looser API rate limit in production, accepts a tighter one', () => {
      expect(() => loadConfig({ ...prod, RATE_LIMIT_SCALE: '2' })).toThrowError(/RATE_LIMIT_SCALE/);
      expect(loadConfig({ ...prod, RATE_LIMIT_SCALE: '0.5' }).rateLimitScale).toBe(0.5);
      expect(loadConfig({ ...prod }).rateLimitScale).toBe(1);
      expect(() => loadConfig({ ...prod, RATE_LIMIT_SCALE: '0' })).toThrowError(/RATE_LIMIT_SCALE/);
    });

    it('allows the looser limits and the open inbox outside production (tests)', () => {
      expect(loadConfig({ ...valid, RATE_LIMIT_SCALE: '1000' }).rateLimitScale).toBe(1000);
      const config = loadConfig({ ...valid, OTP_IP_REQUEST_MAX: '10000', OTP_INBOX_OPEN: 'true' });
      expect(config.otpIpLimits.request).toBe(10000);
    });
  });

  it('accepts OTP_MODE=simulated', () => {
    expect(loadConfig({ ...valid, OTP_MODE: 'simulated' }).otpMode).toBe('simulated');
  });

  it('requires OTP_MODE in production (fails closed) and defaults it elsewhere', () => {
    expect(() => loadConfig({ ...valid, NODE_ENV: 'production' })).toThrowError(/OTP_MODE/);
    expect(
      loadConfig({
        ...valid,
        NODE_ENV: 'production',
        DEMO_PHONES: '9000000001',
        OTP_MODE: 'simulated',
        LLM_PROVIDER: 'gemini',
        GEMINI_API_KEY: 'k',
      }).otpMode,
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

describe('production never runs the fake model (Day 14c)', () => {
  const prod = {
    ...valid,
    NODE_ENV: 'production',
    DEMO_PHONES: '9000000001',
    OTP_MODE: 'simulated',
    GEMINI_API_KEY: 'k',
  };

  it('accepts a production config with the real provider', () => {
    expect(loadConfig({ ...prod, LLM_PROVIDER: 'gemini' })).toMatchObject({
      nodeEnv: 'production',
      llmProvider: 'gemini',
      fakeLlmScenario: null,
    });
  });

  it('refuses LLM_PROVIDER=fake, with a clear error', () => {
    expect(() => loadConfig({ ...prod, LLM_PROVIDER: 'fake' })).toThrowError(
      /LLM_PROVIDER.*fake.*production/i,
    );
  });

  it('refuses FAKE_LLM_SCENARIO whatever the provider is', () => {
    expect(() =>
      loadConfig({
        ...prod,
        LLM_PROVIDER: 'gemini',
        FAKE_LLM_SCENARIO: 'e2e/errand-scenario.json',
      }),
    ).toThrowError(/FAKE_LLM_SCENARIO.*production/i);
    expect(() =>
      loadConfig({ ...prod, LLM_PROVIDER: 'fake', FAKE_LLM_SCENARIO: 'x.json' }),
    ).toThrowError(/FAKE_LLM_SCENARIO/);
  });

  it('refuses it even when it is empty: set at all is set', () => {
    expect(() =>
      loadConfig({ ...prod, LLM_PROVIDER: 'gemini', FAKE_LLM_SCENARIO: '' }),
    ).toThrowError(/FAKE_LLM_SCENARIO/);
  });

  it('has no bypass: no other variable lets the fake model into production', () => {
    for (const bypass of [
      'ALLOW_FAKE_LLM',
      'ALLOW_FAKE_LLM_IN_PRODUCTION',
      'FORCE_FAKE_LLM',
      'CI',
    ]) {
      expect(() => loadConfig({ ...prod, LLM_PROVIDER: 'fake', [bypass]: 'true' })).toThrowError(
        /production/i,
      );
    }
  });

  it('still allows the scripted model outside production (e2e and local runs)', () => {
    for (const NODE_ENV of ['development', 'test']) {
      expect(
        loadConfig({
          ...valid,
          NODE_ENV,
          LLM_PROVIDER: 'fake',
          FAKE_LLM_SCENARIO: 'e2e/errand-scenario.json',
        }),
      ).toMatchObject({ llmProvider: 'fake', fakeLlmScenario: 'e2e/errand-scenario.json' });
    }
  });
});

describe('a model for the errand agent (Day 14c)', () => {
  it('defaults to the shared models, so nothing changes until it is set', () => {
    expect(loadConfig(valid)).toMatchObject({
      geminiModel: 'gemini-3.1-flash-lite',
      errandModel: 'gemini-3.1-flash-lite',
      errandFallbackModel: null,
    });
    expect(loadConfig({ ...valid, GEMINI_MODEL: 'm1', GEMINI_FALLBACK_MODEL: 'f1' })).toMatchObject(
      { errandModel: 'm1', errandFallbackModel: 'f1' },
    );
  });

  it('GEMINI_ERRAND_MODEL moves only the errand agent; resolve keeps GEMINI_MODEL', () => {
    expect(loadConfig({ ...valid, GEMINI_ERRAND_MODEL: 'gemini-3.5-flash-lite' })).toMatchObject({
      geminiModel: 'gemini-3.1-flash-lite',
      errandModel: 'gemini-3.5-flash-lite',
    });
  });

  it('GEMINI_ERRAND_FALLBACK_MODEL overrides the shared fallback for the errand agent only', () => {
    const config = loadConfig({
      ...valid,
      GEMINI_FALLBACK_MODEL: 'shared-fallback',
      GEMINI_ERRAND_MODEL: 'e',
      GEMINI_ERRAND_FALLBACK_MODEL: 'errand-fallback',
    });
    expect(config).toMatchObject({
      geminiFallbackModel: 'shared-fallback',
      errandFallbackModel: 'errand-fallback',
    });
    expect(
      loadConfig({ ...valid, GEMINI_FALLBACK_MODEL: 'shared-fallback', GEMINI_ERRAND_MODEL: 'e' }),
    ).toMatchObject({ errandFallbackModel: 'shared-fallback' });
  });

  it('treats blank like unset, as the other model settings do', () => {
    expect(
      loadConfig({ ...valid, GEMINI_ERRAND_MODEL: '', GEMINI_ERRAND_FALLBACK_MODEL: '' }),
    ).toMatchObject({ errandModel: 'gemini-3.1-flash-lite', errandFallbackModel: null });
  });

  it('is allowed in production with the real provider', () => {
    expect(
      loadConfig({
        ...valid,
        NODE_ENV: 'production',
        DEMO_PHONES: '9000000001',
        OTP_MODE: 'simulated',
        LLM_PROVIDER: 'gemini',
        GEMINI_API_KEY: 'k',
        GEMINI_ERRAND_MODEL: 'gemini-3.5-flash-lite',
      }).errandModel,
    ).toBe('gemini-3.5-flash-lite');
  });
});

describe('photo storage cap (ADR-0030)', () => {
  it("defaults to 300 MB, for Neon's free 0.5 GB", () => {
    expect(loadConfig(valid)).toMatchObject({ photoStorageCapMb: 300 });
  });

  it('is configurable, and must be a positive number', () => {
    expect(loadConfig({ ...valid, PHOTO_STORAGE_CAP_MB: '150' })).toMatchObject({
      photoStorageCapMb: 150,
    });
    expect(() => loadConfig({ ...valid, PHOTO_STORAGE_CAP_MB: '0' })).toThrow();
    expect(() => loadConfig({ ...valid, PHOTO_STORAGE_CAP_MB: 'lots' })).toThrow();
  });
});

describe('limiter key diagnostic (ADR-0058)', () => {
  it('is off by default and on only for the word "on"', () => {
    expect(loadConfig(valid).limiterDiag).toBe(false);
    expect(loadConfig({ ...valid, LIMITER_DIAG: '' }).limiterDiag).toBe(false);
    expect(loadConfig({ ...valid, LIMITER_DIAG: 'on' }).limiterDiag).toBe(true);
    expect(() => loadConfig({ ...valid, LIMITER_DIAG: 'true' })).toThrowError(/LIMITER_DIAG/);
  });
});

describe('demo autopilot (ADR-0062)', () => {
  it('is off by default, so nothing answers for the simulated shops', () => {
    expect(loadConfig(valid)).toMatchObject({
      demoAutopilot: false,
      demoAutopilotMaxPerMinute: 30,
    });
    expect(loadConfig({ ...valid, DEMO_AUTOPILOT: 'off' }).demoAutopilot).toBe(false);
    expect(loadConfig({ ...valid, DEMO_AUTOPILOT: '' }).demoAutopilot).toBe(false);
  });

  it('is on only for the word "on"', () => {
    expect(loadConfig({ ...valid, DEMO_AUTOPILOT: 'on' }).demoAutopilot).toBe(true);
    for (const value of ['true', '1', 'yes', 'ON', 'maybe'])
      expect(() => loadConfig({ ...valid, DEMO_AUTOPILOT: value })).toThrowError(/DEMO_AUTOPILOT/);
  });

  it('caps its answers per minute between 1 and 600', () => {
    expect(
      loadConfig({ ...valid, DEMO_AUTOPILOT_MAX_PER_MINUTE: '12' }).demoAutopilotMaxPerMinute,
    ).toBe(12);
    for (const value of ['0', '601', 'many'])
      expect(() => loadConfig({ ...valid, DEMO_AUTOPILOT_MAX_PER_MINUTE: value })).toThrow();
  });
});

describe('round 3 C-16 settings', () => {
  it('thinks minimally and hedges after 4 s by default; both can be changed', () => {
    const base = valid;
    const defaults = loadConfig(base);
    expect(defaults.geminiThinking).toBe('minimal');
    expect(defaults.aiHedgeAfterMs).toBe(4000);
    const changed = loadConfig({
      ...base,
      GEMINI_THINKING: 'model_default',
      AI_HEDGE_AFTER_MS: '0',
    });
    expect(changed.geminiThinking).toBe('model_default');
    expect(changed.aiHedgeAfterMs).toBe(0);
    expect(() => loadConfig({ ...base, GEMINI_THINKING: 'high' })).toThrow(/GEMINI_THINKING/);
    expect(() => loadConfig({ ...base, AI_HEDGE_AFTER_MS: '20000' })).toThrow(/AI_HEDGE_AFTER_MS/);
  });
});
