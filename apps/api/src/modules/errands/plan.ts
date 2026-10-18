import type { Queryable } from '../../db/queryable.js';
import { formConflict, termsOfItems } from '../catalog/index.js';
import { findLearnedStock } from '../shops/index.js';
import { refusalKey, type Refused } from './executor.js';
import { isExpectedMatch } from './matchedAs.js';
import {
  optimise,
  recommend,
  type Offer,
  type OptimisedPlan,
  type PlanKind,
  type Recommendation,
  type Wanted,
} from './optimiser.js';
import { isUuid, type Confirmation } from './persistence.js';
import { MAX_PLAN_ITEMS, type SubmitPlanInput } from './tools.js';

/** A claimed shop must be inside this distance of the user: the widest radius any tool allows. */
const CHECK_RADIUS_M = 5000;
/** What kam_dukaan may cost more than sasta and still be recommended (ERRAND_FEWER_STOPS_MAX_EXTRA_PAISE). */
export const DEFAULT_FEWER_STOPS_MAX_EXTRA_PAISE = 3000;

export type Downgrade =
  | 'unknown_item'
  | 'no_shop'
  | 'unknown_shop'
  | 'no_fresh_stock'
  | 'too_many_shops'
  /** The model said confirmed but no shop said yes in this errand: it is only likely. */
  | 'not_confirmed';

export interface PlanItem {
  /** The customer's own words for the item. */
  text: string;
  itemId: string | null;
  /** The catalog item that was actually resolved and confirmed (ADR-0025). */
  itemName: string | null;
  quantity: number;
  status: 'confirmed' | 'likely' | 'not_found';
  shopId: string | null;
  shopName: string | null;
  distanceM: number | null;
  /** From the shop's answer or learned stock on record, never from the model. */
  pricePaise: number | null;
  referencePricePaise: number | null;
  /** The shop's photo of the item with its yes, to show on the card (GET /photos/:id). */
  photoId: string | null;
  /** "Confirmed 2 min ago" for a shop that said yes in this errand, else "Pichhla jawab: kal" for learned stock. */
  freshness: string | null;
  /** Set when the model said "likely" and the server could not confirm it. */
  downgraded: Downgrade | null;
  /** True when the item is not what the customer's words would lead them to expect ("diya" → candle). */
  matchedAs: boolean;
  /** A customer-made item no shop has confirmed yet (ADR-0028). */
  isNew: boolean;
  /** Why the item was never sent to shops, if it was not (ADR-0029). */
  refused: Refused | null;
}

export interface PlanRoute {
  orderedStops: { shopId: string; label: string; lat: number; lng: number }[];
  legsM: number[];
  totalM: number;
}

/** One of the two plans the optimiser builds (ADR-0025). */
export interface PlanVariant {
  kind: PlanKind;
  items: PlanItem[];
  route: PlanRoute | null;
  /** Sum of price × quantity over the confirmed and likely items that have a recorded price. */
  totalPricePaise: number;
  /** The length of the route in metres. */
  totalDistanceM: number;
  shopCount: number;
  /** Sum of (reference price − price) × quantity where both are known; negative if dearer. */
  savingsPaise: number;
}

/**
 * What errands.plan holds. `plans` has both plans and `recommended` says which to show first. The
 * top-level items, route and totals are a copy of the recommended plan, so a reader that only
 * knows one plan keeps working.
 */
export interface Plan {
  items: PlanItem[];
  notes: string | null;
  route: PlanRoute | null;
  totalPricePaise: number;
  savingsPaise: number;
  plans: Record<PlanKind, PlanVariant>;
  recommended: PlanKind;
  recommendation: Omit<Recommendation, 'recommended'>;
}

/** "Confirmed just now", "Confirmed 2 min ago": how long ago a shop said yes. */
export function confirmedLabel(answeredAt: Date, now: Date): string {
  const minutes = Math.max(0, Math.floor((now.getTime() - answeredAt.getTime()) / 60_000));
  if (minutes < 1) return 'Confirmed just now';
  if (minutes < 60) return `Confirmed ${minutes} min ago`;
  return `Confirmed ${Math.floor(minutes / 60)} h ago`;
}

const DAY_MS = 24 * 3_600_000;

/**
 * What a remembered answer reads like on the plan (learned stock is never "Confirmed": nobody
 * checked just now): "Pichhla jawab: aaj", "…: kal", "…: 3 din pehle".
 */
export function previousAnswerLabel(lastConfirmedAt: Date, now: Date): string {
  const days = Math.max(0, Math.floor((now.getTime() - lastConfirmedAt.getTime()) / DAY_MS));
  if (days < 1) return 'Pichhla jawab: aaj';
  if (days === 1) return 'Pichhla jawab: kal';
  return `Pichhla jawab: ${days} din pehle`;
}

interface ItemRecord {
  name: string;
  nameHi: string;
  refPricePaise: number | null;
  unverified: boolean;
}

/**
 * Server-side truth (ADR-0024, ADR-0025). The model proposes which items the customer wants; this
 * decides everything else. Every offer the errand has seen is gathered: a shop that said yes to
 * one of its own requests ("confirmed", the price from that answer) and fresh learned stock
 * ("likely"). The optimiser builds two plans from them, sasta and kam_dukaan, and the
 * recommendation rule picks one. Whatever shop or status the model named, the plan is the
 * server's: names, prices, distances and routes all come from the database.
 */
export async function buildPlan(
  db: Queryable,
  where: { lat: number; lng: number },
  input: SubmitPlanInput,
  confirmations: Confirmation[] = [],
  now: Date = new Date(),
  options: {
    fewerStopsMaxExtraPaise?: number;
    /** itemId → the customer's word, for every item resolve_item placed in this errand. */
    resolved?: Iterable<[string, string]>;
    /** The customer's words (see refusalKey) that were never sent to shops, and why. */
    refused?: Iterable<[string, Refused]>;
  } = {},
): Promise<Plan> {
  // Every item the agent resolved is planned, whatever it then claimed (or forgot) in submit_plan.
  const resolved = new Map(options.resolved ?? []);
  const claims: SubmitPlanInput['items'] = [...input.items];
  for (const [itemId, text] of resolved) {
    if (claims.length >= MAX_PLAN_ITEMS) break;
    if (!claims.some((c) => c.itemId === itemId))
      claims.push({ text: text.slice(0, 100), itemId, status: 'not_found' });
  }
  // An item that was refused is listed even if the model left it out: the customer should see it.
  const refused = new Map(options.refused ?? []);
  const claimed = new Set(claims.map((c) => refusalKey(c.text)));
  for (const key of refused.keys()) {
    if (claims.length >= MAX_PLAN_ITEMS) break;
    if (!claimed.has(key)) claims.push({ text: key.slice(0, 100), status: 'not_found' });
  }
  const itemIds = [
    ...new Set(claims.map((i) => i.itemId).filter((id): id is string => isUuid(id))),
  ];
  const shopIds = [
    ...new Set(claims.map((i) => i.shopId).filter((id): id is string => isUuid(id))),
  ];
  const items = new Map<string, ItemRecord>();
  if (itemIds.length > 0) {
    const { rows } = await db.query<{
      id: string;
      name_en: string;
      name_hi: string;
      ref_price_paise: number | null;
      unverified: boolean;
    }>(
      `SELECT id, name_en, name_hi, ref_price_paise, unverified FROM items WHERE id = ANY($1::uuid[])`,
      [itemIds],
    );
    for (const r of rows)
      items.set(r.id, {
        name: r.name_en,
        nameHi: r.name_hi,
        refPricePaise: r.ref_price_paise,
        unverified: r.unverified,
      });
  }
  // An item whose own name is another product form than the customer's words (itr, not powder)
  // is not the item they asked for, whatever id the model gave: it counts as unknown.
  const knownFor = (claim: { text: string; itemId?: string | undefined }) => {
    const known = isUuid(claim.itemId) ? items.get(claim.itemId) : undefined;
    return known && !formConflict(claim.text, [known.name, known.nameHi]) ? known : undefined;
  };
  const shops = new Set<string>();
  if (shopIds.length > 0) {
    const { rows } = await db.query<{ id: string }>(
      `SELECT id FROM shops WHERE id = ANY($1::uuid[])`,
      [shopIds],
    );
    for (const r of rows) shops.add(r.id);
  }

  // What the customer wants: every claim whose item is in the catalog and that the model did not
  // give up on (it never claims more than it checked, and the optimiser never plans less), and
  // every item it resolved: the server looks at the stock on record for those itself.
  const wanted: Wanted[] = [];
  claims.forEach((claim, index) => {
    const known = knownFor(claim);
    if (known && (claim.status !== 'not_found' || resolved.has(claim.itemId as string)))
      wanted.push({
        key: String(index),
        itemId: claim.itemId as string,
        quantity: claim.quantity ?? 1,
        referencePricePaise: known.refPricePaise,
      });
  });

  // Every offer seen: confirmed answers from this errand's requests, and fresh learned stock.
  const offers: Offer[] = [];
  for (const itemId of new Set(wanted.map((w) => w.itemId))) {
    for (const said of confirmations.filter((c) => c.itemId === itemId))
      offers.push({
        itemId,
        shopId: said.shopId,
        shopName: said.name,
        lat: said.lat,
        lng: said.lng,
        distanceM: said.distanceM,
        pricePaise: said.pricePaise,
        status: 'confirmed',
        freshness: confirmedLabel(said.answeredAt, now),
        photoId: said.photoId,
      });
    for (const stock of await findLearnedStock(db, itemId, where.lat, where.lng, CHECK_RADIUS_M))
      offers.push({
        itemId,
        shopId: stock.shopId,
        shopName: stock.name,
        lat: stock.lat,
        lng: stock.lng,
        distanceM: stock.distanceM,
        pricePaise: stock.pricePaise,
        status: 'likely',
        freshness: previousAnswerLabel(stock.lastConfirmedAt, now),
      });
  }

  const optimised = optimise(where, wanted, offers);
  const choice = recommend(optimised.sasta, optimised.kam_dukaan, {
    maxExtraPaise: options.fewerStopsMaxExtraPaise ?? DEFAULT_FEWER_STOPS_MAX_EXTRA_PAISE,
  });

  // Does the item differ from the customer's words in a way they might not expect?
  const terms = await termsOfItems(db, [...items.keys()]);

  const variantOf = (plan: OptimisedPlan): PlanVariant => {
    const bought = new Map(plan.assignments.map((a) => [a.key, a]));
    const planned: PlanItem[] = claims.map((claim, index) => {
      const known = knownFor(claim);
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
        photoId: null,
        freshness: null,
        downgraded: null,
        matchedAs: false,
        isNew: known?.unverified ?? false,
        refused: refused.get(refusalKey(claim.text)) ?? null,
      };
      const offer = bought.get(String(index));
      if (offer) {
        return {
          ...base,
          status: offer.status,
          shopId: offer.shopId,
          shopName: offer.shopName,
          distanceM: offer.distanceM,
          pricePaise: offer.pricePaise,
          photoId: offer.status === 'confirmed' ? (offer.photoId ?? null) : null,
          freshness: offer.freshness,
          downgraded:
            claim.status === 'confirmed' && offer.status === 'likely' ? 'not_confirmed' : null,
          matchedAs: !isExpectedMatch(claim.text, terms.get(offer.itemId) ?? []),
        };
      }
      if (claim.status === 'not_found') return base;
      if (!known) return { ...base, downgraded: 'unknown_item' };
      if (plan.tooManyShops.includes(String(index)))
        return { ...base, downgraded: 'too_many_shops' };
      if (!claim.shopId) return { ...base, downgraded: 'no_shop' };
      if (!isUuid(claim.shopId) || !shops.has(claim.shopId))
        return { ...base, downgraded: 'unknown_shop' };
      return { ...base, downgraded: 'no_fresh_stock' };
    });
    return {
      kind: plan.kind,
      items: planned,
      route: plan.route,
      totalPricePaise: plan.totalPricePaise,
      totalDistanceM: plan.totalDistanceM,
      shopCount: plan.shopIds.length,
      savingsPaise: plan.savingsPaise,
    };
  };

  const plans = { sasta: variantOf(optimised.sasta), kam_dukaan: variantOf(optimised.kam_dukaan) };
  const shown = plans[choice.recommended];
  const { recommended, ...recommendation } = choice;
  return {
    items: shown.items,
    notes: input.notes ?? null,
    route: shown.route,
    totalPricePaise: shown.totalPricePaise,
    savingsPaise: shown.savingsPaise,
    plans,
    recommended,
    recommendation,
  };
}
