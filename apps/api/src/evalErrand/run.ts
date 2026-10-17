import type { Logger } from 'pino';
import type { Pool } from 'pg';
import { ApiError } from '../http/errors.js';
import type { AiContext } from '../modules/ai/index.js';
import { createErrand, runErrand, type ErrandLimits } from '../modules/errands/index.js';
import { findErrand, listSteps } from '../modules/errands/persistence.js';
import { buildSystemPrompt } from '../modules/errands/prompt.js';
import { answerErrand, getErrand } from '../modules/errands/service.js';
import { answerPing } from '../modules/requests/index.js';
import { DEMO_LOCATION, type Answer, type ErrandCase } from './cases.js';
import { scoreRun, type CaseResult, type Observed, type ObservedItem } from './score.js';

/** The shops of the eval world: name, km north and km east of the demo location. */
export const SYNTHETIC_SHOPS: { name: string; north: number; east: number }[] = [
  { name: 'Eval Sharma Kirana', north: 0.2, east: 0.1 },
  { name: 'Eval Gupta Store', north: 0.5, east: -0.3 },
  { name: 'Eval Mishra General', north: 0.7, east: 0.4 },
  { name: 'Eval Joshi Mart', north: -0.4, east: 0.2 },
  { name: 'Eval Verma Stationers', north: 0.9, east: -0.6 },
  { name: 'Eval Patel Hardware', north: -0.6, east: -0.5 },
  { name: 'Eval Jain Provision', north: 1.2, east: 0.8 },
  { name: 'Eval Khan Bazaar', north: -1.0, east: 0.6 },
];
const EVAL_PHONE = '+919800000777';
/** How many of the nearest shops one request pings (the app's own default is 10). */
const PINGED_SHOPS = 6;
/** Share (percent) of (shop, item) pairs a shop carries when it is asked, and in learned stock. */
const CARRY_PERCENT = 55;
const STOCK_PERCENT = { none: 0, sparse: 12, rich: 70 } as const;

/** A deterministic price: 85 % to 120 % of the catalog's reference price, in whole rupees. */
const PRICE_SQL = `GREATEST(100, (round(coalesce(i.ref_price_paise, 5000) *
  (0.85 + (abs(hashtext(i.id::text || s.id::text || 'p')) % 36)::numeric / 100) / 100) * 100))::int`;
const CARRIES_SQL = `(abs(hashtext(s.id::text || i.id::text)) % 100) < ${CARRY_PERCENT}`;

export interface EvalOptions {
  pool: Pool;
  ai: AiContext;
  cases: ErrandCase[];
  /** Shortened waits and patience live here; production config is not touched. */
  limits: ErrandLimits;
  logger: Logger;
  trigramThreshold?: number;
  /** Extra attempts after a 429 or 5xx from the model, passed to the errand loop. */
  modelRetries?: number;
  /** Least time between two model calls (the provider wrapper may pace as well). */
  paceMs?: number;
  /** The most a single errand may take before it counts as a timeout. */
  caseTimeoutMs?: number;
  onCase?: (result: CaseResult) => void;
}

export interface EvalRun {
  results: CaseResult[];
  systemPrompt: string;
  /** Provider latency of the errand's own model calls (not the pacing or the shop waits). */
  modelLatency: { calls: number; p50Ms: number; p95Ms: number };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The synthetic shops, each with an owner account, so their pings are answered the real way. */
export async function seedEvalWorld(pool: Pool): Promise<string> {
  const seeker = await pool.query<{ id: string }>(`SELECT id FROM users WHERE phone = $1`, [
    EVAL_PHONE,
  ]);
  const userId =
    seeker.rows[0]?.id ??
    (
      await pool.query<{ id: string }>(
        `INSERT INTO users (phone, role) VALUES ($1, 'seeker') RETURNING id`,
        [EVAL_PHONE],
      )
    ).rows[0]?.id;
  for (const [i, shop] of SYNTHETIC_SHOPS.entries()) {
    const found = await pool.query(`SELECT 1 FROM shops WHERE name = $1`, [shop.name]);
    if (found.rowCount) continue;
    const phone = `+91900000010${i}`;
    const owner = (
      await pool.query<{ id: string }>(
        `INSERT INTO users (phone, role) VALUES ($1, 'shop') RETURNING id`,
        [phone],
      )
    ).rows[0]?.id as string;
    await pool.query(
      `INSERT INTO shops (name, phone, categories, location, owner_user_id, is_simulated)
       VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint($4, $5), 4326)::geography, $6, true)`,
      [
        shop.name,
        phone,
        ['general_store'],
        DEMO_LOCATION.lng + shop.east / 102,
        DEMO_LOCATION.lat + shop.north / 111,
        owner,
      ],
    );
  }
  return userId as string;
}

/** A clean slate for one case: no earlier errands or requests, and the case's learned stock. */
async function resetWorld(pool: Pool, stock: ErrandCase['stock']): Promise<void> {
  await pool.query('TRUNCATE errands, requests CASCADE');
  await pool.query(`DELETE FROM shop_stock`);
  const percent = STOCK_PERCENT[stock];
  if (percent === 0) return;
  await pool.query(
    `INSERT INTO shop_stock (shop_id, item_id, source, price_paise, last_confirmed_at, expires_at)
     SELECT s.id, i.id, 'ping_yes', ${PRICE_SQL}, now() - interval '5 hours', now() + interval '7 days'
       FROM shops s CROSS JOIN items i
      WHERE s.name LIKE 'Eval %' AND (abs(hashtext(s.id::text || i.id::text || 'stock')) % 100) < $1`,
    [percent],
  );
}

/**
 * Plays the shops of one case. For every request the errand opened it makes the pings the fan-out
 * would (the nearest few shops) and answers them by the case's scenario, through the real answer
 * path: all answer, none answers, every other one answers, or all answer after the patience ran out.
 */
function createResponder(
  pool: Pool,
  logger: Logger,
  c: ErrandCase,
  where: { lat: number; lng: number },
  slowMs: number,
) {
  const handled = new Set<string>();
  const timers = new Set<NodeJS.Timeout>();

  async function answer(pingId: string, ownerId: string, carries: boolean, price: number) {
    await answerPing(
      { db: pool, logger },
      ownerId,
      pingId,
      carries ? { answer: 'yes', pricePaise: price } : { answer: 'no' },
    );
  }

  return {
    async step(errandId: string): Promise<void> {
      const links = await pool.query<{ request_id: string; item_id: string }>(
        `SELECT request_id, item_id FROM errand_requests WHERE errand_id = $1`,
        [errandId],
      );
      for (const link of links.rows) {
        const key = `${link.request_id}:${link.item_id}`;
        if (handled.has(key)) continue;
        handled.add(key);
        const shops = await pool.query<{
          id: string;
          owner: string;
          carries: boolean;
          price: number;
        }>(
          `SELECT s.id, s.owner_user_id AS owner, (${CARRIES_SQL}) AS carries, ${PRICE_SQL} AS price
             FROM shops s, items i
            WHERE i.id = $1 AND s.name LIKE 'Eval %'
            ORDER BY ST_Distance(s.location, ST_SetSRID(ST_MakePoint($3, $2), 4326)::geography)
            LIMIT ${PINGED_SHOPS}`,
          [link.item_id, where.lat, where.lng],
        );
        for (const [index, shop] of shops.rows.entries()) {
          const ping = await pool.query<{ id: string }>(
            `INSERT INTO pings (request_id, shop_id, item_id, state, sent_at)
             VALUES ($1, $2, $3, 'SENT', now()) RETURNING id`,
            [link.request_id, shop.id, link.item_id],
          );
          const pingId = ping.rows[0]?.id as string;
          if (c.shops === 'none') continue;
          if (c.shops === 'partial' && index % 2 === 1) continue;
          if (c.shops === 'slow') {
            const timer = setTimeout(() => {
              timers.delete(timer);
              void answer(pingId, shop.owner, shop.carries, shop.price).catch(() => undefined);
            }, slowMs);
            timers.add(timer);
            continue;
          }
          await answer(pingId, shop.owner, shop.carries, shop.price);
        }
      }
    },
    stop(): void {
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
    },
  };
}

/** What the scripted customer sends for one question. */
function answerFor(
  question: { options?: string[]; multiSelect?: boolean; preselected?: number[] },
  scripted: Answer | undefined,
) {
  const options = question.options ?? [];
  if (question.multiSelect && options.length > 0) {
    let picked: number[] = Array.isArray(scripted?.selected)
      ? scripted.selected
      : scripted?.selected === 'preselected' || scripted === undefined
        ? (question.preselected ?? [])
        : [];
    for (const word of scripted?.untick ?? [])
      picked = picked.filter((i) => !(options[i] ?? '').toLowerCase().includes(word.toLowerCase()));
    const extra = scripted?.add ?? scripted?.text;
    if (picked.length === 0 && !extra) picked = [0];
    return { selected: picked, ...(extra && { text: extra }) };
  }
  if (options.length > 0 && scripted?.text === undefined && scripted?.add === undefined)
    return { optionIndex: Math.min(scripted?.pick ?? 0, options.length - 1) };
  return { text: scripted?.text ?? scripted?.add ?? 'jo bhi theek ho' };
}

const percentile = (values: number[], p: number): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)] as number;
};

/**
 * Runs every case as a real errand in process (ADR-0027): the real loop, the real database, the
 * model behind `ai`, a deterministic responder instead of the simulator. Every metric is read back
 * from the database and scored in code.
 */
export async function runErrandEval(opts: EvalOptions): Promise<EvalRun> {
  const { pool, ai, limits, logger } = opts;
  const userId = await seedEvalWorld(pool);
  const systemPrompt = buildSystemPrompt({ maxItems: limits.maxItems });
  const results: CaseResult[] = [];
  const slugOf = new Map(
    (await pool.query<{ id: string; slug: string }>('SELECT id, slug FROM items')).rows.map((r) => [
      r.id,
      r.slug,
    ]),
  );

  for (const c of opts.cases) {
    const started = Date.now();
    const requestId = `eval-${c.id}`;
    const where = c.location ?? DEMO_LOCATION;
    await resetWorld(pool, c.stock);
    const responder = createResponder(pool, logger, c, where, limits.resumeAfterMs + 1500);
    let state = 'ERROR';
    let failureReason: string | null = null;
    let errandId: string | null = null;
    try {
      try {
        errandId = (
          await createErrand({ db: pool, logger, limits }, userId, {
            task: c.task,
            lat: where.lat,
            lng: where.lng,
            requestId,
          })
        ).id;
      } catch (error) {
        if (error instanceof ApiError && error.code === 'task_rejected') state = 'REJECTED';
        else throw error;
      }
      if (errandId) {
        const deadline = started + (opts.caseTimeoutMs ?? 6 * 60_000);
        let answered = 0;
        state = 'TIMEOUT';
        while (Date.now() < deadline) {
          const errand = await findErrand(pool, errandId);
          if (!errand) throw new Error('the errand vanished');
          if (['PLAN_READY', 'FAILED', 'EXPIRED', 'CANCELLED'].includes(errand.state)) {
            state = errand.state;
            failureReason = errand.failureReason;
            break;
          }
          if (errand.state === 'NEEDS_INPUT' && errand.question) {
            await answerErrand(
              { db: pool, logger, limits },
              userId,
              errandId,
              answerFor(errand.question, c.answers?.[answered++]),
            );
            continue;
          }
          if (errand.state === 'WAITING_FOR_SHOPS') await responder.step(errandId);
          const ran = await runErrand(
            {
              db: pool,
              logger,
              ai,
              limits,
              trigramThreshold: opts.trigramThreshold ?? 0.4,
              paceMs: opts.paceMs ?? 0,
              modelRetries: opts.modelRetries ?? 2,
            },
            errandId,
          );
          if (ran.outcome === 'skipped' || ran.outcome === 'busy') await sleep(300);
        }
      }
    } catch (error) {
      state = 'ERROR';
      failureReason = (error as Error).message.slice(0, 120);
      logger.warn({ caseId: c.id, err: error }, 'eval case failed in the harness');
    } finally {
      responder.stop();
    }

    const observed = await observe(pool, {
      caseId: c.id,
      errandId,
      userId,
      state,
      failureReason,
      startedAt: started,
      requestId,
      slugOf,
    });
    const result = scoreRun(c, observed, limits, systemPrompt);
    results.push(result);
    opts.onCase?.(result);
  }

  const latency = await pool.query<{ latency_ms: number }>(
    `SELECT latency_ms FROM ai_calls WHERE purpose = 'errand' AND outcome = 'ok'`,
  );
  const ms = latency.rows.map((r) => r.latency_ms);
  return {
    results,
    systemPrompt,
    modelLatency: { calls: ms.length, p50Ms: percentile(ms, 0.5), p95Ms: percentile(ms, 0.95) },
  };
}

async function observe(
  pool: Pool,
  o: {
    caseId: string;
    errandId: string | null;
    userId: string;
    state: string;
    failureReason: string | null;
    startedAt: number;
    requestId: string;
    slugOf: Map<string, string>;
  },
): Promise<Observed> {
  const usage = await pool.query<{ calls: number; chat: number; tokens: number }>(
    `SELECT count(*)::int AS calls,
            (count(*) FILTER (WHERE purpose = 'errand'))::int AS chat,
            coalesce(sum(input_tokens + output_tokens), 0)::int AS tokens
       FROM ai_calls WHERE request_id = $1`,
    [o.requestId],
  );
  const base = {
    durationMs: Date.now() - o.startedAt,
    tokens: usage.rows[0]?.tokens ?? 0,
    calls: usage.rows[0]?.calls ?? 0,
    chatCalls: usage.rows[0]?.chat ?? 0,
  };
  if (!o.errandId) {
    return {
      state: o.state,
      failureReason: o.failureReason,
      items: [],
      toolSteps: [],
      askShopsCount: 0,
      questionsAsked: 0,
      modelSteps: 0,
      visibleText: '',
      ...base,
    };
  }
  const errandId = o.errandId;
  const steps = await listSteps(pool, errandId);
  const errand = await findErrand(pool, errandId);
  const view = await getErrand({ db: pool, logger: SILENT }, o.userId, errandId);
  const plan = (view?.plan ?? null) as { items?: PlanItemRow[] } | null;

  const links = await pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM errand_requests WHERE errand_id = $1`,
    [errandId],
  );
  const items: ObservedItem[] = [];
  for (const item of plan?.items ?? []) {
    items.push(await judgeItem(pool, errandId, item, o.slugOf));
  }
  // Everything the customer's screen can show, except what they typed themselves.
  const questions = steps
    .filter((s) => s.toolName === 'ask_user')
    .map((s) => String(s.args['question'] ?? ''));
  const visible: Record<string, unknown> = { ...view };
  delete visible['task'];
  const visibleText = JSON.stringify({ ...visible, questions });

  return {
    state: o.state,
    failureReason: o.failureReason,
    items,
    toolSteps: steps
      .filter((s) => s.kind === 'tool')
      .map((s) => ({ toolName: s.toolName ?? '', args: s.args })),
    askShopsCount: links.rows[0]?.n ?? 0,
    questionsAsked: errand?.questionsAsked ?? 0,
    modelSteps: steps.filter((s) => s.kind === 'model').length,
    visibleText,
    ...base,
  };
}

interface PlanItemRow {
  text: string;
  itemId: string | null;
  status: string;
  shopId: string | null;
  pricePaise: number | null;
}

const SILENT = {
  info() {},
  warn() {},
  error() {},
  debug() {},
  child: () => SILENT,
} as unknown as Logger;

/** Is this plan item, its shop and its price from the database? Null ids and prices have nothing to check. */
async function judgeItem(
  pool: Pool,
  errandId: string,
  item: PlanItemRow,
  slugOf: Map<string, string>,
): Promise<ObservedItem> {
  const itemInDb = item.itemId === null || slugOf.has(item.itemId);
  let shopInDb = true;
  if (item.shopId !== null) {
    shopInDb =
      ((await pool.query(`SELECT 1 FROM shops WHERE id = $1`, [item.shopId])).rowCount ?? 0) > 0;
  }
  let priceFromDb = true;
  if (item.pricePaise !== null) {
    if (item.status === 'not_found' || item.shopId === null || item.itemId === null) {
      priceFromDb = false;
    } else {
      const known = await pool.query(
        `SELECT 1 FROM shop_stock WHERE shop_id = $1 AND item_id = $2 AND price_paise = $3
         UNION ALL
         SELECT 1 FROM pings p JOIN errand_requests er ON er.request_id = p.request_id
          WHERE er.errand_id = $4 AND p.shop_id = $1 AND p.item_id = $2
            AND p.state = 'YES' AND p.price_paise = $3`,
        [item.shopId, item.itemId, item.pricePaise, errandId],
      );
      priceFromDb = (known.rowCount ?? 0) > 0;
    }
  }
  return {
    text: item.text,
    slug: item.itemId ? (slugOf.get(item.itemId) ?? null) : null,
    status: item.status,
    itemInDb,
    shopInDb,
    priceFromDb,
  };
}
