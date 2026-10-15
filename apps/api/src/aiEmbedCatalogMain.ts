import { pino } from 'pino';
import { loadConfig } from './config/config.js';
import { createPool } from './db/pool.js';
import { aiFromConfig } from './modules/ai/index.js';
import { embedCatalog } from './modules/catalog/index.js';

// Run by `npm run ai:embed-catalog`, locally and in the deploy job after seeding. Embeds the
// catalog items whose text changed; a second run costs nothing.
const config = loadConfig({ ...process.env, WORKERS_ENABLED: 'false' });
if (config.llmProvider !== 'gemini') {
  console.log(
    `LLM_PROVIDER is ${config.llmProvider}: embedding with the fake provider is only useful for tests.`,
  );
}
const logger = pino({ level: 'info' });
const pool = createPool(config.databaseUrl, pino({ level: 'warn' }));
const ai = aiFromConfig({ config, db: pool, logger: pino({ level: 'warn' }) });
try {
  const { embedded, skipped } = await embedCatalog(pool, ai, { logger });
  console.log(
    `embedded ${embedded} items, ${skipped} already up to date (model ${ai.client.embedModel})`,
  );
} finally {
  ai.close();
  await pool.end();
}
