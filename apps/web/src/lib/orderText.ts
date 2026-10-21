import type { CustomerStrings } from '../i18n/customerStrings.js';
import type { OrderState, SeekerOrder } from './orders.js';

/** The caption on the status card and the pill on an active row. */
export function orderCaption(c: CustomerStrings, state: OrderState): string {
  return {
    REQUESTED: c.capRequested,
    ACCEPTED: c.capAccepted,
    OUT_FOR_DELIVERY: c.capOut,
    DELIVERED: c.capDelivered,
    DECLINED: c.statusDeclined,
    EXPIRED: c.statusExpired,
    CANCELLED: c.statusCancelledYou,
    NOT_CONFIRMED: c.statusNotConfirmed,
    READY: c.capReady,
    COLLECTED: c.capCollected,
  }[state];
}

/** Plain status text for a finished order in the "Earlier" list. */
export function earlierStatus(
  c: CustomerStrings,
  order: Pick<SeekerOrder, 'state' | 'cancelledBy'>,
): string {
  if (order.state === 'CANCELLED')
    return order.cancelledBy === 'shop' ? c.statusCancelledShop : c.statusCancelledYou;
  return orderCaption(c, order.state);
}
