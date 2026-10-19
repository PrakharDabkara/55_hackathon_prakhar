import type { Queryable } from '../../db/queryable.js';
import { ApiError } from '../../http/errors.js';
import { normaliseQuery } from './normalise.js';
import {
  getItem,
  resolveItem,
  similarItems,
  type CatalogItem,
  type Resolution,
  type ResolveOptions,
} from './resolve.js';

const option = (i: CatalogItem) => ({ itemId: i.id, nameEn: i.nameEn, nameHi: i.nameHi });

/**
 * What POST /requests and GET /search do with the customer's text. If the customer already picked
 * an item (`itemId`, from an earlier question) resolution is skipped. If the text could be several
 * different items the answer is 422 item_ambiguous with the question and the options. Anything
 * else unresolved comes back as `item: null` for the caller to decide.
 *
 * With `confirm` (a plain search, before any shop is asked) a match that is not certain is a
 * question too: 422 item_confirm with the understood item and up to two alternatives. Certain
 * means an exact catalog name or synonym; a new item made from the customer's own words is theirs
 * already, so it is not asked about either. A cached answer is never exact, since only embedding
 * and model answers are cached (ADR-0036).
 */
export async function resolveForCustomer(
  db: Queryable,
  q: string,
  opts: ResolveOptions & { itemId?: string | undefined; confirm?: boolean },
): Promise<Resolution> {
  if (opts.itemId) {
    const item = await getItem(db, opts.itemId);
    if (!item) throw new ApiError(404, 'item_not_found', 'No such item');
    const { text, quantity } = normaliseQuery(q);
    return {
      normalised: text,
      ...(quantity && { quantity }),
      item,
      matchedBy: null,
      similarity: 1,
    };
  }

  const resolution = await resolveItem(db, q, opts);
  if (resolution.ambiguous) {
    if (opts.confirm) shown(opts, 'ambiguous');
    throw new ApiError(422, 'item_ambiguous', 'Which of these do you mean?', {
      question: resolution.ambiguous.question,
      options: resolution.ambiguous.options,
    });
  }
  const { item, matchedBy } = resolution;
  if (opts.confirm && item && matchedBy !== 'synonym' && matchedBy !== 'new_item') {
    const alternatives = resolution.alternatives?.length
      ? resolution.alternatives
      : await similarItems(db, resolution.normalised, item.id);
    shown(opts, 'confirm');
    throw new ApiError(422, 'item_confirm', 'Do you mean this?', {
      item: option(item),
      alternatives: alternatives.slice(0, 2).map(option),
    });
  }
  return resolution;
}

/** The metric: how often the customer is asked what they meant (counted by event name). */
function shown(opts: ResolveOptions, kind: 'confirm' | 'ambiguous'): void {
  opts.logger?.info(
    { event: 'understanding_shown', kind, requestId: opts.requestId },
    'asked the customer what they meant',
  );
}
