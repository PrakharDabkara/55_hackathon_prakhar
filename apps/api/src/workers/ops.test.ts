import type { Queue } from 'bullmq';
import { describe, expect, it, vi } from 'vitest';
import { createOps } from './ops.js';

const queue = { getJobCounts: async () => ({}) } as unknown as Queue;
const ops = (memoryInfo: () => Promise<string>) =>
  createOps({ queues: { a: queue }, autopilot: null, memoryInfo });

const INFO = [
  '# Memory',
  'used_memory:5123456',
  'used_memory_human:4.89M',
  'maxmemory:26214400',
  'maxmemory_policy:noeviction',
  'mem_clients_normal:1234',
].join('\r\n');

describe('createOps redisMemory', () => {
  it('returns only used_memory and maxmemory from INFO', async () => {
    const memory = await ops(async () => INFO).redisMemory();
    expect(memory).toEqual({ usedBytes: 5123456, maxBytes: 26214400 });
  });

  it('rejects when INFO is disabled or garbled, so the caller can say "unknown"', async () => {
    await expect(ops(async () => '').redisMemory()).rejects.toThrow();
    await expect(
      ops(async () => {
        throw new Error('ERR unknown command');
      }).redisMemory(),
    ).rejects.toThrow();
  });

  it('asks Redis once per call, not at creation', async () => {
    const info = vi.fn(async () => INFO);
    const probes = ops(info);
    expect(info).not.toHaveBeenCalled();
    await probes.redisMemory();
    expect(info).toHaveBeenCalledTimes(1);
  });
});
