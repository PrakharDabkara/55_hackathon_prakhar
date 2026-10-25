import type { Logger } from 'pino';
import {
  ACTIVE_SEARCH_LIMIT,
  LIST_HOURLY_LIMIT,
  LIST_TTL_MIN,
  MAX_LIST_ANSWERS,
} from '@askbuy/shared';
import { withTransaction, type Database, type Queryable } from '../../db/queryable.js';
import { ApiError } from '../../http/errors.js';
import type { AiContext } from '../ai/index.js';
import { cleanItemName, normaliseQuery, resolveLines } from '../catalog/index.js';
import {
  announceOrdersCreated,
  insertListOrders,
  seekerOrderView,
  type ListOrderDraft,
  type OrderLine,
  type OrdersContext,
  type SeekerOrderView,
} from '../orders/index.js';
import type { EventPublisher } from '../realtime/index.js';
import {
  DEFAULT_RADIUS_M,
  distanceBand,
  MISC_FANOUT_MAX,
  ownsSavedAddress,
  searchLimitError,
  selectPingTargets,
} from '../requests/index.js';
import { findShopsWithinRadius, recordStockYes } from '../shops/index.js';
import { checkListAnswer, type ListAnswerInput } from './answerCheck.js';
import { cleanLines } from './lines.js';
import {
  expireListIn,
  findList,
  listLines,
  lockList,
  withdrawParchis,
  type LineRow,
  type ListRow,
  type WithdrawnPing,
} from './persistence.js';
import { checkOrderPlan, type AnsweredShop, type OrderPlanInput } from './orderCheck.js';
import { isLive } from './types.js';
import { buildView, sentenceCase, storedAnswers, type ListView } from './view.js';

/** A draft the customer never sent is forgotten after this long. */
const DRAFT_TTL_MIN = 60;

export interface ListsContext {
  db: Database;
  logger: Logger;
  config: { maxPings: number; trigramThreshold: number };
  /** Embeddings and the LLM for sorting. Without it only the free steps run. */
  ai?: AiContext | undefined;
  events?: EventPublisher | undefined;
  /** How many searches the customer has live (requests and lists): sending a list is one more. */
  activeSearches?: ((userId: string) => Promise<number>) | undefined;
}

const ordersCtx = (ctx: ListsContext): OrdersContext => ({
  db: ctx.db,
  logger: ctx.logger,
  events: ctx.events,
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CLEAN_ERRORS = {
  no_lines: 'Add at least one item.',
  too_many_lines: 'A list has at most 10 items.',
  line_too_long: 'Keep each item under 80 characters.',
} as const;

/** The customer's own list, or null for an unknown id or someone else's (so existence is not leaked). */
async function ownedList(db: Queryable, userId: string, id: string): Promise<ListRow | null> {
  if (!UUID.test(id)) return null;
  const list = await findList(db, id);
  return list && list.user_id === userId ? list : null;
}

/** Tells the customer a list moved and the shops that their parchi went away. Ids and a state only. */
function announce(
  ctx: Pick<ListsContext, 'events' | 'logger'>,
  list: { id: string; user_id: string; state: string },
  withdrawn: WithdrawnPing[] = [],
  reason: 'enough_answers' | 'list_ended' | 'customer_chose' = 'list_ended',
): void {
  ctx.events?.publish(
    {
      to: { userId: list.user_id },
      type: 'list.updated',
      data: { listId: list.id, state: list.state },
    },
    ctx.logger,
  );
  for (const ping of withdrawn)
    if (ping.ownerUserId)
      ctx.events?.publish(
        {
          to: { userId: ping.ownerUserId },
          type: 'listping.closed',
          data: { listPingId: ping.id, reason },
        },
        ctx.logger,
      );
}

/** Ends a live list that ran out of time, if it has. Safe to call from any read. */
async function applyDeadline(ctx: ListsContext, list: ListRow): Promise<ListRow> {
  if (!list.overdue || !isLive(list.state)) return list;
  const withdrawn = await withTransaction(ctx.db, (tx) => expireListIn(tx, list.id));
  if (!withdrawn) return (await findList(ctx.db, list.id)) ?? list;
  const ended = (await findList(ctx.db, list.id)) as ListRow;
  ctx.logger.info({ listId: list.id }, 'list expired');
  announce(ctx, ended, withdrawn);
  return ended;
}

// -- Sorting -----------------------------------------------------------------------------------

/**
 * Understands the customer's typed lines (ADR-0055 rule 3) and keeps the result as a DRAFT. At most
 * one embedding request and one model call, whatever the number of lines.
 */
export async function sortList(
  ctx: ListsContext,
  userId: string,
  rawLines: string[],
  requestId?: string,
): Promise<ListView> {
  const cleaned = cleanLines(rawLines);
  if (!cleaned.ok)
    throw new ApiError(
      400,
      cleaned.code === 'no_lines' ? 'invalid_request' : cleaned.code,
      CLEAN_ERRORS[cleaned.code],
    );
  const resolved = await resolveLines(ctx.db, cleaned.lines, {
    userId,
    threshold: ctx.config.trigramThreshold,
    ai: ctx.ai,
    requestId,
    logger: ctx.logger,
  });

  const id = await withTransaction(ctx.db, async (tx) => {
    const made = await tx.query<{ id: string }>(
      `INSERT INTO shopping_lists (user_id, expires_at)
       VALUES ($1, now() + make_interval(mins => $2::int)) RETURNING id`,
      [userId, DRAFT_TTL_MIN],
    );
    const listId = (made.rows[0] as { id: string }).id;
    for (const [position, text] of cleaned.lines.entries()) {
      const r = resolved[position] as (typeof resolved)[number];
      const quantity = 'quantity' in r && r.quantity ? JSON.stringify(r.quantity) : null;
      // The catalog word the text matched, only when it is not simply the item's own name (ADR-0047).
      const alias =
        r.kind === 'item' && r.matchedAlias && r.matchedAlias !== normaliseQuery(r.item.nameEn).text
          ? r.matchedAlias
          : null;
      await tx.query(
        `INSERT INTO list_lines (list_id, position, text, status, item_id, matched_alias, quantity,
                                 question, options, refused_reason)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9::jsonb, $10)`,
        [
          listId,
          position,
          text,
          r.kind,
          r.kind === 'item' ? r.item.id : null,
          alias,
          quantity,
          r.kind === 'ambiguous' ? r.question : null,
          r.kind === 'ambiguous' ? JSON.stringify(r.options.map((o) => o.itemId)) : null,
          r.kind === 'refused' ? r.reason : null,
        ],
      );
    }
    return listId;
  });
  ctx.logger.info(
    {
      listId: id,
      lines: cleaned.lines.length,
      kinds: Object.fromEntries(
        ['item', 'ambiguous', 'other', 'refused'].map((k) => [
          k,
          resolved.filter((r) => r.kind === k).length,
        ]),
      ),
    },
    'list sorted',
  );
  return buildView(ctx.db, (await findList(ctx.db, id)) as ListRow);
}

// -- Sending -----------------------------------------------------------------------------------

export interface SendInput {
  lat: number;
  lng: number;
  radiusM?: number | undefined;
  wantsDelivery?: boolean | undefined;
  deliveryAddressId?: string | undefined;
  /** One per ambiguous line: one of its options, or "as I typed". */
  choices?:
    { position: number; itemId?: string | undefined; asTyped?: true | undefined }[] | undefined;
}

interface Sent {
  pingId: string;
  shopId: string;
  ownerUserId: string | null;
  simulated: boolean;
  shopCategories: string[];
  canDeliver: boolean;
  lineIds: string[];
}

const lineName = (l: LineRow): string =>
  l.status === 'item' ? sentenceCase(l.name_en as string) : otherName(l);
const otherName = (l: LineRow): string => cleanItemName(l.text) ?? sentenceCase(l.text);

/** The distance rule a ping uses, with the list's place (ADR-0039): no limit, or within the limit. */
const CAN_DELIVER = `(s.delivery_max_km IS NULL OR ST_Distance(s.location, l.location) <= s.delivery_max_km * 1000)`;

/**
 * Sends a sorted list (ADR-0055 rule 4). In one transaction the list becomes OPEN and every shop's
 * single parchi is made: category lines to the nearest open shops that sell the kind, "other"
 * lines to the nearest MISC_FANOUT_MAX open shops of any kind, one parchi per shop with the union.
 * Sending again returns the list as it is.
 */
export async function sendList(
  ctx: ListsContext,
  userId: string,
  id: string,
  input: SendInput,
): Promise<ListView | null> {
  if (!(await ownedList(ctx.db, userId, id))) return null;
  const sent = await withTransaction(ctx.db, async (tx) => {
    const list = await lockList(tx, id);
    if (!list || list.user_id !== userId) return null;
    if (list.state !== 'DRAFT') return [];
    if (list.overdue)
      throw new ApiError(409, 'list_expired', 'This list is too old. Sort it again.');
    // A sent list is one of the customer's three searches (C-08).
    if (ctx.activeSearches && (await ctx.activeSearches(userId)) >= ACTIVE_SEARCH_LIMIT)
      throw searchLimitError();

    const lines = await listLines(tx, id);
    const choices = new Map((input.choices ?? []).map((c) => [c.position, c]));
    for (const c of choices.values()) {
      const line = lines.find((l) => l.position === c.position);
      if (!line || line.status !== 'ambiguous')
        throw new ApiError(400, 'invalid_choice', 'That line does not need a choice');
    }
    for (const line of lines.filter((l) => l.status === 'ambiguous')) {
      const choice = choices.get(line.position);
      if (!choice)
        throw new ApiError(400, 'choice_required', 'Choose what you mean for each question');
      if (choice.asTyped) {
        await tx.query(
          `UPDATE list_lines SET status = 'other', as_typed = true, question = NULL, options = NULL WHERE id = $1`,
          [line.id],
        );
      } else if (choice.itemId && (line.options ?? []).includes(choice.itemId)) {
        await tx.query(
          `UPDATE list_lines SET status = 'item', item_id = $2, question = NULL, options = NULL WHERE id = $1`,
          [line.id, choice.itemId],
        );
      } else throw new ApiError(400, 'invalid_choice', 'Choose one of the options, or as typed');
    }

    const final = await listLines(tx, id);
    const toSend = final.filter((l) => l.status === 'item' || l.status === 'other');
    if (toSend.length === 0)
      throw new ApiError(422, 'nothing_to_send', 'None of these items can be sent to shops');

    const recent = await tx.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM shopping_lists
        WHERE user_id = $1 AND sent_at > now() - interval '1 hour'`,
      [userId],
    );
    if ((recent.rows[0]?.n ?? 0) >= LIST_HOURLY_LIMIT)
      throw new ApiError(
        429,
        'list_rate_limited',
        `At most ${LIST_HOURLY_LIMIT} lists an hour. Try again later.`,
      );
    const wantsDelivery = input.wantsDelivery === true;
    if (wantsDelivery && !(await ownsSavedAddress(tx, userId, input.deliveryAddressId)))
      throw new ApiError(
        400,
        'invalid_request',
        'deliveryAddressId: choose one of your saved addresses to get delivery',
      );

    const radiusM = input.radiusM ?? DEFAULT_RADIUS_M;
    const nearby = await findShopsWithinRadius(input.lat, input.lng, radiusM, tx);
    const candidates = nearby.map((s) => ({
      shopId: s.id,
      categories: s.categories,
      distanceM: s.distance_m,
    }));
    // Shop -> the lines it is asked about. A line may reach a shop by its kind or as an "other".
    const asked = new Map<string, string[]>();
    const add = (shopId: string, lineId: string) =>
      asked.set(shopId, [...new Set([...(asked.get(shopId) ?? []), lineId])]);
    for (const line of toSend) {
      const targets =
        line.status === 'item'
          ? selectPingTargets(candidates, {
              itemCategories: line.categories ?? [],
              radiusM,
              excludeShopIds: new Set(),
              max: ctx.config.maxPings,
            })
          : selectPingTargets(candidates, {
              itemCategories: [],
              anyCategory: true,
              radiusM,
              excludeShopIds: new Set(),
              max: MISC_FANOUT_MAX,
            });
      for (const t of targets) add(t.shopId, line.id);
    }

    await tx.query(
      `UPDATE shopping_lists
          SET state = 'OPEN', location = ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography,
              radius_m = $4, wants_delivery = $5, delivery_address_id = $6,
              sent_at = now(), expires_at = now() + make_interval(mins => $7::int), updated_at = now()
        WHERE id = $1`,
      [
        id,
        input.lng,
        input.lat,
        radiusM,
        wantsDelivery,
        wantsDelivery ? (input.deliveryAddressId ?? null) : null,
        LIST_TTL_MIN,
      ],
    );
    const result: Sent[] = [];
    for (const [shopId, lineIds] of asked) {
      const ping = await tx.query<{
        id: string;
        owner_user_id: string | null;
        is_simulated: boolean;
        categories: string[];
        can_deliver: boolean;
      }>(
        `WITH ins AS (
           INSERT INTO list_pings (list_id, shop_id) VALUES ($1, $2) RETURNING id
         )
         SELECT ins.id, s.owner_user_id, s.is_simulated, s.categories,
                ${CAN_DELIVER} AS can_deliver
           FROM ins, shops s, shopping_lists l WHERE s.id = $2 AND l.id = $1`,
        [id, shopId],
      );
      const row = ping.rows[0] as NonNullable<(typeof ping.rows)[number]>;
      await tx.query(
        `INSERT INTO list_ping_lines (list_ping_id, line_id) SELECT $1, unnest($2::uuid[])`,
        [row.id, lineIds],
      );
      result.push({
        pingId: row.id,
        shopId,
        ownerUserId: row.owner_user_id,
        simulated: row.is_simulated,
        shopCategories: row.categories,
        canDeliver: row.can_deliver,
        lineIds,
      });
    }
    return result;
  });
  if (sent === null) return null;

  const list = (await findList(ctx.db, id)) as ListRow;
  if (sent.length > 0) await announceSent(ctx, list, sent);
  ctx.logger.info({ listId: id, shops: sent.length }, 'list sent');
  return buildView(ctx.db, list);
}

/** After the commit: one hint per parchi to its shop, and the simulator gets what it needs to decide. */
async function announceSent(ctx: ListsContext, list: ListRow, sent: Sent[]): Promise<void> {
  const lines = await listLines(ctx.db, list.id);
  const byId = new Map(lines.map((l) => [l.id, l]));
  for (const ping of sent) {
    if (ping.ownerUserId)
      ctx.events?.publish(
        {
          to: { userId: ping.ownerUserId },
          type: 'listping.created',
          data: { listPingId: ping.pingId },
        },
        ctx.logger,
      );
    if (ping.simulated)
      ctx.events?.publish(
        {
          to: { admin: true },
          type: 'listping.created',
          data: {
            listPingId: ping.pingId,
            shopId: ping.shopId,
            wantsDelivery: list.wants_delivery,
            canDeliver: ping.canDeliver,
            shopCategories: ping.shopCategories,
            lines: ping.lineIds.map((lineId) => {
              const l = byId.get(lineId) as LineRow;
              return {
                lineId,
                name: lineName(l),
                category: l.category,
                itemCategories: l.categories ?? [],
                refPricePaise: l.ref_price_paise,
                other: l.status === 'other',
              };
            }),
          },
        },
        ctx.logger,
      );
  }
}

// -- Reading and stopping ------------------------------------------------------------------------

/** The customer's list; a live one past its deadline ends the moment it is looked at. */
export async function getList(ctx: ListsContext, userId: string, id: string) {
  const list = await ownedList(ctx.db, userId, id);
  if (!list) return null;
  return buildView(ctx.db, await applyDeadline(ctx, list));
}

/**
 * "Stop asking": a live list becomes STOPPED, the parchis nobody answered are withdrawn, and the
 * answers it has stop being binding (ADR-0055 rule 13). A list that already ended is returned as
 * it is; a draft was never sent, so there is nothing to stop.
 */
export async function stopList(ctx: ListsContext, userId: string, id: string) {
  if (!(await ownedList(ctx.db, userId, id))) return null;
  const withdrawn = await withTransaction(ctx.db, async (tx) => {
    const list = await lockList(tx, id);
    if (!list) return null;
    if (list.state === 'DRAFT')
      throw new ApiError(409, 'not_sent', 'This list was never sent, so there is nothing to stop');
    if (!isLive(list.state)) return null;
    await tx.query(
      `UPDATE shopping_lists SET state = 'STOPPED', closed_at = now(), updated_at = now() WHERE id = $1`,
      [id],
    );
    return withdrawParchis(tx, id);
  });
  const list = (await findList(ctx.db, id)) as ListRow;
  if (withdrawn) {
    ctx.logger.info({ listId: id }, 'list stopped by the customer');
    announce(ctx, list, withdrawn);
  }
  return buildView(ctx.db, list);
}

/** The 60-second sweep: live lists past their deadline end, and forgotten drafts go. Returns how many. */
export async function sweepLists(
  ctx: Pick<ListsContext, 'db' | 'logger' | 'events'>,
): Promise<number> {
  const due = await ctx.db.query<{ id: string }>(
    `SELECT id FROM shopping_lists WHERE state IN ('OPEN', 'FULL') AND expires_at <= now()
      ORDER BY expires_at LIMIT 100`,
  );
  let touched = 0;
  for (const { id } of due.rows) {
    const withdrawn = await withTransaction(ctx.db, (tx) => expireListIn(tx, id));
    if (!withdrawn) continue;
    touched++;
    announce(ctx, (await findList(ctx.db, id)) as ListRow, withdrawn);
  }
  const drafts = await ctx.db.query(
    `DELETE FROM shopping_lists WHERE state = 'DRAFT' AND expires_at <= now()`,
  );
  return touched + (drafts.rowCount ?? 0);
}

// -- The shop's side -------------------------------------------------------------------------------

export interface ShopParchi {
  id: string;
  distanceBand: string;
  wantsDelivery: boolean;
  canDeliver: boolean;
  sentAt: Date;
  expiresAt: Date;
  lines: {
    lineId: string;
    name: string;
    displayName?: string;
    quantity?: { quantity: number; unit: string };
    /** A line no kind of shop owns: the shop may not usually stock it, so the screen groups these apart. */
    other: boolean;
    /** What this shop last said it charged for the item; null if never, or the answer was called wrong. */
    lastPricePaise: number | null;
  }[];
}

/**
 * This owner's open parchis. What a shop may know: the lines (catalog name and everyday word, or the
 * customer's cleaned words for an "other" line), how much, a distance band. Never who asked, where
 * exactly, or what other shops said.
 */
export async function listShopParchis(db: Queryable, ownerUserId: string): Promise<ShopParchi[]> {
  const pings = await db.query<{
    id: string;
    sent_at: Date;
    expires_at: Date;
    wants_delivery: boolean;
    distance_m: number;
    can_deliver: boolean;
  }>(
    `SELECT lp.id, lp.sent_at, l.expires_at, l.wants_delivery,
            ST_Distance(s.location, l.location) AS distance_m, ${CAN_DELIVER} AS can_deliver
       FROM list_pings lp
       JOIN shops s ON s.id = lp.shop_id
       JOIN shopping_lists l ON l.id = lp.list_id
      WHERE s.owner_user_id = $1 AND lp.state = 'SENT' AND l.state = 'OPEN' AND l.expires_at > now()
      ORDER BY lp.sent_at DESC`,
    [ownerUserId],
  );
  if (pings.rows.length === 0) return [];
  const lines = await db.query<{
    list_ping_id: string;
    line_id: string;
    text: string;
    status: string;
    matched_alias: string | null;
    quantity: { quantity: number; unit: string } | null;
    name_en: string | null;
    last_price_paise: number | null;
  }>(
    `SELECT lpl.list_ping_id, ll.id AS line_id, ll.text, ll.status, ll.matched_alias, ll.quantity, i.name_en,
            (SELECT st.price_paise FROM shop_stock st
              WHERE st.shop_id = lp.shop_id AND st.item_id = ll.item_id
                -- a wrong report hides it until the shop answers again
                AND (st.invalidated_at IS NULL OR st.last_confirmed_at >= st.invalidated_at)) AS last_price_paise
       FROM list_ping_lines lpl
       JOIN list_pings lp ON lp.id = lpl.list_ping_id
       JOIN list_lines ll ON ll.id = lpl.line_id
       LEFT JOIN items i ON i.id = ll.item_id
      WHERE lpl.list_ping_id = ANY($1::uuid[])
      ORDER BY ll.position`,
    [pings.rows.map((p) => p.id)],
  );
  return pings.rows.map((p) => ({
    id: p.id,
    distanceBand: distanceBand(p.distance_m),
    wantsDelivery: p.wants_delivery,
    canDeliver: p.can_deliver,
    sentAt: p.sent_at,
    expiresAt: p.expires_at,
    lines: lines.rows
      .filter((l) => l.list_ping_id === p.id)
      .map((l) => ({
        lineId: l.line_id,
        name:
          l.status === 'item'
            ? sentenceCase(l.name_en as string)
            : (cleanItemName(l.text) ?? sentenceCase(l.text)),
        ...(l.matched_alias && { displayName: sentenceCase(l.matched_alias) }),
        ...(l.quantity && { quantity: l.quantity }),
        other: l.status === 'other',
        lastPricePaise: l.last_price_paise,
      })),
  }));
}

export interface ListAnswerResult {
  id: string;
  state: 'ANSWERED';
  answeredAt: Date;
  lines: { lineId: string; have: boolean; pricePaise: number | null }[];
  canDeliver: boolean;
  deliveryFeePaise: number | null;
}

interface PingRow {
  id: string;
  list_id: string;
  shop_id: string;
  state: 'SENT' | 'ANSWERED' | 'NO_REPLY';
  answered_at: Date | null;
  can_deliver: boolean;
  delivery_fee_paise: number | null;
  owner_user_id: string | null;
  can_deliver_here: boolean;
}

const storedResult = async (tx: Queryable, ping: PingRow): Promise<ListAnswerResult> => {
  const { rows } = await tx.query<{ line_id: string; have: boolean; price_paise: number | null }>(
    `SELECT lpl.line_id, lpl.have, lpl.price_paise
       FROM list_ping_lines lpl JOIN list_lines ll ON ll.id = lpl.line_id
      WHERE lpl.list_ping_id = $1 ORDER BY ll.position`,
    [ping.id],
  );
  return {
    id: ping.id,
    state: 'ANSWERED',
    answeredAt: ping.answered_at as Date,
    lines: rows.map((r) => ({ lineId: r.line_id, have: r.have, pricePaise: r.price_paise })),
    canDeliver: ping.can_deliver,
    deliveryFeePaise: ping.delivery_fee_paise,
  };
};

/**
 * A shop answers its parchi, once (ADR-0055 rule 7). Locks the list first, like every change to it.
 * Answering again returns the first answer. A parchi that was withdrawn, or whose list ended, is 409.
 * Each "have" line teaches the shop's learned stock; the answer that makes it MAX_LIST_ANSWERS
 * closes the list to new answers (FULL) and withdraws the rest. Returns null when the parchi is
 * not this owner's.
 */
export async function answerListPing(
  ctx: ListsContext,
  ownerUserId: string,
  pingId: string,
  input: ListAnswerInput,
): Promise<ListAnswerResult | null> {
  if (!UUID.test(pingId)) return null;
  const outcome = await withTransaction(ctx.db, async (tx) => {
    const found = await tx.query<PingRow>(
      `SELECT lp.id, lp.list_id, lp.shop_id, lp.state, lp.answered_at, lp.can_deliver,
              lp.delivery_fee_paise, s.owner_user_id, ${CAN_DELIVER} AS can_deliver_here
         FROM list_pings lp JOIN shops s ON s.id = lp.shop_id JOIN shopping_lists l ON l.id = lp.list_id
        WHERE lp.id = $1`,
      [pingId],
    );
    const first = found.rows[0];
    if (!first || first.owner_user_id !== ownerUserId) return null;

    const list = (await lockList(tx, first.list_id)) as ListRow;
    // Re-read under the lock: it may have been answered, withdrawn or ended since.
    const ping = (
      await tx.query<PingRow>(
        `SELECT lp.id, lp.list_id, lp.shop_id, lp.state, lp.answered_at, lp.can_deliver,
                lp.delivery_fee_paise, s.owner_user_id, ${CAN_DELIVER} AS can_deliver_here
           FROM list_pings lp JOIN shops s ON s.id = lp.shop_id JOIN shopping_lists l ON l.id = lp.list_id
          WHERE lp.id = $1`,
        [pingId],
      )
    ).rows[0] as PingRow;
    if (ping.state === 'ANSWERED')
      return { result: await storedResult(tx, ping), fresh: false as const };

    let ended: WithdrawnPing[] | null = null;
    if (list.overdue && isLive(list.state)) ended = await expireListIn(tx, list.id);
    const state = ended ? 'EXPIRED' : list.state;
    if (ping.state !== 'SENT' || state !== 'OPEN') {
      // The list ended just now: commit that, then tell the caller their parchi is gone.
      return { closed: true as const, ended, list };
    }

    const sentLines = await tx.query<{ line_id: string }>(
      `SELECT line_id FROM list_ping_lines WHERE list_ping_id = $1`,
      [pingId],
    );
    const check = checkListAnswer(
      sentLines.rows.map((r) => r.line_id),
      input,
      { canDeliverHere: ping.can_deliver_here },
    );
    if (!check.ok)
      throw new ApiError(check.code === 'cannot_deliver' ? 409 : 400, check.code, check.message);

    await tx.query(
      `UPDATE list_ping_lines lpl SET have = a.have, price_paise = a.price
         FROM unnest($2::uuid[], $3::boolean[], $4::int[]) AS a(line_id, have, price)
        WHERE lpl.list_ping_id = $1 AND lpl.line_id = a.line_id`,
      [
        pingId,
        check.lines.map((l) => l.lineId),
        check.lines.map((l) => l.have),
        check.lines.map((l) => l.pricePaise),
      ],
    );
    await tx.query(
      `UPDATE list_pings
          SET state = 'ANSWERED', answered_at = now(), can_deliver = $2, delivery_fee_paise = $3
        WHERE id = $1`,
      [pingId, check.canDeliver, check.deliveryFeePaise],
    );
    // Every "have" line teaches this shop's stock, as a yes to a single search does.
    const have = check.lines.filter((l) => l.have);
    if (have.length > 0) {
      const items = await tx.query<{ id: string; item_id: string | null }>(
        `SELECT id, item_id FROM list_lines WHERE id = ANY($1::uuid[])`,
        [have.map((l) => l.lineId)],
      );
      const itemOf = new Map(items.rows.map((r) => [r.id, r.item_id]));
      for (const l of have) {
        const itemId = itemOf.get(l.lineId);
        if (itemId)
          await recordStockYes(tx, {
            shopId: ping.shop_id,
            itemId,
            pricePaise: l.pricePaise,
            quantityHint: null,
            delivery: check.canDeliver ? { feePaise: check.deliveryFeePaise, minutes: null } : null,
            confirmedAt: new Date(),
          });
      }
    }
    let enough: WithdrawnPing[] = [];
    const answered = (
      await tx.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM list_pings WHERE list_id = $1 AND state = 'ANSWERED'`,
        [list.id],
      )
    ).rows[0]?.n;
    if ((answered ?? 0) >= MAX_LIST_ANSWERS) {
      await tx.query(`UPDATE shopping_lists SET state = 'FULL', updated_at = now() WHERE id = $1`, [
        list.id,
      ]);
      enough = await withdrawParchis(tx, list.id);
    }
    const stored = await tx.query<PingRow>(
      `SELECT lp.id, lp.list_id, lp.shop_id, lp.state, lp.answered_at, lp.can_deliver,
              lp.delivery_fee_paise, NULL::uuid AS owner_user_id, false AS can_deliver_here
         FROM list_pings lp WHERE lp.id = $1`,
      [pingId],
    );
    return {
      result: await storedResult(tx, stored.rows[0] as PingRow),
      fresh: true as const,
      enough,
      listId: list.id,
      userId: list.user_id,
    };
  });

  if (outcome === null) return null;
  if ('closed' in outcome) {
    if (outcome.ended)
      announce(ctx, (await findList(ctx.db, outcome.list.id)) as ListRow, outcome.ended);
    throw new ApiError(409, 'ping_closed', 'This list has closed: it takes no more answers');
  }
  if (outcome.fresh) {
    const list = (await findList(ctx.db, outcome.listId)) as ListRow;
    announce(ctx, list, outcome.enough, 'enough_answers');
    // This shop's parchi is finished (it may have it open on another phone).
    ctx.events?.publish(
      {
        to: { userId: ownerUserId },
        type: 'listping.closed',
        data: { listPingId: pingId, reason: 'answered' },
      },
      ctx.logger,
    );
    ctx.logger.info({ listPingId: pingId, list: `${list.state}` }, 'list parchi answered');
  }
  return outcome.result;
}

// -- Ordering --------------------------------------------------------------------------------------

export interface OrderListInput extends OrderPlanInput {
  addressText?: string | undefined;
  customerName?: string | undefined;
  note?: string | undefined;
  saveAddress?: boolean | undefined;
}

export interface OrderListResult {
  list: ListView;
  orders: SeekerOrderView[];
  /** The shops the customer will walk to, for the route. Each also has an order in `orders`. */
  pickups: {
    shopId: string;
    name: string;
    lat: number;
    lng: number;
    lines: { position: number; text: string; pricePaise: number }[];
  }[];
}

const REFUSED_PLAN_STATUS = {
  nothing_to_order: 400,
  unknown_line: 400,
  line_assigned_twice: 400,
  mode_without_lines: 400,
  line_not_available: 409,
  cannot_deliver: 409,
} as const;

/**
 * Orders from several shops at once, all or nothing (ADR-0055 rule 11). Under the list's lock:
 * every assignment must be a line that shop said it has; delivery only where it said canDeliver;
 * a closed shop refuses the call. One delivery order per delivery shop with that shop's prices and
 * fee, born ACCEPTED while the answers are binding and REQUESTED once the list has expired. A shop
 * set to pickup gets an order too, one that keeps no address, pin or name. The list becomes ORDERED.
 */
export async function orderFromList(
  ctx: ListsContext,
  userId: string,
  id: string,
  input: OrderListInput,
): Promise<OrderListResult | null> {
  if (!(await ownedList(ctx.db, userId, id))) return null;
  const done = await withTransaction(ctx.db, async (tx) => {
    let list = (await lockList(tx, id)) as ListRow;
    let withdrawnByExpiry: WithdrawnPing[] = [];
    if (list.overdue && isLive(list.state)) {
      withdrawnByExpiry = (await expireListIn(tx, id)) ?? [];
      list = (await lockList(tx, id)) as ListRow;
    }
    if (list.state === 'DRAFT')
      throw new ApiError(409, 'not_sent', 'Send the list before ordering from it');
    if (list.state === 'ORDERED')
      throw new ApiError(409, 'already_ordered', 'You have already ordered from this list');
    if (list.state === 'STOPPED')
      throw new ApiError(409, 'list_stopped', 'You stopped this list. Send it again to order.');

    const lines = await listLines(tx, id);
    const answers = await storedAnswers(tx, id);
    const bySh = new Map<string, AnsweredShop>(
      answers.map((a) => [
        a.shopId,
        { have: a.have, canDeliver: a.canDeliver, feePaise: a.deliveryFeePaise },
      ]),
    );
    const sendable = lines.filter((l) => l.status === 'item' || l.status === 'other');
    const plan = checkOrderPlan(input, {
      positions: sendable.map((l) => l.position),
      answers: bySh,
    });
    if (!plan.ok) throw new ApiError(REFUSED_PLAN_STATUS[plan.code], plan.code, plan.message);

    // A closed shop takes no new order, delivery or pickup (ADR-0039).
    const closed = await tx.query(
      `SELECT 1 FROM shops WHERE id = ANY($1::uuid[]) AND closed_until IS NOT NULL AND closed_until > now()`,
      [plan.shops.map((s) => s.shopId)],
    );
    if (closed.rows.length > 0)
      throw new ApiError(409, 'shop_closed', 'A shop on this list just closed');

    const binding = isLive(list.state);
    const byPosition = new Map(lines.map((l) => [l.position, l]));
    const orderLine = (position: number, pricePaise: number): OrderLine => {
      const l = byPosition.get(position) as LineRow;
      const q = l.quantity;
      const base = l.status === 'item' ? lineName(l) : otherName(l);
      return {
        name: q ? `${base} (${q.quantity} ${q.unit})` : base,
        ...(l.status === 'item' && l.name_hi && { nameHi: l.name_hi }),
        text: l.text,
        ...(l.matched_alias && { displayName: sentenceCase(l.matched_alias) }),
        count: 1,
        pricePaise,
      };
    };
    // Every shop of the plan gets an order: delivery to the address, or pickup that shares none.
    const drafts: ListOrderDraft[] = plan.shops.map((s) => ({
      shopId: s.shopId,
      fulfilment: s.mode,
      lines: s.lines.map((l) => orderLine(l.position, l.pricePaise)),
      feePaise: s.feePaise,
      state: binding ? 'ACCEPTED' : 'REQUESTED',
    }));
    const orders =
      drafts.length > 0
        ? await insertListOrders(tx, userId, {
            listId: id,
            lat: list.lat as number,
            lng: list.lng as number,
            deliveryAddressId: list.delivery_address_id,
            addressText: input.addressText,
            customerName: input.customerName,
            note: input.note,
            saveAddress: input.saveAddress,
            orders: drafts,
          })
        : [];

    await tx.query(
      `UPDATE shopping_lists SET state = 'ORDERED', closed_at = now(), updated_at = now() WHERE id = $1`,
      [id],
    );
    // The shops still holding the question are told the customer already got an answer.
    const withdrawn = [...withdrawnByExpiry, ...(await withdrawParchis(tx, id))];
    const names = new Map(answers.map((a) => [a.shopId, a]));
    const pickups = plan.shops
      .filter((s) => s.mode === 'pickup')
      .map((s) => {
        const a = names.get(s.shopId) as (typeof answers)[number];
        return {
          shopId: s.shopId,
          name: a.name,
          lat: a.lat,
          lng: a.lng,
          lines: s.lines.map((l) => ({
            position: l.position,
            text: (byPosition.get(l.position) as LineRow).text,
            pricePaise: l.pricePaise,
          })),
        };
      });
    return { orders, pickups, withdrawn };
  });

  const list = (await findList(ctx.db, id)) as ListRow;
  announce(ctx, list, done.withdrawn, 'customer_chose');
  await announceOrdersCreated(ordersCtx(ctx), done.orders);
  ctx.logger.info(
    { listId: id, orders: done.orders.length, pickups: done.pickups.length },
    'list ordered',
  );
  return {
    list: await buildView(ctx.db, list),
    orders: done.orders.map(seekerOrderView),
    pickups: done.pickups,
  };
}
