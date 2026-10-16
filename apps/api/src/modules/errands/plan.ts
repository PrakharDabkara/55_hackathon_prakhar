import type { Queryable } from '../../db/queryable.js';
import { planRoute } from '../routing/index.js';
import { findLearnedStock } from '../shops/index.js';
import { isUuid, type Confirmation } from './persistence.js';
import type { SubmitPlanInput } from './tools.js';

/** A claimed shop must be inside this distance of the user: the widest radius any tool allows. */
const CHECK_RADIUS_M = 5000;
const MAX_STOPS = 8;

export type Downgrade =
  | 'unknown_item'
  | 'no_shop'
  | 'unknown_shop'
  | 'no_fresh_stock'
  | 'too_many_shops'
  /** The model said confirmed but no shop said yes in this errand: it is only likely. */
  | 'not_confirmed';

export interface PlanItem {
  text: string;
  itemId: string | null;
  itemName: string | null;
  quantity: number;
  status: 'confirmed' | 'likely' | 'not_found';
  shopId: string | null;
  shopName: string | null;
  distanceM: number | null;
  /** From the shop's learned stock on record, never from the model. */
  pricePaise: number | null;
  referencePricePaise: number | null;
  /** "Confirmed 2 min ago" for a shop that said yes in this errand, else how fresh the learned stock is. */
  freshness: string | null;
  /** Set when the model said "likely" and the server could not confirm it. */
  downgraded: Downgrade | null;
}

export interface Plan {
  items: PlanItem[];
  notes: string | null;
  route: {
    orderedStops: { shopId: string; label: string; lat: number; lng: number }[];
    legsM: number[];
    totalM: number;
  } | null;
  /** Sum of price × quantity over the confirmed and likely items that have a recorded price. */
  totalPricePaise: number;
  /** Sum of (reference price − price) × quantity where both are known; negative if dearer. */
  savingsPaise: number;
}

/** "Confirmed just now", "Confirmed 2 min ago": how long ago a shop said yes. */
export function confirmedLabel(answeredAt: Date, now: Date): string {
  const minutes = Math.max(0, Math.floor((now.getTime() - answeredAt.getTime()) / 60_000));
  if (minutes < 1) return 'Confirmed just now';
  if (minutes < 60) return `Confirmed ${minutes} min ago`;
  return `Confirmed ${Math.floor(minutes / 60)} h ago`;
}

interface ItemRecord {
  name: string;
  refPricePaise: number | null;
}

/**
 * Server-side truth (ADR-0024). The model proposes; this decides. An item is "confirmed" only if a
 * shop said yes to it in one of this errand's own requests (`confirmations`), with the price from
 * that answer. Else it is "likely" if the shop has unexpired learned stock of that item within
 * reach of the user. Else "not_found". Whatever the model said, the status is the server's.
 * Prices, names and distances come from the database. The route is planned over the shops that
 * survive.
 */
export async function buildPlan(
  db: Queryable,
  where: { lat: number; lng: number },
  input: SubmitPlanInput,
  confirmations: Confirmation[] = [],
  now: Date = new Date(),
): Promise<Plan> {
  const itemIds = [
    ...new Set(input.items.map((i) => i.itemId).filter((id): id is string => isUuid(id))),
  ];
  const shopIds = [
    ...new Set(input.items.map((i) => i.shopId).filter((id): id is string => isUuid(id))),
  ];
  const items = new Map<string, ItemRecord>();
  if (itemIds.length > 0) {
    const { rows } = await db.query<{
      id: string;
      name_en: string;
      ref_price_paise: number | null;
    }>(`SELECT id, name_en, ref_price_paise FROM items WHERE id = ANY($1::uuid[])`, [itemIds]);
    for (const r of rows) items.set(r.id, { name: r.name_en, refPricePaise: r.ref_price_paise });
  }
  const shops = new Set<string>();
  if (shopIds.length > 0) {
    const { rows } = await db.query<{ id: string }>(
      `SELECT id FROM shops WHERE id = ANY($1::uuid[])`,
      [shopIds],
    );
    for (const r of rows) shops.add(r.id);
  }
  const stockCache = new Map<string, Awaited<ReturnType<typeof findLearnedStock>>>();
  const stockFor = async (itemId: string) => {
    let stock = stockCache.get(itemId);
    if (!stock) {
      stock = await findLearnedStock(db, itemId, where.lat, where.lng, CHECK_RADIUS_M);
      stockCache.set(itemId, stock);
    }
    return stock;
  };

  const planned: PlanItem[] = [];
  const stopInfo = new Map<string, { label: string; lat: number; lng: number }>();
  for (const claim of input.items) {
    const known = isUuid(claim.itemId) ? items.get(claim.itemId) : undefined;
    const base: PlanItem = {
      text: claim.text,
      itemId: known ? (claim.itemId as string) : null,
      itemName: known?.name ?? null,
      quantity: claim.quantity ?? 1,
      status: 'not_found',
      shopId: null,
      shopName: null,
      distanceM: null,
      pricePaise: null,
      referencePricePaise: known?.refPricePaise ?? null,
      freshness: null,
      downgraded: null,
    };
    if (claim.status === 'not_found') {
      planned.push(base);
      continue;
    }

    if (!known) {
      planned.push({ ...base, downgraded: 'unknown_item' });
      continue;
    }
    if (!claim.shopId) {
      planned.push({ ...base, downgraded: 'no_shop' });
      continue;
    }
    if (!isUuid(claim.shopId) || !shops.has(claim.shopId)) {
      planned.push({ ...base, downgraded: 'unknown_shop' });
      continue;
    }
    const said = confirmations.find((c) => c.shopId === claim.shopId && c.itemId === base.itemId);
    if (said) {
      stopInfo.set(said.shopId, { label: said.name, lat: said.lat, lng: said.lng });
      planned.push({
        ...base,
        status: 'confirmed',
        shopId: said.shopId,
        shopName: said.name,
        distanceM: said.distanceM,
        pricePaise: said.pricePaise,
        freshness: confirmedLabel(said.answeredAt, now),
      });
      continue;
    }
    const stock = (await stockFor(base.itemId as string)).find((s) => s.shopId === claim.shopId);
    if (!stock) {
      planned.push({ ...base, downgraded: 'no_fresh_stock' });
      continue;
    }
    stopInfo.set(stock.shopId, { label: stock.name, lat: stock.lat, lng: stock.lng });
    planned.push({
      ...base,
      status: 'likely',
      shopId: stock.shopId,
      shopName: stock.name,
      distanceM: stock.distanceM,
      pricePaise: stock.pricePaise,
      freshness: stock.freshness,
      downgraded: claim.status === 'confirmed' ? 'not_confirmed' : null,
    });
  }

  // A route holds at most 8 stops: later shops beyond that are not planned.
  const kept = [...stopInfo.keys()].slice(0, MAX_STOPS);
  for (const item of planned) {
    if (item.status !== 'not_found' && item.shopId && !kept.includes(item.shopId)) {
      Object.assign(item, {
        status: 'not_found',
        shopId: null,
        shopName: null,
        distanceM: null,
        pricePaise: null,
        freshness: null,
        downgraded: 'too_many_shops',
      } satisfies Partial<PlanItem>);
    }
  }

  let route: Plan['route'] = null;
  if (kept.length > 0) {
    const stops = kept.map((shopId) => ({ shopId, ...(stopInfo.get(shopId) as object) })) as {
      shopId: string;
      label: string;
      lat: number;
      lng: number;
    }[];
    const best = planRoute(where, stops);
    // Whole metres are plenty for a walk, and the total is the sum of what is shown.
    const legsM = best.legsM.map(Math.round);
    route = {
      orderedStops: best.orderedStops,
      legsM,
      totalM: legsM.reduce((a, b) => a + b, 0),
    };
  }

  let totalPricePaise = 0;
  let savingsPaise = 0;
  for (const item of planned) {
    if (item.status === 'not_found' || item.pricePaise === null) continue;
    totalPricePaise += item.pricePaise * item.quantity;
    if (item.referencePricePaise !== null)
      savingsPaise += (item.referencePricePaise - item.pricePaise) * item.quantity;
  }

  return { items: planned, notes: input.notes ?? null, route, totalPricePaise, savingsPaise };
}
