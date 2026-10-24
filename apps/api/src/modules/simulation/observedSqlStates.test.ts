import { readFileSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../http/errors.js';
import { removeSimulatedShops } from './service.js';

/**
 * PR F1: the SQLSTATEs removeSimulatedShops branches on, replayed from what a real Postgres 17
 * sent (testing/observed/postgres.json, recorded by scripts/probe/record-local-failures.ts). The
 * error class is pg's own DatabaseError, as the driver throws it.
 */
const recorded: {
  results: { label: string; outcomes?: unknown[]; outcome?: unknown; error?: unknown }[];
} = JSON.parse(
  readFileSync(path.resolve(import.meta.dirname, '../../testing/observed/postgres.json'), 'utf8'),
);

interface Seen {
  name: string;
  constructor: string;
  message: string;
  code: string;
  severity: string;
}
const seen = (prefix: string): Seen => {
  const row = recorded.results.find((r) => r.label.startsWith(prefix));
  const candidates = [...(row?.outcomes ?? []), row?.outcome, row?.error] as unknown[];
  const error = candidates.find((c) => typeof c === 'object' && c !== null) as Seen | undefined;
  if (!error) throw new Error(`no recorded error for ${prefix}`);
  return error;
};
const databaseError = (s: Seen) => {
  const e = new pg.DatabaseError(s.message, 0, 'error');
  e.code = s.code;
  e.severity = s.severity;
  return e;
};

/** A pool whose transactions fail on BEGIN with `error`, `times` times, then work. */
function dbFailing(error: Error, times: number) {
  let failures = 0;
  const query = vi.fn(async (sql: string) => {
    if (/^BEGIN/.test(sql) && failures < times) {
      failures++;
      throw error;
    }
    return { rows: [], rowCount: 0 };
  });
  const client = { query, on: vi.fn(), removeListener: vi.fn(), release: vi.fn() };
  return { db: { query, connect: async () => client } as never, query };
}

describe('removeSimulatedShops with the real Postgres errors', () => {
  it('a real deadlock (40P01) is retried, and then succeeds', async () => {
    const e = databaseError(seen('40P01'));
    expect(e.code).toBe('40P01');
    const { db } = dbFailing(e, 2);
    await expect(removeSimulatedShops(db)).resolves.toEqual({ shops: 0, users: 0 });
  });

  it('a real deadlock that keeps happening ends as a 503 sim_remove_busy naming the state', async () => {
    const { db } = dbFailing(databaseError(seen('40P01')), 99);
    const error = await removeSimulatedShops(db).catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 503, code: 'sim_remove_busy' });
    expect(error.message).toContain('40P01');
  });

  it('a real serialization failure (40001) is treated the same', async () => {
    const { db } = dbFailing(databaseError(seen('40001')), 1);
    await expect(removeSimulatedShops(db)).resolves.toBeDefined();
  });

  it.each([
    ['57P01', 'a backend killed while it ran (Neon suspending, a restart)'],
    ['57014', 'a statement timeout'],
    ['53300', 'too many connections'],
  ])('%s (%s) is not retried: a 500 sim_remove_failed with the state only', async (state) => {
    const real = databaseError(seen(state));
    expect(real.code).toBe(state);
    const { db, query } = dbFailing(real, 99);
    const error = await removeSimulatedShops(db).catch((e) => e);
    expect(error).toMatchObject({ status: 500, code: 'sim_remove_failed' });
    expect(error.message).toBe(`Could not remove simulated shops (${state})`);
    expect(query.mock.calls.filter(([sql]) => /^BEGIN/.test(String(sql)))).toHaveLength(1);
  });
});
