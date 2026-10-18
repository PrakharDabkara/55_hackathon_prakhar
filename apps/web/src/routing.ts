/** The shop app lives at /app/shop; every other address under /app/ is the customer app. */
export function isShopPath(pathname: string): boolean {
  return pathname === '/app/shop' || pathname.startsWith('/app/shop/');
}

const ERRAND_PATH = /^\/app\/errand(?:\/([\w-]+))?\/?$/;

/** The customer's errand screen: describe a whole task, get two plans. /app/errand/<id> is one errand. */
export function isErrandPath(pathname: string): boolean {
  return ERRAND_PATH.test(pathname);
}

/** The errand a reload should show again, from /app/errand/<id>; null on the empty form. */
export function errandIdFromPath(pathname: string): string | null {
  return ERRAND_PATH.exec(pathname)?.[1] ?? null;
}

const ORDER_PATH = /^\/app\/order\/([\w-]+)\/?$/;
const REQUEST_PATH = /^\/app\/request\/([\w-]+)\/?$/;

/** The customer's list of orders ("Mere orders"). */
export function isOrdersPath(pathname: string): boolean {
  return pathname === '/app/orders' || pathname === '/app/orders/';
}

/** The order a reload should show again, from /app/order/<id>. */
export function orderIdFromPath(pathname: string): string | null {
  return ORDER_PATH.exec(pathname)?.[1] ?? null;
}

/** The search a reload or a link should show again, from /app/request/<id>. */
export function requestIdFromPath(pathname: string): string | null {
  return REQUEST_PATH.exec(pathname)?.[1] ?? null;
}
