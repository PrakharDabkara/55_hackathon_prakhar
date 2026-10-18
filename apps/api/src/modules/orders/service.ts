import type { Logger } from 'pino';
import type { Database } from '../../db/queryable.js';
import { ApiError } from '../../http/errors.js';
import {
  deliveryOfferForErrand,
  chooseDeliveryMode,
  fallBackToPickup,
  type ErrandsContext,
} from '../errands/index.js';
import type { EventPublisher } from '../realtime/index.js';
import { deliveryOfferForRequest } from '../requests/index.js';
import {
  findOpenOrder,
  findOrder,
  findOverdueOrderIds,
  clearOldAddresses,
  forgetSavedAddress,
  getSavedAddress,
  insertOrder,
  listOrdersForShop,
  listOrdersForSource,
  listOrdersForUser,
  moveOrder,
  saveAddress,
} from './persistence.js';
import { ORDER_EXPIRY_MINUTES, type OrderEvent } from './stateMachine.js';
import type { OrderLine, OrderRecord } from './types.js';
import { seekerOrderView, shopOrderView } from './view.js';

export interface OrdersContext {
  db: Database;
  logger: Logger;
  events?: EventPublisher | undefined;
  /** Needed to read a plan the way the customer sees it; without it the plan's default applies. */
  limits?: ErrandsContext['limits'] | undefined;
}

export interface PlaceOrderInput {
  shopId: string;
  requestId?: string | undefined;
  errandId?: string | undefined;
  addressText: string;
  customerName?: string | undefined;
  /** The customer ticked "Is pate ko yaad rakhein": keep this address on their profile. */
  saveAddress?: boolean | undefined;
}

/** "Asha   Verma" → "Asha". Only letters, marks, dots and hyphens survive; nothing else is kept. */
export function firstNameOf(raw: string | undefined): string | null {
  const first = (raw ?? '').trim().split(/\s+/)[0] ?? '';
  const clean = first.replace(/[^\p{L}\p{M}.-]/gu, '').slice(0, 30);
  return clean.length > 0 ? clean : null;
}

/** The total of the lines that have a price; null when none has one. Unknown prices are not ₹0. */
export function totalOf(lines: OrderLine[]): { totalPaise: number | null; unknown: number } {
  const priced = lines.filter((l) => l.pricePaise !== null);
  return {
    totalPaise:
      priced.length > 0
        ? priced.reduce((sum, l) => sum + (l.pricePaise as number) * l.count, 0)
        : null,
    unknown: lines.length - priced.length,
  };
}

/** Hints only: ids and a state, never the address, the pin, a name or a phone. */
function announce(
  ctx: Pick<OrdersContext, 'events' | 'logger'>,
  order: OrderRecord,
  kind: 'created' | 'updated',
) {
  const events = ctx.events;
  if (!events) return;
  const data =
    kind === 'created' ? { orderId: order.id } : { orderId: order.id, state: order.state };
  const type = `order.${kind}`;
  if (kind === 'updated') events.publish({ to: { userId: order.userId }, type, data }, ctx.logger);
  if (order.shopOwnerUserId)
    events.publish({ to: { userId: order.shopOwnerUserId }, type, data }, ctx.logger);
}

async function isSimulated(db: Database, shopId: string): Promise<boolean> {
  const { rows } = await db.query<{ is_simulated: boolean }>(
    `SELECT is_simulated FROM shops WHERE id = $1`,
    [shopId],
  );
  return rows[0]?.is_simulated === true;
}

/**
 * The customer asks a shop to bring what it said yes to. The lines, price and fee come from the
 * shop's own answer (or the plan the customer is looking at), never from the request body. The
 * address is stored here and nowhere else (ADR-0031).
 */
export async function placeOrder(
  ctx: OrdersContext,
  userId: string,
  input: PlaceOrderInput,
): Promise<{ order: OrderRecord; created: boolean }> {
  const { db } = ctx;
  const offer = input.requestId
    ? await deliveryOfferForRequest(db, userId, input.requestId, input.shopId)
    : await deliveryOfferForErrand(ctx, userId, input.errandId as string, input.shopId);
  const shop = (
    await db.query<{ id: string; open: boolean }>(
      `SELECT id, (closed_until IS NULL OR closed_until <= now()) AS open FROM shops WHERE id = $1`,
      [input.shopId],
    )
  ).rows[0];
  if (!shop) throw new ApiError(404, 'not_found', 'No such shop');

  if (!shop.open) throw new ApiError(409, 'shop_closed', 'That shop is closed right now');

  const sourceId = (input.requestId ?? input.errandId) as string;
  const open = await findOpenOrder(db, userId, input.shopId, sourceId);
  if (open) return { order: open, created: false };

  const { totalPaise, unknown } = totalOf(offer.lines);
  const id = await insertOrder(db, {
    userId,
    shopId: input.shopId,
    requestId: input.requestId ?? null,
    errandId: input.errandId ?? null,
    lines: offer.lines,
    itemsTotalPaise: totalPaise,
    unknownPriceCount: unknown,
    feePaise: offer.feePaise,
    feeMinutes: offer.minutes,
    addressText: input.addressText,
    customerFirstName: firstNameOf(input.customerName),
    lat: offer.lat,
    lng: offer.lng,
    expiryMinutes: ORDER_EXPIRY_MINUTES,
  });
  if (!id) {
    // A second tap landed between our look and our insert: the first one is the order.
    const winner = await findOpenOrder(db, userId, input.shopId, sourceId);
    if (winner) return { order: winner, created: false };
    throw new ApiError(409, 'order_exists', 'An order is already open for this shop');
  }
  const order = (await findOrder(db, id)) as OrderRecord;
  // Only on the customer's own tick; no tick, nothing is kept beyond the order.
  if (input.saveAddress === true)
    await saveAddress(db, userId, input.addressText, firstNameOf(input.customerName));
  // A plan card: the shop is now a delivery stop on the plan, until it says no.
  if (input.errandId)
    await chooseDeliveryMode(ctx, userId, input.errandId, input.shopId, 'delivery');

  ctx.logger.info({ orderId: order.id, shopId: order.shopId }, 'delivery order placed');
  announce(ctx, order, 'created');
  if (ctx.events && (await isSimulated(db, order.shopId)))
    // The simulator listens on one admin stream for every simulated shop.
    ctx.events.publish(
      {
        to: { admin: true },
        type: 'order.created',
        data: { orderId: order.id, shopId: order.shopId },
      },
      ctx.logger,
    );
  return { order, created: true };
}

/** A declined, expired or cancelled order puts the plan back on pickup for that shop. */
async function backToPickup(ctx: OrdersContext, order: OrderRecord): Promise<void> {
  if (!order.errandId) return;
  await fallBackToPickup(ctx.db, order.errandId, order.shopId);
  ctx.events?.publish(
    { to: { userId: order.userId }, type: 'errand.updated', data: { errandId: order.errandId } },
    ctx.logger,
  );
}

/** Moves an order by one event and tells both sides. A repeated tap changes nothing. */
async function apply(ctx: OrdersContext, id: string, event: OrderEvent): Promise<OrderRecord> {
  const moved = await moveOrder(ctx.db, id, event);
  if (moved.kind === 'not_found') throw new ApiError(404, 'not_found', 'No such order');
  if (moved.kind === 'invalid')
    throw new ApiError(409, 'invalid_transition', 'This order cannot do that now', {
      state: moved.order.state,
    });
  if (moved.kind === 'applied') {
    const order = moved.order;
    ctx.logger.info(
      { orderId: order.id, from: moved.from, to: order.state, event },
      'delivery order moved',
    );
    if (order.state === 'DECLINED' || order.state === 'EXPIRED' || order.state === 'CANCELLED')
      await backToPickup(ctx, order);
    announce(ctx, order, 'updated');
  }
  return moved.order;
}

/** An order that waited too long ends now, whoever looks first. */
async function expireIfDue(ctx: OrdersContext, order: OrderRecord): Promise<OrderRecord> {
  if (order.state !== 'REQUESTED' || order.expiresAt.getTime() > Date.now()) return order;
  // The database clock decides in the sweep; here the same guard lets only one caller expire it.
  const { rowCount } = await ctx.db.query(
    `SELECT 1 FROM delivery_orders WHERE id = $1 AND state = 'REQUESTED' AND expires_at <= now()`,
    [order.id],
  );
  if (!rowCount) return order;
  return apply(ctx, order.id, 'EXPIRE').catch(
    async () => (await findOrder(ctx.db, order.id)) ?? order,
  );
}

/** Expires every order whose shop did not answer in time. Returns how many it expired. */
export async function sweepOrders(
  ctx: Pick<OrdersContext, 'db' | 'logger' | 'events'>,
): Promise<number> {
  let expired = 0;
  for (const id of await findOverdueOrderIds(ctx.db, 100)) {
    const moved = await moveOrder(ctx.db, id, 'EXPIRE');
    if (moved.kind !== 'applied') continue;
    expired++;
    ctx.logger.info({ orderId: id }, 'delivery order expired');
    await backToPickup(ctx, moved.order);
    announce(ctx, moved.order, 'updated');
  }
  return expired;
}

const MY_ORDERS_LIMIT = 50;

const owned = async (ctx: OrdersContext, userId: string, id: string): Promise<OrderRecord> => {
  const order = await findOrder(ctx.db, id);
  if (!order || order.userId !== userId) throw new ApiError(404, 'not_found', 'No such order');
  return expireIfDue(ctx, order);
};

export async function getSeekerOrder(ctx: OrdersContext, userId: string, id: string) {
  return seekerOrderView(await owned(ctx, userId, id));
}

export async function listSeekerOrders(
  ctx: OrdersContext,
  userId: string,
  source: { requestId: string } | { errandId: string },
) {
  const orders = await listOrdersForSource(ctx.db, userId, source);
  return (await Promise.all(orders.map((o) => expireIfDue(ctx, o)))).map(seekerOrderView);
}

/** Every order of the customer, open ones first. */
export async function listMyOrders(ctx: OrdersContext, userId: string) {
  const orders = await listOrdersForUser(ctx.db, userId, MY_ORDERS_LIMIT);
  return (await Promise.all(orders.map((o) => expireIfDue(ctx, o)))).map(seekerOrderView);
}

export async function cancelOrder(ctx: OrdersContext, userId: string, id: string) {
  await owned(ctx, userId, id);
  return seekerOrderView(await apply(ctx, id, 'CANCEL'));
}

export async function savedAddress(ctx: OrdersContext, userId: string) {
  return (await getSavedAddress(ctx.db, userId)) ?? { addressText: null, customerName: null };
}

export async function forgetAddress(ctx: OrdersContext, userId: string): Promise<void> {
  await forgetSavedAddress(ctx.db, userId);
}

/** Clears the address and pin of orders that ended 30 days ago. Returns how many. */
export async function sweepOrderAddresses(
  ctx: Pick<OrdersContext, 'db' | 'logger'>,
): Promise<number> {
  const cleared = await clearOldAddresses(ctx.db);
  if (cleared > 0) ctx.logger.info({ cleared }, 'delivery order addresses cleared');
  return cleared;
}

export async function listShopOrders(ctx: OrdersContext, ownerUserId: string) {
  const orders = await listOrdersForShop(ctx.db, ownerUserId, MY_ORDERS_LIMIT);
  return (await Promise.all(orders.map((o) => expireIfDue(ctx, o)))).map(shopOrderView);
}

const SHOP_EVENTS = {
  accept: 'ACCEPT',
  decline: 'DECLINE',
  out: 'DISPATCH',
  delivered: 'DELIVER',
} as const;
export type ShopVerb = keyof typeof SHOP_EVENTS;

/** The shop owner answers or moves their own order; someone else's order is a 404. */
export async function shopAct(ctx: OrdersContext, ownerUserId: string, id: string, verb: ShopVerb) {
  const order = await findOrder(ctx.db, id);
  if (!order || order.shopOwnerUserId !== ownerUserId)
    throw new ApiError(404, 'not_found', 'No such order');
  const fresh = await expireIfDue(ctx, order);
  return shopOrderView(await apply(ctx, fresh.id, SHOP_EVENTS[verb]));
}
