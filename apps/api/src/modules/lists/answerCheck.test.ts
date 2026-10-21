import { describe, expect, it } from 'vitest';
import { checkListAnswer } from './answerCheck.js';

const sent = ['l1', 'l2', 'l3'];
const ok = { canDeliverHere: true };

describe('checkListAnswer (ADR-0055 rule 7)', () => {
  it('accepts every sent line answered, prices in whole rupees stored as paise', () => {
    const r = checkListAnswer(
      sent,
      {
        lines: [
          { lineId: 'l1', have: true, priceRupees: 45 },
          { lineId: 'l2', have: false },
          { lineId: 'l3', have: true, priceRupees: 120 },
        ],
        canDeliver: true,
        deliveryFeeRupees: 20,
      },
      ok,
    );
    expect(r).toEqual({
      ok: true,
      lines: [
        { lineId: 'l1', have: true, pricePaise: 4500 },
        { lineId: 'l2', have: false, pricePaise: null },
        { lineId: 'l3', have: true, pricePaise: 12000 },
      ],
      canDeliver: true,
      deliveryFeePaise: 2000,
    });
  });

  it('refuses a line the parchi did not carry', () => {
    const r = checkListAnswer(
      sent,
      {
        lines: [...sent.map((lineId) => ({ lineId, have: false })), { lineId: 'zzz', have: false }],
      },
      ok,
    );
    expect(r).toMatchObject({ ok: false, code: 'line_not_sent' });
  });

  it('refuses a missing line and a repeated line', () => {
    expect(checkListAnswer(sent, { lines: [{ lineId: 'l1', have: false }] }, ok)).toMatchObject({
      ok: false,
      code: 'lines_missing',
    });
    expect(
      checkListAnswer(
        sent,
        {
          lines: [
            { lineId: 'l1', have: false },
            { lineId: 'l1', have: false },
            { lineId: 'l2', have: false },
            { lineId: 'l3', have: false },
          ],
        },
        ok,
      ),
    ).toMatchObject({ ok: false, code: 'duplicate_line' });
  });

  it('needs a price with have, and refuses one without it', () => {
    const base = [
      { lineId: 'l2', have: false },
      { lineId: 'l3', have: false },
    ];
    expect(
      checkListAnswer(sent, { lines: [{ lineId: 'l1', have: true }, ...base] }, ok),
    ).toMatchObject({
      ok: false,
      code: 'price_required',
    });
    expect(
      checkListAnswer(
        sent,
        {
          lines: [
            { lineId: 'l1', have: false, priceRupees: 5 },
            ...base.slice(0, 0),
            { lineId: 'l2', have: false },
            { lineId: 'l3', have: false },
          ],
        },
        ok,
      ),
    ).toMatchObject({ ok: false, code: 'price_not_allowed' });
  });

  it('a fee needs canDeliver, and canDeliver needs the shop to reach the customer', () => {
    const lines = sent.map((lineId) => ({ lineId, have: false }));
    expect(checkListAnswer(sent, { lines, deliveryFeeRupees: 10 }, ok)).toMatchObject({
      ok: false,
      code: 'fee_without_delivery',
    });
    expect(
      checkListAnswer(sent, { lines, canDeliver: true }, { canDeliverHere: false }),
    ).toMatchObject({ ok: false, code: 'cannot_deliver' });
  });

  it('canDeliver without a fee means no fee named (null), not a free delivery', () => {
    const lines = sent.map((lineId) => ({ lineId, have: false }));
    expect(checkListAnswer(sent, { lines, canDeliver: true }, ok)).toMatchObject({
      ok: true,
      canDeliver: true,
      deliveryFeePaise: null,
    });
  });
});
