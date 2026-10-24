import type { Logger } from 'pino';
import type { Database, Queryable } from '../../db/queryable.js';
import { withTransaction } from '../../db/queryable.js';
import { ApiError } from '../../http/errors.js';
import { findItemIdsBySlugs } from '../catalog/index.js';
import { ensureDemoUser, findUserIdsByPhones } from '../identity/index.js';
import { keepAddress } from '../orders/index.js';
import { placeholderLogo, replaceLogo } from '../photos/index.js';
import {
  clearDemoShopStock,
  countDemoSimulatedShops,
  countStockOf,
  recordStockYes,
  upsertDemoShop,
} from '../shops/index.js';
import { createSimulatedShops } from '../simulation/index.js';
import {
  DEMO_ADDRESS,
  DEMO_CUSTOMER_NAME,
  DEMO_CUSTOMER_PHONES,
  DEMO_PHONES,
  DEMO_PLACE,
  DEMO_SHOPS,
  DEMO_SIMULATED_SHOPS,
  DEMO_STOCK,
} from './fixtures.js';

export interface DemoContext {
  db: Database;
  logger: Logger;
  /** Most photo bytes Postgres may hold, for the logos. */
  capBytes: number;
  /** Queues the catch-up for each new simulated shop (ADR-0038). */
  hooks?: { enqueueShopCatchUp?: ((shopId: string) => Promise<void>) | undefined } | undefined;
}

/** What is in place after a seed. Counts only. */
export interface SeedResult {
  shops: number;
  customers: number;
  simulatedShops: number;
  stockRows: number;
  logos: number;
}

/** What a reset removed. Counts only. */
export interface ResetRemoved {
  requests: number;
  lists: number;
  errands: number;
  orders: number;
  pickups: number;
  pings: number;
  listPings: number;
  stockRows: number;
}

/** One lock for seed and reset: two at once would each see "none yet" and make the shops twice. */
const LOCK_KEY = 6_200_062;

async function withDemoLock<T>(db: Database, fn: () => Promise<T>): Promise<T> {
  // A session lock on its own connection, held across the steps below (each its own transaction).
  // try-lock: a second call is refused at once instead of waiting on a connection of its own.
  const client = await db.connect();
  // Same as withTransaction: while we hold this client the pool does not listen to it, and a
  // connection that dies (Neon suspending, a restart) would otherwise throw and crash the process.
  // The next query on it rejects and fails the run; the client is then thrown away below.
  let broken = false;
  const onError = () => {
    broken = true;
  };
  client.on('error', onError);
  let unlocked = false;
  try {
    const got = await client.query<{ ok: boolean }>('SELECT pg_try_advisory_lock($1) AS ok', [
      LOCK_KEY,
    ]);
    if (!got.rows[0]?.ok)
      throw new ApiError(409, 'demo_busy', 'A seed or reset is already running; try again');
    try {
      return await fn();
    } finally {
      unlocked = await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).then(
        () => true,
        () => false,
      );
    }
  } finally {
    // A connection that may still hold the lock is thrown away, not returned to the pool.
    client.removeListener('error', onError);
    client.release(unlocked && !broken ? undefined : true);
  }
}

async function seedLocked(ctx: DemoContext): Promise<SeedResult> {
  const { db, logger } = ctx;

  // The five demo shops and their owners: made if missing, put back as specified if they exist.
  const shops: { id: string; ownerUserId: string; name: string }[] = [];
  for (const spec of DEMO_SHOPS) {
    const ownerUserId = await ensureDemoUser(db, spec.phone, 'shop');
    const id = await upsertDemoShop(db, ownerUserId, spec);
    shops.push({ id, ownerUserId, name: spec.name });
  }

  // Learned stock: the fixture rows, fresh now and a few hours apart so it does not look stamped.
  const ids = await findItemIdsBySlugs(db, [...new Set(DEMO_STOCK.map((r) => r.slug))]);
  const now = Date.now();
  await withTransaction(db, async (tx) => {
    for (const [n, row] of DEMO_STOCK.entries()) {
      const itemId = ids.get(row.slug);
      const shop = shops[row.shop];
      if (!itemId || !shop) {
        logger.warn({ slug: row.slug }, 'demo stock row skipped: item not in the catalog');
        continue;
      }
      await recordStockYes(tx, {
        shopId: shop.id,
        itemId,
        pricePaise: row.pricePaise,
        quantityHint: null,
        delivery: DEMO_SHOPS[row.shop]?.delivery
          ? {
              feePaise: DEMO_SHOPS[row.shop]?.delivery?.feePaise ?? null,
              minutes: DEMO_SHOPS[row.shop]?.delivery?.minutes ?? null,
            }
          : null,
        confirmedAt: new Date(now - (1 + (n % 5)) * 3_600_000),
      });
    }
  });

  // Demo customers, each with a saved address that says it is a demo.
  for (const phone of DEMO_CUSTOMER_PHONES) {
    const userId = await ensureDemoUser(db, phone, 'seeker');
    await keepAddress({ db, logger }, userId, {
      addressText: DEMO_ADDRESS,
      customerName: DEMO_CUSTOMER_NAME,
    });
  }

  // Simulated shops for the autopilot, only as many as are missing.
  const have = await countDemoSimulatedShops(db);
  if (have < DEMO_SIMULATED_SHOPS.count) {
    const made = await createSimulatedShops(
      db,
      {
        count: DEMO_SIMULATED_SHOPS.count - have,
        centre: DEMO_PLACE,
        radiusM: DEMO_SIMULATED_SHOPS.radiusM,
        // Another batch must not repeat the first one's names and places.
        seed: DEMO_SIMULATED_SHOPS.seed + have,
      },
      { demo: true },
    );
    for (const shop of made)
      void ctx.hooks?.enqueueShopCatchUp?.(shop.shopId).catch(() => undefined);
  }

  // Placeholder initials logos, through the same pipeline as an uploaded one, only where missing.
  for (const shop of shops) {
    const { rows } = await db.query<{ has: boolean }>(
      `SELECT logo_photo_id IS NOT NULL AS has FROM shops WHERE id = $1`,
      [shop.id],
    );
    if (rows[0]?.has) continue;
    await replaceLogo(
      { db, logger, capBytes: ctx.capBytes },
      shop.ownerUserId,
      await placeholderLogo(shop.name),
    );
  }

  const logos = await db.query<{ n: string }>(
    `SELECT count(*) AS n FROM shops WHERE id = ANY($1::uuid[]) AND logo_photo_id IS NOT NULL`,
    [shops.map((s) => s.id)],
  );
  const result: SeedResult = {
    shops: shops.length,
    customers: DEMO_CUSTOMER_PHONES.length,
    simulatedShops: await countDemoSimulatedShops(db),
    stockRows: await countStockOf(
      db,
      shops.map((s) => s.id),
    ),
    logos: Number(logos.rows[0]?.n),
  };
  logger.info(result, 'demo seeded');
  return result;
}

/** Makes the demo exist, or puts it back: safe to run any number of times. Counts only. */
export async function seedDemo(ctx: DemoContext): Promise<SeedResult> {
  return withDemoLock(ctx.db, () => seedLocked(ctx));
}

const countOf = async (db: Queryable, sql: string, args: unknown[]): Promise<number> =>
  Number((await db.query<{ n: string }>(sql, args)).rows[0]?.n);

/**
 * Removes everything that involves a demo number (101 to 110, 201 to 210): the demo customers'
 * requests, lists, errands and orders, and the pings, parchis, orders and visits at demo shops,
 * then the stock the demo shops learned, and seeds again. Only rows tied to a demo user or a demo
 * shop are touched; a real customer's request to a real shop is never in the way. Counts only.
 */
export async function resetDemo(
  ctx: DemoContext,
): Promise<{ removed: ResetRemoved; seeded: SeedResult }> {
  return withDemoLock(ctx.db, async () => {
    const { db, logger } = ctx;
    const demoUsers = await findUserIdsByPhones(db, DEMO_PHONES);
    const removed = await withTransaction(db, async (tx): Promise<ResetRemoved> => {
      const shopIds = (
        await tx.query<{ id: string }>(
          `SELECT id FROM shops WHERE owner_user_id = ANY($1::uuid[])`,
          [demoUsers],
        )
      ).rows.map((r) => r.id);
      const args = [demoUsers, shopIds];
      // Counted before the deletes: pings and parchis also go with their request or list.
      const pings = await countOf(
        tx,
        `SELECT count(*) AS n FROM pings
          WHERE shop_id = ANY($2::uuid[])
             OR request_id IN (SELECT id FROM requests WHERE user_id = ANY($1::uuid[]))`,
        args,
      );
      const listPings = await countOf(
        tx,
        `SELECT count(*) AS n FROM list_pings
          WHERE shop_id = ANY($2::uuid[])
             OR list_id IN (SELECT id FROM shopping_lists WHERE user_id = ANY($1::uuid[]))`,
        args,
      );
      const count = async (sql: string, using: unknown[] = args) =>
        (await tx.query(sql, using)).rowCount ?? 0;
      const orders = await count(
        `DELETE FROM delivery_orders WHERE user_id = ANY($1::uuid[]) OR shop_id = ANY($2::uuid[])`,
      );
      const pickups = await count(
        `DELETE FROM pickup_visits WHERE user_id = ANY($1::uuid[]) OR shop_id = ANY($2::uuid[])`,
      );
      // Their requests, lists and errands go; pings, answers, photos and steps follow by cascade.
      const requests = await count(`DELETE FROM requests WHERE user_id = ANY($1::uuid[])`, [
        demoUsers,
      ]);
      const lists = await count(`DELETE FROM shopping_lists WHERE user_id = ANY($1::uuid[])`, [
        demoUsers,
      ]);
      const errands = await count(`DELETE FROM errands WHERE user_id = ANY($1::uuid[])`, [
        demoUsers,
      ]);
      // What is left: a real customer's pings and parchis to a demo shop.
      await count(`DELETE FROM pings WHERE shop_id = ANY($1::uuid[])`, [shopIds]);
      await count(`DELETE FROM list_pings WHERE shop_id = ANY($1::uuid[])`, [shopIds]);
      const stockRows = await clearDemoShopStock(tx);
      return { requests, lists, errands, orders, pickups, pings, listPings, stockRows };
    });
    logger.info(removed, 'demo reset');
    return { removed, seeded: await seedLocked(ctx) };
  });
}
