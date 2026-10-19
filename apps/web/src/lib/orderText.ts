import type { Strings } from '../i18n/strings.js';
import type { OrderState } from './orders.js';

/** The one sentence that says where an order stands, for the list and for the order page. */
export function orderStatusText(t: Strings, state: OrderState): string {
  return {
    REQUESTED: t.orderWaiting,
    ACCEPTED: t.orderAccepted,
    OUT_FOR_DELIVERY: t.orderOut,
    DELIVERED: t.orderDoneFull,
    DECLINED: t.orderDeclined,
    EXPIRED: t.orderExpired,
    CANCELLED: t.orderCancelled,
    NOT_CONFIRMED: t.orderNotConfirmed,
  }[state];
}
