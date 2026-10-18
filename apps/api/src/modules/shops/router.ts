import { CATEGORIES, type Category } from '@kahanmilega/shared';
import { Router } from 'express';
import { z } from 'zod';
import type { Queryable } from '../../db/queryable.js';
import { ApiError, parse } from '../../http/errors.js';
import { authOf, createRequireAuth, requireRole } from '../identity/index.js';
import { createShop, findShopByOwner, updateShopByOwner } from './service.js';

const name = z.string().trim().min(1).max(80);
const lat = z.number().min(-90).max(90);
const lng = z.number().min(-180).max(180);
const categories = z
  .array(z.enum(CATEGORIES))
  .min(1)
  .max(3)
  .refine((list) => new Set(list).size === list.length, 'must not repeat a category');

/** A shop that picks no category is a kirana (ADR-0028). */
const DEFAULT_CATEGORIES: Category[] = ['grocery'];

const createBody = z.object({ name, lat, lng, categories: categories.optional() });

const patchBody = z
  .object({
    name: name.optional(),
    lat: lat.optional(),
    lng: lng.optional(),
    categories: categories.optional(),
  })
  .refine((b) => (b.lat === undefined) === (b.lng === undefined), 'lat and lng go together')
  .refine((b) => Object.values(b).some((v) => v !== undefined), 'nothing to update');

export function shopsRouter({ db }: { db: Queryable }): Router {
  const router = Router();
  const shopOnly = [createRequireAuth(db), requireRole('shop')];

  router.post('/shops', ...shopOnly, async (req, res) => {
    const body = parse(createBody, req.body);
    const shop = await createShop(db, authOf(req).user, {
      ...body,
      categories: body.categories ?? DEFAULT_CATEGORIES,
    });
    if (!shop) throw new ApiError(409, 'shop_exists', 'You already have a shop');
    res.status(201).json(shop);
  });

  router.get('/shops/me', ...shopOnly, async (req, res) => {
    const shop = await findShopByOwner(db, authOf(req).user.id);
    if (!shop) throw new ApiError(404, 'not_found', 'You have not created a shop yet');
    res.json(shop);
  });

  router.patch('/shops/me', ...shopOnly, async (req, res) => {
    const { name, lat, lng, categories } = parse(patchBody, req.body);
    const shop = await updateShopByOwner(db, authOf(req).user.id, {
      ...(name !== undefined && { name }),
      ...(categories !== undefined && { categories }),
      ...(lat !== undefined && lng !== undefined && { location: { lat, lng } }),
    });
    if (!shop) throw new ApiError(404, 'not_found', 'You have not created a shop yet');
    res.json(shop);
  });

  return router;
}
