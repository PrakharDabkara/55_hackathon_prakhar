import type { Queryable } from '../../db/queryable.js';
import {
  AiUnavailableError,
  buildResolvePrompt,
  resolveAnswerSchema,
  validateAnswer,
  type AiContext,
  type Candidate,
} from '../ai/index.js';
import { normaliseQuery, type Quantity } from './normalise.js';
import {
  hasEmbeddings,
  itemsByIds,
  nearestItems,
  readCache,
  suggestSynonym,
  writeCache,
  type ItemRow,
} from './resolveSteps.js';

export interface CatalogItem {
  id: string;
  slug: string;
  nameEn: string;
  nameHi: string;
  category: string;
}

/** Several words: a rival item this close to the best match makes the match a coin toss. */
const AMBIGUITY_MARGIN = 0.1;

/** How many candidates the trigram and embedding steps each offer, and the most the LLM is shown. */
const CANDIDATES_PER_STEP = 5;
const MAX_SHORTLIST = 10;
const LLM_MAX_OUTPUT_TOKENS = 300;

export type MatchedBy = 'cache' | 'synonym' | 'trigram' | 'embedding' | 'llm';

export interface AmbiguousChoice {
  question: string;
  options: { itemId: string; nameEn: string; nameHi: string }[];
}

export interface Resolution {
  normalised: string;
  quantity?: Quantity;
  item: CatalogItem | null;
  /** Which step answered. For an ambiguous query: the step that asked. Null when unresolved. */
  matchedBy: MatchedBy | null;
  /** 1 for an exact synonym or the cache, the similarity for a fuzzy match, 0 when unresolved. */
  similarity: number;
  /** Set when the customer must choose between genuinely different items. */
  ambiguous?: AmbiguousChoice;
}

export interface ResolveOptions {
  userId?: string | null;
  threshold: number;
  /** Embeddings and the LLM. Without it only the free steps run. */
  ai?: AiContext;
  /** Joins the AI audit rows to the HTTP request that caused them. */
  requestId?: string;
}

const toItem = (r: ItemRow): CatalogItem => ({
  id: r.id,
  slug: r.slug,
  nameEn: r.name_en,
  nameHi: r.name_hi,
  category: r.category,
});

const toCandidate = (r: ItemRow): Candidate => ({
  id: r.id,
  nameEn: r.name_en,
  nameHi: r.name_hi,
  category: r.category,
});

interface Found {
  item: CatalogItem | null;
  matchedBy: MatchedBy | null;
  similarity: number;
  ambiguous?: AmbiguousChoice;
}

const choiceFor = async (
  db: Queryable,
  question: string,
  ids: string[],
): Promise<AmbiguousChoice> => ({
  question,
  options: (await itemsByIds(db, ids)).map((r) => ({
    itemId: r.id,
    nameEn: r.name_en,
    nameHi: r.name_hi,
  })),
});

/**
 * Text → catalog item, cheapest path first (ADR-0021):
 * cache, exact synonym, trigram, embeddings, LLM; else unresolved. The AI steps are optional and
 * can only fail soft: any AI problem leaves the query unresolved, never an error. Every call
 * writes a search_queries row recording which step answered.
 */
export async function resolveItem(
  db: Queryable,
  raw: string,
  opts: ResolveOptions,
): Promise<Resolution> {
  const { text, quantity } = normaliseQuery(raw);
  const found = text
    ? await findItem(db, text, opts)
    : { item: null, matchedBy: null, similarity: 0 };

  await db.query(
    `INSERT INTO search_queries (user_id, raw_text, normalised, item_id, matched_by)
     VALUES ($1, $2, $3, $4, $5)`,
    [opts.userId ?? null, raw, text, found.item?.id ?? null, found.matchedBy],
  );
  return { normalised: text, ...(quantity && { quantity }), ...found };
}

async function findItem(db: Queryable, text: string, opts: ResolveOptions): Promise<Found> {
  const none: Found = { item: null, matchedBy: null, similarity: 0 };

  // a) A query we have answered before.
  const hit = await readCache(db, text);
  if (hit) {
    if (hit.itemId) {
      const item = (await itemsByIds(db, [hit.itemId]))[0];
      if (item) return { item: toItem(item), matchedBy: 'cache', similarity: 1 };
    } else if (hit.optionIds && hit.question) {
      return {
        item: null,
        matchedBy: 'cache',
        similarity: 0,
        ambiguous: await choiceFor(db, hit.question, hit.optionIds),
      };
    } else {
      return { ...none, matchedBy: 'cache' };
    }
  }

  // b) An exact synonym.
  const exact = await db.query<ItemRow>(
    `SELECT i.id, i.slug, i.name_en, i.name_hi, i.category
       FROM item_synonyms s JOIN items i ON i.id = s.item_id
      WHERE s.term = $1`,
    [text],
  );
  if (exact.rows[0]) return { item: toItem(exact.rows[0]), matchedBy: 'synonym', similarity: 1 };

  // c) Trigram similarity. `%` lets the GIN index prefilter (at pg_trgm's default 0.3); the
  // threshold is applied below. One best term per item, so we can tell "one clear item" from
  // "several plausible items". The weaker candidates are kept as the LLM's shortlist.
  const fuzzy = await db.query<ItemRow>(
    `SELECT * FROM (
       SELECT DISTINCT ON (i.id) i.id, i.slug, i.name_en, i.name_hi, i.category,
              s.term, similarity(s.term, $1) AS sim
         FROM item_synonyms s JOIN items i ON i.id = s.item_id
        WHERE s.term % $1
        ORDER BY i.id, sim DESC
     ) best
     ORDER BY sim DESC, slug
     LIMIT $2`,
    [text, CANDIDATES_PER_STEP],
  );
  // Unresolved when the match is not clear-cut. A wrong guess costs the user more than asking again.
  // - One word ("tape", "nail"): any second item at or above the threshold is too close, and a
  //   word that only resembles part of a longer phrase ("band" vs "rubber band") is no typo.
  // - Several words ("switch board"): a second item scoring within 0.1 of the best is too close.
  const [best, second] = fuzzy.rows.filter((r) => (r.sim ?? 0) >= opts.threshold);
  const oneWord = !text.includes(' ');
  const trigramUnsure = oneWord
    ? Boolean(second) || (best?.term ?? '').includes(' ')
    : Boolean(best && second && (second.sim ?? 0) >= (best.sim ?? 0) - AMBIGUITY_MARGIN);
  if (best && !trigramUnsure)
    return { item: toItem(best), matchedBy: 'trigram', similarity: best.sim ?? 0 };

  const ai = opts.ai;
  if (!ai) return none;

  // d) Embeddings: the closest items by meaning. Skipped if the catalog has none yet.
  let nearest: ItemRow[] = [];
  if (await hasEmbeddings(db)) {
    try {
      const { vectors } = await ai.client.embed([text], 'embed_query', opts.requestId);
      nearest = await nearestItems(db, vectors[0] as number[], CANDIDATES_PER_STEP);
    } catch (error) {
      if (!(error instanceof AiUnavailableError)) throw error;
    }
  }
  const [top, runnerUp] = nearest;
  if (
    top &&
    (top.sim ?? 0) >= ai.embedThreshold &&
    (!runnerUp || (top.sim ?? 0) - (runnerUp.sim ?? 0) >= ai.embedMargin)
  ) {
    await writeCache(db, text, 'embedding', { itemId: top.id, question: null, optionIds: null });
    return { item: toItem(top), matchedBy: 'embedding', similarity: top.sim ?? 0 };
  }

  // e) The LLM, shown a shortlist of at most 10 items from the two steps above.
  const shortlistRows = new Map<string, ItemRow>();
  for (const row of [...nearest, ...fuzzy.rows]) {
    if (shortlistRows.size < MAX_SHORTLIST && !shortlistRows.has(row.id))
      shortlistRows.set(row.id, row);
  }
  if (shortlistRows.size === 0) return none;
  if (opts.userId && !(await ai.limiter.allow(opts.userId))) return none;
  return askLlm(db, ai, text, [...shortlistRows.values()], opts.requestId);
}

async function askLlm(
  db: Queryable,
  ai: AiContext,
  text: string,
  shortlist: ItemRow[],
  requestId: string | undefined,
): Promise<Found> {
  const none: Found = { item: null, matchedBy: null, similarity: 0 };
  const candidates = shortlist.map(toCandidate);
  const { system, user } = buildResolvePrompt(text, candidates);

  let result;
  try {
    result = await ai.client.generateJson({
      system,
      user,
      schema: resolveAnswerSchema,
      maxOutputTokens: LLM_MAX_OUTPUT_TOKENS,
      purpose: 'resolve_query',
      ...(requestId && { requestId }),
    });
  } catch (error) {
    if (error instanceof AiUnavailableError) return none;
    throw error;
  }

  const verdict = validateAnswer(result.data, candidates);
  if (verdict.kind === 'invalid') {
    await ai.client.markInvalid(result.callId);
    return none;
  }
  if (verdict.kind === 'item') {
    const row = shortlist.find((r) => r.id === verdict.itemId) as ItemRow;
    await writeCache(db, text, 'llm', { itemId: row.id, question: null, optionIds: null });
    await suggestSynonym(db, text, row.id);
    return { item: toItem(row), matchedBy: 'llm', similarity: 0 };
  }
  if (verdict.kind === 'none') {
    await writeCache(db, text, 'llm', { itemId: null, question: null, optionIds: null });
    return none;
  }
  await writeCache(db, text, 'llm', {
    itemId: null,
    question: verdict.question,
    optionIds: verdict.optionIds,
  });
  return {
    item: null,
    matchedBy: 'llm',
    similarity: 0,
    ambiguous: await choiceFor(db, verdict.question, verdict.optionIds),
  };
}

/** One catalog item by id, or null. */
/** The AI-estimated shelf price of the item's usual pack, in paise, or null if the item has none. */
export async function getRefPricePaise(db: Queryable, itemId: string): Promise<number | null> {
  const { rows } = await db.query<{ ref_price_paise: number | null }>(
    `SELECT ref_price_paise FROM items WHERE id = $1`,
    [itemId],
  );
  return rows[0]?.ref_price_paise ?? null;
}

export async function getItem(db: Queryable, id: string): Promise<CatalogItem | null> {
  const { rows } = await db.query<ItemRow>(
    `SELECT id, slug, name_en, name_hi, category FROM items WHERE id = $1`,
    [id],
  );
  return rows[0] ? toItem(rows[0]) : null;
}
