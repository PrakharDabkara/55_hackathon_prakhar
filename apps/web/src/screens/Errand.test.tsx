// @vitest-environment jsdom
import { act, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../lib/api.js';
import type { PlanItem } from '../lib/seekerApi.js';
import { errandPlan, errandView, FakeEventSource, fakeSeekerApi } from '../test/fakes.js';
import { renderApp } from '../test/render.js';
import { Errand } from './Errand.js';

// jsdom cannot draw a Leaflet map; the map is one small component, replaced here by a probe.
vi.mock('../components/PlanMap.js', () => ({
  PlanMap: (props: { origin: unknown; stops: unknown[] }) => (
    <div
      data-testid="plan-map"
      data-origin={JSON.stringify(props.origin)}
      data-stops={JSON.stringify(props.stops)}
    />
  ),
}));

const live = { createSource: (url: string) => new FakeEventSource(url), retryMs: 1000 };

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date('2026-10-16T10:00:42.000Z') });
  FakeEventSource.reset();
});
afterEach(() => {
  vi.useRealTimers();
});

function setup(overrides: Parameters<typeof fakeSeekerApi>[0] = {}) {
  const api = fakeSeekerApi(overrides);
  const onBack = vi.fn();
  const utils = renderApp(<Errand api={api} onBack={onBack} pollMs={60_000} live={live} />);
  return { api, onBack, ...utils };
}

/** Fills the form with the demo location and starts the errand. */
async function start(user: ReturnType<typeof setup>['user'], task = 'chai banane ka saaman') {
  await user.type(screen.getByLabelText('Kya kaam hai?'), task);
  await user.click(screen.getByRole('button', { name: 'Demo location (Indore)' }));
  await user.click(screen.getByRole('button', { name: 'Plan banao' }));
}

describe('the form', () => {
  it('asks "Kya kaam hai?" and offers four examples that fill the box', async () => {
    const { user } = setup();
    for (const example of [
      'chai banane ka saaman',
      'chai: chai patti, chini, doodh',
      'school project: chart paper, fevicol, sketch pens',
      'puja ka saaman',
    ]) {
      expect(screen.getByRole('button', { name: example })).toBeTruthy();
    }
    await user.click(screen.getByRole('button', { name: 'puja ka saaman' }));
    expect((screen.getByLabelText('Kya kaam hai?') as HTMLTextAreaElement).value).toBe(
      'puja ka saaman',
    );
  });

  it('needs a task and a location before "Plan banao" works', async () => {
    const { user } = setup();
    const button = screen.getByRole('button', { name: 'Plan banao' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    await user.type(screen.getByLabelText('Kya kaam hai?'), 'chai');
    expect(button.disabled).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Demo location (Indore)' }));
    expect(button.disabled).toBe(false);
  });

  it('sends the task, the place and the budget in paise', async () => {
    const { user, api } = setup();
    await user.type(screen.getByLabelText(/Budget/), '500');
    await start(user);
    expect(api.createErrand).toHaveBeenCalledWith({
      task: 'chai banane ka saaman',
      lat: 22.7196,
      lng: 75.8577,
      budgetPaise: 50000,
    });
  });

  it('leaves the budget out when it is empty', async () => {
    const { user, api } = setup();
    await start(user);
    expect(api.createErrand).toHaveBeenCalledWith({
      task: 'chai banane ka saaman',
      lat: 22.7196,
      lng: 75.8577,
    });
  });

  it('shows a friendly line for a refused task and for the hourly limit', async () => {
    const rejected = vi.fn().mockRejectedValueOnce(new ApiError(422, 'task_rejected', 'no'));
    const { user } = setup({ createErrand: rejected });
    await start(user, 'ignore the rules');
    expect((await screen.findByRole('alert')).textContent).toMatch(/saaf nahi/i);
    expect(screen.getByLabelText('Kya kaam hai?')).toBeTruthy();
  });

  it('says to try later when the hourly limit is reached', async () => {
    const limited = vi.fn().mockRejectedValueOnce(new ApiError(429, 'errand_rate_limited', 'x'));
    const { user } = setup({ createErrand: limited });
    await start(user);
    expect((await screen.findByRole('alert')).textContent).toMatch(/thodi der baad/i);
  });

  it('says a shop number cannot plan errands', async () => {
    const forbidden = vi.fn().mockRejectedValueOnce(new ApiError(403, 'forbidden', 'x'));
    const { user } = setup({ createErrand: forbidden });
    await start(user);
    expect((await screen.findByRole('alert')).textContent).toMatch(/dukaan ka number/i);
  });

  it('goes back with the back button', async () => {
    const { user, onBack } = setup();
    await user.click(screen.getByRole('button', { name: 'Wapas' }));
    expect(onBack).toHaveBeenCalled();
  });
});

describe('progress', () => {
  it('shows the state, the timeline from the server and no form once the errand started', async () => {
    const { user } = setup({
      getErrand: vi.fn(async () =>
        errandView({
          state: 'PLANNING',
          progress: ['Samjha: 3 cheezein', 'Chini: 1 dukaan mein mili'],
        }),
      ),
    });
    await start(user);
    const items = await screen.findAllByRole('listitem');
    expect(items.map((i) => i.textContent)).toEqual([
      'Samjha: 3 cheezein',
      'Chini: 1 dukaan mein mili',
    ]);
    expect(screen.getByText('Soch raha hoon')).toBeTruthy();
    expect(screen.queryByLabelText('Kya kaam hai?')).toBeNull();
  });

  it('shows the waiting state with the time elapsed since the errand began', async () => {
    const { user } = setup({
      getErrand: vi.fn(async () =>
        errandView({
          state: 'WAITING_FOR_SHOPS',
          progress: ['10 dukaanon se pooch raha hoon: chini', 'Jawab ka intezaar…'],
        }),
      ),
    });
    await start(user);
    expect(await screen.findByText('Dukaanon ke jawab ka intezaar…')).toBeTruthy();
    expect(screen.getByText(/^Samay: 0:4\d$/)).toBeTruthy();
    // the server's own marker is not repeated in the timeline
    expect(screen.queryByText('Jawab ka intezaar…')).toBeNull();
    act(() => void vi.advanceTimersByTime(3000));
    expect(await screen.findByText(/^Samay: 0:(4[5-9]|5\d)$/)).toBeTruthy();
  });

  it('refetches when the server says the errand moved, and when the poll fires', async () => {
    const getErrand = vi
      .fn()
      .mockResolvedValueOnce(errandView({ progress: ['Samjha: 1 cheez'] }))
      .mockResolvedValue(
        errandView({ progress: ['Samjha: 1 cheez', 'Chini: 4 dukaanon mein mili'] }),
      );
    const { user } = setup({ getErrand });
    await start(user);
    await screen.findByText('Samjha: 1 cheez');
    await waitFor(() => expect(FakeEventSource.instances.length).toBeGreaterThan(0));
    act(() => FakeEventSource.last().emit('errand.updated', { errandId: 'errand-1' }));
    expect(await screen.findByText('Chini: 4 dukaanon mein mili')).toBeTruthy();
  });

  it('cancels with the Cancel button', async () => {
    const cancelErrand = vi.fn(async () => errandView({ state: 'CANCELLED', progress: [] }));
    const { user } = setup({ cancelErrand });
    await start(user);
    await user.click(await screen.findByRole('button', { name: 'Cancel karein' }));
    expect(cancelErrand).toHaveBeenCalledWith('errand-1');
    expect(await screen.findByText('Errand cancel kar diya.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Naya kaam' })).toBeTruthy();
  });
});

describe('a question', () => {
  const asking = errandView({
    state: 'NEEDS_INPUT',
    question: { question: 'Kaunsi chai?', options: ['Dust chai', 'Patti chai'] },
  });

  it('shows the question with an option button for each answer, then goes back to progress', async () => {
    const answerErrand = vi.fn(async () => errandView({ state: 'PLANNING' }));
    const getErrand = vi
      .fn()
      .mockResolvedValueOnce(asking)
      .mockResolvedValue(errandView({ state: 'PLANNING', progress: ['Samjha: 3 cheezein'] }));
    const { user } = setup({ getErrand, answerErrand });
    await start(user);
    expect(await screen.findByText('Kaunsi chai?')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Patti chai' }));
    expect(answerErrand).toHaveBeenCalledWith('errand-1', { optionIndex: 1 });
    expect(await screen.findByText('Samjha: 3 cheezein')).toBeTruthy();
    expect(screen.queryByText('Kaunsi chai?')).toBeNull();
  });

  it('does not repeat the open question in the timeline', async () => {
    const { user } = setup({
      getErrand: vi.fn(async () =>
        errandView({
          state: 'NEEDS_INPUT',
          question: { question: 'Kaunsi chai?' },
          progress: ['Samjha: 3 cheezein', 'Aapse ek sawaal: Kaunsi chai?'],
        }),
      ),
    });
    await start(user);
    await screen.findByText('Samjha: 3 cheezein');
    expect(screen.getAllByText(/Kaunsi chai\?/)).toHaveLength(1);
  });

  it('also takes a typed answer', async () => {
    const answerErrand = vi.fn(async () => errandView({ state: 'PLANNING' }));
    const { user } = setup({ getErrand: vi.fn(async () => asking), answerErrand });
    await start(user);
    await user.type(await screen.findByLabelText('Apna jawab likhein'), 'Kadak chai');
    await user.click(screen.getByRole('button', { name: 'Bhejo' }));
    expect(answerErrand).toHaveBeenCalledWith('errand-1', { text: 'Kadak chai' });
  });

  describe('a list to confirm (multi-select)', () => {
    const confirm = errandView({
      state: 'NEEDS_INPUT',
      question: {
        question: 'Ye cheezein chahiye?',
        options: ['chai patti', 'chini', 'doodh', 'adrak', 'elaichi'],
        multiSelect: true,
        preselected: [0, 1, 2],
      },
    });
    const box = () => screen.getByRole('group', { name: 'Ek sawaal' });

    it('shows a checkbox for each item, the defaults ticked, and "Theek hai"', async () => {
      const { user } = setup({ getErrand: vi.fn(async () => confirm) });
      await start(user);
      expect(await screen.findByText('Ye cheezein chahiye?')).toBeTruthy();
      const boxes = within(box()).getAllByRole('checkbox') as HTMLInputElement[];
      expect(boxes.map((b) => [b.labels?.[0]?.textContent, b.checked])).toEqual([
        ['chai patti', true],
        ['chini', true],
        ['doodh', true],
        ['adrak', false],
        ['elaichi', false],
      ]);
      expect(screen.getByRole('button', { name: 'Theek hai' })).toBeTruthy();
      // the options are not one-tap answers here
      expect(within(box()).queryByRole('button', { name: 'chini' })).toBeNull();
    });

    it('sends the ticked ones as they are when the customer taps "Theek hai"', async () => {
      const answerErrand = vi.fn(async () => errandView({ state: 'PLANNING' }));
      const { user } = setup({ getErrand: vi.fn(async () => confirm), answerErrand });
      await start(user);
      await user.click(await screen.findByRole('button', { name: 'Theek hai' }));
      expect(answerErrand).toHaveBeenCalledWith('errand-1', { selected: [0, 1, 2] });
    });

    it('sends changes: an added item, a removed one, and the "Kuch aur?" text', async () => {
      const answerErrand = vi.fn(async () => errandView({ state: 'PLANNING' }));
      const { user } = setup({ getErrand: vi.fn(async () => confirm), answerErrand });
      await start(user);
      await user.click(await screen.findByRole('checkbox', { name: 'chini' }));
      await user.click(screen.getByRole('checkbox', { name: 'elaichi' }));
      await user.type(screen.getByLabelText('Kuch aur?'), 'kesar');
      await user.click(screen.getByRole('button', { name: 'Theek hai' }));
      expect(answerErrand).toHaveBeenCalledWith('errand-1', { selected: [0, 2, 4], text: 'kesar' });
    });

    it('cannot be sent with nothing ticked and nothing typed', async () => {
      const { user } = setup({ getErrand: vi.fn(async () => confirm) });
      await start(user);
      for (const name of ['chai patti', 'chini', 'doodh'])
        await user.click(await screen.findByRole('checkbox', { name }));
      expect(
        (screen.getByRole('button', { name: 'Theek hai' }) as HTMLButtonElement).disabled,
      ).toBe(true);
      await user.type(screen.getByLabelText('Kuch aur?'), 'sirf chai');
      expect(
        (screen.getByRole('button', { name: 'Theek hai' }) as HTMLButtonElement).disabled,
      ).toBe(false);
    });

    it('keeps the ticks while the errand refetches (the customer is mid-choice)', async () => {
      const getErrand = vi.fn(async () => confirm);
      const { user } = setup({ getErrand });
      await start(user);
      await user.click(await screen.findByRole('checkbox', { name: 'adrak' }));
      await waitFor(() => expect(FakeEventSource.instances.length).toBeGreaterThan(0));
      act(() => FakeEventSource.last().emit('errand.updated', { errandId: 'errand-1' }));
      await waitFor(() => expect(getErrand.mock.calls.length).toBeGreaterThan(1));
      expect((screen.getByRole('checkbox', { name: 'adrak' }) as HTMLInputElement).checked).toBe(
        true,
      );
    });
  });

  it('works for a question with no options: only the text box', async () => {
    const { user } = setup({
      getErrand: vi.fn(async () =>
        errandView({ state: 'NEEDS_INPUT', question: { question: 'Kitna chahiye?' } }),
      ),
    });
    await start(user);
    expect(await screen.findByText('Kitna chahiye?')).toBeTruthy();
    expect(screen.getByLabelText('Apna jawab likhein')).toBeTruthy();
  });
});

describe('the result', () => {
  const ready = (plan = errandPlan(), extra = {}) =>
    errandView({
      state: 'PLAN_READY',
      progress: ['Samjha: 2 cheezein', 'Plan taiyaar: 2 cheezein mil gayi, 0 nahi mili'],
      plan,
      ...extra,
    });

  async function showResult(plan = errandPlan(), extra = {}) {
    const utils = setup({ getErrand: vi.fn(async () => ready(plan, extra)) });
    await start(utils.user);
    await screen.findByRole('tablist');
    return utils;
  }

  it('opens on the recommended plan, with both tabs and a Recommended badge on it', async () => {
    await showResult();
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual([
      expect.stringContaining('Kam dukaan'),
      expect.stringContaining('Sabse sasta'),
    ]);
    expect(tabs[0]?.getAttribute('aria-selected')).toBe('true');
    expect(within(tabs[0] as HTMLElement).getByText('Recommended')).toBeTruthy();
    expect(within(tabs[1] as HTMLElement).queryByText('Recommended')).toBeNull();
  });

  it('gives the reason in one line: "₹25 zyada, 1 dukaan kam"', async () => {
    await showResult();
    expect(screen.getByText('₹25 zyada, 1 dukaan kam')).toBeTruthy();
  });

  it('puts the badge and the reason on Sabse sasta when that is recommended', async () => {
    await showResult(
      errandPlan({
        recommended: 'sasta',
        recommendation: { extraPaise: 4000, stopsSaved: 1, reason: 'fewer_stops_too_dear' },
      }),
    );
    const tabs = screen.getAllByRole('tab');
    expect(tabs[1]?.getAttribute('aria-selected')).toBe('true');
    expect(within(tabs[1] as HTMLElement).getByText('Recommended')).toBeTruthy();
    expect(screen.getByText('Kam dukaan mein ₹40 zyada lagte, 1 dukaan kam')).toBeTruthy();
  });

  it('shows each item: the catalog name large, the customer’s words small, the shop and the price', async () => {
    await showResult();
    const row = screen.getByText('tea leaves').closest('li') as HTMLElement;
    expect(within(row).getByText('chai patti')).toBeTruthy();
    expect(within(row).getByText(/Mishra Kirana/)).toBeTruthy();
    expect(within(row).getByText('₹99')).toBeTruthy();
    expect(within(row).getByText('✓ Confirmed')).toBeTruthy();
    expect(within(row).getByText('Confirmed 2 min ago')).toBeTruthy();
  });

  it('switches to the cheapest plan: other shops, a Likely badge, and its own totals', async () => {
    const { user } = await showResult();
    await user.click(screen.getByRole('tab', { name: /Sabse sasta/ }));
    const row = screen.getByText('sugar').closest('li') as HTMLElement;
    expect(within(row).getByText(/Gupta Store/)).toBeTruthy();
    expect(within(row).getByText('₹38')).toBeTruthy();
    expect(within(row).getByText('Likely · pichhle jawab se')).toBeTruthy();
    const totals = screen.getByRole('group', { name: 'Kul hisaab' });
    expect(within(totals).getByText('₹125')).toBeTruthy();
    expect(within(totals).getByText('₹49')).toBeTruthy();
    expect(within(totals).getByText('2')).toBeTruthy();
    expect(within(totals).getByText('1.3 km')).toBeTruthy();
  });

  it('shows the totals of the kam dukaan plan: price, savings, stops, distance', async () => {
    await showResult();
    const totals = screen.getByRole('group', { name: 'Kul hisaab' });
    expect(within(totals).getByText('₹150')).toBeTruthy();
    expect(within(totals).getByText('₹24')).toBeTruthy();
    expect(within(totals).getByText('1')).toBeTruthy();
    expect(within(totals).getByText('400 m')).toBeTruthy();
  });

  it('marks an item nobody has as Nahi mila, in grey, without a shop', async () => {
    const plan = errandPlan();
    plan.plans.kam_dukaan.items.push({
      ...(plan.plans.kam_dukaan.items[0] as PlanItem),
      text: 'unicorn',
      itemName: null,
      itemId: null,
      status: 'not_found',
      shopId: null,
      shopName: null,
      pricePaise: null,
      freshness: null,
      distanceM: null,
    });
    await showResult(plan);
    const row = screen.getByText('unicorn').closest('li') as HTMLElement;
    expect(row.closest('ul')?.getAttribute('aria-label')).toBe('Nahi mila');
    expect(within(row).queryByText(/₹/)).toBeNull();
  });

  it('says so when the item found is not what the customer said', async () => {
    const plan = errandPlan();
    plan.plans.kam_dukaan.items[0] = {
      ...(plan.plans.kam_dukaan.items[0] as PlanItem),
      text: 'diya',
      itemName: 'candle',
      matchedAs: true,
    };
    await showResult(plan);
    expect(
      screen.getByText("Aapne 'diya' kaha tha — dukaan ne 'candle' confirm kiya"),
    ).toBeTruthy();
  });

  it('words the note carefully for a likely item: nobody confirmed it', async () => {
    const plan = errandPlan();
    plan.plans.kam_dukaan.items[0] = {
      ...(plan.plans.kam_dukaan.items[0] as PlanItem),
      text: 'diya',
      itemName: 'candle',
      status: 'likely',
      matchedAs: true,
    };
    await showResult(plan);
    expect(screen.getByText("Aapne 'diya' kaha tha — dukaan ke paas 'candle' hai")).toBeTruthy();
  });

  it('draws the route of the chosen plan: numbered stops in order, and opens Google Maps', async () => {
    const { user } = await showResult();
    const stops = () =>
      JSON.parse(screen.getByTestId('plan-map').getAttribute('data-stops') ?? '[]');
    expect(stops().map((s: { n: number; label: string }) => [s.n, s.label])).toEqual([
      [1, 'Mishra Kirana'],
    ]);
    expect(JSON.parse(screen.getByTestId('plan-map').getAttribute('data-origin') ?? '{}')).toEqual({
      lat: 22.7196,
      lng: 75.8577,
    });
    const link = screen.getByRole('link', { name: 'Raasta kholo' });
    expect(link.getAttribute('href')).toMatch(
      /^https:\/\/www\.google\.com\/maps\/dir\/\?api=1&origin=/,
    );
    expect(link.getAttribute('target')).toBe('_blank');

    await user.click(screen.getByRole('tab', { name: /Sabse sasta/ }));
    expect(stops().map((s: { n: number }) => s.n)).toEqual([1, 2]);
    expect(
      new URL(
        screen.getByRole('link', { name: 'Raasta kholo' }).getAttribute('href') ?? '',
      ).searchParams.get('waypoints'),
    ).toBe('22.721,75.86');
  });

  it('keeps late answers out of the timeline, collapsed under "Baad mein aaye jawab (N)"', async () => {
    await showResult(errandPlan(), {
      lateAnswers: ['Joshi Super Mart ne haan kaha ₹41', 'Shah General Store ne haan kaha ₹44'],
    });
    const summary = screen.getByText('Baad mein aaye jawab (2)');
    const details = summary.closest('details') as HTMLDetailsElement;
    expect(details.open).toBe(false);
    expect(within(details).getByText('Joshi Super Mart ne haan kaha ₹41')).toBeTruthy();
    const timeline = screen.getByRole('list', { name: 'Ab tak kya hua' });
    expect(within(timeline).queryByText(/Joshi/)).toBeNull();
  });

  it('has no late-answers box when none came', async () => {
    await showResult();
    expect(screen.queryByText(/Baad mein aaye jawab/)).toBeNull();
  });

  describe('one plan, or none, or part of one', () => {
    const sameBoth = () => {
      const plan = errandPlan();
      plan.plans.sasta = { ...plan.plans.kam_dukaan, kind: 'sasta' };
      return plan;
    };
    const lost = (item: PlanItem): PlanItem => ({
      ...item,
      status: 'not_found',
      shopId: null,
      shopName: null,
      pricePaise: null,
      freshness: null,
      distanceM: null,
    });
    async function showPlain(plan: ReturnType<typeof errandPlan>, extra = {}) {
      const utils = setup({ getErrand: vi.fn(async () => ready(plan, extra)) });
      await start(utils.user);
      await screen.findByRole('region', { name: 'Plan taiyaar' });
      return utils;
    }

    it('identical plans: one plan, no tabs, no Recommended badge, no "which is better" line', async () => {
      await showPlain(sameBoth());
      expect(screen.queryByRole('tablist')).toBeNull();
      expect(screen.queryByRole('tab')).toBeNull();
      expect(screen.queryByText('Recommended')).toBeNull();
      expect(screen.queryByText('Dono plan ek jaise hain')).toBeNull();
      expect(screen.getByText('tea leaves')).toBeTruthy();
      expect(screen.getByRole('group', { name: 'Kul hisaab' })).toBeTruthy();
      expect(screen.getByTestId('plan-map')).toBeTruthy();
    });

    it('plans that really differ stay two plans, with tabs', async () => {
      await showPlain(errandPlan());
      expect(screen.getAllByRole('tab')).toHaveLength(2);
    });

    it('a likely item shows the server’s "Pichhla jawab" line, and no "Confirmed" anywhere on it', async () => {
      const plan = errandPlan();
      const likely = {
        ...plan.plans.kam_dukaan.items[1],
        status: 'likely',
        freshness: 'Pichhla jawab: kal',
      } as PlanItem;
      plan.plans.kam_dukaan.items[1] = likely;
      await showPlain(plan);
      const row = screen.getByText('sugar').closest('li') as HTMLElement;
      expect(within(row).getByText('Pichhla jawab: kal')).toBeTruthy();
      expect(within(row).queryByText(/Confirmed/)).toBeNull();
    });

    it('nothing found: no zero tiles, no map; the items are listed under "Abhi kisi dukaan ne jawab nahi diya"', async () => {
      const plan = sameBoth();
      for (const k of ['kam_dukaan', 'sasta'] as const) {
        const v = plan.plans[k];
        v.items = v.items.map(lost);
        v.route = null;
        v.totalPricePaise = 0;
        v.totalDistanceM = 0;
        v.shopCount = 0;
        v.savingsPaise = 0;
      }
      await showPlain(plan);
      expect(screen.getByText('Abhi kisi dukaan ne jawab nahi diya')).toBeTruthy();
      expect(screen.getByText('tea leaves')).toBeTruthy();
      expect(screen.getByText('sugar')).toBeTruthy();
      expect(screen.queryByRole('group', { name: 'Kul hisaab' })).toBeNull();
      expect(screen.queryByText('₹0')).toBeNull();
      expect(screen.queryByTestId('plan-map')).toBeNull();
      expect(screen.queryByRole('tablist')).toBeNull();
      expect(screen.getByRole('button', { name: 'Dukaanon se phir poochein' })).toBeTruthy();
    });

    it('"Dukaanon se phir poochein" starts a new errand with the same task, place and budget', async () => {
      const plan = sameBoth();
      for (const k of ['kam_dukaan', 'sasta'] as const) {
        plan.plans[k].items = plan.plans[k].items.map(lost);
        plan.plans[k].route = null;
      }
      const createErrand = vi
        .fn()
        .mockResolvedValueOnce({ id: 'errand-1', state: 'PLANNING' })
        .mockResolvedValueOnce({ id: 'errand-2', state: 'PLANNING' });
      const getErrand = vi.fn(async (id: string) =>
        id === 'errand-2'
          ? errandView({ id: 'errand-2', state: 'PLANNING', progress: ['Samjha: 2 cheezein'] })
          : ready(plan, { task: 'chai ka saaman', budgetPaise: 30000, lat: 22.7, lng: 75.8 }),
      );
      const { user } = setup({ createErrand, getErrand });
      await start(user);
      await user.click(await screen.findByRole('button', { name: 'Dukaanon se phir poochein' }));
      expect(createErrand).toHaveBeenLastCalledWith({
        task: 'chai ka saaman',
        lat: 22.7,
        lng: 75.8,
        budgetPaise: 30000,
      });
      expect(await screen.findByText('Samjha: 2 cheezein')).toBeTruthy();
    });

    it('some found, some not: found items first, the others together under "Nahi mila"', async () => {
      const plan = errandPlan();
      plan.plans.kam_dukaan.items = [
        lost({ ...(plan.plans.kam_dukaan.items[0] as PlanItem), text: 'unicorn', itemName: null }),
        ...plan.plans.kam_dukaan.items,
      ];
      await showPlain(plan);
      const found = screen.getByRole('list', { name: 'Mil gaya' });
      const missing = screen.getByRole('list', { name: 'Nahi mila' });
      expect(within(found).getAllByRole('listitem')).toHaveLength(2);
      expect(within(found).getByText('tea leaves')).toBeTruthy();
      expect(within(missing).getAllByRole('listitem')).toHaveLength(1);
      expect(within(missing).getByText('unicorn')).toBeTruthy();
      // found first in the page
      expect(
        found.compareDocumentPosition(missing) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      // the nothing-found message is only for when nothing was found
      expect(screen.queryByText('Abhi kisi dukaan ne jawab nahi diya')).toBeNull();
    });
  });

  describe('the summary is built from the plan, in the screen’s language (Day 14c)', () => {
    const lostItem = (item: PlanItem): PlanItem => ({
      ...item,
      text: 'chandan itr',
      itemName: null,
      itemId: null,
      status: 'not_found',
      shopId: null,
      shopName: null,
      pricePaise: null,
      freshness: null,
      distanceM: null,
    });
    const withLost = () => {
      const plan = errandPlan();
      plan.plans.kam_dukaan.items.push(lostItem(plan.plans.kam_dukaan.items[0] as PlanItem));
      return plan;
    };

    it('says how many items were found, the shops and the distance, and names the ones not found', async () => {
      await showResult(withLost());
      expect(screen.getByText('3 mein se 2 cheezein mili · 1 dukaan · 400 m')).toBeTruthy();
      expect(screen.getByText('Nahi mila: chandan itr')).toBeTruthy();
    });

    it('uses the singular for one item', async () => {
      const plan = errandPlan();
      plan.plans.kam_dukaan.items = [
        plan.plans.kam_dukaan.items[0] as PlanItem,
        lostItem(plan.plans.kam_dukaan.items[0] as PlanItem),
      ];
      await showResult(plan);
      expect(screen.getByText('2 mein se 1 cheez mili · 1 dukaan · 400 m')).toBeTruthy();
    });

    it('never calls a likely item available or confirmed; it says it is from an earlier answer', async () => {
      const plan = errandPlan();
      plan.plans.kam_dukaan.items[1] = {
        ...(plan.plans.kam_dukaan.items[1] as PlanItem),
        status: 'likely',
        freshness: 'Pichhla jawab: kal',
      };
      await showResult(plan);
      expect(screen.getByText('Abhi confirm nahi: 1 cheez (pichhle jawab se)')).toBeTruthy();
      const summary = screen.getByRole('status', { name: 'Saaransh' });
      expect(summary.textContent).not.toMatch(/available|confirmed/i);
    });

    it('the same summary in English', async () => {
      const api = fakeSeekerApi({ getErrand: vi.fn(async () => ready(withLost())) });
      const { user } = renderApp(
        <Errand api={api} onBack={vi.fn()} pollMs={60_000} live={live} />,
        'en',
      );
      await user.type(screen.getByLabelText('What is the errand?'), 'chai');
      await user.click(screen.getByRole('button', { name: 'Demo location (Indore)' }));
      await user.click(screen.getByRole('button', { name: 'Make a plan' }));
      expect(await screen.findByText('2 of 3 items found · 1 shop · 400 m')).toBeTruthy();
      expect(screen.getByText('Not found: chandan itr')).toBeTruthy();
    });

    it('shows no summary when nothing was found (the screen says so on its own)', async () => {
      const plan = errandPlan();
      for (const k of ['kam_dukaan', 'sasta'] as const)
        plan.plans[k].items = plan.plans[k].items.map(lostItem);
      await showResult(plan);
      expect(screen.queryByRole('status', { name: 'Saaransh' })).toBeNull();
      expect(screen.getByText('Abhi kisi dukaan ne jawab nahi diya')).toBeTruthy();
    });

    it('never shows free text written by the model, not even inside "Ab tak kya hua" (Day 14c)', async () => {
      const notes = 'Shiv Kirana Bhandar mein sarson ka tel mil jayega';
      const plan = { ...errandPlan(), notes } as unknown as ReturnType<typeof errandPlan>;
      await showResult(plan);
      expect(screen.queryByText(notes)).toBeNull();
      expect(document.body.textContent).not.toContain('Shiv Kirana');
    });
  });

  it('starts a new errand with "Naya kaam"', async () => {
    const { user } = await showResult();
    await user.click(screen.getByRole('button', { name: 'Naya kaam' }));
    expect(await screen.findByLabelText('Kya kaam hai?')).toBeTruthy();
  });

  it('shows the same screen in English', async () => {
    const api = fakeSeekerApi({ getErrand: vi.fn(async () => ready()) });
    const { user } = renderApp(
      <Errand api={api} onBack={vi.fn()} pollMs={60_000} live={live} />,
      'en',
    );
    await user.type(screen.getByLabelText('What is the errand?'), 'chai');
    await user.click(screen.getByRole('button', { name: 'Demo location (Indore)' }));
    await user.click(screen.getByRole('button', { name: 'Make a plan' }));
    expect(await screen.findByText('₹25 more, 1 fewer shop')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open route' })).toBeTruthy();
  });
});

describe('endings that are not a plan', () => {
  it('FAILED: a friendly message and "Dobara koshish karein", which starts a new errand with the same task', async () => {
    const createErrand = vi
      .fn()
      .mockResolvedValueOnce({ id: 'errand-1', state: 'PLANNING' })
      .mockResolvedValueOnce({ id: 'errand-2', state: 'PLANNING' });
    const getErrand = vi.fn(async (id: string) =>
      id === 'errand-1'
        ? errandView({
            state: 'FAILED',
            failureReason: 'ai_unavailable',
            progress: [],
            task: 'puja ka saaman',
            budgetPaise: 30000,
          })
        : errandView({ id: 'errand-2', state: 'PLANNING', progress: ['Samjha: 1 cheez'] }),
    );
    const { user } = setup({ createErrand, getErrand });
    await user.type(screen.getByLabelText(/Budget/), '300');
    await start(user, 'puja ka saaman');
    expect(await screen.findByText(/AI abhi available nahi hai/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Dobara koshish karein' }));
    expect(createErrand).toHaveBeenLastCalledWith({
      task: 'puja ka saaman',
      lat: 22.7196,
      lng: 75.8577,
      budgetPaise: 30000,
    });
    expect(await screen.findByText('Samjha: 1 cheez')).toBeTruthy();
  });

  it('FAILED for another reason still says something kind', async () => {
    const { user } = setup({
      getErrand: vi.fn(async () => errandView({ state: 'FAILED', failureReason: 'step_limit' })),
    });
    await start(user);
    expect(await screen.findByText(/Plan nahi ban paya/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Dobara koshish karein' })).toBeTruthy();
  });

  it('EXPIRED: says the time ran out, and offers a new errand', async () => {
    const { user } = setup({
      getErrand: vi.fn(async () => errandView({ state: 'EXPIRED' })),
    });
    await start(user);
    expect(await screen.findByText('Time khatam ho gaya, plan nahi ban paya.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Naya kaam' })).toBeTruthy();
  });
});

describe('accessibility', () => {
  it('gives the tabs, the groups and the list real names', async () => {
    const { user } = setup({
      getErrand: vi.fn(async () =>
        errandView({ state: 'PLAN_READY', plan: errandPlan(), progress: ['Samjha: 2 cheezein'] }),
      ),
    });
    await start(user);
    expect(await screen.findByRole('tablist', { name: 'Plan chunein' })).toBeTruthy();
    expect(screen.getByRole('tabpanel')).toBeTruthy();
    expect(screen.getByRole('list', { name: 'Ab tak kya hua' })).toBeTruthy();
  });
});

describe('opened by id (after a reload)', () => {
  it('loads that errand without the form, and tells the app about starts and restarts', async () => {
    const getErrand = vi.fn(async () =>
      errandView({ id: 'errand-9', state: 'WAITING_FOR_SHOPS', task: 'puja ka saaman' }),
    );
    const onOpened = vi.fn();
    const api = fakeSeekerApi({ getErrand });
    const { user } = renderApp(
      <Errand
        api={api}
        onBack={vi.fn()}
        errandId="errand-9"
        onOpened={onOpened}
        pollMs={60_000}
        live={live}
      />,
    );
    expect(await screen.findByText('puja ka saaman')).toBeTruthy();
    expect(getErrand).toHaveBeenCalledWith('errand-9');
    expect(screen.queryByLabelText('Kya kaam hai?')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Cancel karein' }));
    expect(api.cancelErrand).toHaveBeenCalledWith('errand-9');
  });

  it('tells the app the new id when an errand starts, and null on "Naya kaam"', async () => {
    const onOpened = vi.fn();
    const api = fakeSeekerApi({
      getErrand: vi.fn(async () => errandView({ state: 'EXPIRED' })),
    });
    const { user } = renderApp(
      <Errand api={api} onBack={vi.fn()} onOpened={onOpened} pollMs={60_000} live={live} />,
    );
    await user.type(screen.getByLabelText('Kya kaam hai?'), 'chai');
    await user.click(screen.getByRole('button', { name: 'Demo location (Indore)' }));
    await user.click(screen.getByRole('button', { name: 'Plan banao' }));
    await user.click(await screen.findByRole('button', { name: 'Naya kaam' }));
    expect(onOpened.mock.calls).toEqual([['errand-1'], [null]]);
  });

  it('says so, kindly, when the errand cannot be found (an old link)', async () => {
    const getErrand = vi.fn().mockRejectedValue(new ApiError(404, 'not_found', 'No such errand'));
    renderApp(
      <Errand
        api={fakeSeekerApi({ getErrand })}
        onBack={vi.fn()}
        errandId="gone"
        pollMs={60_000}
        live={live}
      />,
    );
    expect(await screen.findByText('Ye kaam nahi mila.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Naya kaam' })).toBeTruthy();
  });
});
