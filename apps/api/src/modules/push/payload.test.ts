import { describe, expect, it } from 'vitest';
import { buildPayload, type PushKind } from './payload.js';

const ID = '3f2b8c1e-5d4a-4b7e-9a10-0c1d2e3f4a5b';

describe('list answer pushes (customer, ADR-0055)', () => {
  it('the first answer names the shop and how many lines it has, and alerts', () => {
    expect(
      buildPayload('list_answered', {
        id: ID,
        shop: 'Sharma General Store',
        shops: 1,
        have: 4,
        total: 5,
      }),
    ).toEqual({
      title: 'Sharma General Store has 4 of your 5',
      body: 'Tap to see the answers',
      tag: `list:${ID}`,
      renotify: true,
      url: `/app/list/${ID}`,
    });
  });

  it('a shop with none of the lines is still named, without a count', () => {
    expect(
      buildPayload('list_answered', { id: ID, shop: 'Sharma', shops: 1, have: 0, total: 5 }).title,
    ).toBe('Sharma answered your list');
  });

  it('later answers update the same notification quietly with the count', () => {
    const p = buildPayload('list_answered', {
      id: ID,
      shop: 'Sharma',
      shops: 3,
      have: 1,
      total: 5,
    });
    expect(p).toMatchObject({
      title: '3 shops answered your list',
      tag: `list:${ID}`,
      renotify: false,
    });
  });

  it('when the list is done it alerts once more, and says "1 shop" in the singular', () => {
    expect(buildPayload('list_ready', { id: ID, shops: 8 })).toMatchObject({
      title: 'Your list is ready: 8 shops answered',
      tag: `list:${ID}`,
      renotify: true,
      url: `/app/list/${ID}`,
    });
    expect(buildPayload('list_ready', { id: ID, shops: 1 }).title).toBe(
      'Your list is ready: 1 shop answered',
    );
  });

  it('carries only words: a phone number in a shop name is removed', () => {
    const p = buildPayload('list_answered', {
      id: ID,
      shop: 'Sharma 98765 43210',
      shops: 1,
      have: 1,
      total: 2,
    });
    expect(JSON.stringify(p)).not.toMatch(/98765/);
  });
});

describe('pickup pushes (ADR-0055)', () => {
  it('tells the customer their order is ready, with a tag per order', () => {
    expect(buildPayload('order_ready', { item: 'atta +2', id: ID, shop: 'Sharma' })).toMatchObject({
      title: 'Sharma: your atta +2 is ready for pickup',
      tag: `order:${ID}`,
      url: `/app/order/${ID}`,
    });
  });
});

describe('buildPayload', () => {
  it('names the item and the distance band in a new request, with one tag for the whole shop', () => {
    expect(buildPayload('new_ping', { item: 'atta', band: 'under 1 km' })).toEqual({
      title: 'New request: atta · under 1 km',
      body: 'Open the shop to answer',
      tag: 'shop-requests',
      renotify: true,
      url: '/app/shop',
    });
  });

  it('adds "and N more" when several requests wait, and still alerts', () => {
    const payload = buildPayload('new_ping', { item: 'atta', band: '1–2 km', more: 2 });
    expect(payload.title).toBe('New request: atta · 1–2 km and 2 more');
    expect(payload.tag).toBe('shop-requests');
    expect(payload.renotify).toBe(true);
  });

  it('writes the shop order titles with a tag per order', () => {
    expect(buildPayload('new_order', { item: 'atta', id: ID })).toMatchObject({
      title: 'New order: atta',
      tag: `order:${ID}`,
      url: '/app/shop',
    });
    expect(buildPayload('order_chosen', { item: 'atta', id: ID })).toMatchObject({
      title: 'Customer chose you: atta',
      tag: `order:${ID}`,
      url: '/app/shop',
    });
  });

  it('names the shop and the price for the first answer, and alerts', () => {
    expect(
      buildPayload('shop_answered', {
        item: 'atta',
        id: ID,
        shop: 'Raju Kirana',
        pricePaise: 4500,
      }),
    ).toEqual({
      title: 'Raju Kirana has atta · ₹45',
      body: 'Tap to see the reply',
      tag: `req:${ID}`,
      renotify: true,
      url: `/app/request/${ID}`,
    });
    expect(
      buildPayload('shop_answered', { item: 'atta', id: ID, shop: 'Raju', pricePaise: 4550 }).title,
    ).toBe('Raju has atta · ₹45.50');
    expect(buildPayload('shop_answered', { item: 'atta', id: ID, shop: 'Raju' }).title).toBe(
      'Raju has atta',
    );
  });

  it('updates the same notification silently when more shops answer', () => {
    const payload = buildPayload('shop_answered', {
      item: 'atta',
      id: ID,
      shops: 3,
      pricePaise: 4200,
    });
    expect(payload.title).toBe('3 shops have atta · from ₹42');
    expect(payload.tag).toBe(`req:${ID}`);
    expect(payload.renotify).toBe(false);
  });

  it('writes the customer order titles with the shop named and a tag per order', () => {
    const args = { item: 'atta', id: ID, shop: 'Raju' };
    expect(buildPayload('order_accepted', args).title).toBe('Raju accepted your atta order');
    expect(buildPayload('order_declined', args).title).toBe('Raju declined your atta order');
    expect(buildPayload('order_out', args).title).toBe('Raju: your atta is on the way');
    expect(buildPayload('order_cancelled_by_shop', args).title).toBe(
      'Raju cancelled your atta order',
    );
    for (const kind of [
      'order_accepted',
      'order_declined',
      'order_out',
      'order_cancelled_by_shop',
    ] as const) {
      const payload = buildPayload(kind, args);
      expect(payload.tag, kind).toBe(`order:${ID}`);
      expect(payload.url, kind).toBe(`/app/order/${ID}`);
    }
  });

  it('says the errand plan is ready, with a tag per errand', () => {
    expect(buildPayload('plan_ready', { id: ID })).toMatchObject({
      title: 'Your errand plan is ready',
      tag: `errand:${ID}`,
      url: `/app/errand/${ID}`,
    });
  });

  it('asks "Did you get ...?" with the item only, and opens the home screen', () => {
    expect(buildPayload('pickup_ask', { item: 'atta' })).toMatchObject({
      title: 'Did you get atta?',
      tag: 'pickup',
      url: '/app/',
    });
  });

  it('no longer has a push for the shop when the customer taps Received, nor a dead delivered kind', () => {
    const kinds: string[] = [
      'new_ping',
      'new_order',
      'shop_answered',
      'plan_ready',
      'order_accepted',
      'order_declined',
      'order_out',
      'order_chosen',
      'order_cancelled_by_shop',
      'pickup_ask',
    ];
    expect(() => buildPayload('order_received' as PushKind, { item: 'atta', id: ID })).toThrow();
    expect(() => buildPayload('order_delivered' as PushKind, { item: 'atta', id: ID })).toThrow();
    expect(kinds).toHaveLength(10);
  });

  // The privacy rule (ADR-0034): a push passes through Google, Mozilla and Apple servers.
  describe('privacy', () => {
    const kinds: PushKind[] = [
      'new_ping',
      'new_order',
      'shop_answered',
      'plan_ready',
      'order_accepted',
      'order_declined',
      'order_out',
      'order_chosen',
      'order_cancelled_by_shop',
      'pickup_ask',
    ];

    it('has exactly a title, a body, a tag, renotify and a deep link, and nothing else', () => {
      for (const kind of kinds) {
        const payload = buildPayload(kind, {
          item: 'atta',
          id: ID,
          shop: 'Raju',
          band: 'under 1 km',
        });
        expect(Object.keys(payload).sort(), kind).toEqual([
          'body',
          'renotify',
          'tag',
          'title',
          'url',
        ]);
        expect(payload.url, kind).toMatch(
          /^\/app\/(shop|request\/[\w-]+|errand\/[\w-]+|order\/[\w-]+)?$/,
        );
        expect(payload.tag, kind).toMatch(/^[\w:-]{1,80}$/);
      }
    });

    it('never carries a phone number or coordinates, even if the item or shop name does', () => {
      const hostile = [
        'atta +919876543210',
        'atta 9876543210',
        'atta 98765 43210',
        'atta 22.7196, 75.8577',
      ];
      for (const kind of kinds) {
        for (const item of hostile) {
          const text = JSON.stringify(
            buildPayload(kind, { item, id: ID, shop: `Raju ${item}`, band: 'under 1 km' }),
          );
          expect(text, `${kind} ${item}`).not.toMatch(/\d{7}/);
          expect(text, `${kind} ${item}`).not.toMatch(/\+91/);
          expect(text, `${kind} ${item}`).not.toMatch(/\d{1,3}\.\d{3,}/);
          if (kind !== 'plan_ready') expect(text, `${kind} ${item}`).toContain('atta');
        }
      }
    });

    it('has no way to take an address: the builder is only given a kind and a small set of words', () => {
      expect(buildPayload.length).toBe(2);
    });

    it('keeps only a short, plain item and shop name', () => {
      const payload = buildPayload('shop_answered', {
        item: `  a\u0000tta\n\n  ${'x'.repeat(200)} `,
        shop: 'S'.repeat(200),
        id: ID,
      });
      expect(payload.title).not.toMatch(/[\u0000-\u001f]/);
      expect(payload.title.length).toBeLessThanOrEqual(120);
    });

    it('refuses an id that is not a plain id, so the link and tag cannot be bent', () => {
      expect(() => buildPayload('shop_answered', { item: 'atta', id: '../../evil' })).toThrow();
      expect(() => buildPayload('order_out', { item: 'atta', id: 'x?y=1' })).toThrow();
      expect(() => buildPayload('plan_ready', {})).toThrow();
    });
  });
});
