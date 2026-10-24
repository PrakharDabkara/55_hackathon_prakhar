import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pino } from 'pino';
import { z } from 'zod';
import { loadConfig } from './config/config.js';
import { saveEmbeddings } from './evalEmbeddings.js';
import { createProgress, isHoldoutSet } from './evalProgress.js';
import { pinnedModelViolations, resolveEvalEnv } from './evalModel.js';
import { createQuotaStop } from './evalQuota.js';
import { createPool } from './db/pool.js';
import {
  checkGates,
  GATED_SET,
  renderMarkdown,
  scoreCase,
  scoreListLine,
  summarise,
  withinListBudget,
  type Case,
  type ListCase,
  type LlmCall,
  type Row,
  type Step,
  type Summary,
} from './evalScore.js';
import { aiFromConfig, providerFromConfig, QuotaWatch, watchProvider } from './modules/ai/index.js';
import {
  embedCatalog,
  loadSeedCatalog,
  resolveItem,
  resolveLines,
  seedCatalog,
} from './modules/catalog/index.js';
import { startPostgres, type TestDatabase } from './testing/startPostgres.js';
import { runWithRetries } from './evalRetry.js';

// Run by `npm run eval:resolve`. Sends every labelled query of the chosen set(s) through the whole
// resolution pipeline against the configured provider (LLM_PROVIDER=gemini for the real thing), then
// prints accuracy, accuracy by category, which step answered, the LLM fallback rate, tokens and p95
// latency, and writes one JSON report per set to evals/reports/.
//
//   EVAL_SET=dev|holdout-v2|holdout|list-dev|all   which set(s); default all = dev + holdout-v2 +
//                              list-dev (holdout is the retired v1, run only when asked for;
//                              list-dev sorts shopping lists, ADR-0055: reported, never gated, but a
//                              list that needs more than one model call or one embedding request
//                              fails the run)
//   EVAL_DB=testcontainers     run in a throwaway Postgres (CI); default is the DATABASE_URL database,
//                              which is then cleared of cached answers
//   EVAL_GATE=1                apply the holdout gates and exit 1 if one fails (CI)
//   EVAL_KINDS=variant,typo    only these kinds (handy while tuning on the dev set)
//   EVAL_AI_PAUSE_MS=5000      pause after a query that called the AI, to stay inside free-tier limits
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const env = process.env;
const gate = env['EVAL_GATE'] === '1';
const which = env['EVAL_SET'] ?? 'all';
const only = env['EVAL_KINDS']?.split(',');
const aiPauseMs = Number(env['EVAL_AI_PAUSE_MS'] ?? 5000);
const FILES = {
  dev: 'resolve.dev.jsonl',
  holdout: 'resolve.holdout.jsonl', // v1, retired after informing fixes
  'holdout-v2': 'resolve.holdout.v2.jsonl',
  'list-dev': 'resolve.list.dev.jsonl',
} as const;
type EvalSet = keyof typeof FILES;
const sets = (which === 'all' ? ['dev', 'holdout-v2', 'list-dev'] : which.split(',')) as EvalSet[];
for (const s of sets) {
  if (!(s in FILES)) throw new Error(`EVAL_SET: unknown set "${s}"`);
}

// EVAL_MODEL=primary|fallback picks the model under test (GEMINI_MODEL, or the fallback model).
// The automatic failover is off, so a run measures one model.
const modelUnderTest = env['EVAL_MODEL'] ?? 'primary';
if (modelUnderTest !== 'primary' && modelUnderTest !== 'fallback')
  throw new Error(`EVAL_MODEL: "${modelUnderTest}"`);
const config = loadConfig({
  ...resolveEvalEnv(env, modelUnderTest),
  WORKERS_ENABLED: 'false',
});
if (config.llmProvider !== 'gemini' || !config.geminiApiKey) {
  // A gate against the fake model would pass or fail for no reason that matters. Never skip quietly.
  const message =
    'The evals need LLM_PROVIDER=gemini and GEMINI_API_KEY. Without them the run would measure the fake model.';
  if (gate) {
    console.error(`::error::${message}`);
    process.exit(2);
  }
  console.warn(`warning: ${message}`);
}

// A run that cannot finish today stops at once instead of retrying 429s for the whole job (ADR-0022):
// a daily-quota 429, or three 429s in a row asking for a wait over 60 s. Exit code 3, so the job
// fails and the summary says why.
const quota = new QuotaWatch();
let testDb: TestDatabase | null = null;
let stopping = false;
const stopOnce = createQuotaStop({
  title: 'Resolve evals',
  summary: (text) => {
    if (env['GITHUB_STEP_SUMMARY']) appendFileSync(env['GITHUB_STEP_SUMMARY'], text);
  },
  // Best effort: the throwaway Postgres goes away with the job anyway (Ryuk removes it).
  cleanup: () => testDb?.stop(),
});
const stopForQuota = (reason: string) => ((stopping = true), stopOnce(reason));
const watched = (provider: Parameters<typeof watchProvider>[0]) =>
  watchProvider(provider, quota, stopForQuota);

// Preflight: one embedding and one tiny answer, before any container starts, so a spent quota fails
// in seconds. Only a quota verdict stops the run; a busy model (503) is the runner's usual business.
if (config.llmProvider === 'gemini' && config.geminiApiKey) {
  const provider = watched(providerFromConfig(config));
  const calls = [
    () => provider.embed(['preflight'], 'embed_query'),
    () =>
      provider.generateJson({
        system: 'Answer with {"ok": true}.',
        user: 'ping',
        schema: z.object({ ok: z.boolean() }),
        maxOutputTokens: 500,
        purpose: 'resolve_query',
      }),
  ];
  for (const call of calls) {
    try {
      await call();
    } catch (error) {
      console.warn(`preflight call failed (${(error as Error).message}); carrying on`);
    }
  }
  if (!stopping) console.log('preflight ok: the Gemini quota has room');
}

testDb = env['EVAL_DB'] === 'testcontainers' ? await startPostgres() : null;
const pool = testDb?.pool ?? createPool(config.databaseUrl, pino({ level: 'warn' }));
// Patient but bounded: every request has 30 s, and a call is retried at most 3 times (pauses of 2,
// 4, 8 s with jitter, or the wait Google asked for, at most 30 s). Counts for the progress lines.
let progress = createProgress({ label: 'resolve', total: 0 });
const ai = aiFromConfig({
  config,
  db: pool,
  logger: pino({ level: 'warn' }),
  client: { timeoutMs: 30_000, retries: 3, backoffMs: 2000, onRetry: () => progress.retried() },
  wrapProvider: watched,
});
const embedder = aiFromConfig({
  config,
  db: pool,
  logger: pino({ level: 'warn' }),
  client: { timeoutMs: 30_000, retries: 3, backoffMs: 5000, onRetry: () => progress.retried() },
  wrapProvider: watched,
});

const loadCases = (set: string): Case[] =>
  readFileSync(path.join(root, 'evals', FILES[set as EvalSet]), 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as Case)
    .filter((c) => !only || only.includes(c.kind));

let exitCode = 0;

const aiCallCount = async (): Promise<number> =>
  (await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM ai_calls`)).rows[0]?.n ?? 0;

// One more try of a whole query, after the client's own 3 (two nested layers made a bad hour last
// for tens of minutes).
const MODEL_RETRIES = 1;
const RETRY_PAUSE_MS = 8000;
const sleep = (ms: number) => new Promise<void>((res) => setTimeout(res, ms));
/** Model calls that failed or were refused by the open breaker. */
const failedCallCount = async (): Promise<number> =>
  (
    await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM ai_calls WHERE outcome IN ('timeout', 'http', 'network', 'other', 'breaker')`,
    )
  ).rows[0]?.n ?? 0;

const llmCallCount = async (): Promise<number> =>
  (
    await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM ai_calls WHERE purpose = 'resolve_query'`,
    )
  ).rows[0]?.n ?? 0;

const loadListCases = (): ListCase[] =>
  readFileSync(path.join(root, 'evals', FILES['list-dev']), 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as ListCase)
    .filter((c) => !only || only.includes(c.kind));

const callsOf = async (purpose: string): Promise<number> =>
  (
    await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM ai_calls WHERE purpose = $1`, [
      purpose,
    ])
  ).rows[0]?.n ?? 0;

/** Shopping lists (ADR-0055): every line of a list is sorted together, in one model call at most. */
async function runListSet(set: EvalSet) {
  const cases = loadListCases();
  progress = createProgress({ label: set, total: cases.length });
  await pool.query('TRUNCATE query_cache, search_queries, suggested_synonyms, new_item_attempts');
  await pool.query('TRUNCATE ai_calls');
  const rows: Row[] = [];
  const detail: {
    q: string;
    kind: string;
    expected: string;
    got: string;
    step: string | null;
    correct: boolean;
    error?: true;
  }[] = [];
  let overBudget = 0;
  for (const [index, c] of cases.entries()) {
    const userId = (
      await pool.query<{ id: string }>(
        `INSERT INTO users (phone, role) VALUES ($1, 'seeker')
         ON CONFLICT (phone) DO UPDATE SET role = users.role RETURNING id`,
        [`+9191${String(index).padStart(8, '0')}`],
      )
    ).rows[0]?.id as string;
    const llmBefore = await callsOf('resolve_query');
    const embedBefore = await callsOf('embed_query');
    const options = {
      userId,
      threshold: config.trigramThreshold,
      ai,
      requestId: `eval-${set}`,
    };
    const lines = c.lines.map((l) => l.q);
    const { value: resolved, errored } = await runWithRetries(
      () => resolveLines(pool, lines, options),
      failedCallCount,
      MODEL_RETRIES,
      sleep,
      () => progress.retried(),
      RETRY_PAUSE_MS,
    );
    // The budget is per attempt: the retry above is the runner's, not the pipeline's.
    const calls = {
      generate: (await callsOf('resolve_query')) - llmBefore,
      embed: (await callsOf('embed_query')) - embedBefore,
    };
    if (!errored && !withinListBudget(calls)) {
      overBudget++;
      console.error(
        `::error::a list of ${lines.length} lines made ${calls.generate} model calls and ${calls.embed} embedding requests (budget: 1 and 1)`,
      );
    }
    for (const [i, l] of c.lines.entries()) {
      const r = resolved[i] as Awaited<ReturnType<typeof resolveLines>>[number];
      const slug =
        r.kind === 'item'
          ? ((await pool.query(`SELECT slug FROM items WHERE id = $1`, [r.item.id])).rows[0]
              .slug as string)
          : null;
      const correct = scoreListLine(l.expected, { kind: r.kind, slug });
      rows.push({
        kind: c.kind,
        gotItem: slug !== null,
        correct,
        error: errored,
        step: null,
        usedLlm: calls.generate > 0,
      });
      detail.push({
        q: l.q,
        kind: c.kind,
        expected: l.expected,
        got: r.kind === 'item' ? (slug as string) : r.kind,
        step: null,
        correct,
        ...(errored && { error: true }),
      });
    }
    progress.done(
      !errored &&
        c.lines.every((l, i) => detail[detail.length - c.lines.length + i]?.correct === true),
    );
    if (calls.generate + calls.embed > 0 && aiPauseMs > 0)
      await new Promise((res) => setTimeout(res, aiPauseMs));
  }
  const llmRows = await pool.query<{ tokens: number; latency_ms: number }>(
    `SELECT input_tokens + output_tokens AS tokens, latency_ms FROM ai_calls
      WHERE purpose = 'resolve_query' AND outcome = 'ok'`,
  );
  const summary = summarise(
    rows,
    llmRows.rows.map((r) => ({ tokens: r.tokens, latencyMs: r.latency_ms })),
  );
  const at = new Date().toISOString();
  mkdirSync(path.join(root, 'evals/reports'), { recursive: true });
  const file = path.join(root, `evals/reports/resolve-${set}-${at.replace(/[:.]/g, '-')}.json`);
  const wrong = detail.filter((d) => !d.correct && !d.error);
  const errored = detail.filter((d) => d.error);
  writeFileSync(
    file,
    JSON.stringify(
      { set, at, provider: config.llmProvider, summary, overBudget, wrong, cases: detail },
      null,
      2,
    ),
  );
  print(set, summary, wrong, errored, path.relative(root, file));
  if (overBudget > 0) {
    console.error(`${overBudget} list(s) went over the call budget`);
    exitCode = 1;
  }
  return { set, summary };
}

async function runSet(set: EvalSet) {
  if (set === 'list-dev') return runListSet(set);
  const cases = loadCases(set);
  progress = createProgress({ label: set, total: cases.length });
  // Each set starts from nothing cached, so one set cannot make the other look better.
  await pool.query('TRUNCATE query_cache, search_queries, suggested_synonyms, new_item_attempts');
  await pool.query('TRUNCATE ai_calls');
  // Items the last set made are gone too, so one set cannot help the other (ADR-0022).
  await pool.query(`DELETE FROM items WHERE source = 'user'`);

  const rows: Row[] = [];
  const detail: {
    q: string;
    kind: string;
    expected: string | null;
    got: string | null;
    step: string | null;
    correct: boolean;
    error?: true;
  }[] = [];
  for (const [index, c] of cases.entries()) {
    // One user per case: the per-day limit of new items (ADR-0029) must not shape the score.
    const userId = (
      await pool.query<{ id: string }>(
        `INSERT INTO users (phone, role) VALUES ($1, 'seeker')
         ON CONFLICT (phone) DO UPDATE SET role = users.role RETURNING id`,
        [`+9190${String(index).padStart(8, '0')}`],
      )
    ).rows[0]?.id as string;
    const before = await aiCallCount();
    const llmBefore = await llmCallCount();
    // A model call that fails (429, 5xx, timeout) is tried again, twice, after a pause. A query
    // that still fails is an error, not a wrong answer: it is reported apart and not scored.
    const options = {
      threshold: config.trigramThreshold,
      ai,
      requestId: `eval-${set}`,
      userId,
      // The production path: a real product the catalog lacks becomes a new item (ADR-0028).
      openCatalog: {},
    };
    const { value: r, errored } = await runWithRetries(
      () => resolveItem(pool, c.q, options),
      failedCallCount,
      MODEL_RETRIES,
      sleep,
      () => progress.retried(),
      RETRY_PAUSE_MS,
    );
    const after = await aiCallCount();
    const slug = r.item
      ? ((await pool.query(`SELECT slug FROM items WHERE id = $1`, [r.item.id])).rows[0]
          .slug as string)
      : null;
    const created = Boolean(r.item?.unverified);
    const correct = scoreCase(c, { slug, ambiguous: Boolean(r.ambiguous), created });
    rows.push({
      kind: c.kind,
      gotItem: slug !== null,
      correct,
      error: errored,
      step: r.matchedBy as Step | null,
      usedLlm: (await llmCallCount()) > llmBefore,
    });
    detail.push({
      q: c.q,
      kind: c.kind,
      expected: c.expected,
      got: r.ambiguous ? 'ambiguous' : created ? `new item: ${r.item?.nameEn}` : slug,
      step: r.matchedBy,
      correct,
      ...(errored && { error: true }),
    });
    progress.done(correct && !errored);
    if (after > before && aiPauseMs > 0) await new Promise((res) => setTimeout(res, aiPauseMs));
  }

  // Latency is the provider call itself (ai_calls.latency_ms, measured around one request), never
  // the runner's pacing pauses or retry waits; failed and invalid calls are left out.
  const llmRows = await pool.query<{ tokens: number; latency_ms: number }>(
    `SELECT input_tokens + output_tokens AS tokens, latency_ms FROM ai_calls
      WHERE purpose = 'resolve_query' AND outcome = 'ok'`,
  );
  const llmCalls: LlmCall[] = llmRows.rows.map((r) => ({
    tokens: r.tokens,
    latencyMs: r.latency_ms,
  }));
  const counts = await pool.query<{ purpose: string; outcome: string; n: number }>(
    `SELECT purpose, outcome, count(*)::int AS n FROM ai_calls GROUP BY purpose, outcome ORDER BY purpose, outcome`,
  );
  const summary = summarise(rows, llmCalls);

  const report = {
    set,
    at: new Date().toISOString(),
    provider: config.llmProvider,
    model: config.llmProvider === 'gemini' ? config.geminiModel : 'fake-model',
    embedModel: ai.client.embedModel,
    thresholds: {
      embed: config.embedThreshold,
      margin: config.embedMargin,
      trigram: config.trigramThreshold,
    },
    summary,
    aiCalls: counts.rows,
    wrong: detail.filter((d) => !d.correct && !d.error),
    errored: detail.filter((d) => d.error),
    cases: detail,
  };
  mkdirSync(path.join(root, 'evals/reports'), { recursive: true });
  const file = path.join(
    root,
    `evals/reports/resolve-${set}-${report.at.replace(/[:.]/g, '-')}.json`,
  );
  writeFileSync(file, JSON.stringify(report, null, 2));
  print(set, summary, report.wrong, report.errored, path.relative(root, file));
  return { set, summary };
}

function print(
  set: string,
  s: Summary,
  wrong: { q: string; expected: unknown; got: unknown; step: unknown }[],
  errored: { q: string }[],
  file: string,
) {
  const right = Math.round(s.accuracy * s.scored);
  console.log(`\n== ${set} (${config.llmProvider}) ==`);
  console.log(
    `accuracy        ${(s.accuracy * 100).toFixed(1)}%  (${right}/${s.scored} scored of ${s.total})`,
  );
  console.log(
    `by category     ${Object.entries(s.byCategory)
      .map(([k, v]) => `${k} ${v.right}/${v.total}`)
      .join(' · ')}`,
  );
  console.log(
    `answered by     ${Object.entries(s.byStep)
      .map(([k, v]) => `${k} ${v}`)
      .join(' · ')}`,
  );
  console.log(
    `LLM fallback    ${(s.llmFallbackRate * 100).toFixed(1)}%  (${s.llm.calls} calls, ${s.llm.totalTokens} tokens, p95 ${s.llm.p95LatencyMs} ms, ${s.errors} errors)`,
  );
  // A holdout case is never named in the log: the counts above are all it shows.
  const quiet = isHoldoutSet(set);
  for (const w of quiet ? [] : wrong) {
    console.log(
      `  WRONG  ${JSON.stringify(w.q).slice(0, 70).padEnd(72)} expected ${String(w.expected)}  got ${String(w.got)}  (${String(w.step)})`,
    );
  }
  for (const e of quiet ? [] : errored)
    console.log(
      `  ERROR  ${JSON.stringify(e.q).slice(0, 70)} (model failed after retries; not scored)`,
    );
  console.log(`report: ${file}`);
}

try {
  await seedCatalog(pool, loadSeedCatalog());
  // Vectors from an earlier run (restored by the CI cache, keyed by the catalog file) are loaded
  // first, so only items whose text changed cost an embedding request.
  const vectorFile = path.resolve(root, env['EVAL_EMBED_CACHE'] ?? 'evals/.cache/embeddings.json');
  if (existsSync(vectorFile)) {
    const saved = JSON.parse(readFileSync(vectorFile, 'utf8')) as {
      slug: string;
      hash: string;
      vector: string;
    }[];
    for (const v of saved)
      await pool.query(
        `UPDATE items SET embedding = $2::vector, embedding_source_hash = $3 WHERE slug = $1`,
        [v.slug, v.vector, v.hash],
      );
    console.log(`loaded ${saved.length} saved embeddings from ${path.relative(root, vectorFile)}`);
  }

  // Embedding is resumable (batches already stored stay stored), so a free-tier limit that outlasts
  // the client's own retries just means: wait a minute and carry on.
  let embedded = 0;
  for (let attempt = 1; ; attempt++) {
    try {
      embedded += (
        await embedCatalog(pool, embedder, {
          batchSize: 20,
          pauseMs: 20_000,
          // Saved after every batch: a run that is killed has still kept what it embedded.
          onBatch: () => saveEmbeddings(pool, vectorFile),
        })
      ).embedded;
      break;
    } catch (error) {
      if (attempt >= 3) throw error;
      console.warn(`embedding paused (${(error as Error).message}); retrying in 65 s`);
      await new Promise((res) => setTimeout(res, 65_000));
    }
  }
  if (embedded > 0) console.log(`embedded ${embedded} catalog items`);
  await saveEmbeddings(pool, vectorFile);

  const results = [];
  for (const set of sets) results.push(await runSet(set));

  // Behind the switched-off failover: a call answered by any other model fails the run.
  const foreign = await pinnedModelViolations(pool, {
    resolve_query: config.geminiModel,
    classify_item: config.geminiModel,
  });
  for (const f of foreign) console.error(`::error::eval not pinned: ${f}`);
  if (foreign.length > 0) exitCode = 1;

  const markdown = renderMarkdown(results);
  mkdirSync(path.join(root, 'evals/reports'), { recursive: true });
  writeFileSync(path.join(root, 'evals/reports/summary.md'), markdown);
  if (env['GITHUB_STEP_SUMMARY'])
    appendFileSync(env['GITHUB_STEP_SUMMARY'], `### Resolve evals\n\n${markdown}`);

  const holdout = results.find((r) => r.set === GATED_SET);
  if (gate) {
    if (!holdout) {
      console.error('::error::EVAL_GATE=1 needs the holdout-v2 set (EVAL_SET=holdout-v2 or all).');
      exitCode = 2;
    } else {
      const verdict = checkGates(holdout.summary);
      if (verdict.passed) console.log('\nGATE PASSED (holdout)');
      else {
        for (const f of verdict.failures) console.error(`::error::eval gate failed: ${f}`);
        exitCode = 1;
      }
    }
  }
} finally {
  ai.close();
  embedder.close();
  await (testDb ? testDb.stop() : pool.end());
}
process.exit(exitCode);
