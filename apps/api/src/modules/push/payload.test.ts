import { describe, expect, it } from 'vitest';
import { buildPayload, type PushKind } from './payload.js';

const ID = '3f2b8c1e-5d4a-4b7e-9a10-0c1d2e3f4a5b';

describe('buildPayload', () => {
  it('writes the shop titles', () => {
    expect(buildPayload('new_ping', { item: 'atta' }).title).toBe('Naya sawaal: atta');
    expect(buildPayload('new_order', { item: 'atta' }).title).toBe('Naya order: atta');
  });

  it('writes the customer titles', () => {
    expect(buildPayload('shop_answered', { item: 'atta', id: ID }).title).toBe(
      'Dukaan ne jawab diya: atta',
    );
    expect(buildPayload('plan_ready', { id: ID }).title).toBe('Plan taiyaar');
    expect(buildPayload('order_accepted', { item: 'atta', id: ID }).title).toMatch(/accept/i);
    expect(buildPayload('order_declined', { item: 'atta', id: ID }).title).toMatch(/decline|mana/i);
    expect(buildPayload('order_out', { item: 'atta', id: ID }).title).toMatch(/nikla|raaste|out/i);
    expect(buildPayload('order_delivered', { item: 'atta', id: ID }).title).toMatch(
      /pahunch|deliver/i,
    );
  });

  it('links to the right screen', () => {
    expect(buildPayload('new_ping', { item: 'atta' }).url).toBe('/app/shop');
    expect(buildPayload('new_order', { item: 'atta' }).url).toBe('/app/shop');
    expect(buildPayload('shop_answered', { item: 'atta', id: ID }).url).toBe(`/app/request/${ID}`);
    expect(buildPayload('plan_ready', { id: ID }).url).toBe(`/app/errand/${ID}`);
    for (const kind of [
      'order_accepted',
      'order_declined',
      'order_out',
      'order_delivered',
    ] as const)
      expect(buildPayload(kind, { item: 'atta', id: ID }).url).toBe(`/app/order/${ID}`);
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
      'order_delivered',
    ];

    it('has exactly a title, the item name and a deep link, and nothing else', () => {
      for (const kind of kinds) {
        const payload = buildPayload(kind, { item: 'atta', id: ID });
        expect(Object.keys(payload).sort(), kind).toEqual(['item', 'title', 'url']);
        expect(payload.url, kind).toMatch(
          /^\/app\/(shop|request\/[\w-]+|errand\/[\w-]+|order\/[\w-]+)$/,
        );
      }
    });

    it('never carries a phone number, an address or coordinates, even if the item text does', () => {
      const hostile = [
        'atta +919876543210',
        'atta 9876543210',
        'atta at Flat 4B, Sapna Apartments, Vijay Nagar',
        'atta 22.7196, 75.8577',
      ];
      for (const kind of kinds) {
        for (const item of hostile) {
          const text = JSON.stringify(buildPayload(kind, { item, id: ID }));
          expect(text, `${kind} ${item}`).not.toMatch(/\d{10}/);
          expect(text, `${kind} ${item}`).not.toMatch(/\+91/);
          expect(text, `${kind} ${item}`).not.toMatch(/\d{1,3}\.\d{3,}/);
          expect(text, `${kind} ${item}`).not.toMatch(/flat|apartments|nagar/i);
        }
      }
    });

    it('keeps only a short, plain item name', () => {
      const payload = buildPayload('new_ping', { item: `  a\u0000tta\n\n  ${'x'.repeat(200)} ` });
      expect(payload.item).not.toMatch(/[\u0000-\u001f]/);
      expect(payload.item.length).toBeLessThanOrEqual(60);
      expect(payload.title.length).toBeLessThanOrEqual(90);
    });

    it('refuses an id that is not a plain id, so the link cannot be bent', () => {
      expect(() => buildPayload('shop_answered', { item: 'atta', id: '../../evil' })).toThrow();
      expect(() => buildPayload('order_out', { item: 'atta', id: 'x?y=1' })).toThrow();
      expect(() => buildPayload('plan_ready', {})).toThrow();
    });
  });
});
