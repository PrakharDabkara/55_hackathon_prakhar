/**
 * What a push may say (ADR-0034, ADR-0044). It travels through the browser maker's servers, so it
 * is a title, one line, a tag and a deep link, and nothing else: no phone, address, coordinates or
 * ids beyond the link and tag. The builder is only given plain words (item, shop name, a distance
 * band, a price, counts), so there is nothing else it could include.
 */
export type PushKind =
  | 'new_ping'
  | 'new_order'
  | 'new_list'
  | 'shop_answered'
  | 'plan_ready'
  | 'order_accepted'
  | 'order_declined'
  | 'order_out'
  | 'order_ready'
  | 'list_answered'
  | 'list_ready'
  | 'order_chosen'
  | 'order_cancelled_by_shop'
  | 'pickup_ask';

export interface PushPayload {
  title: string;
  /** One short line under the title. */
  body: string;
  /** A later push with the same tag replaces the earlier one on the phone instead of stacking. */
  tag: string;
  /** Whether a replacing push should alert again (false: it quietly updates the one on screen). */
  renotify: boolean;
  /** A path inside /app/, opened when the notification is tapped. */
  url: string;
}

/** The words a push may be built from. The builder takes nothing else, so nothing else can leave. */
export interface PushArgs {
  item?: string;
  id?: string;
  /** The shop's public name. */
  shop?: string;
  /** The distance band a shop is told, never a position. */
  band?: string;
  pricePaise?: number;
  /** Shops that have said yes (for the customer's one-per-request notification). */
  shops?: number;
  /** Other requests still waiting on this shop. */
  more?: number;
  /** A list answer: how many of the list's lines the shop has, out of how many. */
  have?: number;
  total?: number;
}

const ITEM_MAX = 60;
const NAME_MAX = 30;
const PLAIN_ID = /^[\w-]{1,64}$/;

/** Our privacy rule for free text: a run of digits that looks like a phone number goes. */
export const stripPhoneNumbers = (text: string): string => text.replace(/\+?\d[\d\s-]{5,}\d/g, ' ');

/** A short single-line name with nothing that looks like a phone number or a coordinate. */
export function cleanText(raw: string | undefined, max: number): string {
  const text = stripPhoneNumbers((raw ?? '').replace(/[\u0000-\u001f\u007f]/g, ' '))
    .replace(/-?\d{1,3}\.\d{3,}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}
export const cleanItem = (raw: string | undefined): string => cleanText(raw, ITEM_MAX);

const rupees = (paise: number): string => {
  const value = paise / 100;
  return `₹${Number.isInteger(value) ? value : value.toFixed(2)}`;
};

interface Words {
  item: string;
  shop: string;
  band: string;
  price: string;
  shops: number;
  more: number;
  have: number;
  total: number;
}

interface Copy {
  title: (w: Words) => string;
  body: string;
  /** The tag, from the plain id (or fixed for a screen-wide notification). */
  tag: (id: string) => string;
  link: (id: string) => string;
  needsId: boolean;
  renotify: (w: Words) => boolean;
}

const ofOrder = (id: string) => `order:${id}`;
const customerOrder = (title: (w: Words) => string): Copy => ({
  title,
  body: 'Tap to see your order',
  tag: ofOrder,
  link: (id) => `/app/order/${id}`,
  needsId: true,
  renotify: () => true,
});
const shopOrder = (title: (w: Words) => string): Copy => ({
  title,
  body: 'Open the shop to see it',
  tag: ofOrder,
  link: () => '/app/shop',
  needsId: true,
  renotify: () => true,
});

const COPY: Record<PushKind, Copy> = {
  // One notification per shop, replaced by each new request (ADR-0044).
  new_ping: {
    title: (w) => `New request: ${w.item} · ${w.band}${w.more > 0 ? ` and ${w.more} more` : ''}`,
    body: 'Open the shop to answer',
    tag: () => 'shop-requests',
    link: () => '/app/shop',
    needsId: false,
    renotify: () => true,
  },
  // One notification per shop per list (ADR-0055). The id is the shop's own parchi, so a repeat
  // replaces it and a tap opens the deck at that card.
  new_list: {
    title: (w) => `New list: ${w.item} · ${w.band}`,
    body: 'Open the shop to answer',
    tag: (id) => `list:${id}`,
    link: (id) => `/app/shop?parchi=${id}`,
    needsId: true,
    renotify: () => true,
  },
  new_order: shopOrder((w) => `New order: ${w.item}`),
  order_chosen: shopOrder((w) => `Customer chose you: ${w.item}`),
  // One notification per request: the first yes alerts, the 2nd and 3rd update it quietly.
  shop_answered: {
    title: (w) =>
      w.shops > 1
        ? `${w.shops} shops have ${w.item}${w.price ? ` · from ${w.price}` : ''}`
        : `${w.shop} has ${w.item}${w.price ? ` · ${w.price}` : ''}`,
    body: 'Tap to see the reply',
    tag: (id) => `req:${id}`,
    link: (id) => `/app/request/${id}`,
    needsId: true,
    renotify: (w) => w.shops <= 1,
  },
  plan_ready: {
    title: () => 'Your errand plan is ready',
    body: 'Tap to see the plan',
    tag: (id) => `errand:${id}`,
    link: (id) => `/app/errand/${id}`,
    needsId: true,
    renotify: () => true,
  },
  order_accepted: customerOrder((w) => `${w.shop} accepted your ${w.item} order`),
  order_declined: customerOrder((w) => `${w.shop} declined your ${w.item} order`),
  order_ready: customerOrder((w) => `${w.shop}: your ${w.item} is ready for pickup`),
  // One notification per list (ADR-0055): the first answer alerts, the next ones update it quietly,
  // and the end of the list alerts once more with "ready".
  list_answered: {
    title: (w) =>
      w.shops > 1
        ? `${w.shops} shops answered your list`
        : w.have > 0
          ? `${w.shop} has ${w.have} of your ${w.total}`
          : `${w.shop} answered your list`,
    body: 'Tap to see the answers',
    tag: (id) => `list:${id}`,
    link: (id) => `/app/list/${id}`,
    needsId: true,
    renotify: (w) => w.shops <= 1,
  },
  list_ready: {
    title: (w) => `Your list is ready: ${w.shops} ${w.shops === 1 ? 'shop' : 'shops'} answered`,
    body: 'Tap to see the answers',
    tag: (id) => `list:${id}`,
    link: (id) => `/app/list/${id}`,
    needsId: true,
    renotify: () => true,
  },
  order_out: customerOrder((w) => `${w.shop}: your ${w.item} is on the way`),
  order_cancelled_by_shop: customerOrder((w) => `${w.shop} cancelled your ${w.item} order`),
  // The question itself is on the customer's home screen ("Le liya?", ADR-0035).
  pickup_ask: {
    title: (w) => `Did you get ${w.item}?`,
    body: 'Tap to tell us',
    tag: () => 'pickup',
    link: () => '/app/',
    needsId: false,
    renotify: () => true,
  },
};

export function buildPayload(kind: PushKind, args: PushArgs): PushPayload {
  const copy = COPY[kind];
  if (!copy) throw new Error(`unknown push kind ${String(kind)}`);
  const id = args.id ?? '';
  if (copy.needsId && !PLAIN_ID.test(id))
    throw new Error(`push kind ${kind} needs a plain id for its tag and link`);
  const words: Words = {
    item: cleanItem(args.item),
    shop: cleanText(args.shop, NAME_MAX) || 'A shop',
    band: cleanText(args.band, 20),
    price: args.pricePaise === undefined ? '' : rupees(args.pricePaise),
    shops: args.shops ?? 1,
    more: args.more ?? 0,
    have: args.have ?? 0,
    total: args.total ?? 0,
  };
  return {
    title: copy.title(words).trim(),
    body: copy.body,
    tag: copy.tag(id),
    renotify: copy.renotify(words),
    url: copy.link(id),
  };
}
