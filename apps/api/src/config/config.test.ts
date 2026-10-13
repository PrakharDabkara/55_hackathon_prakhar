import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

const valid = { DATABASE_URL: 'postgres://u:p@localhost:5433/db' };

describe('loadConfig', () => {
  it('applies defaults', () => {
    const config = loadConfig(valid);

    expect(config).toMatchObject({
      nodeEnv: 'development',
      port: 3000,
      logLevel: 'info',
      databaseUrl: valid.DATABASE_URL,
      gitSha: 'unknown',
    });
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
