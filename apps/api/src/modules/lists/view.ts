import { MAX_LIST_ANSWERS } from '@askbuy/shared';
import type { Queryable } from '../../db/queryable.js';
import { bestCover, type CoverPlan, type CoverShop } from './cover.js';
import { findList, listLines, type LineRow, type ListRow } from './persistence.js';
import { rankAnswers } from './rank.js';
import { isLive, type ListState } from './types.js';

export const sentenceCase = (text: string): string => {
  const [first = ''] = Array.from(text);
  return first.toLocaleUpperCase() + text.slice(first.length);
};

export interface LineView {
  position: number;
  /** The customer's own words, cleaned (trimmed, at most 80 characters). */
  text: string;
  status: 'item' | 'ambiguous' | 'other' | 'refused';
  item?: { id: string; nameEn: string; nameHi: string; category: string };
  /** The everyday catalog word the text matched ("Maida"), when it differs from the item's name. */
  displayName?: string;
  quantity?: { quantity: number; unit: string };
  /** An ambiguous line (a draft): the question and up to 3 options; "as I typed" is always also allowed. */
  question?: string;
  options?: { itemId: string; nameEn: string; nameHi: string }[];
  /** The customer chose "as I typed" for an ambiguous line. */
  asTyped?: true;
  reason?: 'blocked' | 'unclear';
  /** How many shops this line was sent to. */
  asked: number;
}

export interface AnswerView {
  shopId: string;
  name: string;
  logoUrl: string | null;
  distanceM: number;
  lat: number;
  lng: number;
  haveCount: number;
  /** The sum of the prices of the lines this shop has. */
  totalPaise: number;
  canDeliver: boolean;
  /** One fee for the whole list; null when the shop did not name one. */
  deliveryFeePaise: number | null;
  answeredAt: string;
  lines: { position: number; status: 'have' | 'no' | 'not_sent'; pricePaise?: number }[];
}

export interface PlanView {
  assignments: { position: number; shopId: string; pricePaise: number }[];
  /** In route order from the customer. */
  stops: { shopId: string; name: string; lat: number; lng: number }[];
  totalM: number;
  totalPaise: number;
  /** "Nobody has this yet". */
  missing: number[];
}

export interface ListView {
  id: string;
  state: ListState;
  /** Still collecting answers: OPEN. FULL, ORDERED, STOPPED and EXPIRED are not listening. */
  listening: boolean;
  /** Answers can still be ordered at once (OPEN or FULL). */
  binding: boolean;
  wantsDelivery: boolean;
  /** Where the customer sent it from (their own place; null for a draft): the plan's map starts here. */
  lat: number | null;
  lng: number | null;
  maxAnswers: number;
  shopsAsked: number;
  shopsAnswered: number;
  lines: LineView[];
  /** Ranked: more "have" lines, then nearer, then cheaper. Empty for a draft. */
  answers: AnswerView[];
  /** The default plan, worked out on every read; null for a draft. */
  plan: PlanView | null;
  createdAt: string;
  sentAt: string | null;
  expiresAt: string;
}

/** A shop's answer with its lines, as stored. */
export interface StoredAnswer {
  listPingId: string;
  shopId: string;
  name: string;
  logoUrl: string | null;
  distanceM: number;
  lat: number;
  lng: number;
  canDeliver: boolean;
  deliveryFeePaise: number | null;
  answeredAt: Date;
  /** position → price, for the lines the shop has. */
  have: Map<number, number>;
  /** The positions the shop was sent. */
  sent: Set<number>;
}

/** Every shop that answered this list, with what it said line by line. */
export async function storedAnswers(db: Queryable, listId: string): Promise<StoredAnswer[]> {
  const { rows } = await db.query<{
    id: string;
    shop_id: string;
    name: string;
    logo_url: string | null;
    distance_m: number;
    lat: number;
    lng: number;
    can_deliver: boolean;
    delivery_fee_paise: number | null;
    answered_at: Date;
    position: number;
    have: boolean | null;
    price_paise: number | null;
  }>(
    `SELECT lp.id, s.id AS shop_id, s.name,
            CASE WHEN s.logo_photo_id IS NOT NULL THEN '/photos/' || s.logo_photo_id END AS logo_url,
            ST_Distance(s.location, l.location) AS distance_m,
            ST_Y(s.location::geometry) AS lat, ST_X(s.location::geometry) AS lng,
            lp.can_deliver, lp.delivery_fee_paise, lp.answered_at,
            ll.position, lpl.have, lpl.price_paise
       FROM list_pings lp
       JOIN shopping_lists l ON l.id = lp.list_id
       JOIN shops s ON s.id = lp.shop_id
       JOIN list_ping_lines lpl ON lpl.list_ping_id = lp.id
       JOIN list_lines ll ON ll.id = lpl.line_id
      WHERE lp.list_id = $1 AND lp.state = 'ANSWERED'
      ORDER BY lp.answered_at, ll.position`,
    [listId],
  );
  const byPing = new Map<string, StoredAnswer>();
  for (const r of rows) {
    let a = byPing.get(r.id);
    if (!a) {
      a = {
        listPingId: r.id,
        shopId: r.shop_id,
        name: r.name,
        logoUrl: r.logo_url,
        distanceM: Math.round(r.distance_m),
        lat: r.lat,
        lng: r.lng,
        canDeliver: r.can_deliver,
        deliveryFeePaise: r.delivery_fee_paise,
        answeredAt: r.answered_at,
        have: new Map(),
        sent: new Set(),
      };
      byPing.set(r.id, a);
    }
    a.sent.add(r.position);
    if (r.have === true && r.price_paise !== null) a.have.set(r.position, r.price_paise);
  }
  return [...byPing.values()];
}

const SENDABLE = new Set(['item', 'other']);
const sendable = (lines: LineRow[]) => lines.filter((l) => SENDABLE.has(l.status));

function lineView(
  l: LineRow,
  asked: number,
  optionNames: Map<string, LineView['options']>,
): LineView {
  return {
    position: l.position,
    text: l.text,
    status: l.status,
    ...(l.item_id &&
      l.name_en !== null && {
        item: {
          id: l.item_id,
          nameEn: l.name_en,
          nameHi: l.name_hi as string,
          category: l.category as string,
        },
      }),
    ...(l.matched_alias && { displayName: sentenceCase(l.matched_alias) }),
    ...(l.quantity && { quantity: l.quantity }),
    ...(l.status === 'ambiguous' && {
      question: l.question as string,
      options: (l.options ?? []).flatMap((id) => optionNames.get(id) ?? []),
    }),
    ...(l.as_typed && { asTyped: true as const }),
    ...(l.refused_reason && { reason: l.refused_reason }),
    asked,
  };
}

/** The list as its owner sees it: lines, ranked answers and the default plan. */
export async function buildView(db: Queryable, list: ListRow): Promise<ListView> {
  const lines = await listLines(db, list.id);
  const optionIds = [...new Set(lines.flatMap((l) => l.options ?? []))];
  const optionNames = new Map<string, LineView['options']>();
  if (optionIds.length > 0) {
    const { rows } = await db.query<{ id: string; name_en: string; name_hi: string }>(
      `SELECT id, name_en, name_hi FROM items WHERE id = ANY($1::uuid[])`,
      [optionIds],
    );
    for (const r of rows)
      optionNames.set(r.id, [{ itemId: r.id, nameEn: r.name_en, nameHi: r.name_hi }]);
  }
  const askedRows = await db.query<{ position: number; n: number }>(
    `SELECT ll.position, count(*)::int AS n
       FROM list_ping_lines lpl
       JOIN list_pings lp ON lp.id = lpl.list_ping_id
       JOIN list_lines ll ON ll.id = lpl.line_id
      WHERE lp.list_id = $1 GROUP BY ll.position`,
    [list.id],
  );
  const askedBy = new Map(askedRows.rows.map((r) => [r.position, r.n]));
  const counts = (
    await db.query<{ asked: number; answered: number }>(
      `SELECT count(*)::int AS asked, count(*) FILTER (WHERE state = 'ANSWERED')::int AS answered
         FROM list_pings WHERE list_id = $1`,
      [list.id],
    )
  ).rows[0] as { asked: number; answered: number };

  const stored = list.state === 'DRAFT' ? [] : await storedAnswers(db, list.id);
  const positions = sendable(lines).map((l) => l.position);
  const answers: AnswerView[] = rankAnswers(
    stored.map((a) => ({
      a,
      haveCount: a.have.size,
      distanceM: a.distanceM,
      totalPaise: [...a.have.values()].reduce((sum, p) => sum + p, 0),
    })),
  ).map(({ a, haveCount, totalPaise }) => ({
    shopId: a.shopId,
    name: a.name,
    logoUrl: a.logoUrl,
    distanceM: a.distanceM,
    lat: a.lat,
    lng: a.lng,
    haveCount,
    totalPaise,
    canDeliver: a.canDeliver,
    deliveryFeePaise: a.deliveryFeePaise,
    answeredAt: a.answeredAt.toISOString(),
    lines: positions.map((position) => {
      const price = a.have.get(position);
      return price !== undefined
        ? { position, status: 'have' as const, pricePaise: price }
        : { position, status: a.sent.has(position) ? ('no' as const) : ('not_sent' as const) };
    }),
  }));

  let plan: PlanView | null = null;
  if (list.state !== 'DRAFT' && list.lat !== null && list.lng !== null) {
    const shops: CoverShop[] = stored
      .filter((a) => a.have.size > 0)
      .map((a) => ({ shopId: a.shopId, lat: a.lat, lng: a.lng, have: a.have }));
    const cover: CoverPlan = bestCover({ lat: list.lat, lng: list.lng }, shops, positions);
    const byId = new Map(stored.map((a) => [a.shopId, a]));
    plan = {
      assignments: cover.assignments,
      stops: cover.stops.map((shopId) => {
        const a = byId.get(shopId) as StoredAnswer;
        return { shopId, name: a.name, lat: a.lat, lng: a.lng };
      }),
      totalM: Math.round(cover.totalM),
      totalPaise: cover.totalPaise,
      missing: cover.missing,
    };
  }

  return {
    id: list.id,
    state: list.state,
    listening: list.state === 'OPEN',
    binding: isLive(list.state),
    wantsDelivery: list.wants_delivery,
    lat: list.lat,
    lng: list.lng,
    maxAnswers: MAX_LIST_ANSWERS,
    shopsAsked: counts.asked,
    shopsAnswered: counts.answered,
    lines: lines.map((l) => lineView(l, askedBy.get(l.position) ?? 0, optionNames)),
    answers,
    plan,
    createdAt: list.created_at.toISOString(),
    sentAt: list.sent_at ? list.sent_at.toISOString() : null,
    expiresAt: list.expires_at.toISOString(),
  };
}

export async function viewOf(db: Queryable, id: string): Promise<ListView | null> {
  const list = await findList(db, id);
  return list ? buildView(db, list) : null;
}
