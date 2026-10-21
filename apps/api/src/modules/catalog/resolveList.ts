import type { Logger } from 'pino';
import { LIST_MAX_OPTIONS } from '@askbuy/shared';
import type { Queryable } from '../../db/queryable.js';
import {
  AiUnavailableError,
  buildListResolvePrompt,
  looksLikeInstruction,
  resolveListAnswerSchema,
  validateAnswer,
  type AiContext,
  type Candidate,
} from '../ai/index.js';
import { checkDenyList } from '../safety/index.js';
import { cleanItemName } from './itemName.js';
import { checkProductName } from './itemSanity.js';
import { formConflict } from './productForm.js';
import { firstLine, normaliseQuery, type Quantity } from './normalise.js';
import {
  acceptEmbedding,
  findItem,
  toItem,
  withoutModifierOnly,
  type CatalogItem,
  type Found,
} from './resolve.js';
import {
  hasEmbeddings,
  itemsByIds,
  nearestItems,
  suggestSynonym,
  writeCache,
  type ItemRow,
} from './resolveSteps.js';
import { CATALOG_VERSION } from './seed.js';

/** How one line of a shopping list was understood (ADR-0055). */
export type ListLineResolution = { quantity?: Quantity } & (
  | { kind: 'item'; item: CatalogItem; matchedAlias?: string }
  | {
      kind: 'ambiguous';
      question: string;
      options: { itemId: string; nameEn: string; nameHi: string }[];
    }
  /** No kind of shop owns it, or nothing fits: text only, asked of the nearest shops. */
  | { kind: 'other' }
  | { kind: 'refused'; reason: 'blocked' | 'unclear' }
);

export interface ResolveLinesOptions {
  userId: string;
  threshold: number;
  /** Embeddings and the LLM. Without it only the free steps run. */
  ai?: AiContext | undefined;
  requestId?: string | undefined;
  logger?: Logger | undefined;
}

const CANDIDATES_PER_STEP = 5;
const MAX_SHORTLIST = 10;
/** Room for ten lines: the single-search limit of 300 is for one answer. */
const LLM_MAX_OUTPUT_TOKENS = 1200;
/** The most words of a line the model may ask the customer about. */
const MAX_QUESTION_WORDS = 3;

const toCandidate = (r: ItemRow): Candidate => ({
  id: r.id,
  nameEn: r.name_en,
  nameHi: r.name_hi,
  category: r.category,
});

interface Pending {
  index: number;
  text: string;
  fuzzy: ItemRow[];
  considered: number;
  similar: number;
  nearest: ItemRow[];
}

const option = (r: { id: string; name_en: string; name_hi: string }) => ({
  itemId: r.id,
  nameEn: r.name_en,
  nameHi: r.name_hi,
});

/**
 * Understands the lines of a shopping list with the single search's own rules (ADR-0055): the free
 * steps (cache, everyday words, exact synonym, trigram, default) per line, then ONE embedding
 * request for the lines still unplaced and ONE model call for those with a shortlist. A line
 * the code refuses (deny list, instruction, not a product name) reaches no model. An unknown line
 * is "other"; a model outage leaves the lines it would have placed "other" too. Never throws for
 * a line, never creates a catalog item.
 */
export async function resolveLines(
  db: Queryable,
  lines: string[],
  opts: ResolveLinesOptions,
): Promise<ListLineResolution[]> {
  const out: (ListLineResolution | undefined)[] = lines.map(() => undefined);
  const pending: Pending[] = [];

  for (const [index, raw] of lines.entries()) {
    const query = firstLine(raw);
    const { text, quantity } = normaliseQuery(query);
    const withQuantity = <T extends ListLineResolution>(r: T): T =>
      quantity ? { ...r, quantity } : r;
    if (!text) {
      out[index] = { kind: 'refused', reason: 'unclear' };
      continue;
    }
    const found = await findItem(
      db,
      text,
      { userId: opts.userId, threshold: opts.threshold },
      query,
      { stopBeforeAi: true },
    );
    if (found.item) {
      out[index] = withQuantity({
        kind: 'item',
        item: found.item,
        ...(found.matchedAlias && { matchedAlias: found.matchedAlias }),
      });
      await log(db, opts.userId, raw, text, found);
      continue;
    }
    if (found.ambiguous) {
      out[index] = {
        kind: 'ambiguous',
        question: found.ambiguous.question,
        options: found.ambiguous.options.slice(0, LIST_MAX_OPTIONS),
      };
      await log(db, opts.userId, raw, text, found);
      continue;
    }

    // Nothing in the catalog. The code checks come before any model: a refused line reaches none.
    if (checkDenyList(text)) {
      out[index] = { kind: 'refused', reason: 'blocked' };
      continue;
    }
    if (
      looksLikeInstruction(query.toLowerCase()) ||
      cleanItemName(raw) === null ||
      !checkProductName(text).ok
    ) {
      out[index] = { kind: 'refused', reason: 'unclear' };
      continue;
    }
    out[index] = withQuantity({ kind: 'other' });
    await log(db, opts.userId, raw, text, found);
    if (found.pendingAi) pending.push({ index, text, nearest: [], ...found.pendingAi });
  }

  if (opts.ai && pending.length > 0) await placeWithAi(db, opts.ai, opts, pending, out);
  return out as ListLineResolution[];
}

async function log(db: Queryable, userId: string, raw: string, text: string, found: Found) {
  await db.query(
    `INSERT INTO search_queries (user_id, raw_text, normalised, item_id, matched_by)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, raw, text, found.item?.id ?? null, found.matchedBy],
  );
}

/** One embedding request, then one model call, for every line the free steps could not place. */
async function placeWithAi(
  db: Queryable,
  ai: AiContext,
  opts: ResolveLinesOptions,
  pending: Pending[],
  out: (ListLineResolution | undefined)[],
): Promise<void> {
  const withQuantity = (index: number, r: ListLineResolution): ListLineResolution => {
    const quantity = (out[index] as { quantity?: Quantity } | undefined)?.quantity;
    return quantity ? { ...r, quantity } : r;
  };
  const fits = (text: string) => (row: ItemRow) => !formConflict(text, [row.name_en, row.name_hi]);

  // d) Embeddings: ONE request for all the lines.
  if (await hasEmbeddings(db)) {
    try {
      const { vectors } = await ai.client.embed(
        pending.map((p) => p.text),
        'embed_query',
        opts.requestId,
      );
      for (const [i, p] of pending.entries()) {
        p.nearest = await withoutModifierOnly(
          db,
          p.text,
          (await nearestItems(db, vectors[i] as number[], CANDIDATES_PER_STEP)).filter(
            fits(p.text),
          ),
        );
      }
    } catch (error) {
      if (!(error instanceof AiUnavailableError)) throw error;
    }
  }
  const unplaced: Pending[] = [];
  for (const p of pending) {
    const top = acceptEmbedding(p.nearest, p, ai);
    if (top) {
      await writeCache(
        db,
        p.text,
        'embedding',
        { itemId: top.id, question: null, optionIds: null },
        CATALOG_VERSION,
      );
      out[p.index] = withQuantity(p.index, { kind: 'item', item: toItem(top) });
    } else unplaced.push(p);
  }

  // e) The model: ONE call with a shortlist per line.
  const shortlists = new Map<Pending, ItemRow[]>();
  for (const p of unplaced) {
    const list = new Map<string, ItemRow>();
    for (const row of [...p.nearest, ...p.fuzzy])
      if (list.size < MAX_SHORTLIST && !list.has(row.id)) list.set(row.id, row);
    if (list.size > 0) shortlists.set(p, [...list.values()]);
  }
  if (shortlists.size === 0) return;
  if (!(await ai.limiter.allow(opts.userId))) return;

  const asked = [...shortlists.entries()];
  const { system, user } = buildListResolvePrompt(
    asked.map(([p, rows], n) => ({ n, text: p.text, candidates: rows.map(toCandidate) })),
  );
  let result;
  try {
    result = await ai.client.generateJson({
      system,
      user,
      schema: resolveListAnswerSchema,
      maxOutputTokens: LLM_MAX_OUTPUT_TOKENS,
      purpose: 'resolve_query',
      ...(opts.requestId && { requestId: opts.requestId }),
    });
  } catch (error) {
    if (error instanceof AiUnavailableError) return;
    throw error;
  }

  const answers = new Map(result.data.lines.map((l) => [l.n, l]));
  let invalid = false;
  for (const [n, [p, rows]] of asked.entries()) {
    const answer = answers.get(n);
    if (!answer) {
      invalid = true;
      continue;
    }
    if (answer.blocked === true) {
      out[p.index] = { kind: 'refused', reason: 'blocked' };
      opts.logger?.warn(
        { event: 'list_line_blocked', requestId: opts.requestId },
        'list line blocked',
      );
      continue;
    }
    if (answer.notProduct === true) {
      out[p.index] = { kind: 'refused', reason: 'unclear' };
      continue;
    }
    // Each answer is checked against ITS line's own shortlist: an id it was not offered is dropped.
    const verdict = validateAnswer(
      {
        itemId: answer.itemId,
        needsClarification: answer.needsClarification,
        ...(answer.question !== undefined && { question: answer.question }),
        ...(answer.optionIds && { optionIds: answer.optionIds }),
      },
      rows.map(toCandidate),
    );
    if (verdict.kind === 'invalid') {
      invalid = true;
      continue;
    }
    if (verdict.kind === 'item') {
      const row = rows.find((r) => r.id === verdict.itemId) as ItemRow;
      if (!fits(p.text)(row)) continue;
      await writeCache(
        db,
        p.text,
        'llm',
        { itemId: row.id, question: null, optionIds: null },
        CATALOG_VERSION,
      );
      await suggestSynonym(db, p.text, row.id);
      out[p.index] = withQuantity(p.index, { kind: 'item', item: toItem(row) });
      continue;
    }
    if (verdict.kind === 'none' || p.text.split(' ').length > MAX_QUESTION_WORDS) {
      await writeCache(
        db,
        p.text,
        'llm',
        { itemId: null, question: null, optionIds: null },
        CATALOG_VERSION,
      );
      continue;
    }
    const ids = verdict.optionIds.slice(0, LIST_MAX_OPTIONS);
    await writeCache(
      db,
      p.text,
      'llm',
      { itemId: null, question: verdict.question, optionIds: ids },
      CATALOG_VERSION,
    );
    out[p.index] = {
      kind: 'ambiguous',
      question: verdict.question,
      options: (await itemsByIds(db, ids)).map(option),
    };
  }
  if (invalid) await ai.client.markInvalid(result.callId);
}
