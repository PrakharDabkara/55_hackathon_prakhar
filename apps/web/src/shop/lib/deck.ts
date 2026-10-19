import type { ShopPing } from '../../lib/api.js';
import type { ShopOrder } from '../../lib/orders.js';

export type Slip =
  { kind: 'order'; key: string; order: ShopOrder } | { kind: 'ping'; key: string; ping: ShopPing };

const byExpiry = <T extends { expiresAt: string }>(a: T, b: T) =>
  Date.parse(a.expiresAt) - Date.parse(b.expiresAt);

/** The deck: order requests first (they are money waiting), then pings, each by what runs out soonest. */
export function buildDeck(pings: readonly ShopPing[], orders: readonly ShopOrder[]): Slip[] {
  return [
    ...orders
      .filter((order) => order.state === 'REQUESTED')
      .sort(byExpiry)
      .map((order): Slip => ({ kind: 'order', key: `order:${order.id}`, order })),
    ...[...pings]
      .sort(byExpiry)
      .map((ping): Slip => ({ kind: 'ping', key: `ping:${ping.id}`, ping })),
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
