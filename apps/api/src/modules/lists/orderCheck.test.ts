import { describe, expect, it } from 'vitest';
import { checkOrderPlan, type AnsweredShop } from './orderCheck.js';

const answers = new Map<string, AnsweredShop>([
  [
    'A',
    {
      have: new Map([
        [0, 4500],
        [1, 1000],
      ]),
      canDeliver: true,
      feePaise: 2000,
    },
  ],
  ['B', { have: new Map([[2, 700]]), canDeliver: false, feePaise: null }],
]);
const positions = [0, 1, 2, 3];

describe('checkOrderPlan (ADR-0055 rule 11)', () => {
  it('groups the lines per shop with the shop answer prices and the chosen mode', () => {
    const r = checkOrderPlan(
      {
        assignments: [
          { position: 0, shopId: 'A' },
          { position: 1, shopId: 'A' },
          { position: 2, shopId: 'B' },
        ],
        modes: { A: 'delivery', B: 'pickup' },
      },
      { positions, answers },
    );
    expect(r).toEqual({
      ok: true,
      shops: [
        {
          shopId: 'A',
          mode: 'delivery',
          lines: [
            { position: 0, pricePaise: 4500 },
            { position: 1, pricePaise: 1000 },
          ],
          feePaise: 2000,
        },
        { shopId: 'B', mode: 'pickup', lines: [{ position: 2, pricePaise: 700 }], feePaise: null },
      ],
    });
  });

  it('a shop with no mode is pickup', () => {
    const r = checkOrderPlan(
      { assignments: [{ position: 2, shopId: 'B' }], modes: {} },
      { positions, answers },
    );
    expect(r).toMatchObject({ ok: true, shops: [{ shopId: 'B', mode: 'pickup' }] });
  });

  it('refuses delivery from a shop that did not say canDeliver', () => {
    expect(
      checkOrderPlan(
        { assignments: [{ position: 2, shopId: 'B' }], modes: { B: 'delivery' } },
        { positions, answers },
      ),
    ).toMatchObject({ ok: false, code: 'cannot_deliver' });
  });

  it('refuses a line the shop said it does not have, a shop that did not answer, and a line not on the list', () => {
    expect(
      checkOrderPlan(
        { assignments: [{ position: 3, shopId: 'A' }], modes: {} },
        { positions, answers },
      ),
    ).toMatchObject({ ok: false, code: 'line_not_available' });
    expect(
      checkOrderPlan(
        { assignments: [{ position: 0, shopId: 'Z' }], modes: {} },
        { positions, answers },
      ),
    ).toMatchObject({ ok: false, code: 'line_not_available' });
    expect(
      checkOrderPlan(
        { assignments: [{ position: 9, shopId: 'A' }], modes: {} },
        { positions, answers },
      ),
    ).toMatchObject({ ok: false, code: 'unknown_line' });
  });

  it('refuses a line given to two shops, a mode for a shop with no line, and an empty order', () => {
    expect(
      checkOrderPlan(
        {
          assignments: [
            { position: 0, shopId: 'A' },
            { position: 0, shopId: 'B' },
          ],
          modes: {},
        },
        { positions, answers },
      ),
    ).toMatchObject({ ok: false, code: 'line_assigned_twice' });
    expect(
      checkOrderPlan(
        { assignments: [{ position: 0, shopId: 'A' }], modes: { B: 'pickup' } },
        { positions, answers },
      ),
    ).toMatchObject({ ok: false, code: 'mode_without_lines' });
    expect(checkOrderPlan({ assignments: [], modes: {} }, { positions, answers })).toMatchObject({
      ok: false,
      code: 'nothing_to_order',
    });
  });
});
