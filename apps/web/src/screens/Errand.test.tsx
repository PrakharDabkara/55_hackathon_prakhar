// @vitest-environment jsdom
import { act, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../lib/api.js';
import { errandView, FakeEventSource, fakeSeekerApi, seekerOrder } from '../test/fakes.js';
import {
  choiceQuestion,
  deliveringItem,
  errandPlan,
  lostItem,
  listQuestion,
  planWithItems,
} from '../test/fakesErrand.js';
import { renderApp } from '../test/render.js';
import { Errand } from './Errand.js';

// jsdom cannot decode or draw a picture: the shrink step (canvas) is replaced by a pass-through.
vi.mock('../lib/photo.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/photo.js')>()),
  shrinkPhoto: async (file: Blob) => file,
}));

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
  const navigate = vi.fn();
  const utils = renderApp(
    <Errand api={api} onBack={onBack} navigate={navigate} pollMs={60_000} live={live} />,
    'en',
  );
  return { api, onBack, navigate, ...utils };
}

/** Fills the form with the demo location and starts the errand. */
async function start(user: ReturnType<typeof setup>['user'], task = 'make tea') {
  await user.type(screen.getByLabelText("What's the job?"), task);
  await user.click(screen.getByRole('button', { name: 'Use demo location (Indore)' }));
  await user.click(screen.getByRole('button', { name: 'Make my list' }));
}

describe('the form', () => {
  it('is titled "Plan an errand" and offers English examples that fill the box', async () => {
    const { user } = setup();
    expect(screen.getByRole('heading', { name: 'Plan an errand' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Puja items' }));
    expect((screen.getByLabelText("What's the job?") as HTMLTextAreaElement).value).toBe(
      'Puja items',
    );
  });

  it('needs a task and a location before "Make my list" works', async () => {
    const { user } = setup();
    const button = screen.getByRole('button', { name: 'Make my list' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    await user.type(screen.getByLabelText("What's the job?"), 'tea');
    expect(button.disabled).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Use demo location (Indore)' }));
    expect(button.disabled).toBe(false);
  });

  it('sends the task, the place and the budget in paise', async () => {
    const { user, api } = setup();
    await user.type(screen.getByLabelText(/Budget/), '500');
    await start(user);
    expect(api.createErrand).toHaveBeenCalledWith({
      task: 'make tea',
      lat: 22.7196,
      lng: 75.8577,
      budgetPaise: 50000,
    });
  });

  it('leaves the budget out when it is empty, and says so when it is not a price', async () => {
    const { user, api } = setup();
    await start(user);
    expect(api.createErrand).toHaveBeenCalledWith({ task: 'make tea', lat: 22.7196, lng: 75.8577 });
  });

  it('says a refused task, the hourly limit and a shop number in plain words', async () => {
    const createErrand = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(422, 'task_rejected', 'no'))
      .mockRejectedValueOnce(new ApiError(429, 'errand_rate_limited', 'x'))
      .mockRejectedValueOnce(new ApiError(403, 'forbidden', 'x'));
    const { user } = setup({ createErrand });
    await start(user);
    expect((await screen.findByRole('alert')).textContent).toMatch(/shopping job/i);
    await user.click(screen.getByRole('button', { name: 'Make my list' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/little while/i));
    await user.click(screen.getByRole('button', { name: 'Make my list' }));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toMatch(/belongs to a shop/i),
    );
    expect(screen.getByLabelText("What's the job?")).toBeTruthy();
  });

  it('goes back with the back button', async () => {
    const { user, onBack } = setup();
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(onBack).toHaveBeenCalled();
  });

  it('has one primary button', () => {
    const { container } = setup();
    expect(container.querySelectorAll('.sh-btn--primary')).toHaveLength(1);
  });
});

describe('progress', () => {
  it('shows the state and the server lines (English), and no form once started', async () => {
    const { user } = setup({
      getErrand: vi.fn(async () =>
        errandView({
          state: 'PLANNING',
          progress: ['Understood: 3 items', 'Sugar: found at 1 shop'],
        }),
      ),
    });
    await start(user);
    const items = await screen.findAllByRole('listitem');
    expect(items.map((i) => i.textContent)).toEqual([
      'Understood: 3 items',
      'Sugar: found at 1 shop',
    ]);
    expect(screen.getByText('Working on it')).toBeTruthy();
    expect(screen.queryByLabelText("What's the job?")).toBeNull();
  });

  it('shows a skeleton while there are no lines yet', async () => {
    const { user, container } = setup({
      getErrand: vi.fn(async () => errandView({ state: 'PLANNING', progress: [] })),
    });
    await start(user);
    await screen.findByText('Working on it');
    expect(container.querySelector('.sh-skeleton')).toBeTruthy();
  });

  it('shows the waiting state with the time elapsed, without the server marker', async () => {
    const { user } = setup({
      getErrand: vi.fn(async () =>
        errandView({
          state: 'WAITING_FOR_SHOPS',
          progress: ['Asking 10 shops: sugar', 'Waiting for shops…'],
        }),
      ),
    });
    await start(user);
    expect(await screen.findByText('Waiting for shops to answer')).toBeTruthy();
    expect(screen.getByText(/^Time so far 0:4\d$/)).toBeTruthy();
    expect(screen.queryByText('Waiting for shops…')).toBeNull();
    act(() => void vi.advanceTimersByTime(3000));
    expect(await screen.findByText(/^Time so far 0:(4[5-9]|5\d)$/)).toBeTruthy();
  });

  it('refetches when the server says the errand moved', async () => {
    const getErrand = vi
      .fn()
      .mockResolvedValueOnce(errandView({ progress: ['Understood: 1 item'] }))
      .mockResolvedValue(
        errandView({ progress: ['Understood: 1 item', 'Sugar: found at 4 shops'] }),
      );
    const { user } = setup({ getErrand });
    await start(user);
    await screen.findByText('Understood: 1 item');
    await waitFor(() => expect(FakeEventSource.instances.length).toBeGreaterThan(0));
    act(() => FakeEventSource.last().emit('errand.updated', { errandId: 'errand-1' }));
    expect(await screen.findByText('Sugar: found at 4 shops')).toBeTruthy();
  });

  it('cancels with "Cancel errand"', async () => {
    const cancelErrand = vi.fn(async () => errandView({ state: 'CANCELLED', progress: [] }));
    const { user } = setup({ cancelErrand });
    await start(user);
    await user.click(await screen.findByRole('button', { name: 'Cancel errand' }));
    expect(cancelErrand).toHaveBeenCalledWith('errand-1');
    expect(await screen.findByText('You cancelled this errand.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Start a new errand' })).toBeTruthy();
  });

  it('says what to do when the errand cannot be loaded, and retries', async () => {
    const getErrand = vi
      .fn()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValue(errandView({ progress: ['Understood: 1 item'] }));
    const { user } = setup({ getErrand });
    await start(user);
    expect((await screen.findByRole('alert')).textContent).toMatch(/Couldn't load/);
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Understood: 1 item')).toBeTruthy();
  });

  it('shows a loading skeleton, not a spinner, before the first answer', async () => {
    let release: (v: ReturnType<typeof errandView>) => void = () => undefined;
    const getErrand = vi.fn(() => new Promise<ReturnType<typeof errandView>>((r) => (release = r)));
    const { user, container } = setup({ getErrand });
    await start(user);
    await waitFor(() => expect(container.querySelector('.sh-skeleton')).toBeTruthy());
    act(() => release(errandView({ progress: ['Understood: 1 item'] })));
    expect(await screen.findByText('Understood: 1 item')).toBeTruthy();
  });
});

describe('a free-form question', () => {
  const asking = errandView({ state: 'NEEDS_INPUT', question: choiceQuestion });

  it('shows the question as the agent wrote it, with a chip for each option', async () => {
    const answerErrand = vi.fn(async () => errandView({ state: 'PLANNING' }));
    const getErrand = vi
      .fn()
      .mockResolvedValueOnce(asking)
      .mockResolvedValue(errandView({ state: 'PLANNING', progress: ['Understood: 3 items'] }));
    const { user } = setup({ getErrand, answerErrand });
    await start(user);
    expect(await screen.findByText('Which tea?')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Leaf tea' }));
    expect(answerErrand).toHaveBeenCalledWith('errand-1', { optionIndex: 1 });
    expect(await screen.findByText('Understood: 3 items')).toBeTruthy();
    expect(screen.queryByText('Which tea?')).toBeNull();
  });

  it('does not repeat the open question in the progress list', async () => {
    const { user } = setup({
      getErrand: vi.fn(async () =>
        errandView({
          state: 'NEEDS_INPUT',
          question: { question: 'Which tea?' },
          progress: ['Understood: 3 items', 'Question for you: Which tea?'],
        }),
      ),
    });
    await start(user);
    await screen.findByText('Understood: 3 items');
    expect(screen.getAllByText(/Which tea\?/)).toHaveLength(1);
  });

  it('also takes a typed answer with "Send"', async () => {
    const answerErrand = vi.fn(async () => errandView({ state: 'PLANNING' }));
    const { user } = setup({ getErrand: vi.fn(async () => asking), answerErrand });
    await start(user);
    await user.type(await screen.findByLabelText('Your answer'), 'Strong tea');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(answerErrand).toHaveBeenCalledWith('errand-1', { text: 'Strong tea' });
  });

  it('works with no options: only the text box', async () => {
    const { user } = setup({
      getErrand: vi.fn(async () =>
        errandView({ state: 'NEEDS_INPUT', question: { question: 'How much?' } }),
      ),
    });
    await start(user);
    expect(await screen.findByText('How much?')).toBeTruthy();
    expect(screen.getByLabelText('Your answer')).toBeTruthy();
  });
});

describe('"Your list" (the agent asks you to confirm items)', () => {
  const confirm = errandView({ state: 'NEEDS_INPUT', question: listQuestion });
  const list = () => screen.getByRole('group', { name: 'Your list' });
  async function open(overrides: Parameters<typeof fakeSeekerApi>[0] = {}) {
    const utils = setup({ getErrand: vi.fn(async () => confirm), ...overrides });
    await start(utils.user);
    await screen.findByRole('group', { name: 'Your list' });
    return utils;
  }

  it("uses the app's own heading and never shows the model-written question", async () => {
    await open();
    expect(screen.getByRole('heading', { name: 'Your list' })).toBeTruthy();
    expect(screen.queryByText('Ye cheezein chahiye?')).toBeNull();
  });

  it('shows each option as a checkbox row, the suggested ones ticked and tagged "Suggested"', async () => {
    await open();
    const boxes = within(list()).getAllByRole('checkbox') as HTMLInputElement[];
    expect(boxes.map((b) => [b.labels?.[0]?.textContent, b.checked])).toEqual([
      ['tea leaves', true],
      ['sugar', true],
      ['milk', true],
      ['ginger', false],
      ['cardamom', false],
    ]);
    expect(within(list()).getAllByText('Suggested')).toHaveLength(3);
    const ginger = screen.getByRole('checkbox', { name: 'ginger' });
    expect(ginger.closest('li')?.textContent).not.toContain('Suggested');
  });

  it('has the AI note', async () => {
    await open();
    expect(
      screen.getByText(
        'AI made this list and can make mistakes. Check it before we ask shops. Prices always come from the shops, never from AI.',
      ),
    ).toBeTruthy();
  });

  it('counts the ticked items on the button and sends them', async () => {
    const answerErrand = vi.fn(async () => errandView({ state: 'PLANNING' }));
    const { user } = await open({ answerErrand });
    await user.click(screen.getByRole('button', { name: 'Ask shops for these 3' }));
    expect(answerErrand).toHaveBeenCalledWith('errand-1', { selected: [0, 1, 2] });
  });

  it('removes an unticked item from the answer and counts a ticked extra', async () => {
    const answerErrand = vi.fn(async () => errandView({ state: 'PLANNING' }));
    const { user } = await open({ answerErrand });
    await user.click(screen.getByRole('checkbox', { name: 'sugar' }));
    await user.click(screen.getByRole('checkbox', { name: 'cardamom' }));
    await user.click(screen.getByRole('button', { name: '+ Add something else' }));
    await user.type(screen.getByLabelText('Something else'), 'saffron');
    await user.click(screen.getByRole('button', { name: 'Ask shops for these 4' }));
    expect(answerErrand).toHaveBeenCalledWith('errand-1', { selected: [0, 2, 4], text: 'saffron' });
  });

  it('cannot be sent with nothing ticked and nothing added', async () => {
    const { user } = await open();
    for (const name of ['tea leaves', 'sugar', 'milk'])
      await user.click(screen.getByRole('checkbox', { name }));
    expect(
      (screen.getByRole('button', { name: 'Ask shops for these 0' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    await user.click(screen.getByRole('button', { name: '+ Add something else' }));
    await user.type(screen.getByLabelText('Something else'), 'only this');
    expect(
      (screen.getByRole('button', { name: 'Ask shops for these 1' }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it('keeps the ticks while the errand refetches', async () => {
    const getErrand = vi.fn(async () => confirm);
    const { user } = await open({ getErrand });
    await user.click(screen.getByRole('checkbox', { name: 'ginger' }));
    await waitFor(() => expect(FakeEventSource.instances.length).toBeGreaterThan(0));
    act(() => FakeEventSource.last().emit('errand.updated', { errandId: 'errand-1' }));
    await waitFor(() => expect(getErrand.mock.calls.length).toBeGreaterThan(1));
    expect((screen.getByRole('checkbox', { name: 'ginger' }) as HTMLInputElement).checked).toBe(
      true,
    );
  });

  it('offers a photo on every item and never needs one', async () => {
    const { user, api, container } = await open();
    expect(container.querySelectorAll('input[type="file"]')).toHaveLength(5);
    const input = screen
      .getByRole('button', { name: 'Add photo: sugar' })
      .closest('li')
      ?.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, new File([new Uint8Array(300)], 'a.jpg', { type: 'image/jpeg' }));
    await waitFor(() =>
      expect(api.uploadPhoto).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ role: 'request', errand: { id: 'errand-1', label: 'sugar' } }),
      ),
    );
  });
});

describe('the plan', () => {
  const ready = (plan = errandPlan(), extra = {}) =>
    errandView({ state: 'PLAN_READY', progress: ['Understood: 2 items'], plan, ...extra });
  async function showPlan(plan = errandPlan(), extra = {}, overrides = {}) {
    const utils = setup({ getErrand: vi.fn(async () => ready(plan, extra)), ...overrides });
    await start(utils.user);
    await screen.findByRole('region', { name: 'Your plan' });
    return utils;
  }

  it('shows the recommended plan, with the route map at the errand origin', async () => {
    await showPlan();
    expect(screen.getByLabelText('Stop 1: Mishra Kirana')).toBeTruthy();
    expect(JSON.parse(screen.getByTestId('plan-map').getAttribute('data-origin') ?? '{}')).toEqual({
      lat: 22.7196,
      lng: 75.8577,
    });
    expect(screen.getByRole('link', { name: 'Start route' })).toBeTruthy();
  });

  it('keeps late answers out of the progress list, collapsed', async () => {
    await showPlan(errandPlan(), {
      lateAnswers: ['Joshi Mart said yes ₹41', 'Shah Store said yes ₹44'],
    });
    const details = screen.getByText('Late answers (2)').closest('details') as HTMLDetailsElement;
    expect(details.open).toBe(false);
    expect(within(details).getByText('Joshi Mart said yes ₹41')).toBeTruthy();
    const progress = screen.getByRole('list', { name: 'What has happened' });
    expect(within(progress).queryByText(/Joshi/)).toBeNull();
  });

  it('never shows free text written by the model', async () => {
    const notes = 'Shiv Kirana Bhandar mein sarson ka tel mil jayega';
    const plan = { ...errandPlan(), notes } as unknown as ReturnType<typeof errandPlan>;
    await showPlan(plan);
    expect(document.body.textContent).not.toContain('Shiv Kirana');
  });

  it('starts a new errand with "Start a new errand"', async () => {
    const { user } = await showPlan();
    await user.click(screen.getByRole('button', { name: 'Start a new errand' }));
    expect(await screen.findByLabelText("What's the job?")).toBeTruthy();
  });

  it('"Ask shops again" starts a new errand with the same task, place and budget', async () => {
    const plan = planWithItems([lostItem()], { route: null, shopCount: 0 });
    const createErrand = vi
      .fn()
      .mockResolvedValueOnce({ id: 'errand-1', state: 'PLANNING' })
      .mockResolvedValueOnce({ id: 'errand-2', state: 'PLANNING' });
    const getErrand = vi.fn(async (id: string) =>
      id === 'errand-2'
        ? errandView({ id: 'errand-2', state: 'PLANNING', progress: ['Understood: 2 items'] })
        : ready(plan, { task: 'tea things', budgetPaise: 30000, lat: 22.7, lng: 75.8 }),
    );
    const { user } = setup({ createErrand, getErrand });
    await start(user);
    await user.click(await screen.findByRole('button', { name: 'Ask shops again' }));
    expect(createErrand).toHaveBeenLastCalledWith({
      task: 'tea things',
      lat: 22.7,
      lng: 75.8,
      budgetPaise: 30000,
    });
    expect(await screen.findByText('Understood: 2 items')).toBeTruthy();
  });

  it('tapping Delivery asks the server to switch that shop and shows the new plan', async () => {
    const plan = planWithItems([deliveringItem()]);
    const after = planWithItems([deliveringItem({ mode: 'delivery' })], {
      deliveryFeePaise: 3000,
      deliveryShopCount: 1,
      grandTotalPaise: 18000,
    });
    const getErrand = vi.fn().mockResolvedValueOnce(ready(plan)).mockResolvedValue(ready(after));
    const setDeliveryMode = vi.fn(async () => ready(after));
    const { user } = setup({ getErrand, setDeliveryMode });
    await start(user);
    await screen.findByRole('region', { name: 'Your plan' });
    await user.click(screen.getByRole('button', { name: 'Delivery' }));
    expect(setDeliveryMode).toHaveBeenCalledWith('errand-1', 's1', 'delivery');
    expect(await screen.findByText('₹180')).toBeTruthy();
    expect(screen.getByText('Delivers · ₹30')).toBeTruthy();
  });

  describe('ordering a delivery from the plan (ADR-0031)', () => {
    const withMode = (mode: 'pickup' | 'delivery') =>
      ready(planWithItems([deliveringItem({ mode })]));
    async function show(mode: 'pickup' | 'delivery', overrides = {}) {
      const utils = setup({ getErrand: vi.fn(async () => withMode(mode)), ...overrides });
      await start(utils.user);
      await screen.findByRole('region', { name: 'Your plan' });
      return utils;
    }

    it('offers "Send order" once delivery is chosen, not before', async () => {
      await show('pickup');
      expect(screen.queryByRole('button', { name: 'Send order' })).toBeNull();
    });

    it('chosen delivery, address, then the order is placed for this errand and shop', async () => {
      const { user, api } = await show('delivery');
      await user.click(screen.getByRole('button', { name: 'Send order' }));
      await user.type(screen.getByLabelText('Home address'), 'Flat 4B, Sapna Apartments');
      await user.click(screen.getByRole('button', { name: 'Confirm' }));
      expect(api.placeOrder).toHaveBeenCalledWith({
        shopId: 's1',
        errandId: 'errand-1',
        addressText: 'Flat 4B, Sapna Apartments',
      });
    });

    it('follows the order live', async () => {
      const listOrders = vi
        .fn()
        .mockResolvedValueOnce([
          seekerOrder({ state: 'ACCEPTED', errandId: 'errand-1', requestId: null }),
        ])
        .mockResolvedValue([
          seekerOrder({ state: 'OUT_FOR_DELIVERY', errandId: 'errand-1', requestId: null }),
        ]);
      await show('delivery', { listOrders });
      await screen.findByText('The shop accepted your order');
      act(() => FakeEventSource.last().emit('order.updated', { orderId: 'order-1' }));
      expect(await screen.findByText('On its way')).toBeTruthy();
    });
  });
});

describe('endings that are not a plan', () => {
  it('FAILED: says why and "Try again" starts a new errand with the same task', async () => {
    const createErrand = vi
      .fn()
      .mockResolvedValueOnce({ id: 'errand-1', state: 'PLANNING' })
      .mockResolvedValueOnce({ id: 'errand-2', state: 'PLANNING' });
    const getErrand = vi.fn(async (id: string) =>
      id === 'errand-1'
        ? errandView({
            state: 'FAILED',
            failureReason: 'ai_unavailable',
            task: 'puja',
            budgetPaise: 30000,
          })
        : errandView({ id: 'errand-2', state: 'PLANNING', progress: ['Understood: 1 item'] }),
    );
    const { user } = setup({ createErrand, getErrand });
    await start(user, 'puja');
    expect(await screen.findByText(/The AI is not available/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(createErrand).toHaveBeenLastCalledWith({
      task: 'puja',
      lat: 22.7196,
      lng: 75.8577,
      budgetPaise: 30000,
    });
    expect(await screen.findByText('Understood: 1 item')).toBeTruthy();
  });

  it('FAILED for another reason still says something kind', async () => {
    const { user } = setup({
      getErrand: vi.fn(async () => errandView({ state: 'FAILED', failureReason: 'step_limit' })),
    });
    await start(user);
    expect(await screen.findByText(/couldn't make a plan/i)).toBeTruthy();
  });

  it('FAILED with a partial plan still shows what was found', async () => {
    const { user } = setup({
      getErrand: vi.fn(async () => errandView({ state: 'FAILED', plan: errandPlan() })),
    });
    await start(user);
    expect(await screen.findByLabelText('Stop 1: Mishra Kirana')).toBeTruthy();
    expect(screen.getByText('This is what we found before it stopped.')).toBeTruthy();
  });

  it('EXPIRED: says the time ran out and offers a new errand', async () => {
    const { user } = setup({ getErrand: vi.fn(async () => errandView({ state: 'EXPIRED' })) });
    await start(user);
    expect(await screen.findByText(/Time ran out/, { selector: 'p' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Start a new errand' })).toBeTruthy();
  });
});

describe('opened by id (after a reload)', () => {
  it('loads that errand without the form, and tells the app about starts', async () => {
    const getErrand = vi.fn(async () =>
      errandView({ id: 'errand-9', state: 'WAITING_FOR_SHOPS', task: 'puja items' }),
    );
    const api = fakeSeekerApi({ getErrand });
    const { user } = renderApp(
      <Errand
        api={api}
        onBack={vi.fn()}
        navigate={vi.fn()}
        errandId="errand-9"
        onOpened={vi.fn()}
        pollMs={60_000}
        live={live}
      />,
      'en',
    );
    expect(await screen.findByText('puja items')).toBeTruthy();
    expect(getErrand).toHaveBeenCalledWith('errand-9');
    expect(screen.queryByLabelText("What's the job?")).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Cancel errand' }));
    expect(api.cancelErrand).toHaveBeenCalledWith('errand-9');
  });

  it('tells the app the new id, and null on "Start a new errand"', async () => {
    const onOpened = vi.fn();
    const api = fakeSeekerApi({ getErrand: vi.fn(async () => errandView({ state: 'EXPIRED' })) });
    const { user } = renderApp(
      <Errand
        api={api}
        onBack={vi.fn()}
        navigate={vi.fn()}
        onOpened={onOpened}
        pollMs={60_000}
        live={live}
      />,
      'en',
    );
    await user.type(screen.getByLabelText("What's the job?"), 'tea');
    await user.click(screen.getByRole('button', { name: 'Use demo location (Indore)' }));
    await user.click(screen.getByRole('button', { name: 'Make my list' }));
    await user.click(await screen.findByRole('button', { name: 'Start a new errand' }));
    expect(onOpened.mock.calls).toEqual([['errand-1'], [null]]);
  });

  it('says so, kindly, when the errand cannot be found (an old link)', async () => {
    const getErrand = vi.fn().mockRejectedValue(new ApiError(404, 'not_found', 'No such errand'));
    renderApp(
      <Errand
        api={fakeSeekerApi({ getErrand })}
        onBack={vi.fn()}
        navigate={vi.fn()}
        errandId="gone"
        pollMs={60_000}
        live={live}
      />,
      'en',
    );
    expect(await screen.findByText("We couldn't find this errand. It may be old.")).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Start a new errand' })).toBeTruthy();
  });
});
