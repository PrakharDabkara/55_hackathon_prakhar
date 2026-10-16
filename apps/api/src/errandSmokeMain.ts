import { pino } from 'pino';
import { loadConfig } from './config/config.js';
import { createPool } from './db/pool.js';
import { aiFromConfig } from './modules/ai/index.js';
import { loadSeedCatalog, seedCatalog } from './modules/catalog/index.js';
import { createErrand, getErrand, limitsFromConfig, runErrand } from './modules/errands/index.js';
import { listSteps } from './modules/errands/persistence.js';

// Run by `npm run errand:smoke`: plans real errands against the local database with the configured
// model (LLM_PROVIDER=gemini for the real thing) and prints each errand's step log and tokens.
// It makes a few simulated demo shops with learned stock around the centre of Indore (idempotent),
// and a demo seeker. The task texts are the first arguments, or two built-in examples.
const config = loadConfig({ ...process.env, WORKERS_ENABLED: 'false' });
const logger = pino({ level: 'warn' });
const pool = createPool(config.databaseUrl, logger);
const ai = aiFromConfig({ config, db: pool, logger });

const CENTRE = { lat: 22.7196, lng: 75.8577 };
const DEFAULT_TASKS = [
  'school project ke liye chart paper, fevicol aur sketch pens',
  'chai banane ka saaman: chai patti, chini, doodh',
];

/** [shop name, km north, km east, items it has (slug → price as a share of the reference price)] */
const DEMO_SHOPS: [string, number, number, Record<string, number>][] = [
  ['Smoke Stationers', 0.3, 0.1, { 'chart-paper': 0.95, 'sketch-pens': 1.05 }],
  ['Smoke Book Depot', 0.9, -0.4, { 'chart-paper': 1.1 }],
  ['Smoke Hardware', 0.6, 0.7, { 'wood-glue': 0.9 }],
  ['Smoke Kirana', 0.4, -0.2, { 'tea-leaves': 1.0, sugar: 1.05, milk: 1.0 }],
  ['Smoke Mart', 1.1, 0.5, { 'tea-leaves': 0.9, sugar: 0.95 }],
  [
    'Smoke General Store',
    0.7,
    0.3,
    { sugar: 1.0, milk: 1.1, 'chart-paper': 1.0, 'wood-glue': 1.15 },
  ],
];

async function seedDemoShops() {
  const { rows: count } = await pool.query(`SELECT count(*)::int AS n FROM items`);
  if (count[0].n === 0) await seedCatalog(pool, loadSeedCatalog());
  const { rows: items } = await pool.query<{ id: string; slug: string; ref: number }>(
    `SELECT id, slug, ref_price_paise AS ref FROM items`,
  );
  for (const [name, north, east, stock] of DEMO_SHOPS) {
    let shop = (await pool.query<{ id: string }>(`SELECT id FROM shops WHERE name = $1`, [name]))
      .rows[0];
    if (!shop) {
      shop = (
        await pool.query<{ id: string }>(
          `INSERT INTO shops (name, phone, categories, location, is_simulated)
           VALUES ($1, '+910000000000', ARRAY['general_store'],
                   ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography, true) RETURNING id`,
          [name, CENTRE.lng + east / 102, CENTRE.lat + north / 111],
        )
      ).rows[0] as { id: string };
    }
    for (const [slug, share] of Object.entries(stock)) {
      const item = items.find((i) => i.slug === slug);
      if (!item) continue;
      await pool.query(
        `INSERT INTO shop_stock (shop_id, item_id, source, price_paise, last_confirmed_at, expires_at)
         VALUES ($1, $2, 'ping_yes', $3, now() - interval '3 hours', now() + interval '7 days')
         ON CONFLICT (shop_id, item_id) DO UPDATE
           SET price_paise = EXCLUDED.price_paise, last_confirmed_at = EXCLUDED.last_confirmed_at,
               expires_at = EXCLUDED.expires_at`,
        [shop.id, item.id, Math.round(item.ref * share)],
      );
    }
  }
}

async function demoSeeker(): Promise<string> {
  const phone = '+919800000999';
  const found = await pool.query<{ id: string }>(`SELECT id FROM users WHERE phone = $1`, [phone]);
  if (found.rows[0]) return found.rows[0].id;
  return (
    await pool.query<{ id: string }>(
      `INSERT INTO users (phone, role) VALUES ($1, 'seeker') RETURNING id`,
      [phone],
    )
  ).rows[0]?.id as string;
}

try {
  console.log(
    `provider: ${config.llmProvider}, model: ${config.llmProvider === 'gemini' ? config.geminiModel : 'fake'}`,
  );
  await seedDemoShops();
  const userId = await demoSeeker();
  const limits = { ...limitsFromConfig(config), userHourlyLimit: 1000 };
  const tasks = process.argv.length > 2 ? process.argv.slice(2) : DEFAULT_TASKS;

  for (const task of tasks) {
    console.log(`\n=== ${task}`);
    const { id } = await createErrand({ db: pool, logger, limits }, userId, {
      task,
      lat: CENTRE.lat,
      lng: CENTRE.lng,
      requestId: `smoke-${Date.now()}`,
    });
    const started = Date.now();
    const result = await runErrand(
      {
        db: pool,
        logger,
        ai,
        limits,
        trigramThreshold: config.trigramThreshold,
        paceMs: config.llmProvider === 'gemini' ? 4000 : 0,
        modelRetries: config.llmProvider === 'gemini' ? 3 : 1,
      },
      id,
    );
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    for (const s of await listSteps(pool, id)) {
      const what =
        s.kind === 'model'
          ? `model  calls=${JSON.stringify((s.args['calls'] as { name: string }[]).map((c) => c.name))}${s.args['text'] ? ` text=${JSON.stringify(s.args['text'])}` : ''}`
          : `tool   ${s.toolName} ${JSON.stringify(s.args)} -> ${JSON.stringify(s.resultSummary)}`;
      console.log(`${String(s.n).padStart(2)}. ${what}  [${s.tokens} tok, ${s.latencyMs} ms]`);
    }
    const view = await getErrand({ db: pool, logger }, userId, id);
    console.log(`outcome: ${result.outcome}, state: ${view?.state}, ${seconds}s`);
    console.log(
      `tokens: in ${view?.usage.tokensIn}, out ${view?.usage.tokensOut}, total ${(view?.usage.tokensIn ?? 0) + (view?.usage.tokensOut ?? 0)} over ${view?.usage.steps} steps`,
    );
    console.log('progress:');
    for (const line of view?.progress ?? []) console.log(`  - ${line}`);
    console.log('plan:', JSON.stringify(view?.plan, null, 2));
    if (view?.failureReason) console.log('failure_reason:', view.failureReason);
  }
} finally {
  ai.close();
  await pool.end();
}
