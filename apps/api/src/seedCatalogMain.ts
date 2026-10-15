import { pino } from 'pino';
import { createPool } from './db/pool.js';
import { loadSeedCatalog, seedCatalog } from './modules/catalog/index.js';

// Run by `npm run seed:catalog`, locally and in the deploy job after migrations.
const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) throw new Error('DATABASE_URL is not set');

const pool = createPool(databaseUrl, pino({ level: 'warn' }));
try {
  const catalog = loadSeedCatalog();
  const { items, terms } = await seedCatalog(pool, catalog);
  console.log(`catalog v${catalog.version}: ${items} items, ${terms} terms`);
} finally {
  await pool.end();
}
