import type { Request } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../http/errors.js';
import { tokenMatches } from './adminToken.js';
import { createRequireAdmin } from './middleware.js';

const TOKEN = 'unit-test-admin-token-'.padEnd(40, 'x');

describe('tokenMatches', () => {
  it('is true only for the exact token', () => {
    expect(tokenMatches(TOKEN, TOKEN)).toBe(true);
    expect(tokenMatches(`${TOKEN.slice(0, -1)}y`, TOKEN)).toBe(false);
  });

  it('handles any length difference without throwing', () => {
    expect(tokenMatches('', TOKEN)).toBe(false);
    expect(tokenMatches(TOKEN.slice(0, 5), TOKEN)).toBe(false);
    expect(tokenMatches(`${TOKEN}extra`, TOKEN)).toBe(false);
    expect(tokenMatches('x'.repeat(100_000), TOKEN)).toBe(false);
  });
});

describe('createRequireAdmin', () => {
  const run = (authorization: string | undefined) => {
    const next = vi.fn();
    const req = { headers: authorization === undefined ? {} : { authorization } } as Request;
    let thrown: unknown;
    try {
      createRequireAdmin(TOKEN)(req, {} as never, next);
    } catch (error) {
      thrown = error;
    }
    return { next, thrown };
  };

  it('lets the exact bearer token through', () => {
    const { next, thrown } = run(`Bearer ${TOKEN}`);
    expect(thrown).toBeUndefined();
    expect(next).toHaveBeenCalledOnce();
  });

  it('answers 404, as if the route did not exist, for everything else', () => {
    for (const header of [
      undefined,
      '',
      'Bearer',
      'Bearer ',
      `Bearer ${TOKEN}x`,
      `Bearer ${TOKEN.slice(1)}`,
      `bearer ${TOKEN}`,
      TOKEN,
      `Basic ${TOKEN}`,
    ]) {
      const { next, thrown } = run(header);
      expect(next).not.toHaveBeenCalled();
      expect(thrown).toBeInstanceOf(ApiError);
      expect((thrown as ApiError).status).toBe(404);
    }
  });
});
