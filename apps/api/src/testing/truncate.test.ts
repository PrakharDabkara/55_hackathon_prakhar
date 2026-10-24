import { afterEach, describe, expect, it, vi } from 'vitest';
import { truncateKeepingShops } from './truncate.js';
import { waitForQuietDb } from './waitForQuietDb.js';

/** A pool whose TRUNCATE fails with the given error codes, one per attempt, then goes through. */
const fakePool = (truncateFailures: string[]) => {
  const log: string[] = [];
  const failures = [...truncateFailures];
  const client = {
    query: async (sql: string) => {
      log.push(sql.split(/\s/)[0] as string);
      if (sql.startsWith('TRUNCATE')) {
        const code = failures.shift();
        if (code) throw Object.assign(new Error(`fake ${code}`), { code });
      }
      return { rows: [] };
    },
    release: () => log.push('release'),
  };
  return { pool: { connect: async () => client }, log };
};

afterEach(() => vi.restoreAllMocks());

describe('truncateKeepingShops', () => {
  it('retries a deadlock (40P01), rolls the failed attempt back, and logs each retry', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { pool, log } = fakePool(['40P01', '40P01']);
    await truncateKeepingShops(pool, 'requests');
    expect(log.filter((l) => l === 'ROLLBACK')).toHaveLength(2);
    expect(log.filter((l) => l === 'COMMIT')).toHaveLength(1);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('gives up after 3 attempts, so a recurring deadlock still fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { pool, log } = fakePool(['40P01', '40P01', '40P01', '40P01']);
    await expect(truncateKeepingShops(pool, 'requests')).rejects.toThrow('fake 40P01');
    expect(log.filter((l) => l.startsWith('TRUNCATE'))).toHaveLength(3);
  });

  it('does not retry any other error', async () => {
    const { pool, log } = fakePool(['23503']);
    await expect(truncateKeepingShops(pool, 'requests')).rejects.toThrow('fake 23503');
    expect(log.filter((l) => l.startsWith('TRUNCATE'))).toHaveLength(1);
  });
});

describe('waitForQuietDb', () => {
  const poolReturning = (batches: { query: string }[][]) => ({
    query: async () => ({ rows: batches.length > 1 ? batches.shift() : batches[0] }),
  });

  it('returns once no other backend is running a query', async () => {
    await waitForQuietDb(poolReturning([[{ query: 'SELECT 1' }], []]), 2000);
  });

  it('fails with the queries still running when the time runs out', async () => {
    await expect(
      waitForQuietDb(poolReturning([[{ query: 'SELECT pings FROM busy' }]]), 300),
    ).rejects.toThrow(/still running.*SELECT pings FROM busy/s);
  });
});
