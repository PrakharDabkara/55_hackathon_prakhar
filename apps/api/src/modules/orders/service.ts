import type { Logger } from 'pino';
import type { Database, Queryable } from '../../db/queryable.js';
import { ApiError } from '../../http/errors.js';
import {
  deliveryOfferForErrand,
  chooseDeliveryMode,
  fallBackToPickup,
  type ErrandsContext,
} from '../errands/index.js';
import type { EventPublisher } from '../realtime/index.js';
import {
  deliveryOfferForRequest,
  otherAnsweredShops,
  withdrawPingsForChoice,
} from '../requests/index.js';
import {
  findOpenOrder,
  findOrder,
  findOverdueOrderIds,
  clearOldAddresses,
  forgetSavedAddress,
  findUnconfirmedOrderIds,
  getSavedAddress,
  getSavedAddressById,
  insertOrder,
  listOrdersForShop,
  listOrdersForSource,
  listOrdersForUser,
  moveOrder,
  saveAddress,
  setLinePacked,
  type MoveDetails,
} from './persistence.js';
import { cleanNote } from './note.js';
import {
  isFinalOrderState,
  OFFER_FRESH_MINUTES,
  ORDER_EXPIRY_MINUTES,
  type OrderEvent,
} from './stateMachine.js';
import {
  SHOP_CANCEL_REASONS,
  type OrderLine,
  type OrderRecord,
  type ShopCancelReason,
} from './types.js';
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
  /** Typed by the customer. Without it the address they picked on Find is used (ADR-0039). */
  addressText?: string | undefined;
  customerName?: string | undefined;
  /** For the shop, up to 140 characters; phone numbers are removed. */
  note?: string | undefined;
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
  const fromRequest = input.requestId
    ? await deliveryOfferForRequest(db, userId, input.requestId, input.shopId)
    : null;
  const offer =
    fromRequest ??
    (await deliveryOfferForErrand(ctx, userId, input.errandId as string, input.shopId));
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

  // The address: what the customer typed, else the one they picked on Find (if it is still there).
  const picked =
    input.addressText === undefined && offer.deliveryAddressId
      ? await getSavedAddressById(db, userId, offer.deliveryAddressId)
      : null;
  const addressText = input.addressText ?? picked?.addressText;
  if (!addressText)
    throw new ApiError(400, 'address_required', 'Tell us where to deliver: the address is needed');

  // A fresh yes from the shop itself, on a request still open, is binding: no second accept.
  const binding =
    fromRequest !== null &&
    fromRequest.ownOfferAgeSeconds !== null &&
    fromRequest.ownOfferAgeSeconds <= OFFER_FRESH_MINUTES * 60 &&
    fromRequest.requestLive;

  const { totalPaise, unknown } = totalOf(offer.lines);
  let id: string | null;
  try {
    id = await insertOrder(db, {
      userId,
      shopId: input.shopId,
      requestId: input.requestId ?? null,
      errandId: input.errandId ?? null,
      lines: offer.lines,
      itemsTotalPaise: totalPaise,
      unknownPriceCount: unknown,
      feePaise: offer.feePaise,
      feeMinutes: offer.minutes,
      addressText,
      customerFirstName: firstNameOf(input.customerName) ?? picked?.customerName ?? null,
      lat: offer.lat,
      lng: offer.lng,
      note: cleanNote(input.note),
      state: binding ? 'ACCEPTED' : 'REQUESTED',
      expiryMinutes: ORDER_EXPIRY_MINUTES,
    });
  } catch (err) {
    // The customer picks ONE shop: the unique index lets only one order per request be live.
    if ((err as { code?: string }).code === '23505') {
      const winner = await findOpenOrder(db, userId, input.shopId, sourceId);
      if (winner) return { order: winner, created: false };
      throw new ApiError(409, 'already_ordered', "You've already ordered this from another shop");
    }
    throw err;
  }
  if (!id) {
    // A second tap landed between our look and our insert: the first one is the order.
    const winner = await findOpenOrder(db, userId, input.shopId, sourceId);
    if (winner) return { order: winner, created: false };
    throw new ApiError(409, 'order_exists', 'An order is already open for this shop');
  }
  const order = (await findOrder(db, id)) as OrderRecord;
  // Only on the customer's own tick; no tick, nothing is kept beyond the order.
  if (input.saveAddress === true)
    await saveAddress(db, userId, addressText, firstNameOf(input.customerName));
  // A plan card: the shop is now a delivery stop on the plan, until it says no.
  if (input.errandId)
    await chooseDeliveryMode(ctx, userId, input.errandId, input.shopId, 'delivery');

  ctx.logger.info({ orderId: order.id, shopId: order.shopId }, 'delivery order placed');
  announce(ctx, order, 'created');
  if (input.requestId) await tellOtherShops(ctx, input.requestId, order.shopId);
  if (ctx.events && (await isSimulated(db, order.shopId)))
    // The simulator listens on one admin stream for every simulated shop.
    ctx.events.publish(
      {
        to: { admin: true },
        type: 'order.created',
        data: { orderId: order.id, shopId: order.shopId, state: order.state },
      },
      ctx.logger,
    );
  return { order, created: true };
}

/**
 * The customer picked a shop, so the others that answered are told "the customer already got an
 * answer" (the same note as when enough shops had said yes); shops still holding the question get it too. Ids only.
 */
async function tellOtherShops(ctx: OrdersContext, requestId: string, chosenShopId: string) {
  // Shops that have not answered yet let the question go too (ADR-0043).
  await withdrawPingsForChoice(ctx, requestId);
  if (!ctx.events) return;
  for (const other of await otherAnsweredShops(ctx.db, requestId, chosenShopId))
    ctx.events.publish(
      {
        to: { userId: other.ownerUserId },
        type: 'ping.closed',
        data: { pingId: other.pingId, reason: 'customer_chose' },
      },
      ctx.logger,
    );
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
async function apply(
  ctx: OrdersContext,
  id: string,
  event: OrderEvent,
  details?: MoveDetails,
): Promise<OrderRecord> {
  const moved = await moveOrder(ctx.db, id, event, details);
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

/**
 * An order past its deadline ends now, whoever looks first: a REQUESTED one the shop did not
 * answer in time is EXPIRED, an OUT_FOR_DELIVERY one the customer never confirmed is NOT_CONFIRMED.
 */
async function expireIfDue(ctx: OrdersContext, order: OrderRecord): Promise<OrderRecord> {
  const event =
    order.state === 'REQUESTED'
      ? 'EXPIRE'
      : order.state === 'OUT_FOR_DELIVERY'
        ? 'NOT_CONFIRM'
        : null;
  const deadline = order.state === 'REQUESTED' ? order.expiresAt : order.receiveBy;
  if (!event || !deadline || deadline.getTime() > Date.now()) return order;
  // The database clock decides in the sweep; here the same guard lets only one caller move it.
  const { rowCount } = await ctx.db.query(
    order.state === 'REQUESTED'
      ? `SELECT 1 FROM delivery_orders WHERE id = $1 AND state = 'REQUESTED' AND expires_at <= now()`
      : `SELECT 1 FROM delivery_orders WHERE id = $1 AND state = 'OUT_FOR_DELIVERY' AND receive_by <= now()`,
    [order.id],
  );
  if (!rowCount) return order;
  return apply(ctx, order.id, event).catch(
    async () => (await findOrder(ctx.db, order.id)) ?? order,
  );
}

/** Ends every order past its deadline (unanswered, or never received). Returns how many. */
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
  // The customer did not confirm in time: final, and never DELIVERED (ADR-0039).
  for (const id of await findUnconfirmedOrderIds(ctx.db, 100)) {
    const moved = await moveOrder(ctx.db, id, 'NOT_CONFIRM');
    if (moved.kind !== 'applied') continue;
    expired++;
    ctx.logger.info({ orderId: id }, 'delivery order not confirmed by the customer');
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
  source: { requestId: string } | { errandId: string } | { listId: string },
) {
  const orders = await listOrdersForSource(ctx.db, userId, source);
  return (await Promise.all(orders.map((o) => expireIfDue(ctx, o)))).map(seekerOrderView);
}

/** Every order of the customer, open ones first. */
export async function listMyOrders(ctx: OrdersContext, userId: string) {
  const orders = await listOrdersForUser(ctx.db, userId, MY_ORDERS_LIMIT);
  return (await Promise.all(orders.map((o) => expireIfDue(ctx, o)))).map(seekerOrderView);
}

/** The customer confirms the delivery arrived. Only OUT_FOR_DELIVERY, and only before the deadline. */
export async function receiveOrder(ctx: OrdersContext, userId: string, id: string) {
  await owned(ctx, userId, id);
  return seekerOrderView(await apply(ctx, id, 'RECEIVE'));
}

export interface CancelInput {
  reason?: string | undefined;
  text?: string | undefined;
}

/**
 * One cancel route, two people. Who the caller is to THIS order decides (a user can be a
 * shopkeeper and a customer): the order's customer may cancel REQUESTED or ACCEPTED with an optional
 * reason; the order's shop only ACCEPTED, with a reason from the list. Both at once is refused.
 */
export async function cancelOrder(
  ctx: OrdersContext,
  callerUserId: string,
  id: string,
  input: CancelInput = {},
) {
  const order = await findOrder(ctx.db, id);
  const isCustomer = order?.userId === callerUserId;
  const isShop = order?.shopOwnerUserId === callerUserId;
  if (!order || (!isCustomer && !isShop)) throw new ApiError(404, 'not_found', 'No such order');
  if (isCustomer && isShop)
    throw new ApiError(
      409,
      'ambiguous_cancel',
      'You are both the customer and the shop on this order: it cannot be cancelled from here',
    );
  if (isCustomer) {
    await expireIfDue(ctx, order);
    const words = cleanNote(input.text ?? input.reason);
    const done = await apply(ctx, id, 'CANCEL', {
      cancelledBy: 'customer',
      ...(words && { text: words }),
    });
    return seekerOrderView(done);
  }
  const reason = input.reason as ShopCancelReason | undefined;
  if (!reason || !SHOP_CANCEL_REASONS.includes(reason))
    throw new ApiError(400, 'invalid_request', 'reason: out_of_stock, cannot_deliver_now or other');
  const text = cleanNote(input.text);
  const fresh = await expireIfDue(ctx, order);
  return shopOrderView(
    await apply(ctx, fresh.id, 'SHOP_CANCEL', {
      cancelledBy: 'shop',
      reason,
      ...(text && { text }),
    }),
  );
}

export async function savedAddress(ctx: OrdersContext, userId: string) {
  return (
    (await getSavedAddress(ctx.db, userId)) ?? { id: null, addressText: null, customerName: null }
  );
}

/** Keeps the customer's address (one per customer) so Find can point a request at it. */
export async function keepAddress(
  ctx: OrdersContext,
  userId: string,
  input: { addressText: string; customerName?: string | undefined },
) {
  await saveAddress(ctx.db, userId, input.addressText, firstNameOf(input.customerName));
  return savedAddress(ctx, userId);
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

// There is no "delivered" for a shop: only the customer's Received ends a delivery (ADR-0039).
const SHOP_EVENTS = {
  accept: 'ACCEPT',
  decline: 'DECLINE',
  out: 'DISPATCH',
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

/** What one shop's order from a list is made of (ADR-0055): its lines, fee, and how it starts. */
export interface ListOrderDraft {
  shopId: string;
  lines: OrderLine[];
  feePaise: number | null;
  /** ACCEPTED for an answer that is still binding, else REQUESTED. */
  state: 'REQUESTED' | 'ACCEPTED';
}

export interface ListOrdersInput {
  listId: string;
  /** Where the customer was when they sent the list: the pin each order keeps. */
  lat: number;
  lng: number;
  /** The saved address the list was sent with, used when no address is typed (ADR-0039). */
  deliveryAddressId: string | null;
  addressText?: string | undefined;
  customerName?: string | undefined;
  note?: string | undefined;
  saveAddress?: boolean | undefined;
  orders: ListOrderDraft[];
}

/**
 * One delivery order per shop of a list, inside the caller's transaction, so one bad order undoes
 * them all (ADR-0055 rule 11). Same address, note and name rules as a single order; prices and
 * fees come from the drafts, which come from the shops' own answers. Tell both sides with
 * `announceOrdersCreated` after the commit.
 */
export async function insertListOrders(
  tx: Queryable,
  userId: string,
  input: ListOrdersInput,
): Promise<OrderRecord[]> {
  const picked =
    input.addressText === undefined && input.deliveryAddressId
      ? await getSavedAddressById(tx, userId, input.deliveryAddressId)
      : null;
  const addressText = input.addressText ?? picked?.addressText;
  if (!addressText)
    throw new ApiError(400, 'address_required', 'Tell us where to deliver: the address is needed');
  const records: OrderRecord[] = [];
  for (const draft of input.orders) {
    const { totalPaise, unknown } = totalOf(draft.lines);
    const id = await insertOrder(tx, {
      userId,
      shopId: draft.shopId,
      requestId: null,
      errandId: null,
      listId: input.listId,
      lines: draft.lines,
      itemsTotalPaise: totalPaise,
      unknownPriceCount: unknown,
      feePaise: draft.feePaise,
      feeMinutes: null,
      addressText,
      customerFirstName: firstNameOf(input.customerName) ?? picked?.customerName ?? null,
      lat: input.lat,
      lng: input.lng,
      note: cleanNote(input.note),
      state: draft.state,
      expiryMinutes: ORDER_EXPIRY_MINUTES,
    });
    if (!id) throw new ApiError(409, 'order_exists', 'An order is already open for this shop');
    records.push((await findOrder(tx, id)) as OrderRecord);
  }
  if (input.saveAddress === true)
    await saveAddress(tx, userId, addressText, firstNameOf(input.customerName));
  return records;
}

/** After the commit: the shops hear of their new order, and so does the simulator. */
export async function announceOrdersCreated(
  ctx: OrdersContext,
  orders: OrderRecord[],
): Promise<void> {
  for (const order of orders) {
    ctx.logger.info(
      { orderId: order.id, shopId: order.shopId, listId: order.listId },
      'delivery order placed',
    );
    announce(ctx, order, 'created');
    if (ctx.events && (await isSimulated(ctx.db, order.shopId)))
      ctx.events.publish(
        {
          to: { admin: true },
          type: 'order.created',
          data: { orderId: order.id, shopId: order.shopId, state: order.state },
        },
        ctx.logger,
      );
  }
}

/**
 * The owning shop ticks or clears one line as packed (ADR-0055 rule 12), while the order is not
 * final. Someone else's order is a 404; a final order 409; a line that is not there 404. The
 * customer gets a hint (`order.packed`), not an `order.updated`, which would look like a new state.
 */
export async function packLine(
  ctx: OrdersContext,
  ownerUserId: string,
  id: string,
  index: number,
  packed: boolean,
) {
  const order = await findOrder(ctx.db, id);
  if (!order || order.shopOwnerUserId !== ownerUserId)
    throw new ApiError(404, 'not_found', 'No such order');
  const fresh = await expireIfDue(ctx, order);
  if (isFinalOrderState(fresh.state))
    throw new ApiError(409, 'order_closed', 'This order has ended: its lines cannot change');
  const line = fresh.lines[index];
  if (!line) throw new ApiError(404, 'not_found', 'No such line');
  if ((line.packed === true) !== packed) {
    if (!(await setLinePacked(ctx.db, id, index, packed)))
      throw new ApiError(409, 'order_closed', 'This order has ended: its lines cannot change');
    ctx.events?.publish(
      { to: { userId: fresh.userId }, type: 'order.packed', data: { orderId: id } },
      ctx.logger,
    );
  }
  return shopOrderView((await findOrder(ctx.db, id)) as OrderRecord);
}
