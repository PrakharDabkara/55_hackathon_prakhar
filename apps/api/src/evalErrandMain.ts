import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pino } from 'pino';
import { z } from 'zod';
import { loadConfig } from './config/config.js';
import { createProgress, isHoldoutSet } from './evalProgress.js';
import { createQuotaStop } from './evalQuota.js';
import { loadErrandCases } from './evalErrand/cases.js';
import { errandEvalEnv } from './evalErrand/model.js';
import { pinnedModelViolations } from './evalModel.js';
import { pacedProvider } from './evalErrand/pace.js';
import { prepareCatalog } from './evalErrand/prepare.js';
import { runErrandEval } from './evalErrand/run.js';
import {
  checkErrandGates,
  ERRAND_GATES,
  estimateCalls,
  renderErrandMarkdown,
  summariseErrand,
} from './evalErrand/score.js';
import { aiFromConfig, providerFromConfig, QuotaWatch, watchProvider } from './modules/ai/index.js';
import { loadSeedCatalog } from './modules/catalog/index.js';
import { limitsFromConfig } from './modules/errands/index.js';
import { startPostgres, type TestDatabase } from './testing/startPostgres.js';

// Run by `npm run eval:errand` (ADR-0027). Plays every case of the chosen set as a real errand, in
// process, against the real model (LLM_PROVIDER=gemini), a throwaway Postgres with the seeded
// catalog and synthetic shops, and a deterministic shop responder. All metrics are computed in code.
//
//   EVAL_SET=dev|holdout      which case file (evals/errand.<set>.jsonl); default dev
//   EVAL_MODEL=primary|fallback  the errand agent's model: GEMINI_MODEL, or the fallback model
//                             (GEMINI_FALLBACK_MODEL, default gemini-3.5-flash-lite); sets GEMINI_ERRAND_MODEL
//   EVAL_CASES=d01,d02        only these case ids (to split a run under the call budget)
//   EVAL_GATE=1               apply the gates (holdout only) and exit 1 if one fails
//   EVAL_PACE_MS=4000         least time between two provider calls
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const env = process.env;
const set = env['EVAL_SET'] ?? 'dev';
if (set !== 'dev' && set !== 'holdout') throw new Error(`EVAL_SET: unknown set "${set}"`);
const which = env['EVAL_MODEL'] ?? 'primary';
if (which !== 'primary' && which !== 'fallback') throw new Error(`EVAL_MODEL: "${which}"`);
const gate = env['EVAL_GATE'] === '1';
const paceMs = Number(env['EVAL_PACE_MS'] ?? 4000);
// 300, not 250: the dev set now has 26 cases (d24 to d26 added in SEC3) and one run estimates 274 calls.
const MAX_CALLS = 300;

// "primary" and "fallback" name the model the errand agent runs on (GEMINI_ERRAND_MODEL); query
// resolution keeps GEMINI_MODEL, as in production. No automatic fallback: a run measures one model.
const config = loadConfig({ ...errandEvalEnv(env, which), WORKERS_ENABLED: 'false' });
if (config.llmProvider !== 'gemini' || !config.geminiApiKey) {
  console.error(
    '::error::The agent evals need LLM_PROVIDER=gemini and GEMINI_API_KEY. Without them the run would measure the fake model.',
  );
  process.exit(2);
}

const only = env['EVAL_CASES']?.split(',');
const cases = loadErrandCases(path.join(root, 'evals', `errand.${set}.jsonl`)).filter(
  (c) => !only || only.includes(c.id),
);

// Before anything is called: how many calls this run can cost (an upper bound; saved embeddings and
// shorter conversations make it fewer). Over the budget, the run refuses and says how to split it.
const catalogBatches = Math.ceil(loadSeedCatalog().items.length / 20);
const estimate = estimateCalls(cases, catalogBatches);
console.log(
  `agent evals: set ${set}, model ${config.errandModel} (${which}), ${cases.length} cases, ` +
    `estimated up to ${estimate} LLM calls (${cases.length} errands × 10 + ${catalogBatches} embedding batches if none are cached), ` +
    `${paceMs} ms between calls`,
);
if (estimate > MAX_CALLS) {
  console.error(
    `::error::${estimate} calls is over the ${MAX_CALLS} budget for one run. Split it with EVAL_CASES=<ids>.`,
  );
  process.exit(2);
}

const quota = new QuotaWatch();
let testDb: TestDatabase | null = null;
const stopForQuota = createQuotaStop({
  title: 'Agent evals',
  summary: (text) => {
    if (env['GITHUB_STEP_SUMMARY']) appendFileSync(env['GITHUB_STEP_SUMMARY'], text);
  },
  cleanup: () => testDb?.stop(),
});
let stopping = false;
// Quota is watched on the raw calls; the pacing gap goes outside, so a waiting call is not a failure.
const wrap = (p: Parameters<typeof watchProvider>[0]) =>
  pacedProvider(
    watchProvider(p, quota, (reason) => ((stopping = true), stopForQuota(reason))),
    paceMs,
  );

// Preflight: one embedding and one tiny answer, so a spent quota fails in seconds.
{
  const provider = wrap(providerFromConfig(config));
  for (const call of [
    () => provider.embed(['preflight'], 'embed_query'),
    () =>
      provider.generateJson({
        system: 'Answer with {"ok": true}.',
        user: 'ping',
        schema: z.object({ ok: z.boolean() }),
        maxOutputTokens: 500,
        purpose: 'resolve_query',
      }),
  ]) {
    try {
      await call();
    } catch (error) {
      console.warn(`preflight call failed (${(error as Error).message}); carrying on`);
    }
  }
  if (!stopping) console.log('preflight ok: the Gemini quota has room');
}

const logger = pino({ level: 'warn' });
testDb = await startPostgres();
const pool = testDb.pool;
// Patient but bounded: every request has 30 s, and a call is retried at most 3 times (pauses of 4,
// 8, 16 s with jitter, or the wait Google asked for, at most 30 s).
const progress = createProgress({ label: set, total: cases.length });
const ai = aiFromConfig({
  config,
  db: pool,
  logger,
  client: { timeoutMs: 30_000, retries: 3, backoffMs: 4000, onRetry: () => progress.retried() },
  wrapProvider: wrap,
});
const embedder = aiFromConfig({
  config,
  db: pool,
  logger,
  client: { timeoutMs: 30_000, retries: 3, backoffMs: 5000, onRetry: () => progress.retried() },
  wrapProvider: wrap,
});

let exitCode = 0;
try {
  await prepareCatalog(
    pool,
    embedder,
    path.resolve(root, env['EVAL_EMBED_CACHE'] ?? 'evals/.cache/embeddings.json'),
    (line) => console.log(line),
  );
  // Waits are shortened here, through the limits the loop already takes: production keeps its own.
  const limits = {
    ...limitsFromConfig(config),
    userHourlyLimit: 10_000,
    resumeAfterMs: 6000,
    maxWaitMs: 20_000,
    answerTimeoutMs: 120_000,
    expiryMs: 900_000,
    resumeDebounceMs: 0,
  };
  const run = await runErrandEval({
    pool,
    ai,
    cases,
    limits,
    logger,
    trigramThreshold: config.trigramThreshold,
    modelRetries: 3,
    // The holdout is never named: its cases are only counted. The dev set prints one line each.
    onCase: (r) => {
      if (!isHoldoutSet(set))
        console.log(
          `${r.errored ? 'ERROR' : r.success && r.tool && !r.hallucination ? 'ok   ' : 'FAIL '} ${r.id.padEnd(4)} ${r.kind.padEnd(16)} ${r.state.padEnd(12)} ${(r.durationMs / 1000).toFixed(0).padStart(3)}s ${r.tokens} tok ${r.calls} calls ${r.errored ? `error:${r.errored}` : r.failed.join(',')}`,
        );
      progress.done(!r.errored && r.success && r.tool && !r.hallucination);
    },
  });
  const summary = summariseErrand(run.results);
  const report = {
    set,
    at: new Date().toISOString(),
    model: config.errandModel,
    which,
    paceMs,
    summary,
    modelLatency: run.modelLatency,
    gates: ERRAND_GATES,
    results: run.results,
  };
  mkdirSync(path.join(root, 'evals/reports'), { recursive: true });
  const stamp = report.at.replace(/[:.]/g, '-');
  const file = `evals/reports/errand-${set}-${which}-${stamp}.json`;
  writeFileSync(path.join(root, file), JSON.stringify(report, null, 2));
  const markdown = renderErrandMarkdown(
    [{ model: config.errandModel, set, summary, results: run.results }],
    { aggregateOnly: isHoldoutSet(set) },
  );
  const extra = `\nModel call latency (provider only): ${run.modelLatency.calls} calls, p50 ${(run.modelLatency.p50Ms / 1000).toFixed(1)} s, p95 ${(run.modelLatency.p95Ms / 1000).toFixed(1)} s.\n`;
  writeFileSync(
    path.join(root, `evals/reports/errand-${set}-${which}-summary.md`),
    markdown + extra,
  );
  console.log(`\n${markdown}${extra}report: ${file}`);
  if (env['GITHUB_STEP_SUMMARY'])
    appendFileSync(
      env['GITHUB_STEP_SUMMARY'],
      `### Agent evals (${set}, ${which})\n\n${markdown}${extra}`,
    );

  // Behind the switched-off failover: a call answered by any other model fails the run.
  const foreign = await pinnedModelViolations(pool, {
    errand: config.errandModel,
    resolve_query: config.geminiModel,
    classify_item: config.geminiModel,
  });
  for (const f of foreign) console.error(`::error::eval not pinned: ${f}`);
  if (foreign.length > 0) exitCode = 1;

  const verdict = checkErrandGates(summary);
  if (set === 'holdout') {
    if (verdict.passed) console.log('GATE PASSED (agent holdout)');
    else for (const f of verdict.failures) console.error(`::error::agent gate failed: ${f}`);
    if (gate && !verdict.passed) exitCode = 1;
  } else {
    console.log(
      `dev set: ${verdict.passed ? 'would pass' : `would not pass (${verdict.failures.join('; ')})`} the holdout gates (not enforced on dev)`,
    );
  }
} finally {
  ai.close();
  embedder.close();
  await testDb.stop();
}
process.exit(exitCode);
