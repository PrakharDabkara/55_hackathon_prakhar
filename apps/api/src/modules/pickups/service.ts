import type { Logger } from 'pino';
import { withTransaction, type Database } from '../../db/queryable.js';
import { ApiError } from '../../http/errors.js';
import type { EventPublisher } from '../realtime/index.js';
import { withdrawPingsForChoice } from '../requests/index.js';
import {
  confirmStockByCustomer,
  hasStockRecord,
  invalidateStockByCustomer,
} from '../shops/index.js';

export type PickupAnswer = 'found' | 'not_there' | 'not_gone';

export interface PickupsContext {
  db: Database;
  logger: Logger;
  events?: EventPublisher | undefined;
  /** Minutes after the tap before the home screen asks. */
  askAfterMinutes: number;
}

/** The reminder push goes this long after the tap, if the home screen has not asked by then. */
export const PUSH_AFTER_MINUTES = 60;
/** A visit is forgotten this long after the tap (ADR-0035). */
export const KEEP_DAYS = 30;
/** More than this many questions at once is a chore. */
const MAX_PENDING = 3;

const MINUTE_MS = 60_000;

export interface NewPickup {
  shopId: string;
  itemId: string;
  requestId?: string | undefined;
  errandId?: string | undefined;
}

export interface PendingPickup {
  id: string;
  item: { nameEn: string; nameHi: string };
  shop: { name: string };
}

/**
 * The customer tapped "Raasta" for a pickup shop. Noted once per customer, shop and item (that is
 * also the "ask at most once" rule). Quiet for a delivery order from that shop (never asked for
 * deliveries) and a 404 for anything that is not the customer's own search or errand, or a shop
 * that has no record of the item (so nobody can plant a question about a shop they never saw).
 */
export async function recordPickup(
  { db, logger, events }: PickupsContext,
  userId: string,
  input: NewPickup,
): Promise<void> {
  const sourceId = input.requestId ?? input.errandId;
  if (!sourceId) throw new ApiError(400, 'invalid_request', 'give a requestId or an errandId');
  const { rows: source } = input.requestId
    ? await db.query(`SELECT 1 FROM requests WHERE id = $1 AND user_id = $2 AND item_id = $3`, [
        input.requestId,
        userId,
        input.itemId,
      ])
    : await db.query(`SELECT 1 FROM errands WHERE id = $1 AND user_id = $2`, [
        input.errandId,
        userId,
      ]);
  if (source.length === 0 || !(await hasStockRecord(db, input.shopId, input.itemId)))
    throw new ApiError(404, 'not_found', 'No such search or shop');

  const { rows: ordered } = await db.query(
    `SELECT 1 FROM delivery_orders
      WHERE user_id = $1 AND shop_id = $2 AND source_id = $3
        AND state NOT IN ('DECLINED', 'EXPIRED', 'CANCELLED')`,
    [userId, input.shopId, sourceId],
  );
  if (ordered.length > 0) return;

  await db.query(
    `INSERT INTO pickup_visits (user_id, shop_id, item_id, request_id, errand_id)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id, shop_id, item_id) DO NOTHING`,
    [userId, input.shopId, input.itemId, input.requestId ?? null, input.errandId ?? null],
  );
  // The customer is on the way to a shop: the shops still holding the question can let it go (ADR-0043).
  if (input.requestId) await withdrawPingsForChoice({ db, logger, events }, input.requestId);
}

/**
 * The questions the home screen should ask now: taps old enough, not answered, oldest first. Being
 * shown here is what stops the reminder push for them.
 */
export async function listPendingPickups(
  { db, askAfterMinutes }: PickupsContext,
  userId: string,
  now: Date = new Date(),
): Promise<PendingPickup[]> {
  const { rows } = await db.query<{ id: string; name_en: string; name_hi: string; shop: string }>(
    `WITH due AS (
       SELECT id FROM pickup_visits
        WHERE user_id = $1 AND answer IS NULL AND created_at <= $2
        ORDER BY created_at LIMIT $4
     ), shown AS (
       UPDATE pickup_visits v SET asked_at = COALESCE(v.asked_at, $3)
         FROM due WHERE v.id = due.id
       RETURNING v.id, v.shop_id, v.item_id, v.created_at
     )
     SELECT shown.id, i.name_en, i.name_hi, s.name AS shop
       FROM shown JOIN items i ON i.id = shown.item_id JOIN shops s ON s.id = shown.shop_id
      ORDER BY shown.created_at`,
    [userId, new Date(now.getTime() - askAfterMinutes * MINUTE_MS), now, MAX_PENDING],
  );
  return rows.map((r) => ({
    id: r.id,
    item: { nameEn: r.name_en, nameHi: r.name_hi },
    shop: { name: r.shop },
  }));
}

/**
 * The customer's answer, once. "Mil gaya" refreshes the shop's answer and marks it confirmed by a
 * customer; "Wahan nahi tha" invalidates it and counts against the shop for the item; "Gaya nahi"
 * changes nothing. The stock row is told the shop and item, never the customer.
 */
export async function answerPickup(
  { db, logger }: PickupsContext,
  userId: string,
  visitId: string,
  answer: PickupAnswer,
  now: Date = new Date(),
): Promise<void> {
  await withTransaction(db, async (tx) => {
    const { rows } = await tx.query<{ shop_id: string; item_id: string; answer: string | null }>(
      `SELECT shop_id, item_id, answer FROM pickup_visits
        WHERE id = $1 AND user_id = $2 FOR UPDATE`,
      [visitId, userId],
    );
    const visit = rows[0];
    if (!visit) throw new ApiError(404, 'not_found', 'No such question');
    if (visit.answer) throw new ApiError(409, 'already_answered', 'You already answered this');
    await tx.query(`UPDATE pickup_visits SET answer = $2, answered_at = $3 WHERE id = $1`, [
      visitId,
      answer,
      now,
    ]);
    if (answer === 'found') await confirmStockByCustomer(tx, visit.shop_id, visit.item_id, now);
    if (answer === 'not_there')
      await invalidateStockByCustomer(tx, visit.shop_id, visit.item_id, now);
  });
  logger.info({ answer }, 'pickup answered');
}

/** What the reminder push needs: the items of each customer's unasked visits, oldest first. */
export interface PickupReminder {
  userId: string;
  items: string[];
}

/**
 * Takes the visits that are an hour old and were never asked about on the home screen, marks them
 * so they are reminded once, and returns them grouped by customer: one push each.
 */
export async function claimPickupReminders(
  db: Database,
  now: Date = new Date(),
): Promise<PickupReminder[]> {
  const { rows } = await db.query<{ user_id: string; name_en: string }>(
    `WITH due AS (
       UPDATE pickup_visits SET push_sent_at = $1
        WHERE answer IS NULL AND asked_at IS NULL AND push_sent_at IS NULL AND created_at <= $2
       RETURNING user_id, item_id, created_at
     )
     SELECT due.user_id, i.name_en
       FROM due JOIN items i ON i.id = due.item_id
      ORDER BY due.created_at`,
    [now, new Date(now.getTime() - PUSH_AFTER_MINUTES * MINUTE_MS)],
  );
  const byUser = new Map<string, string[]>();
  for (const row of rows)
    byUser.set(row.user_id, [...(byUser.get(row.user_id) ?? []), row.name_en]);
  return [...byUser].map(([userId, items]) => ({ userId, items }));
}

/** Forgets visits 30 days after the tap, answered or not. Returns how many went. */
export async function sweepPickups(
  { db, logger }: { db: Database; logger: Logger },
  now: Date = new Date(),
): Promise<number> {
  const { rowCount } = await db.query(`DELETE FROM pickup_visits WHERE created_at < $1`, [
    new Date(now.getTime() - KEEP_DAYS * 24 * 60 * MINUTE_MS),
  ]);
  if (rowCount) logger.info({ count: rowCount }, 'old pickup visits removed');
  return rowCount ?? 0;
}
