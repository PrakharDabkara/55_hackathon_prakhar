// @vitest-environment jsdom
import { act, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../lib/api.js';
import type { ListView } from '../lib/listApi.js';
import type { SeekerApi } from '../lib/seekerApi.js';
import { FakeEventSource, fakeSeekerApi, seekerOrder } from '../test/fakes.js';
import { openList } from '../test/fakesLists.js';
import { renderApp } from '../test/render.js';
import { ListPage } from './ListPage.js';

vi.mock('../components/PlanMap.js', () => ({ PlanMap: () => <div data-testid="plan-map" /> }));

// Three minutes after the list was sent: 12 minutes of listening are left.
const NOW = new Date('2026-10-21T10:03:01.000Z');

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  FakeEventSource.reset();
});
afterEach(() => vi.useRealTimers());

function show(list: ListView, overrides: Partial<SeekerApi> = {}) {
  const api = fakeSeekerApi({ getList: vi.fn(async () => list), ...overrides });
  const navigate = vi.fn();
  const onDone = vi.fn();
  const utils = renderApp(
    <ListPage
      api={api}
      listId={list.id}
      navigate={navigate}
      onDone={onDone}
      pollMs={60_000}
      live={{ createSource: (url) => new FakeEventSource(url), retryMs: 10 }}
    />,
    'en',
  );
  return { api, navigate, onDone, ...utils };
}

const answerCard = (name: string) => screen.getByRole('listitem', { name });

describe('the list replies screen', () => {
  it('loads the list from its address and shows a skeleton meanwhile', async () => {
    show(openList());
    expect(document.querySelector('[aria-busy="true"]')).toBeTruthy();
    expect(await screen.findByText('Sent to 6 shops · 5 items')).toBeTruthy();
  });

  it('shows a parchi summary with the customer’s own words', async () => {
    show(openList());
    const summary = await screen.findByText('Sent to 6 shops · 5 items');
    const slip = summary.closest('article') as HTMLElement;
    for (const word of ['chini', 'haldi', 'notebook', 'tractor spare bolt', 'chawal'])
      expect(within(slip).getByText(word)).toBeTruthy();
  });

  it('says how many shops answered and how long it keeps listening', async () => {
    show(openList());
    expect(await screen.findByText('3 shops answered · still listening for 12 min')).toBeTruthy();
  });

  it('says "Enough answers" when the list is full and "Listening ended" when it ran out', async () => {
    const { unmount } = show(openList({ state: 'FULL', listening: false, shopsAnswered: 8 }));
    expect(await screen.findByText('Enough answers · 8 shops answered')).toBeTruthy();
    unmount();
    show(openList({ state: 'EXPIRED', listening: false, binding: false }));
    expect(await screen.findByText('Listening ended · 3 shops answered')).toBeTruthy();
  });

  it('keeps the API’s ranked order, the first card open and the others on one line', async () => {
    show(openList());
    await screen.findByText('Sent to 6 shops · 5 items');
    const names = screen
      .getAllByRole('listitem')
      .flatMap((li) => li.getAttribute('aria-label') ?? []);
    expect(names).toEqual(['Mishra Kirana', 'Gupta Store', 'Jain Stationers']);
    const first = answerCard('Mishra Kirana');
    expect(within(first).getByRole('button', { expanded: true })).toBeTruthy();
    expect(within(first).getByText('400 m · delivers, ₹20')).toBeTruthy();
    expect(within(first).getByText('3 of 5')).toBeTruthy();
    expect(within(first).getByText('₹153')).toBeTruthy();
    // Each line: has it (with price), does not have it, does not sell it.
    expect(within(first).getByText('Sugar')).toBeTruthy();
    expect(within(first).getByText('₹48')).toBeTruthy();
    expect(within(first).getByText("Doesn't have")).toBeTruthy();
    expect(within(first).getByText("Doesn't sell")).toBeTruthy();
    const second = answerCard('Gupta Store');
    expect(within(second).getByRole('button', { expanded: false })).toBeTruthy();
    expect(within(second).getByText('900 m · pick up only')).toBeTruthy();
    expect(within(second).queryByText('Sugar')).toBeNull();
  });

  it('expands another card when it is tapped', async () => {
    const { user } = show(openList());
    await screen.findByText('Sent to 6 shops · 5 items');
    await user.click(within(answerCard('Gupta Store')).getByRole('button'));
    expect(within(answerCard('Gupta Store')).getByText('Tractor spare bolt')).toBeTruthy();
    expect(within(answerCard('Gupta Store')).getByRole('button', { expanded: true })).toBeTruthy();
  });

  it('says "delivers free" for a zero fee and just "delivers" when no fee was named', async () => {
    const list = openList();
    list.answers[0]!.deliveryFeePaise = 0;
    show(list);
    await screen.findByText('Sent to 6 shops · 5 items');
    expect(screen.getByText('400 m · delivers free')).toBeTruthy();
    expect(screen.getByText('1.2 km · delivers')).toBeTruthy();
  });

  it('waits with a friendly empty state before any shop answers', async () => {
    show(
      openList({
        answers: [],
        plan: { assignments: [], stops: [], totalM: 0, totalPaise: 0, missing: [0, 1, 2, 3, 4] },
        shopsAnswered: 0,
      }),
    );
    expect(await screen.findByText('Waiting for shops… usually 1–3 minutes')).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: 'Make my plan' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('tells the coverage in a sentence and enables "Make my plan"', async () => {
    show(openList());
    expect(await screen.findByText('Every item has a shop. 3 shops cover all 5.')).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: 'Make my plan' }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it('says how many items have a shop so far when some have none', async () => {
    const base = openList();
    show(
      openList({
        plan: { ...base.plan!, assignments: base.plan!.assignments.slice(0, 3), missing: [3, 4] },
      }),
    );
    expect(await screen.findByText('3 of 5 items have a shop so far')).toBeTruthy();
  });

  it('opens the plan from "Make my plan" and comes back', async () => {
    const { user } = show(openList());
    await user.click(await screen.findByRole('button', { name: 'Make my plan' }));
    expect(screen.getByRole('heading', { name: 'Your plan' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByText('Sent to 6 shops · 5 items')).toBeTruthy();
  });

  it('refreshes on a list.updated hint', async () => {
    const getList = vi
      .fn<SeekerApi['getList']>()
      .mockResolvedValueOnce(openList({ shopsAnswered: 1 }))
      .mockResolvedValue(openList({ shopsAnswered: 3 }));
    show(openList(), { getList });
    expect(await screen.findByText('1 shop answered · still listening for 12 min')).toBeTruthy();
    await act(async () => {
      FakeEventSource.last().emit('list.updated', { listId: 'list-1', state: 'OPEN' });
    });
    expect(await screen.findByText('3 shops answered · still listening for 12 min')).toBeTruthy();
  });

  it('shows a retry when the list cannot be loaded, and a plain message for an unknown list', async () => {
    const getList = vi
      .fn<SeekerApi['getList']>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(openList());
    const { user } = show(openList(), { getList });
    expect((await screen.findByRole('alert')).textContent).toBe("Couldn't load this.");
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Sent to 6 shops · 5 items')).toBeTruthy();
  });

  it('says so when the list does not exist', async () => {
    show(openList(), {
      getList: vi.fn(async () => {
        throw new ApiError(404, 'not_found', 'No such list');
      }),
    });
    expect(await screen.findByText("We can't find this list.")).toBeTruthy();
  });
});

describe('Stop asking on a list', () => {
  it('asks in the page first, then stops the list and says so', async () => {
    const stopped = openList({ state: 'STOPPED', listening: false, binding: false });
    const stopList = vi.fn(async () => stopped);
    const getList = vi
      .fn<SeekerApi['getList']>()
      .mockResolvedValueOnce(openList())
      .mockResolvedValue(stopped);
    const { user } = show(openList(), { stopList, getList });
    await user.click(await screen.findByRole('button', { name: 'Stop asking' }));
    const sheet = screen.getByRole('dialog', { name: 'Stop asking shops?' });
    expect(stopList).not.toHaveBeenCalled();
    await user.click(within(sheet).getByRole('button', { name: 'Stop asking' }));
    await waitFor(() => expect(stopList).toHaveBeenCalledExactlyOnceWith('list-1'));
    expect(await screen.findByText('You stopped asking · 3 shops answered')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Stop asking' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Make my plan' })).toBeNull();
    expect(
      screen.getByText("You can't order from a list you stopped. Start a new one."),
    ).toBeTruthy();
  });

  it('keeps waiting when the customer changes their mind', async () => {
    const { user, api } = show(openList());
    await user.click(await screen.findByRole('button', { name: 'Stop asking' }));
    await user.click(screen.getByRole('button', { name: 'Keep waiting' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(api.stopList).not.toHaveBeenCalled();
  });

  it('is not offered once the list has ended', async () => {
    show(openList({ state: 'EXPIRED', listening: false, binding: false }));
    await screen.findByText('Listening ended · 3 shops answered');
    expect(screen.queryByRole('button', { name: 'Stop asking' })).toBeNull();
  });
});

describe('an ordered list', () => {
  const ordered = () => openList({ state: 'ORDERED', listening: false, binding: false });

  it('shows its orders instead of the answers', async () => {
    const orders = [
      seekerOrder({
        id: 'o1',
        state: 'ACCEPTED',
        fulfilment: 'pickup',
        listId: 'list-1',
        shopName: 'Mishra Kirana',
        lines: [
          { name: 'sugar', count: 1, pricePaise: 4800 },
          { name: 'turmeric', count: 1, pricePaise: 4500 },
        ],
        packedCount: 1,
        feePaise: null,
        itemsTotalPaise: 9300,
      }),
      seekerOrder({
        id: 'o2',
        state: 'READY',
        fulfilment: 'pickup',
        listId: 'list-1',
        shopName: 'Gupta Store',
        lines: [{ name: 'rice', count: 1, pricePaise: 5500 }],
        packedCount: 1,
        feePaise: null,
        itemsTotalPaise: 5500,
      }),
    ];
    show(ordered(), { listOrders: vi.fn(async () => orders) });
    expect(await screen.findByRole('heading', { name: 'Your orders' })).toBeTruthy();
    expect(screen.queryByText('Make my plan')).toBeNull();
    const mishra = screen.getByRole('listitem', { name: 'Mishra Kirana' });
    expect(within(mishra).getByText('Being packed · 1 of 2')).toBeTruthy();
    const gupta = screen.getByRole('listitem', { name: 'Gupta Store' });
    expect(within(gupta).getByText('Ready for pickup')).toBeTruthy();
    expect(
      within(gupta)
        .getByRole('link', { name: /Directions/ })
        .getAttribute('href'),
    ).toContain('google.com/maps');
  });

  it('"Got it" collects a ready pickup', async () => {
    const order = seekerOrder({
      id: 'o2',
      state: 'READY',
      fulfilment: 'pickup',
      listId: 'list-1',
      shopName: 'Gupta Store',
      packedCount: 1,
    });
    const listOrders = vi
      .fn<SeekerApi['listOrders']>()
      .mockResolvedValueOnce([order])
      .mockResolvedValue([{ ...order, state: 'COLLECTED' }]);
    const { user, api } = show(ordered(), { listOrders });
    await user.click(await screen.findByRole('button', { name: 'Got it' }));
    await waitFor(() => expect(api.collectOrder).toHaveBeenCalledExactlyOnceWith('o2'));
    expect(await screen.findByText('Collected')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Got it' })).toBeNull();
  });

  it('"I received it" confirms a delivery that is out', async () => {
    const order = seekerOrder({
      id: 'o3',
      state: 'OUT_FOR_DELIVERY',
      listId: 'list-1',
      shopName: 'Mishra Kirana',
    });
    const { user, api } = show(ordered(), { listOrders: vi.fn(async () => [order]) });
    await user.click(await screen.findByRole('button', { name: 'I received it' }));
    await waitFor(() => expect(api.receiveOrder).toHaveBeenCalledExactlyOnceWith('o3'));
  });

  it('refreshes the packing count on order.packed', async () => {
    const order = seekerOrder({
      id: 'o1',
      state: 'ACCEPTED',
      fulfilment: 'pickup',
      listId: 'list-1',
      shopName: 'Mishra Kirana',
      lines: [
        { name: 'sugar', count: 1, pricePaise: 4800 },
        { name: 'turmeric', count: 1, pricePaise: 4500 },
      ],
      packedCount: 0,
    });
    const listOrders = vi
      .fn<SeekerApi['listOrders']>()
      .mockResolvedValueOnce([order])
      .mockResolvedValue([{ ...order, packedCount: 2 }]);
    show(ordered(), { listOrders });
    expect(await screen.findByText('Being packed · 0 of 2')).toBeTruthy();
    await act(async () => {
      FakeEventSource.last().emit('order.packed', { orderId: 'o1' });
    });
    expect(await screen.findByText('Being packed · 2 of 2')).toBeTruthy();
  });
});
