import type { Queryable } from '../../db/queryable.js';
import type { ListState } from './types.js';

export interface ListRow {
  id: string;
  user_id: string;
  state: ListState;
  lat: number | null;
  lng: number | null;
  radius_m: number | null;
  wants_delivery: boolean;
  delivery_address_id: string | null;
  expires_at: Date;
  created_at: Date;
  sent_at: Date | null;
  /** Past its deadline by the database clock. */
  overdue: boolean;
}

const SELECT = `SELECT id, user_id, state, ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng,
       radius_m, wants_delivery, delivery_address_id, expires_at, created_at, sent_at,
       (expires_at <= now()) AS overdue
  FROM shopping_lists`;

export async function findList(db: Queryable, id: string): Promise<ListRow | null> {
  const { rows } = await db.query<ListRow>(`${SELECT} WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

/** The list row, locked for the rest of the transaction: every change to a list goes through this lock. */
export async function lockList(tx: Queryable, id: string): Promise<ListRow | null> {
  const { rows } = await tx.query<ListRow>(`${SELECT} WHERE id = $1 FOR UPDATE`, [id]);
  return rows[0] ?? null;
}

export interface LineRow {
  id: string;
  position: number;
  text: string;
  status: 'item' | 'ambiguous' | 'other' | 'refused';
  item_id: string | null;
  matched_alias: string | null;
  quantity: { quantity: number; unit: string } | null;
  question: string | null;
  options: string[] | null;
  as_typed: boolean;
  refused_reason: 'blocked' | 'unclear' | null;
  slug: string | null;
  name_en: string | null;
  name_hi: string | null;
  category: string | null;
  categories: string[] | null;
  ref_price_paise: number | null;
}

export async function listLines(db: Queryable, listId: string): Promise<LineRow[]> {
  const { rows } = await db.query<LineRow>(
    `SELECT ll.id, ll.position, ll.text, ll.status, ll.item_id, ll.matched_alias, ll.quantity,
            ll.question, ll.options, ll.as_typed, ll.refused_reason,
            i.slug, i.name_en, i.name_hi, i.category, i.categories, i.ref_price_paise
       FROM list_lines ll LEFT JOIN items i ON i.id = ll.item_id
      WHERE ll.list_id = $1 ORDER BY ll.position`,
    [listId],
  );
  return rows;
}

export interface WithdrawnPing {
  id: string;
  ownerUserId: string | null;
}

/** Parchis still waiting become NO_REPLY. Call it inside the transaction that ends their need. */
export async function withdrawParchis(tx: Queryable, listId: string): Promise<WithdrawnPing[]> {
  const { rows } = await tx.query<{ id: string; owner_user_id: string | null }>(
    `UPDATE list_pings lp SET state = 'NO_REPLY'
       FROM shops s
      WHERE lp.list_id = $1 AND lp.state = 'SENT' AND s.id = lp.shop_id
      RETURNING lp.id, s.owner_user_id`,
    [listId],
  );
  return rows.map((r) => ({ id: r.id, ownerUserId: r.owner_user_id }));
}

/**
 * Ends a live list whose deadline passed (OPEN or FULL to EXPIRED) and withdraws its open parchis.
 * Under the list's row lock, so of any number of callers one ends it. Returns what it withdrew, or
 * null when the list was not due.
 */
export async function expireListIn(tx: Queryable, id: string): Promise<WithdrawnPing[] | null> {
  const row = await lockList(tx, id);
  if (!row || !row.overdue || (row.state !== 'OPEN' && row.state !== 'FULL')) return null;
  await tx.query(
    `UPDATE shopping_lists SET state = 'EXPIRED', closed_at = now(), updated_at = now() WHERE id = $1`,
    [id],
  );
  return withdrawParchis(tx, id);
}
