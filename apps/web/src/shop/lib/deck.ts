import type { ShopListParchi, ShopPing } from '../../lib/api.js';
import type { ShopOrder } from '../../lib/orders.js';

export type Slip =
  | { kind: 'order'; key: string; order: ShopOrder }
  | { kind: 'ping'; key: string; ping: ShopPing }
  | { kind: 'list'; key: string; parchi: ShopListParchi; closed: boolean };

const expiry = (slip: Slip): { expiresAt: string } =>
  slip.kind === 'ping' ? slip.ping : slip.kind === 'list' ? slip.parchi : slip.order;

const byExpiry = <T extends { expiresAt: string }>(a: T, b: T) =>
  Date.parse(a.expiresAt) - Date.parse(b.expiresAt);

/**
 * The deck: order requests first (they are money waiting), then single requests and shopping lists
 * together, each by what runs out soonest. A list that has just closed keeps its place, as a notice.
 */
export function buildDeck(
  pings: readonly ShopPing[],
  orders: readonly ShopOrder[],
  lists: readonly ShopListParchi[] = [],
  closedLists: readonly ShopListParchi[] = [],
): Slip[] {
  const questions: Slip[] = [
    ...pings.map((ping): Slip => ({ kind: 'ping', key: `ping:${ping.id}`, ping })),
    ...lists.map((parchi): Slip => ({
      kind: 'list',
      key: `list:${parchi.id}`,
      parchi,
      closed: false,
    })),
    ...closedLists.map((parchi): Slip => ({
      kind: 'list',
      key: `list:${parchi.id}`,
      parchi,
      closed: true,
    })),
  ].sort((a, b) => byExpiry(expiry(a), expiry(b)));
  return [
    ...orders
      .filter((order) => order.state === 'REQUESTED')
      .sort(byExpiry)
      .map((order): Slip => ({ kind: 'order', key: `order:${order.id}`, order })),
    ...questions,
  ];
}

/**
 * Orders that are ACCEPTED now and were not when we last looked: a customer chose this shop. `seen`
 * is null on the first look, so a reload does not announce old orders as new.
 */
export function newlyAccepted(
  seen: ReadonlySet<string> | null,
  orders: readonly ShopOrder[],
): ShopOrder[] {
  if (seen === null) return [];
  return orders.filter((order) => order.state === 'ACCEPTED' && !seen.has(order.id));
}
