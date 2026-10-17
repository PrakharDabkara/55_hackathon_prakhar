import { describe, expect, it } from 'vitest';
import { errandIdFromPath, isErrandPath, isShopPath } from './routing.js';

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

describe('isErrandPath', () => {
  it('is the errand screen, with or without a trailing slash', () => {
    expect(isErrandPath('/app/errand')).toBe(true);
    expect(isErrandPath('/app/errand/')).toBe(true);
  });

  it('is also one errand at its own address, /app/errand/<id>', () => {
    expect(isErrandPath('/app/errand/3f2a-91')).toBe(true);
    expect(errandIdFromPath('/app/errand/3f2a-91')).toBe('3f2a-91');
    expect(errandIdFromPath('/app/errand/3f2a-91/')).toBe('3f2a-91');
    expect(errandIdFromPath('/app/errand')).toBeNull();
    expect(errandIdFromPath('/app/')).toBeNull();
  });

  it('is not anything else', () => {
    for (const p of ['/app/', '/app/errands', '/app/errand/a/b', '/app/errand/a b', '/app/shop']) {
      expect(isErrandPath(p), p).toBe(false);
    }
  });
});
