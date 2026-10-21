import { describe, expect, it } from 'vitest';
import {
  errandIdFromPath,
  isErrandPath,
  isShopPath,
  orderIdFromPath,
  requestIdFromPath,
  isOrdersPath,
  isAccountPath,
  listIdFromPath,
} from './routing.js';

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

describe('the paths of PR E (my orders, one order, one search)', () => {
  it('/app/orders is the list, /app/order/<id> is one order', () => {
    expect(isOrdersPath('/app/orders')).toBe(true);
    expect(isOrdersPath('/app/orders/')).toBe(true);
    expect(isOrdersPath('/app/order/abc')).toBe(false);
    expect(orderIdFromPath('/app/order/3f2a-9b')).toBe('3f2a-9b');
    expect(orderIdFromPath('/app/order/3f2a-9b/')).toBe('3f2a-9b');
    expect(orderIdFromPath('/app/order')).toBeNull();
    expect(orderIdFromPath('/app/orders')).toBeNull();
    expect(orderIdFromPath('/app/shop/order/x')).toBeNull();
  });

  it('/app/request/<id> is one search', () => {
    expect(requestIdFromPath('/app/request/7c1')).toBe('7c1');
    expect(requestIdFromPath('/app/request/')).toBeNull();
    expect(requestIdFromPath('/app/errand/7c1')).toBeNull();
  });
});

describe('isAccountPath', () => {
  it('is the Account screen, with or without a trailing slash', () => {
    expect(isAccountPath('/app/account')).toBe(true);
    expect(isAccountPath('/app/account/')).toBe(true);
    expect(isAccountPath('/app/accounts')).toBe(false);
    expect(isAccountPath('/app/shop/account')).toBe(false);
  });
});

describe('listIdFromPath', () => {
  it('/app/list/<id> is one shopping list, and the address a list push opens', () => {
    expect(listIdFromPath('/app/list/3f2a-91')).toBe('3f2a-91');
    expect(listIdFromPath('/app/list/3f2a-91/')).toBe('3f2a-91');
    expect(listIdFromPath('/app/list')).toBeNull();
    expect(listIdFromPath('/app/lists/x')).toBeNull();
    expect(listIdFromPath('/app/shop/list/x')).toBeNull();
  });
});
