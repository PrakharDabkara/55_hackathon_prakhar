import type { Queryable } from '../../db/queryable.js';
import { ApiError } from '../../http/errors.js';
import { normaliseQuery } from './normalise.js';
import { getItem, resolveItem, type Resolution, type ResolveOptions } from './resolve.js';

/**
 * What POST /requests and GET /search do with the customer's text. If the customer already picked
 * an item (`itemId`, from an earlier question) resolution is skipped. If the text could be several
 * different items the answer is 422 item_ambiguous with the question and the options. Anything
 * else unresolved comes back as `item: null` for the caller to decide.
 */
export async function resolveForCustomer(
  db: Queryable,
  q: string,
  opts: ResolveOptions & { itemId?: string | undefined },
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
    throw new ApiError(422, 'item_ambiguous', 'Which of these do you mean?', {
      question: resolution.ambiguous.question,
      options: resolution.ambiguous.options,
    });
  }
  return resolution;
}
