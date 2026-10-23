/* eslint-disable @typescript-eslint/no-explicit-any */
import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { loadSeedCatalog, seedCatalog } from '../apps/api/src/modules/catalog/index.js';
import { DEMO_PLACE, DEMO_STOCK } from '../apps/api/src/modules/demo/fixtures.js';
import { connect } from '../apps/api/src/workers/redis.js';
import { startPostgres, type TestDatabase } from '../apps/api/src/testing/startPostgres.js';
import { startRedis } from '../apps/api/src/testing/startRedis.js';
import { pino } from 'pino';

/**
 * Cost of the demo autopilot (ADR-0062): the API runs as its own process, once with the autopilot
 * off and once on (alternating, ROUNDS times), under the same busy demo: five customers searching
 * every few seconds, one shopping list and, when someone answers it, one order. It samples the
 * API process's CPU and memory from /proc, counts database transactions while idle, and times the
 * customer's search. Needs `npm run build -w @askbuy/shared -w @askbuy/api` first.
 *   npm run perf:autopilot
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROUNDS = Number(process.env['PERF_ROUNDS'] ?? 2);
const IDLE_S = Number(process.env['PERF_IDLE_S'] ?? 45);
const BUSY_S = Number(process.env['PERF_BUSY_S'] ?? 120);
const OUT = process.env['PERF_OUT'];
const TOKEN = 'perf-admin-token-'.padEnd(48, 'x');
const quiet = pino({ level: 'silent' });
const CUSTOMERS = ['9000000202', '9000000203', '9000000204', '9000000205', '9000000206'];
const stocked = new Set(DEMO_STOCK.map((r) => r.slug));
const ITEMS = loadSeedCatalog()
  .items.filter((i) => !stocked.has(i.slug) && i.category !== 'medical')
  .slice(0, 60)
  .map((i) => i.nameEn);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length
    ? Math.round(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] as number)
    : NaN;
};

function procStat(pid: number) {
  const f = readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1]?.split(' ') as string[];
  const ticks = Number(f[11]) + Number(f[12]); // utime + stime
  const rssKb = Number(/VmRSS:\s+(\d+)/.exec(readFileSync(`/proc/${pid}/status`, 'utf8'))?.[1]);
  return { cpuS: ticks / 100, rssMb: rssKb / 1024 };
}

interface Phase {
  cpuPct: number;
  rssMeanMb: number;
  rssPeakMb: number;
}
async function sampled(pid: number, ms: number, during?: () => Promise<void>): Promise<Phase> {
  const t0 = Date.now();
  const c0 = procStat(pid).cpuS;
  const rss: number[] = [];
  const timer = setInterval(() => rss.push(procStat(pid).rssMb), 1000);
  if (during) await during();
  else await sleep(ms);
  clearInterval(timer);
  const secs = (Date.now() - t0) / 1000;
  return {
    cpuPct: ((procStat(pid).cpuS - c0) / secs) * 100,
    rssMeanMb: rss.reduce((a, b) => a + b, 0) / Math.max(1, rss.length),
    rssPeakMb: Math.max(...rss),
  };
}

describe('demo autopilot cost', () => {
  let db: TestDatabase;
  let pool: Pool;
  let redis: Awaited<ReturnType<typeof startRedis>>;
  const results: Record<string, unknown>[] = [];

  beforeAll(async () => {
    [db, redis] = await Promise.all([startPostgres(), startRedis()]);
    pool = db.pool;
    await seedCatalog(pool, loadSeedCatalog());
  }, 600_000);
  afterAll(async () => {
    await db?.stop();
    await redis?.stop();
  });

  async function runOnce(mode: 'off' | 'on', port: number) {
    const probe = connect(redis.url, quiet);
    await probe.flushall();
    probe.disconnect();
    const env = {
      PATH: process.env['PATH'] as string,
      NODE_ENV: 'development',
      PORT: String(port),
      LOG_LEVEL: 'warn',
      DATABASE_URL: db.url,
      REDIS_URL: redis.url,
      ADMIN_TOKEN: TOKEN,
      DEMO_PHONES: CUSTOMERS.join(','),
      OTP_INBOX_OPEN: 'true',
      OTP_IP_REQUEST_MAX: '100000',
      OTP_IP_VERIFY_MAX: '100000',
      OTP_IP_INBOX_MAX: '100000',
      RATE_LIMIT_SCALE: '1000',
      LLM_PROVIDER: 'fake',
      WORKERS_ENABLED: 'true',
      DEMO_AUTOPILOT: mode,
    };
    const child: ChildProcess = spawn('node', ['apps/api/dist/server.js'], {
      cwd: ROOT,
      env,
      stdio: 'ignore',
    });
    const base = `http://127.0.0.1:${port}`;
    try {
      for (let i = 0; i < 60; i++) {
        if ((await fetch(`${base}/health`).catch(() => null))?.ok) break;
        await sleep(500);
      }
      const admin = { Authorization: `Bearer ${TOKEN}` };
      await fetch(`${base}/admin/demo/reset`, { method: 'POST', headers: admin });
      await pool.query(
        `DELETE FROM shop_stock WHERE shop_id IN (SELECT id FROM shops WHERE is_simulated)`,
      );
      const pid = child.pid as number;

      // Idle: the instance is awake and nobody is doing anything.
      const xact = async () =>
        Number(
          (
            await pool.query(
              `SELECT xact_commit AS n FROM pg_stat_database WHERE datname = current_database()`,
            )
          ).rows[0].n,
        );
      const x0 = await xact();
      const idle = await sampled(pid, IDLE_S * 1000);
      const idleXacts = (await xact()) - x0 - 1; // minus our own probe

      // Busy: five customers searching, one list, one order.
      const tokens: string[] = [];
      for (const phone of CUSTOMERS) {
        await fetch(`${base}/auth/otp/request`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ phone }),
        });
        const code = (
          (await (await fetch(`${base}/dev/otp-inbox?phone=${phone}`)).json()) as { code: string }
        ).code;
        const v = (await (
          await fetch(`${base}/auth/otp/verify`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ phone, code, role: 'seeker' }),
          })
        ).json()) as { token: string };
        tokens.push(v.token);
      }
      const post: number[] = [];
      const get: number[] = [];
      let listOrdered = 'no';
      const failures: string[] = [];
      const call = async (token: string, method: string, url: string, body?: unknown) => {
        const t = performance.now();
        const res = await fetch(`${base}${url}`, {
          method,
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          ...(body !== undefined && { body: JSON.stringify(body) }),
        });
        const ms = performance.now() - t;
        return {
          ms,
          json: (await res.json().catch(() => null)) as Record<string, any> | null,
          status: res.status,
        };
      };
      const end = Date.now() + BUSY_S * 1000;
      const busy = await sampled(pid, 0, async () => {
        const loops = tokens.map(async (token, c) => {
          let k = c * 7;
          while (Date.now() < end) {
            const r = await call(token, 'POST', '/requests', {
              q: ITEMS[k++ % ITEMS.length],
              lat: DEMO_PLACE.lat,
              lng: DEMO_PLACE.lng,
            });
            if (r.status === 201 || r.status === 200) {
              post.push(r.ms);
              await sleep(2000);
              get.push((await call(token, 'GET', `/requests/${r.json?.['id']}`)).ms);
            }
            if (r.status !== 201 && r.status !== 200 && failures.length < 3)
              failures.push(`${r.status} ${JSON.stringify(r.json)}`);
            await sleep(3000 + c * 300);
          }
        });
        const list = (async () => {
          const token = tokens[0] as string;
          await sleep(10_000);
          const sorted = await call(token, 'POST', '/lists/sort', {
            lines: ['chini', 'chawal', 'pen'],
          });
          const id = sorted.json?.['id'];
          await call(token, 'POST', `/lists/${id}/send`, {
            lat: DEMO_PLACE.lat,
            lng: DEMO_PLACE.lng,
          });
          while (Date.now() < end - 5000 && listOrdered === 'no') {
            await sleep(3000);
            const view = (await call(token, 'GET', `/lists/${id}`)).json;
            const best = (view?.['answers'] as any[] | undefined)?.find((a) => a.haveCount > 0);
            if (!best) continue;
            const assignments = best.lines
              .filter((l: any) => l.status === 'have')
              .map((l: any) => ({ position: l.position, shopId: best.shopId }));
            const placed = await call(token, 'POST', `/lists/${id}/order`, {
              assignments,
              modes: { [best.shopId]: 'pickup' },
            });
            listOrdered = placed.status === 201 ? 'yes' : `no (${placed.status})`;
          }
        })();
        await Promise.all([...loops, list]);
      });
      await sleep(5000);
      const answered = Number(
        (await pool.query(`SELECT count(*) AS n FROM pings WHERE state IN ('YES','NO')`)).rows[0].n,
      );
      const orderStates = (
        await pool.query(`SELECT state, count(*)::int AS n FROM delivery_orders GROUP BY state`)
      ).rows;
      return {
        mode,
        idle: {
          ...idle,
          dbTransactions: idleXacts,
          perMinute: Math.round((idleXacts / IDLE_S) * 60),
        },
        busy,
        search: { n: post.length, p50: pct(post, 50), p95: pct(post, 95), p99: pct(post, 99) },
        status: { n: get.length, p50: pct(get, 50), p95: pct(get, 95), p99: pct(get, 99) },
        answeredPings: answered,
        orderStates,
        listOrdered,
        failures,
      };
    } finally {
      child.kill('SIGTERM');
      await sleep(1500);
    }
  }

  it('measures', async () => {
    let port = 53200;
    for (let r = 0; r < ROUNDS; r++)
      for (const mode of ['off', 'on'] as const) {
        const res = await runOnce(mode, port++);
        results.push(res);
        console.log(JSON.stringify(res));
      }
    if (OUT) writeFileSync(OUT, JSON.stringify(results, null, 2));
  });
});
