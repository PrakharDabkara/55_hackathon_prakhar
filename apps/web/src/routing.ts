/** The shop app lives at /app/shop; every other address under /app/ is the customer app. */
export function isShopPath(pathname: string): boolean {
  return pathname === '/app/shop' || pathname.startsWith('/app/shop/');
}

/** The customer's errand screen: describe a whole task, get two plans. */
export function isErrandPath(pathname: string): boolean {
  return pathname === '/app/errand' || pathname === '/app/errand/';
}
