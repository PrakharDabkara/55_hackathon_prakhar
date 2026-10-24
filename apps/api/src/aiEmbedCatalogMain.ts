import { pino } from 'pino';
import { loadConfig } from './config/config.js';
import { createPool, SCRIPT_POOL_OPTIONS } from './db/pool.js';
import { aiFromConfig } from './modules/ai/index.js';
import { appendFileSync } from 'node:fs';
import { embedCatalog, embedCatalogSafely, formatEmbedSummary } from './modules/catalog/index.js';

// Run by `npm run ai:embed-catalog`, locally and in the deploy job after seeding. Embeds the
// catalog items whose text changed; a second run costs nothing.
const config = loadConfig({ ...process.env, WORKERS_ENABLED: 'false' });
if (config.llmProvider !== 'gemini') {
  console.log(
    `LLM_PROVIDER is ${config.llmProvider}: embedding with the fake provider is only useful for tests.`,
  );
}
const logger = pino({ level: 'info' });
const pool = createPool(config.databaseUrl, pino({ level: 'warn' }), SCRIPT_POOL_OPTIONS);
// Free-tier embedding limits are per minute: small batches, a pause between them, and a patient
// retry (20 s, 40 s, 80 s) if a limit is still hit.
const ai = aiFromConfig({
  config,
  db: pool,
  logger: pino({ level: 'warn' }),
  client: { retries: 3, backoffMs: 20_000 },
});
try {
  const options = { logger, batchSize: 20, pauseMs: 15_000 };
  if (process.env['EMBED_NON_BLOCKING'] === '1') {
    // The deploy: a failure is reported in the job summary and the exit code stays 0 (ADR-0021).
    const result = await embedCatalogSafely(pool, ai, options);
    console.log(formatEmbedSummary(result));
    if (!result.ok)
      console.log(
        `::warning::${result.pending} catalog items are still un-embedded (${result.reason}); the deploy continues`,
      );
    const summaryFile = process.env['GITHUB_STEP_SUMMARY'];
    if (summaryFile) appendFileSync(summaryFile, formatEmbedSummary(result));
  } else {
    const { embedded, skipped } = await embedCatalog(pool, ai, options);
    console.log(
      `embedded ${embedded} items, ${skipped} already up to date (model ${ai.client.embedModel})`,
    );
  }
} finally {
  ai.close();
  await pool.end();
}
