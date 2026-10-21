import { describe, expect, it } from 'vitest';
import { at, shop, shopListParchi } from '../../test/fakes.js';
import {
  buildListAnswer,
  issuesFromError,
  listSummary,
  setLinePrice,
  startDraft,
  toggleLine,
} from './listAnswer.js';

const parchi = shopListParchi();
const sugar = at(parchi.lines, 0);
const pen = at(parchi.lines, 1);
const bolt = at(parchi.lines, 2);

describe('startDraft', () => {
  it('starts with nothing ticked and no prices', () => {
    const draft = startDraft(parchi, shop());
    expect(draft.ticked).toEqual({});
    expect(draft.prices).toEqual({});
    expect(draft.delivers).toBe(false);
    expect(draft.fee).toBe('');
  });

  it('offers delivery from the shop settings, with their fee, when this customer is in reach', () => {
    const delivering = shop({ deliversDefault: true, defaultFeePaise: 2000 });
    expect(startDraft(parchi, delivering)).toMatchObject({ delivers: true, fee: '20' });
    expect(startDraft(shopListParchi({ canDeliver: false }), delivering).delivers).toBe(false);
  });

  it('prefills the fee from the settings even while delivery is off', () => {
    expect(startDraft(parchi, shop({ defaultFeePaise: 1500 })).fee).toBe('15');
  });
});

describe('toggleLine', () => {
  it('ticks a line and fills its price from last time', () => {
    const draft = toggleLine(startDraft(parchi, shop()), sugar);
    expect(draft.ticked['l1']).toBe(true);
    expect(draft.prices['l1']).toBe('45');
  });

  it('leaves the price empty when there is no last price', () => {
    const draft = toggleLine(startDraft(parchi, shop()), pen);
    expect(draft.ticked['l2']).toBe(true);
    expect(draft.prices['l2'] ?? '').toBe('');
  });

  it('unticks, and keeps what was typed if it is ticked again', () => {
    let draft = toggleLine(startDraft(parchi, shop()), sugar);
    draft = setLinePrice(draft, 'l1', '50');
    draft = toggleLine(draft, sugar);
    expect(draft.ticked['l1']).toBe(false);
    draft = toggleLine(draft, sugar);
    expect(draft.prices['l1']).toBe('50');
  });
});

describe('listSummary', () => {
  it('counts ticked lines and totals their prices in paise', () => {
    let draft = startDraft(parchi, shop());
    expect(listSummary(parchi, draft)).toEqual({ ticked: 0, of: 3, totalPaise: 0 });
    draft = toggleLine(draft, sugar);
    draft = toggleLine(draft, pen);
    draft = setLinePrice(draft, 'l2', '12');
    expect(listSummary(parchi, draft)).toEqual({ ticked: 2, of: 3, totalPaise: 5700 });
  });

  it('ignores a blank or invalid price in the total, and an unticked line', () => {
    let draft = toggleLine(startDraft(parchi, shop()), pen);
    draft = setLinePrice(draft, 'l2', 'abc');
    draft = toggleLine(draft, bolt);
    draft = setLinePrice(draft, 'l3', '');
    draft = setLinePrice(draft, 'l1', '99');
    expect(listSummary(parchi, draft).totalPaise).toBe(0);
  });
});

describe('buildListAnswer', () => {
  it('sends every line: ticked ones with a whole-rupee price, the rest as "no"', () => {
    let draft = toggleLine(startDraft(parchi, shop()), sugar);
    draft = toggleLine(draft, bolt);
    draft = setLinePrice(draft, 'l3', ' 30 ');
    const result = buildListAnswer(parchi, draft);
    expect(result).toEqual({
      ok: true,
      none: false,
      body: {
        lines: [
          { lineId: 'l1', have: true, priceRupees: 45 },
          { lineId: 'l2', have: false },
          { lineId: 'l3', have: true, priceRupees: 30 },
        ],
      },
    });
  });

  it('nothing ticked is allowed and means "none of these"', () => {
    const result = buildListAnswer(parchi, startDraft(parchi, shop()));
    expect(result).toMatchObject({ ok: true, none: true });
    if (result.ok) expect(result.body.lines.every((l) => !l.have)).toBe(true);
  });

  it('asks for a price on a ticked line without one, and for whole rupees', () => {
    let draft = toggleLine(startDraft(parchi, shop()), pen);
    draft = toggleLine(draft, bolt);
    draft = setLinePrice(draft, 'l3', '12.5');
    const result = buildListAnswer(parchi, draft);
    expect(result).toEqual({
      ok: false,
      issues: { lines: { l2: 'price_required', l3: 'price_invalid' } },
    });
  });

  it('refuses a price of 0 or below, and one over the limit', () => {
    let draft = toggleLine(startDraft(parchi, shop()), pen);
    draft = setLinePrice(draft, 'l2', '-4');
    expect(buildListAnswer(parchi, draft)).toMatchObject({
      ok: false,
      issues: { lines: { l2: 'price_invalid' } },
    });
    draft = setLinePrice(draft, 'l2', '100001');
    expect(buildListAnswer(parchi, draft)).toMatchObject({ ok: false });
  });

  it('adds the delivery offer and one fee when delivery is on', () => {
    let draft = toggleLine(startDraft(parchi, shop({ defaultFeePaise: 2000 })), sugar);
    draft = { ...draft, delivers: true };
    expect(buildListAnswer(parchi, draft)).toMatchObject({
      ok: true,
      body: { canDeliver: true, deliveryFeeRupees: 20 },
    });
    expect(buildListAnswer(parchi, { ...draft, fee: '' })).toMatchObject({
      ok: true,
      body: { canDeliver: true },
    });
    const noFee = buildListAnswer(parchi, { ...draft, fee: '' });
    if (noFee.ok) expect(noFee.body.deliveryFeeRupees).toBeUndefined();
  });

  it('points at a fee that is not whole rupees', () => {
    let draft = toggleLine(startDraft(parchi, shop()), sugar);
    draft = { ...draft, delivers: true, fee: '2x' };
    expect(buildListAnswer(parchi, draft)).toEqual({
      ok: false,
      issues: { lines: {}, fee: 'fee_invalid' },
    });
  });

  it('sends no delivery with "none of these", or where this customer is out of reach', () => {
    const none = { ...startDraft(parchi, shop()), delivers: true, fee: '20' };
    const sent = buildListAnswer(parchi, none);
    if (sent.ok) expect(sent.body.canDeliver).toBeUndefined();
    const far = shopListParchi({ canDeliver: false });
    const draft = { ...toggleLine(startDraft(far, shop()), sugar), delivers: true };
    const farSent = buildListAnswer(far, draft);
    if (farSent.ok) expect(farSent.body.canDeliver).toBeUndefined();
  });
});

describe('issuesFromError', () => {
  const ticked = () => {
    let draft = toggleLine(startDraft(parchi, shop()), pen);
    draft = toggleLine(draft, bolt);
    return setLinePrice(draft, 'l3', '30');
  };

  it('price_required marks the ticked lines that have no price', () => {
    expect(issuesFromError('price_required', parchi, ticked())).toEqual({
      lines: { l2: 'price_required' },
    });
  });

  it('answers that are about the whole parchi become one message near the button', () => {
    for (const [code, form] of [
      ['cannot_deliver', 'cannot_deliver'],
      ['ping_closed', 'ping_closed'],
      ['fee_without_delivery', 'invalid'],
      ['lines_missing', 'invalid'],
      ['something_else', 'failed'],
    ] as const) {
      expect(issuesFromError(code, parchi, ticked())).toEqual({ lines: {}, form });
    }
  });

  it('price_required with every price filled is still shown, as a general message', () => {
    expect(
      issuesFromError('price_required', parchi, toggleLine(startDraft(parchi, shop()), sugar)),
    ).toEqual({
      lines: {},
      form: 'invalid',
    });
  });
});
