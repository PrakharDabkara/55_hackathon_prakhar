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
    });
  });

  it('accepts OTP_MODE=simulated', () => {
    expect(loadConfig({ ...valid, OTP_MODE: 'simulated' }).otpMode).toBe('simulated');
  });

  it('requires OTP_MODE in production (fails closed) and defaults it elsewhere', () => {
    expect(() => loadConfig({ ...valid, NODE_ENV: 'production' })).toThrowError(/OTP_MODE/);
    expect(loadConfig({ ...valid, NODE_ENV: 'production', OTP_MODE: 'simulated' }).otpMode).toBe(
      'simulated',
    );
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
