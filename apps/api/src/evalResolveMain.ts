import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pino } from 'pino';
import { loadConfig } from './config/config.js';
import { createPool } from './db/pool.js';
import {
  checkGates,
  GATED_SET,
  renderMarkdown,
  scoreCase,
  summarise,
  type Case,
  type LlmCall,
  type Row,
  type Step,
  type Summary,
} from './evalScore.js';
import { aiFromConfig } from './modules/ai/index.js';
import {
  embedCatalog,
  loadSeedCatalog,
  resolveItem,
  seedCatalog,
} from './modules/catalog/index.js';
import { startPostgres, type TestDatabase } from './testing/startPostgres.js';

// Run by `npm run eval:resolve`. Sends every labelled query of the chosen set(s) through the whole
// resolution pipeline against the configured provider (LLM_PROVIDER=gemini for the real thing), then
// prints accuracy, accuracy by category, which step answered, the LLM fallback rate, tokens and p95
// latency, and writes one JSON report per set to evals/reports/.
//
//   EVAL_SET=dev|holdout-v2|holdout|all   which set(s); default all = dev + holdout-v2 (holdout is
//                              the retired v1, run only when asked for)
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
} as const;
type EvalSet = keyof typeof FILES;
const sets = (which === 'all' ? ['dev', 'holdout-v2'] : which.split(',')) as EvalSet[];
for (const s of sets) {
  if (!(s in FILES)) throw new Error(`EVAL_SET: unknown set "${s}"`);
}

const config = loadConfig({ ...env, WORKERS_ENABLED: 'false' });
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

const testDb: TestDatabase | null =
  env['EVAL_DB'] === 'testcontainers' ? await startPostgres() : null;
const pool = testDb?.pool ?? createPool(config.databaseUrl, pino({ level: 'warn' }));
// Patient on purpose: a 429 waits 2, 4, 8, 16, 32 seconds before the query is given up on.
const ai = aiFromConfig({
  config,
  db: pool,
  logger: pino({ level: 'warn' }),
  client: { timeoutMs: 30_000, retries: 5, backoffMs: 2000 },
});
const embedder = aiFromConfig({
  config,
  db: pool,
  logger: pino({ level: 'warn' }),
  client: { retries: 3, backoffMs: 20_000 },
});

const loadCases = (set: string): Case[] =>
  readFileSync(path.join(root, 'evals', FILES[set as EvalSet]), 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as Case)
    .filter((c) => !only || only.includes(c.kind));

const aiCallCount = async (): Promise<number> =>
  (await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM ai_calls`)).rows[0]?.n ?? 0;

const MODEL_RETRIES = 2;
const RETRY_PAUSE_MS = 8000;
/** Model calls that failed or were refused by the open breaker. */
const failedCallCount = async (): Promise<number> =>
  (
    await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM ai_calls WHERE outcome IN ('error', 'skipped_breaker')`,
    )
  ).rows[0]?.n ?? 0;

const llmCallCount = async (): Promise<number> =>
  (
    await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM ai_calls WHERE purpose = 'resolve_query'`,
    )
  ).rows[0]?.n ?? 0;

async function runSet(set: EvalSet) {
  const cases = loadCases(set);
  // Each set starts from nothing cached, so one set cannot make the other look better.
  await pool.query('TRUNCATE query_cache, search_queries, suggested_synonyms');
  await pool.query('TRUNCATE ai_calls');

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
  for (const c of cases) {
    const before = await aiCallCount();
    const llmBefore = await llmCallCount();
    const failedBefore = await failedCallCount();
    // A model call that fails (429, 5xx, timeout) is tried again, twice, after a pause. A query
    // that still fails is an error, not a wrong answer: it is reported apart and not scored.
    let r = await resolveItem(pool, c.q, {
      threshold: config.trigramThreshold,
      ai,
      requestId: `eval-${set}`,
    });
    let errored = false;
    for (let attempt = 1; (await failedCallCount()) > failedBefore; attempt++) {
      if (attempt > MODEL_RETRIES) {
        errored = true;
        break;
      }
      await new Promise((res) => setTimeout(res, RETRY_PAUSE_MS * attempt));
      r = await resolveItem(pool, c.q, {
        threshold: config.trigramThreshold,
        ai,
        requestId: `eval-${set}`,
      });
    }
    const after = await aiCallCount();
    const slug = r.item
      ? ((await pool.query(`SELECT slug FROM items WHERE id = $1`, [r.item.id])).rows[0]
          .slug as string)
      : null;
    const correct = scoreCase(c, { slug, ambiguous: Boolean(r.ambiguous) });
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
      got: r.ambiguous ? 'ambiguous' : slug,
      step: r.matchedBy,
      correct,
      ...(errored && { error: true }),
    });
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
  for (const w of wrong) {
    console.log(
      `  WRONG  ${JSON.stringify(w.q).slice(0, 70).padEnd(72)} expected ${String(w.expected)}  got ${String(w.got)}  (${String(w.step)})`,
    );
  }
  for (const e of errored)
    console.log(
      `  ERROR  ${JSON.stringify(e.q).slice(0, 70)} (model failed after retries; not scored)`,
    );
  console.log(`report: ${file}`);
}

let exitCode = 0;
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
      embedded += (await embedCatalog(pool, embedder, { batchSize: 20, pauseMs: 20_000 })).embedded;
      break;
    } catch (error) {
      if (attempt >= 5) throw error;
      console.warn(`embedding paused (${(error as Error).message}); retrying in 65 s`);
      await new Promise((res) => setTimeout(res, 65_000));
    }
  }
  if (embedded > 0) console.log(`embedded ${embedded} catalog items`);
  const stored = await pool.query<{ slug: string; hash: string; vector: string }>(
    `SELECT slug, embedding_source_hash AS hash, embedding::text AS vector
       FROM items WHERE embedding IS NOT NULL`,
  );
  mkdirSync(path.dirname(vectorFile), { recursive: true });
  writeFileSync(vectorFile, JSON.stringify(stored.rows));

  const results = [];
  for (const set of sets) results.push(await runSet(set));

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
