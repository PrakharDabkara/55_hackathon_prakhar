import { execSync, spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pino } from 'pino';
import { it } from 'vitest';
import { loadSeedCatalog, seedCatalog } from '../apps/api/src/modules/catalog/index.js';
import { startPostgres } from '../apps/api/src/testing/startPostgres.js';
import { startRedis } from '../apps/api/src/testing/startRedis.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Which statements does an idle API run, with the autopilot off and on?
it('idle statements', async () => {
  const [db, redis] = await Promise.all([startPostgres(), startRedis()]);
  await seedCatalog(db.pool, loadSeedCatalog());
  await db.pool.query(`ALTER SYSTEM SET log_statement = 'all'`);
  await db.pool.query('SELECT pg_reload_conf()');
  const id = execSync(`docker ps -q --filter ancestor=askbuy-postgres:test`)
    .toString()
    .trim()
    .split('\n')[0];
  void pino;
  let port = 53300;
  for (const mode of ['off', 'on']) {
    const child = spawn('node', ['apps/api/dist/server.js'], {
      cwd: ROOT,
      stdio: 'ignore',
      env: {
        PATH: process.env['PATH'] as string,
        NODE_ENV: 'development',
        PORT: String(port++),
        LOG_LEVEL: 'warn',
        DATABASE_URL: db.url,
        REDIS_URL: redis.url,
        ADMIN_TOKEN: 'x'.repeat(40),
        LLM_PROVIDER: 'fake',
        WORKERS_ENABLED: 'true',
        DEMO_AUTOPILOT: mode,
        DEMO_PHONES: '9000000202',
      },
    });
    await sleep(8000); // started, startup scan done
    const since = new Date().toISOString();
    await sleep(70_000);
    const log = execSync(`docker logs --since ${since} ${id} 2>&1`, {
      maxBuffer: 1 << 28,
    }).toString();
    const counts = new Map<string, number>();
    for (const m of log.matchAll(/statement: ([^\n]{0,90})/g))
      counts.set(m[1] as string, (counts.get(m[1] as string) ?? 0) + 1);
    console.log(
      `MODE ${mode}: ${[...counts.values()].reduce((a, b) => a + b, 0)} statements in 70 s`,
    );
    for (const [k, v] of [...counts].sort((a, b) => b[1] - a[1]).slice(0, 12))
      console.log(`  ${v}  ${k}`);
    child.kill('SIGTERM');
    await sleep(1500);
  }
  await db.stop();
  await redis.stop();
}, 600_000);
