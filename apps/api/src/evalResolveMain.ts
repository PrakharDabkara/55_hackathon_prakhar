import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pino } from 'pino';
import { loadConfig } from './config/config.js';
import { createPool } from './db/pool.js';
import { aiFromConfig } from './modules/ai/index.js';
import { resolveItem } from './modules/catalog/index.js';
import { scoreCase, summarise, type Case, type LlmCall, type Row, type Step } from './evalScore.js';

// Run by `npm run eval:resolve`. Sends every labelled query through the whole resolution pipeline
// against the configured provider (LLM_PROVIDER=gemini for the real thing), then prints accuracy,
// which step answered, the LLM fallback rate, tokens and p95 latency, and writes a JSON report.
// It uses the DATABASE_URL database: run it against a local one (it clears the query cache first).
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const config = loadConfig({ ...process.env, WORKERS_ENABLED: 'false' });
const pool = createPool(config.databaseUrl, pino({ level: 'warn' }));
const ai = aiFromConfig({ config, db: pool, logger: pino({ level: 'warn' }) });
const pauseMs = Number(process.env['EVAL_PAUSE_MS'] ?? 0);

// EVAL_KINDS=variant,ambiguous runs only those kinds (handy while tuning the prompt).
const only = process.env['EVAL_KINDS']?.split(',');
const cases: Case[] = readFileSync(path.join(root, 'evals/resolve.jsonl'), 'utf8')
  .split('\n')
  .filter((line) => line.trim() !== '')
  .map((line) => JSON.parse(line) as Case)
  .filter((c) => !only || only.includes(c.kind));

try {
  await pool.query('TRUNCATE query_cache');
  await pool.query('TRUNCATE ai_calls');

  const rows: Row[] = [];
  const detail: unknown[] = [];
  for (const c of cases) {
    const before = (
      await pool.query(`SELECT count(*)::int AS n FROM ai_calls WHERE purpose = 'resolve_query'`)
    ).rows[0].n as number;
    const r = await resolveItem(pool, c.q, {
      threshold: config.trigramThreshold,
      ai,
      requestId: 'eval',
    });
    const after = (
      await pool.query(`SELECT count(*)::int AS n FROM ai_calls WHERE purpose = 'resolve_query'`)
    ).rows[0].n as number;
    const slug = r.item
      ? ((await pool.query(`SELECT slug FROM items WHERE id = $1`, [r.item.id])).rows[0]
          .slug as string)
      : null;
    const correct = scoreCase(c, { slug, ambiguous: Boolean(r.ambiguous) });
    rows.push({ correct, step: r.matchedBy as Step | null, usedLlm: after > before });
    detail.push({
      q: c.q,
      kind: c.kind,
      expected: c.expected,
      got: r.ambiguous ? 'ambiguous' : slug,
      step: r.matchedBy,
      correct,
    });
    if (pauseMs > 0) await new Promise((resolve) => setTimeout(resolve, pauseMs));
  }

  const llmRows = await pool.query<{ tokens: number; latency_ms: number }>(
    `SELECT input_tokens + output_tokens AS tokens, latency_ms FROM ai_calls
      WHERE purpose = 'resolve_query' AND outcome IN ('ok', 'invalid_output')`,
  );
  const llmCalls: LlmCall[] = llmRows.rows.map((r) => ({
    tokens: r.tokens,
    latencyMs: r.latency_ms,
  }));
  const counts = await pool.query<{ purpose: string; outcome: string; n: number }>(
    `SELECT purpose, outcome, count(*)::int AS n FROM ai_calls GROUP BY purpose, outcome ORDER BY purpose, outcome`,
  );

  const summary = summarise(rows, llmCalls);
  const byKind: Record<string, { right: number; total: number }> = {};
  rows.forEach((row, i) => {
    const kind = (cases[i] as Case).kind;
    byKind[kind] ??= { right: 0, total: 0 };
    byKind[kind].total++;
    if (row.correct) byKind[kind].right++;
  });

  const report = {
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
    byKind,
    aiCalls: counts.rows,
    wrong: detail.filter((d) => !(d as { correct: boolean }).correct),
  };
  mkdirSync(path.join(root, 'evals/reports'), { recursive: true });
  const file = path.join(root, `evals/reports/resolve-${report.at.replace(/[:.]/g, '-')}.json`);
  writeFileSync(file, JSON.stringify({ ...report, cases: detail }, null, 2));

  console.log(`\nprovider ${report.provider} (${report.model}), embeddings ${report.embedModel}`);
  console.log(
    `accuracy        ${(summary.accuracy * 100).toFixed(1)}%  (${rows.filter((r) => r.correct).length}/${summary.total})`,
  );
  console.log(
    `answered by     ${Object.entries(summary.byStep)
      .map(([k, v]) => `${k} ${v}`)
      .join(' · ')}`,
  );
  console.log(
    `LLM fallback    ${(summary.llmFallbackRate * 100).toFixed(1)}%  (${summary.llm.calls} calls, ${summary.llm.totalTokens} tokens, p95 ${summary.llm.p95LatencyMs} ms)`,
  );
  console.log(
    `by kind         ${Object.entries(byKind)
      .map(([k, v]) => `${k} ${v.right}/${v.total}`)
      .join(' · ')}`,
  );
  console.log(
    `ai calls        ${counts.rows.map((r) => `${r.purpose}/${r.outcome} ${r.n}`).join(' · ')}`,
  );
  for (const w of report.wrong as { q: string; expected: unknown; got: unknown; step: unknown }[]) {
    console.log(
      `  WRONG  ${JSON.stringify(w.q).slice(0, 70).padEnd(72)} expected ${String(w.expected)}  got ${String(w.got)}  (${String(w.step)})`,
    );
  }
  console.log(`\nreport: ${path.relative(root, file)}`);
} finally {
  ai.close();
  await pool.end();
}
