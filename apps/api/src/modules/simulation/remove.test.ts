import { describe, expect, it } from 'vitest';
import type { Database } from '../../db/queryable.js';
import { ApiError } from '../../http/errors.js';
import { removeSimulatedShops } from './service.js';

const dbError = (code: string) => Object.assign(new Error(`pg ${code}`), { code });

/** A database whose transactions fail with `failures` in turn, then succeed (one shop, one user). */
function fakeDb(failures: unknown[]) {
  let attempts = 0;
  const db = {
    query: async () => ({ rows: [], rowCount: 0 }),
    connect: async () => {
      const failure = failures[attempts++];
      return {
        on: () => undefined,
        removeListener: () => undefined,
        release: () => undefined,
        query: async (sql: string) => {
          if (failure && /DELETE FROM shops/.test(sql)) throw failure;
          if (/DELETE FROM shops/.test(sql)) return { rows: [{ owner_user_id: 'u1' }] };
          if (/DELETE FROM users/.test(sql)) return { rows: [], rowCount: 1 };
          return { rows: [], rowCount: 0 };
        },
      };
    },
  } as unknown as Database;
  return { db, attempts: () => attempts };
}

describe('removeSimulatedShops under contention', () => {
  it('runs the removal again after a deadlock or serialization failure', async () => {
    const f = fakeDb([dbError('40P01'), dbError('40001')]);
    await expect(removeSimulatedShops(f.db)).resolves.toEqual({ shops: 1, users: 1 });
    expect(f.attempts()).toBe(3);
  });

  it('gives up after three tries with a 503 "busy" the caller can retry', async () => {
    const f = fakeDb([dbError('40P01'), dbError('40P01'), dbError('40P01')]);
    const err = await removeSimulatedShops(f.db).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 503, code: 'sim_remove_busy' });
    expect(f.attempts()).toBe(3);
  });

  it('turns any other database error into 500 "sim_remove_failed" with the SQLSTATE in the message, never raw SQL', async () => {
    const f = fakeDb([dbError('23503')]);
    const err = await removeSimulatedShops(f.db).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 500, code: 'sim_remove_failed' });
    expect((err as ApiError).message).toContain('23503');
    expect(f.attempts()).toBe(1);
  });

  it('lets an error that is not from the database through unchanged', async () => {
    const f = fakeDb([new Error('boom')]);
    await expect(removeSimulatedShops(f.db)).rejects.toThrow('boom');
  });
});
