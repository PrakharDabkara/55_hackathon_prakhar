import { pino } from 'pino';
import { describe, expect, it, vi } from 'vitest';
import { createPingDedupe, type RedisLike } from './pingDedupe.js';

const logs: Record<string, unknown>[] = [];
const logger = pino(
  { level: 'debug' },
  { write: (line: string) => logs.push(JSON.parse(line) as Record<string, unknown>) },
);

describe('createPingDedupe', () => {
  it('claims with SET key NX EX, using ping-dedupe-<shopId>-<itemId> and the window in seconds', async () => {
    const set = vi.fn(async () => 'OK' as const);
    const dedupe = createPingDedupe({ set, del: vi.fn() } as RedisLike, logger, 30);

    expect(await dedupe.claim('shop-1', 'item-9')).toBe(true);
    expect(set).toHaveBeenCalledWith('ping-dedupe-shop-1-item-9', '1', 'EX', 1800, 'NX');
  });

  it('refuses when the key already exists (NX returns null)', async () => {
    const dedupe = createPingDedupe(
      { set: vi.fn(async () => null), del: vi.fn() } as unknown as RedisLike,
      logger,
      30,
    );
    expect(await dedupe.claim('shop-1', 'item-9')).toBe(false);
  });

  it('lets the ping through, and logs it, when Redis fails', async () => {
    logs.length = 0;
    const dedupe = createPingDedupe(
      {
        set: vi.fn(async () => {
          throw new Error('Command timed out');
        }),
        del: vi.fn(),
      } as unknown as RedisLike,
      logger,
      30,
    );
    expect(await dedupe.claim('shop-1', 'item-9')).toBe(true);
    expect(logs.some((l) => l['level'] === 40 && /dedupe/.test(String(l['msg'])))).toBe(true);
  });

  it('lets the ping through when there is no Redis at all', async () => {
    const dedupe = createPingDedupe(null, logger, 30);
    expect(await dedupe.claim('a', 'b')).toBe(true);
    await expect(dedupe.release('a', 'b')).resolves.toBeUndefined();
  });

  it('release deletes the key and never throws', async () => {
    const del = vi.fn(async () => 1);
    const dedupe = createPingDedupe({ set: vi.fn(), del } as unknown as RedisLike, logger, 30);
    await dedupe.release('shop-1', 'item-9');
    expect(del).toHaveBeenCalledWith('ping-dedupe-shop-1-item-9');

    const broken = createPingDedupe(
      {
        set: vi.fn(),
        del: vi.fn(async () => {
          throw new Error('down');
        }),
      } as unknown as RedisLike,
      logger,
      30,
    );
    await expect(broken.release('a', 'b')).resolves.toBeUndefined();
  });
});
