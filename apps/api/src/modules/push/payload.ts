/**
 * What a push may say (ADR-0034). It travels through the browser maker's servers, so it is a title,
 * the item name and a deep link, and nothing else: no phone, address, coordinates or ids beyond the
 * link. The builder is only given an item name and an id, so there is nothing else it could include.
 */
export type PushKind =
  | 'new_ping'
  | 'new_order'
  | 'shop_answered'
  | 'plan_ready'
  | 'order_accepted'
  | 'order_declined'
  | 'order_out'
  | 'order_delivered'
  | 'order_chosen'
  | 'order_received'
  | 'order_cancelled_by_shop'
  | 'pickup_ask';

export interface PushPayload {
  title: string;
  item: string;
  /** A path inside /app/, opened when the notification is tapped. */
  url: string;
}

const ITEM_MAX = 60;
const PLAIN_ID = /^[\w-]{1,64}$/;

/** Our privacy rule for free text: a run of digits that looks like a phone number goes. */
export const stripPhoneNumbers = (text: string): string => text.replace(/\+?\d[\d\s-]{5,}\d/g, ' ');

/** A short single-line item name with nothing that looks like a phone number or a coordinate. */
export function cleanItem(raw: string | undefined): string {
  const text = stripPhoneNumbers((raw ?? '').replace(/[\u0000-\u001f\u007f]/g, ' '))
    .replace(/-?\d{1,3}\.\d{3,}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > ITEM_MAX ? `${text.slice(0, ITEM_MAX - 1).trimEnd()}…` : text;
}

const TITLES: Record<PushKind, (item: string) => string> = {
  new_ping: (item) => `Naya sawaal: ${item}`,
  new_order: (item) => `Naya order: ${item}`,
  shop_answered: (item) => `Dukaan ne jawab diya: ${item}`,
  plan_ready: () => 'Plan taiyaar',
  order_accepted: (item) => `Order accept ho gaya: ${item}`,
  order_declined: (item) => `Dukaan ne order mana kiya: ${item}`,
  order_out: (item) => `Order raaste mein hai: ${item}`,
  order_delivered: (item) => `Order pahunch gaya: ${item}`,
  order_chosen: (item) => `Grahak ne aapko chuna: ${item}`,
  // The customer tapped Received: the shop hears the same words the customer used to.
  order_received: (item) => `Order pahunch gaya: ${item}`,
  order_cancelled_by_shop: (item) => `Dukaan ne order cancel kiya: ${item}`,
  pickup_ask: (item) => `Kya aapko ${item} mila?`,
};

/** The link for each kind; the id is the request, errand or order it is about. */
function linkFor(kind: PushKind, id: string | undefined): string {
  if (
    kind === 'new_ping' ||
    kind === 'new_order' ||
    kind === 'order_chosen' ||
    kind === 'order_received'
  )
    return '/app/shop';
  // The question itself is on the customer's home screen ("Le liya?", ADR-0035).
  if (kind === 'pickup_ask') return '/app/';
  if (!id || !PLAIN_ID.test(id)) throw new Error(`push kind ${kind} needs a plain id for its link`);
  if (kind === 'shop_answered') return `/app/request/${id}`;
  if (kind === 'plan_ready') return `/app/errand/${id}`;
  return `/app/order/${id}`;
}

export function buildPayload(
  kind: PushKind,
  { item, id }: { item?: string; id?: string },
): PushPayload {
  const name = cleanItem(item);
  return { title: TITLES[kind](name).trim(), item: name, url: linkFor(kind, id) };
}
