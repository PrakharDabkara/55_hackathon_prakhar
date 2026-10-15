/** The shop app lives at /app/shop; every other address under /app/ is the customer app. */
export function isShopPath(pathname: string): boolean {
  return pathname === '/app/shop' || pathname.startsWith('/app/shop/');
}
