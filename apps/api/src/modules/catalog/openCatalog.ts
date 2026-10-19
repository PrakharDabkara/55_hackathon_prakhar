import type { Logger } from 'pino';
import { ApiError } from '../../http/errors.js';
import type { Queryable } from '../../db/queryable.js';
import { AiUnavailableError, looksLikeInstruction, type AiContext } from '../ai/index.js';
import {
  checkDenyList,
  classifyNewItem,
  overNewItemLimit,
  recordNewItemAttempt,
  type LimitScope,
} from '../safety/index.js';
import { checkProductName } from './itemSanity.js';
import { formConflict } from './productForm.js';
import { cleanItemName, slugForUserItem } from './itemName.js';
import { firstLine } from './normalise.js';
import type { ItemRow } from './resolveSteps.js';

/** Why a text that looks like a product was not turned into an item (ADR-0028, ADR-0029). */
export type Refusal =
  { reason: 'blocked' } | { reason: 'unavailable' } | { reason: 'limit'; scope: LimitScope };

export type UserItemOutcome =
  | { kind: 'item'; row: ItemRow; created: boolean }
  /** Nonsense or not fit to store: stays "not found", nothing is created. */
  | { kind: 'none' }
  | { kind: 'refused'; refusal: Refusal };

/** Two names this alike are the same product: reuse the existing item instead of creating one. */
const DEDUPE_SIMILARITY = 0.8;

const COLUMNS = `i.id, i.slug, i.name_en, i.name_hi, i.category, i.categories, i.unverified`;

async function findExisting(db: Queryable, text: string): Promise<ItemRow[]> {
  const { rows } = await db.query<ItemRow>(
    `SELECT * FROM (
       SELECT DISTINCT ON (i.id) ${COLUMNS}, s.term, similarity(s.term, $1) AS sim
         FROM item_synonyms s JOIN items i ON i.id = s.item_id
        WHERE s.term % $1 OR s.term = $1
        ORDER BY i.id, sim DESC
     ) best
     WHERE sim >= $2
     ORDER BY sim DESC, slug
     LIMIT 5`,
    [text, DEDUPE_SIMILARITY],
  );
  return rows;
}

export interface CreateOptions {
  userId: string;
  /** The errand the item is for, if any: five new items at most per errand. */
  errandId?: string | null | undefined;
  requestId?: string | undefined;
  logger?: Logger | undefined;
  /** How sure the classifier must be that it is a real product; "medium" when a person confirmed it. */
  minConfidence?: 'high' | 'medium';
}

/**
 * The text the catalog could not place: nonsense, a blocked item, or a real product we do not know
 * yet (ADR-0028). Only the last becomes an item. Order: name hygiene, deny list (layer 1, free),
 * dedupe against every item, the per-errand and per-day limits, the per-user AI limiter, then the
 * model (layer 2: blocked, nonsense, or allowed with a category from the fixed list). Any doubt
 * ends in "none" or a refusal, never in an item. `text` is the normalised query.
 */
export async function createUserItem(
  db: Queryable,
  ai: AiContext,
  raw: string,
  text: string,
  opts: CreateOptions,
): Promise<UserItemOutcome> {
  const name = cleanItemName(raw);
  if (!name) return { kind: 'none' };

  // Layer 1 first and before anything else, so a blocked text costs no model call and reaches no model.
  const denied = checkDenyList(text);
  if (denied) return blocked(db, opts, denied.rule, 'deny_list');
  if (looksLikeInstruction(firstLine(raw).toLowerCase())) return { kind: 'none' };

  const fits = (row: ItemRow) => !formConflict(text, [row.name_en, row.name_hi]);
  const existing = (await findExisting(db, text)).find(fits);
  if (existing) return { kind: 'item', row: existing, created: false };

  // Not a product, by code alone: random, mash, a sentence, a vehicle or a phone itself. Free.
  if (!checkProductName(text).ok) return { kind: 'none' };

  const over = await overNewItemLimit(db, opts);
  if (over) return { kind: 'refused', refusal: { reason: 'limit', scope: over } };
  if (!(await ai.limiter.allow(opts.userId))) return unavailable();

  let verdict;
  try {
    verdict = await classifyNewItem(ai, text, opts.requestId, {
      minConfidence: opts.minConfidence ?? 'high',
    });
  } catch (error) {
    if (error instanceof AiUnavailableError) return unavailable();
    throw error;
  }
  if (verdict.verdict === 'nonsense' || verdict.verdict === 'unsure') return { kind: 'none' };
  if (verdict.verdict === 'blocked') return blocked(db, opts, 'classifier', 'classifier');

  const slug = slugForUserItem(text);
  const inserted = await db.query<ItemRow>(
    `INSERT INTO items (slug, name_en, name_hi, category, categories, source, unverified, created_by)
     VALUES ($1, $2, $2, $3, ARRAY[$3], 'user', true, $4)
     ON CONFLICT (slug) DO NOTHING
     RETURNING id, slug, name_en, name_hi, category, categories, unverified`,
    [slug, name, verdict.category, opts.userId],
  );
  let row = inserted.rows[0];
  if (!row) {
    // A parallel request created the same item a moment ago: use it.
    const { rows } = await db.query<ItemRow>(`SELECT ${COLUMNS} FROM items i WHERE slug = $1`, [
      slug,
    ]);
    return { kind: 'item', row: rows[0] as ItemRow, created: false };
  }
  await db.query(
    `INSERT INTO item_synonyms (term, item_id) VALUES ($1, $2) ON CONFLICT (term) DO NOTHING`,
    [text, row.id],
  );
  await recordNewItemAttempt(db, {
    userId: opts.userId,
    errandId: opts.errandId,
    outcome: 'created',
  });
  opts.logger?.info(
    { event: 'new_item_created', requestId: opts.requestId, category: verdict.category },
    'new item created',
  );
  row = { ...row };
  return { kind: 'item', row, created: true };
}

async function blocked(
  db: Queryable,
  opts: CreateOptions,
  rule: string,
  layer: 'deny_list' | 'classifier',
): Promise<UserItemOutcome> {
  await recordNewItemAttempt(db, {
    userId: opts.userId,
    errandId: opts.errandId,
    outcome: 'blocked',
    rule,
  });
  // The fact and the rule, never the text.
  opts.logger?.warn(
    { event: 'new_item_blocked', requestId: opts.requestId, layer, rule },
    'new item blocked',
  );
  return { kind: 'refused', refusal: { reason: 'blocked' } };
}

const unavailable = (): UserItemOutcome => ({
  kind: 'refused',
  refusal: { reason: 'unavailable' },
});

/** The API error for a refusal: what the customer is told, in the words the screens use (ADR-0029). */
export function refusalError(refusal: Refusal): ApiError {
  switch (refusal.reason) {
    case 'blocked':
      return new ApiError(422, 'item_blocked', 'Ye cheez hum dukaanon ko nahi bhej sakte');
    case 'unavailable':
      return new ApiError(503, 'item_unavailable', 'Abhi ye cheez dukaanon ko nahi bhej sakte');
    case 'limit':
      return new ApiError(
        429,
        'new_item_limit',
        refusal.scope === 'errand'
          ? 'Ek kaam mein 5 se zyada nayi cheezein nahi pooch sakte'
          : 'Aaj ke liye nayi cheezon ki limit poori ho gayi, kal phir koshish karein',
        { scope: refusal.scope },
      );
  }
}
