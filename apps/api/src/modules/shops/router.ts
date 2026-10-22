import { CATEGORIES, type Category } from '@askbuy/shared';
import { Router } from 'express';
import { z } from 'zod';
import type { Queryable } from '../../db/queryable.js';
import { ApiError, parse } from '../../http/errors.js';
import { authOf, createRequireAuth, requireRole } from '../identity/index.js';
import { createShop, findShopByOwner, setShopOpen, updateShopByOwner } from './service.js';

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

/** A standing delivery offer: a fee and a time, either may be left out. */
const delivery = z.strictObject({
  feePaise: z.number().int().min(0).max(1_000_000).optional(),
  minutes: z.number().int().min(1).max(1440).optional(),
});

const createBody = z.strictObject({
  name,
  lat,
  lng,
  categories: categories.optional(),
  delivery: delivery.optional(),
});

const patchBody = z
  .strictObject({
    name: name.optional(),
    lat: lat.optional(),
    lng: lng.optional(),
    categories: categories.optional(),
    delivery: delivery.nullable().optional(),
    /** How far the shop delivers, in km; null removes the limit. */
    deliveryMaxKm: z.number().min(0.1).max(100).nullable().optional(),
  })
  .refine((b) => (b.lat === undefined) === (b.lng === undefined), 'lat and lng go together')
  .refine((b) => Object.values(b).some((v) => v !== undefined), 'nothing to update');

/** What the shops module may ask of the rest: queue the catch-up for a shop (ADR-0038). */
export interface ShopHooks {
  enqueueShopCatchUp?: ((shopId: string) => Promise<void>) | undefined;
}

export function shopsRouter({ db, hooks }: { db: Queryable; hooks?: ShopHooks }): Router {
  const router = Router();
  /** Best effort: a shop that cannot be caught up still works; requests expire on time. */
  const catchUp = (shopId: string) =>
    void hooks?.enqueueShopCatchUp?.(shopId).catch(() => undefined);
  const shopOnly = [createRequireAuth(db), requireRole('shop')];

  router.post('/shops', ...shopOnly, async (req, res) => {
    const body = parse(createBody, req.body);
    const shop = await createShop(db, authOf(req).user, {
      ...body,
      categories: body.categories ?? DEFAULT_CATEGORIES,
    });
    if (!shop) throw new ApiError(409, 'shop_exists', 'You already have a shop');
    catchUp(shop.id);
    res.status(201).json(shop);
  });

  router.get('/shops/me', ...shopOnly, async (req, res) => {
    const shop = await findShopByOwner(db, authOf(req).user.id);
    if (!shop) throw new ApiError(404, 'not_found', 'You have not created a shop yet');
    res.json(shop);
  });

  router.patch('/shops/me', ...shopOnly, async (req, res) => {
    const { name, lat, lng, categories, delivery, deliveryMaxKm } = parse(patchBody, req.body);
    const shop = await updateShopByOwner(db, authOf(req).user.id, {
      ...(name !== undefined && { name }),
      ...(categories !== undefined && { categories }),
      ...(delivery !== undefined && { delivery }),
      ...(deliveryMaxKm !== undefined && { deliveryMaxKm }),
      ...(lat !== undefined && lng !== undefined && { location: { lat, lng } }),
    });
    if (!shop) throw new ApiError(404, 'not_found', 'You have not created a shop yet');
    res.json(shop);
  });

  // "Dukaan aaj band hai": closed shops get no pings and are left out of learned stock until the
  // end of the day, or until the owner opens again (ADR-0031).
  router.put('/shops/me/open', ...shopOnly, async (req, res) => {
    const { open } = parse(z.strictObject({ open: z.boolean() }), req.body);
    const shop = await setShopOpen(db, authOf(req).user.id, open);
    if (!shop) throw new ApiError(404, 'not_found', 'You have not created a shop yet');
    if (open) catchUp(shop.id);
    res.json(shop);
  });

  return router;
}
