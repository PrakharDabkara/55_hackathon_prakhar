/**
 * Records what Redis, BullMQ and Postgres REALLY throw when they fail, using throwaway
 * Testcontainers (no external service, no .env, no real data). Writes redacted JSON fixtures to
 * apps/api/src/testing/observed/. Run: node scripts/probe/record-local-failures.ts
 *
 * Imports only npm libraries, never app code, so what is recorded is the library's own behaviour.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import pg from 'pg';
import { GenericContainer } from 'testcontainers';

const out = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../apps/api/src/testing/observed',
);
mkdirSync(out, { recursive: true });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const redact = (text: string) =>
  text.replace(/redis:\/\/[^\s'"]+/g, 'redis://[host]').replace(/postgres:\/\/[^\s'"]+/g, '[url]');

/** The parts of an error our code can branch on, and nothing that carries a connection string. */
function shape(error: unknown) {
  const e = error as Record<string, unknown> | null;
  const cause = e?.['cause'] as Record<string, unknown> | undefined;
  return {
    name: (e?.['name'] as string) ?? typeof error,
    constructor: (error as object | null)?.constructor?.name ?? null,
    message: redact(String(e?.['message'] ?? error)).slice(0, 300),
    code: e?.['code'] ?? null,
    errno: e?.['errno'] ?? null,
    syscall: e?.['syscall'] ?? null,
    causeCode: cause?.['code'] ?? null,
    severity: e?.['severity'] ?? null,
    constraint: e?.['constraint'] ?? null,
  };
}

async function attempt<T>(label: string, run: () => Promise<T>, ms = 4000) {
  const started = Date.now();
  try {
    const value = await Promise.race([
      run(),
      sleep(ms).then(() => {
        throw Object.assign(new Error(`NO ANSWER within ${ms} ms (call is still pending)`), {
          name: 'Hang',
        });
      }),
    ]);
    return { label, ok: true, ms: Date.now() - started, value: String(value).slice(0, 80) };
  } catch (error) {
    return { label, ok: false, ms: Date.now() - started, error: shape(error) };
  }
}

async function redisOom() {
  const container = await new GenericContainer('redis:8.8.3-alpine')
    .withExposedPorts(6379)
    .withCommand(['redis-server', '--maxmemory', '2mb', '--maxmemory-policy', 'noeviction'])
    .start();
  const url = `redis://${container.getHost()}:${container.getMappedPort(6379)}`;
  const results: unknown[] = [];
  const admin = new Redis(url, { maxRetriesPerRequest: 1, commandTimeout: 1000 });
  admin.on('error', () => undefined);
  const workerConnection = new Redis(url, { maxRetriesPerRequest: null });
  workerConnection.on('error', () => undefined);
  const queueConnection = new Redis(url, { maxRetriesPerRequest: null });
  queueConnection.on('error', () => undefined);
  const queue = new Queue('probe', { connection: queueConnection });
  queue.on('error', () => undefined);
  let processed = 0;
  const worker = new Worker(
    'probe',
    async () => {
      processed++;
    },
    { connection: workerConnection },
  );
  worker.on('error', (e) =>
    results.push({ label: 'worker error event while full', error: shape(e) }),
  );
  await sleep(500);
  // A job due in 2.5 s, queued while there is room: will the worker be able to pick it up once full?
  await queue.add('later', { a: 1 }, { jobId: 'due-later', delay: 2500 });

  // Fill with many small values (a single big command would be refused for its own buffer, not
  // because the dataset is full), until a tiny write is refused.
  const blob = 'x'.repeat(2000);
  let filledWith = 0;
  let firstRefusal: unknown = null;
  for (let i = 0; i < 5000 && !firstRefusal; i++) {
    try {
      await admin.set(`fill:${i}`, blob);
      filledWith = i + 1;
    } catch (error) {
      firstRefusal = shape(error);
    }
  }
  const info = await admin.info('memory');
  results.push({
    label: 'filled keys before first refusal',
    value: filledWith,
    firstRefusal,
    usedMemory: /used_memory:(\d+)/.exec(info)?.[1],
    maxmemory: /maxmemory:(\d+)/.exec(info)?.[1],
  });
  results.push(await attempt('SET when full', () => admin.set('k', 'v')));
  results.push(
    await attempt('GET when full (reads still work)', () =>
      admin.get('fill:0').then((v) => (v ? 'value' : 'null')),
    ),
  );
  results.push(await attempt('INCR when full', () => admin.incr('rl:probe')));
  results.push(
    await attempt(
      'EVAL INCR+PEXPIRE (the ip-limit script) when full',
      () =>
        admin.eval(
          `local n = redis.call('INCR', KEYS[1]) if n == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end return {n, 1}`,
          1,
          'rl:probe',
          60000,
        ) as Promise<unknown>,
    ),
  );
  results.push(
    await attempt('BullMQ queue.add when full', () =>
      queue.add('probe', { a: 1 }, { jobId: 'probe-1', attempts: 1 }).then((j) => j.id ?? ''),
    ),
  );
  results.push(
    await attempt('BullMQ queue.add with delay when full', () =>
      queue.add('probe', { a: 1 }, { jobId: 'probe-2', delay: 1000 }).then((j) => j.id ?? ''),
    ),
  );
  // Free some space and see whether BullMQ recovers by itself.
  await admin.del(...Array.from({ length: 10 }, (_, i) => `fill:${i}`));
  results.push(
    await attempt('BullMQ queue.add after freeing space', () =>
      queue.add('probe', { a: 1 }, { jobId: 'probe-3' }).then((j) => j.id ?? ''),
    ),
  );
  await sleep(5000);
  const counts = await queue
    .getJobCounts('wait', 'active', 'delayed', 'completed', 'failed')
    .catch((e: unknown) => ({ error: shape(e) }));
  results.push({
    label: 'job queued before the fill, due 2.5 s later: state after 5 s of a full Redis',
    processedByWorker: processed,
    jobCounts: counts,
  });
  writeFileSync(
    path.join(out, 'redis-oom.json'),
    JSON.stringify({ maxmemory: '2mb', policy: 'noeviction', results }, null, 2) + '\n',
  );
  await worker.close().catch(() => undefined);
  await queue.close().catch(() => undefined);
  admin.disconnect();
  await container.stop();
}

async function redisDown() {
  const container = await new GenericContainer('redis:8.8.3-alpine').withExposedPorts(6379).start();
  const url = `redis://${container.getHost()}:${container.getMappedPort(6379)}`;
  const results: unknown[] = [];
  const errorEvents: unknown[] = [];
  // Two connection styles the app uses: producers with maxRetriesPerRequest 1 + commandTimeout, and
  // queue/worker connections with maxRetriesPerRequest null.
  const strict = new Redis(url, { maxRetriesPerRequest: 1, commandTimeout: 1000 });
  strict.on('error', (e) => errorEvents.push(shape(e)));
  const patient = new Redis(url, { maxRetriesPerRequest: null });
  patient.on('error', () => undefined);
  const queue = new Queue('probe2', { connection: patient });
  queue.on('error', () => undefined);
  await strict.ping();
  await container.stop();
  await sleep(300);
  results.push(
    await attempt('strict (retries 1, commandTimeout 1000) GET, Redis stopped', () =>
      strict.get('x').then((v) => String(v)),
    ),
  );
  results.push(
    await attempt(
      'strict EVAL, Redis stopped',
      () => strict.eval('return 1', 0) as Promise<unknown>,
    ),
  );
  results.push(
    await attempt(
      'patient (retries null) GET, Redis stopped',
      () => patient.get('x').then((v) => String(v)),
      5000,
    ),
  );
  results.push(
    await attempt(
      'BullMQ queue.add (patient connection), Redis stopped',
      () => queue.add('probe', {}, { jobId: 'down-1' }).then((j) => j.id ?? ''),
      5000,
    ),
  );
  writeFileSync(
    path.join(out, 'redis-down.json'),
    JSON.stringify(
      {
        results,
        uniqueErrorEvents: [...new Map(errorEvents.map((e) => [JSON.stringify(e), e])).values()],
      },
      null,
      2,
    ) + '\n',
  );
  strict.disconnect();
  patient.disconnect();
  await queue.close().catch(() => undefined);
}

async function postgres() {
  const container = await new GenericContainer('postgres:17-alpine')
    .withEnvironment({ POSTGRES_PASSWORD: 'probe', POSTGRES_USER: 'probe', POSTGRES_DB: 'probe' })
    .withExposedPorts(5432)
    .withWaitStrategy(
      (await import('testcontainers')).Wait.forLogMessage(/ready to accept connections/, 2),
    )
    .start();
  const url = `postgres://probe:probe@${container.getHost()}:${container.getMappedPort(5432)}/probe`;
  const results: unknown[] = [];
  const pool = new pg.Pool({ connectionString: url, max: 4 });
  const poolErrors: unknown[] = [];
  pool.on('error', (e) => poolErrors.push(shape(e)));
  const sql = async (label: string, text: string, params: unknown[] = []) => {
    results.push(
      await attempt(label, () => pool.query(text, params).then((r) => `${r.rowCount} rows`), 8000),
    );
  };
  await pool.query('CREATE TABLE u (id int PRIMARY KEY, k text UNIQUE)');
  await pool.query("INSERT INTO u VALUES (1, 'a')");
  await sql('23505 unique_violation', "INSERT INTO u VALUES (2, 'a')");
  await sql('22P02 invalid_text_representation', "SELECT 'abc'::int");
  await sql('23502 not_null_violation', 'INSERT INTO u VALUES (NULL, $1)', ['z']);
  await sql('42P01 undefined_table', 'SELECT * FROM missing');
  await sql(
    '57014 query_canceled by statement_timeout',
    'SET statement_timeout = 200; SELECT pg_sleep(2)',
  );
  // Deadlock: two transactions lock rows in opposite order.
  await pool.query("INSERT INTO u VALUES (3, 'c'), (4, 'd')");
  const c1 = await pool.connect();
  const c2 = await pool.connect();
  await c1.query('BEGIN');
  await c2.query('BEGIN');
  await c1.query('SELECT * FROM u WHERE id = 3 FOR UPDATE');
  await c2.query('SELECT * FROM u WHERE id = 4 FOR UPDATE');
  const a = c1.query('SELECT * FROM u WHERE id = 4 FOR UPDATE').then(
    () => 'ok',
    (e: unknown) => shape(e),
  );
  await sleep(300);
  const b = c2.query('SELECT * FROM u WHERE id = 3 FOR UPDATE').then(
    () => 'ok',
    (e: unknown) => shape(e),
  );
  results.push({
    label: '40P01 deadlock_detected (one of the two transactions)',
    outcomes: await Promise.all([a, b]),
  });
  await c1.query('ROLLBACK').catch(() => undefined);
  await c2.query('ROLLBACK').catch(() => undefined);
  c1.release();
  c2.release();
  // Serialization failure.
  const s1 = await pool.connect();
  const s2 = await pool.connect();
  await s1.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
  await s2.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
  await s1.query('SELECT count(*) FROM u');
  await s2.query('SELECT count(*) FROM u');
  await s1.query("INSERT INTO u VALUES (10, 'x')");
  await s2.query("INSERT INTO u VALUES (11, 'y')");
  const r1 = await s1.query('COMMIT').then(
    () => 'ok',
    (e: unknown) => shape(e),
  );
  const r2 = await s2.query('COMMIT').then(
    () => 'ok',
    (e: unknown) => shape(e),
  );
  results.push({ label: '40001 serialization_failure', outcomes: [r1, r2] });
  s1.release();
  s2.release();
  // Too many connections.
  const clients: pg.Client[] = [];
  const tooMany = await attempt(
    '53300 too_many_connections',
    async () => {
      for (let i = 0; i < 150; i++) {
        const c = new pg.Client({ connectionString: url });
        c.on('error', () => undefined);
        clients.push(c);
        await c.connect();
      }
      return 'connected 150';
    },
    20000,
  );
  results.push(tooMany);
  await Promise.all(clients.map((c) => c.end().catch(() => undefined)));

  stage = 'idle kill';
  // Kill a backend (what Neon does when it suspends compute): an idle client, then a running query.
  const idle = await pool.connect();
  const pid = (await idle.query('SELECT pg_backend_pid() AS pid')).rows[0].pid as number;
  idle.release();
  const killer = new pg.Client({ connectionString: url });
  await killer.connect();
  await killer.query('SELECT pg_terminate_backend($1)', [pid]);
  await sleep(300);
  results.push({
    label: 'pool "error" events after pg_terminate_backend of an idle client',
    events: poolErrors.splice(0),
  });
  results.push(
    await attempt('next pool.query after the idle client was killed', () =>
      pool.query('SELECT 1').then(() => 'ok'),
    ),
  );
  stage = 'running kill';
  const running = pool.connect();
  const rc = await running;
  const rpid = (await rc.query('SELECT pg_backend_pid() AS pid')).rows[0].pid as number;
  const longQuery = rc.query('SELECT pg_sleep(30)').then(
    () => 'ok',
    (e: unknown) => shape(e),
  );
  await sleep(300);
  await killer.query('SELECT pg_terminate_backend($1)', [rpid]);
  results.push({
    label: '57P01 admin_shutdown: backend terminated while a query runs',
    outcome: await longQuery,
  });
  rc.release(true);
  await killer.end();
  stage = 'container stop';
  // Whole container killed mid-query.
  const victim = await pool.connect();
  const victimEvents: unknown[] = [];
  victim.on('error', (e) => victimEvents.push(shape(e)));
  const midQuery = victim.query('SELECT pg_sleep(30)').then(
    () => 'ok',
    (e: unknown) => shape(e),
  );
  await sleep(300);
  await container.stop({ timeout: 1 });
  results.push({
    label: 'container stopped (SIGTERM then SIGKILL) while a query runs',
    outcome: await Promise.race([
      midQuery,
      sleep(15000).then(() => 'HANG: still pending after 15 s'),
    ]),
  });
  await sleep(500);
  results.push({
    label:
      "'error' events on the CHECKED-OUT client after the container stopped (pool.on('error') does not cover these)",
    events: victimEvents,
  });
  victim.release(true);
  results.push(
    await attempt(
      'pool.query with Postgres gone (refused)',
      () => pool.query('SELECT 1').then(() => 'ok'),
      20000,
    ),
  );
  results.push({
    label: 'pool "error" events overall after the container stopped',
    events: poolErrors,
  });
  writeFileSync(
    path.join(out, 'postgres.json'),
    JSON.stringify({ image: 'postgres:17-alpine', results }, null, 2) + '\n',
  );
  await pool.end().catch(() => undefined);
}

let stage = 'start';
process.on('uncaughtException', (e) => {
  console.error('stage:', stage);
  console.error('UNCAUGHT (would crash the process):', (e as Error).message);
  console.error(
    String((e as Error).stack)
      .split('\n')
      .slice(0, 8)
      .join('\n'),
  );
});

const which = process.argv[2] ?? 'all';
if (which === 'all' || which === 'oom') await redisOom();
if (which === 'all' || which === 'down') await redisDown();
if (which === 'all' || which === 'pg') await postgres();
console.log('recorded to', out);
process.exit(0);
