import type { Queue } from 'bullmq';
import type { OpsProbes, QueueDepth } from '../http/adminHealth.js';
import type { DemoAutopilot } from '../modules/demo/index.js';

const DAY_MS = 24 * 3_600_000;
/** Failed jobs are kept for a day or 100 of them; the newest 100 are enough to count a day. */
const FAILED_LOOKED_AT = 100;

async function depth(name: string, queue: Queue): Promise<QueueDepth> {
  const counts = await queue.getJobCounts('waiting', 'active', 'delayed');
  const failed = await queue.getJobs(['failed'], 0, FAILED_LOOKED_AT - 1);
  const since = Date.now() - DAY_MS;
  return {
    name,
    waiting: counts['waiting'] ?? 0,
    active: counts['active'] ?? 0,
    delayed: counts['delayed'] ?? 0,
    failedLast24h: failed.filter((job) => (job.finishedOn ?? 0) >= since).length,
  };
}

/** The numbers /admin/health/details reads from the queues and the autopilot of this process. */
export function createOps({
  queues,
  autopilot,
  memoryInfo,
}: {
  queues: Record<string, Queue | null | undefined>;
  autopilot: DemoAutopilot | null;
  /** The text of Redis `INFO memory`. */
  memoryInfo: () => Promise<string>;
}): OpsProbes {
  const live = Object.entries(queues).flatMap(([name, queue]) =>
    queue ? [[name, queue] as const] : [],
  );
  return {
    async redisOk() {
      const first = live[0];
      if (!first) return false;
      await first[1].getJobCounts('waiting');
      return true;
    },
    async redisMemory() {
      const info = await memoryInfo();
      const read = (key: string) => Number(new RegExp(`^${key}:(\d+)`, 'm').exec(info)?.[1] ?? 0);
      return { usedBytes: read('used_memory'), maxBytes: read('maxmemory') };
    },
    queues: () => Promise.all(live.map(([name, queue]) => depth(name, queue))),
    autopilot: () => ({
      on: autopilot !== null,
      lastActivityAt: autopilot?.stats().lastActivityAt ?? null,
    }),
  };
}
