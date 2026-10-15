import { describe, expect, it } from 'vitest';
import { isShopPath } from './routing.js';

describe('isShopPath', () => {
  it('sends /app/shop and anything under it to the shop app', () => {
    expect(isShopPath('/app/shop')).toBe(true);
    expect(isShopPath('/app/shop/')).toBe(true);
    expect(isShopPath('/app/shop/anything')).toBe(true);
  });

  it('sends everything else under /app/ to the seeker app', () => {
    for (const p of ['/app/', '/app', '/app/find', '/app/shopping', '/app/shops']) {
      expect(isShopPath(p), p).toBe(false);
    }
  });
});
