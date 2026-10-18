import { Router } from 'express';
import type { Logger } from 'pino';
import { z } from 'zod';
import type { Queryable } from '../../db/queryable.js';
import { parse } from '../../http/errors.js';
import type { AiContext } from '../ai/index.js';
import { resolveForCustomer } from '../catalog/index.js';
import { authOf, createRequireAuth } from '../identity/index.js';
import { findLearnedStock } from '../shops/index.js';

const DEFAULT_RADIUS_M = 2000;
const MAX_RADIUS_M = 5000;

const query = z
  .object({
    q: z.string().trim().min(1).max(200).optional(),
    lat: z.coerce.number().min(-90).max(90),
    lng: z.coerce.number().min(-180).max(180),
    radius_m: z.coerce.number().int().min(1).max(MAX_RADIUS_M).default(DEFAULT_RADIUS_M),
    itemId: z.uuid().optional(),
  })
  .refine((v) => v.q !== undefined || v.itemId !== undefined, {
    message: 'q: give the text to look for, or an itemId',
    path: ['q'],
  });

const resolveBody = z.object({ q: z.string().trim().min(1).max(200) });

interface SearchDeps {
  db: Queryable;
  trigramThreshold: number;
  ai?: AiContext | undefined;
  logger?: Logger | undefined;
}

export function searchRouter({ db, trigramThreshold, ai, logger }: SearchDeps): Router {
  const router = Router();

  router.get('/search', createRequireAuth(db), async (req, res) => {
    const { q, lat, lng, radius_m, itemId } = parse(query, req.query);
    const resolution = await resolveForCustomer(db, q ?? '', {
      userId: authOf(req).user.id,
      threshold: trigramThreshold,
      itemId,
      requestId: String(req.id),
      ...(ai && { ai }),
      ...(logger && { logger }),
    });
    const results = resolution.item
      ? await findLearnedStock(db, resolution.item.id, lat, lng, radius_m)
      : [];

    res.json({
      query: {
        normalised: resolution.normalised,
        ...(resolution.quantity && { quantity: resolution.quantity }),
      },
      item: resolution.item,
      matchedBy: resolution.matchedBy,
      ...(resolution.refused && { refused: resolution.refused }),
      results,
    });
  });

  // resolve_item: like a search, but a real product the catalog does not know becomes a new item
  // (ADR-0028). A POST because it can create data; the same text gives the same item.
  router.post('/items/resolve', createRequireAuth(db), async (req, res) => {
    const { q } = parse(resolveBody, req.body);
    const resolution = await resolveForCustomer(db, q, {
      userId: authOf(req).user.id,
      threshold: trigramThreshold,
      requestId: String(req.id),
      openCatalog: {},
      ...(ai && { ai }),
      ...(logger && { logger }),
    });
    res.json({
      query: {
        normalised: resolution.normalised,
        ...(resolution.quantity && { quantity: resolution.quantity }),
      },
      item: resolution.item,
      matchedBy: resolution.matchedBy,
      ...(resolution.refused && { refused: resolution.refused }),
    });
  });

  return router;
}
