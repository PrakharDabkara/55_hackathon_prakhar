// Measures what an idle BullMQ worker costs in Redis commands.
// Usage: REDIS_URL=redis://localhost:6379 node --experimental-strip-types \
//          apps/api/scripts/redis-idle-worker.ts [seconds=600]
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { extrapolate, parseCommandStats, UPSTASH_FREE_COMMANDS_PER_MONTH } from './commandStats.ts';

const seconds = Number(process.argv[2] ?? 600);
const url = new URL(process.env.REDIS_URL ?? 'redis://localhost:6379');
const connection = {
  host: url.hostname,
  port: Number(url.port || 6379),
  maxRetriesPerRequest: null,
};
const name = `idle-experiment-${Date.now()}`;

const queue = new Queue(name, { connection });
const worker = new Worker(name, async () => {}, { connection });
await worker.waitUntilReady();

const admin = new Redis({ host: connection.host, port: connection.port });
await admin.config('RESETSTAT');
console.log(`Idle worker running for ${seconds}s on ${url.host} ...`);
await new Promise((resolve) => setTimeout(resolve, seconds * 1000));

const stats = parseCommandStats(await admin.info('commandstats'));
await worker.close();
await queue.obliterate({ force: true });
await queue.close();
admin.disconnect();

const total = Object.values(stats).reduce((a, b) => a + b, 0);
const { perSecond, perMonth, percentOfUpstashFree } = extrapolate(total, seconds);
console.table(
  Object.entries(stats)
    .sort((a, b) => b[1] - a[1])
    .map(([command, calls]) => ({ command, calls })),
);
console.log(`total commands:      ${total} in ${seconds}s`);
console.log(`per second:          ${perSecond.toFixed(3)}`);
console.log(`per 30-day month:    ${perMonth.toLocaleString()}`);
console.log(
  `Upstash free cap:    ${UPSTASH_FREE_COMMANDS_PER_MONTH.toLocaleString()} (${percentOfUpstashFree.toFixed(0)}% of it)`,
);
