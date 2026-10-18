// @vitest-environment jsdom
import { act, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../lib/api.js';
import { FakeEventSource, fakeApi, ping, shop, shopOrder } from '../test/fakes.js';
import { renderApp } from '../test/render.js';
import { PingHome } from './PingHome.js';

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('PingHome', () => {
  it('shows the empty state when nobody has asked anything', async () => {
    renderApp(<PingHome api={fakeApi()} />);
    expect(
      await screen.findByText('Abhi koi sawaal nahi. Naye sawaal yahan apne aap aayenge.'),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Haan hai/ })).toBeNull();
  });

  it('shows one ping at a time, the newest first', async () => {
    const api = fakeApi({
      listPings: vi.fn(async () => [
        ping({ id: 'new', item: { slug: 'rice', nameEn: 'rice', nameHi: 'चावल' } }),
        ping({ id: 'old' }),
      ]),
    });
    renderApp(<PingHome api={api} />);
    expect(await screen.findByText('चावल')).toBeTruthy();
    expect(screen.queryByText('आटा')).toBeNull();
    expect(screen.getAllByRole('button', { name: /Haan hai/ })).toHaveLength(1);
  });

  it('polls every 30 seconds as a fallback and shows a new ping when it arrives', async () => {
    const listPings = vi.fn<() => Promise<ReturnType<typeof ping>[]>>(async () => []);
    renderApp(<PingHome api={fakeApi({ listPings })} />);
    await screen.findByText(/Abhi koi sawaal nahi/);
    expect(listPings).toHaveBeenCalledTimes(1);

    listPings.mockResolvedValue([ping()]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(29_000);
    });
    expect(listPings).toHaveBeenCalledTimes(1); // not yet: 5 s polling is gone
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(listPings).toHaveBeenCalledTimes(2);
    expect(await screen.findByText('आटा')).toBeTruthy();
  });

  it('stops polling when it goes away', async () => {
    const listPings = vi.fn(async () => []);
    const { unmount } = renderApp(<PingHome api={fakeApi({ listPings })} />);
    await screen.findByText(/Abhi koi sawaal nahi/);
    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(listPings).toHaveBeenCalledTimes(1);
  });

  it('"Haan hai", price 45, "Bhejo" calls the answer API with pricePaise 4500', async () => {
    const answerPing = vi.fn(async () => undefined);
    const api = fakeApi({ listPings: vi.fn(async () => [ping({ id: 'p-9' })]), answerPing });
    const { user } = renderApp(<PingHome api={api} />);

    await user.click(await screen.findByRole('button', { name: /Haan hai/ }));
    await user.type(screen.getByLabelText(/Aapka daam/), '45');
    await user.click(screen.getByRole('button', { name: 'Bhejo' }));

    await waitFor(() =>
      expect(answerPing).toHaveBeenCalledExactlyOnceWith('p-9', {
        answer: 'yes',
        pricePaise: 4500,
      }),
    );
  });

  it('"Skip" sends a yes with no price, and "Nahi hai" sends a no', async () => {
    const answerPing = vi.fn(async () => undefined);
    const listPings = vi
      .fn()
      .mockResolvedValueOnce([ping({ id: 'a' }), ping({ id: 'b' })])
      .mockResolvedValue([ping({ id: 'b' })]);
    const { user } = renderApp(<PingHome api={fakeApi({ listPings, answerPing })} />);

    await user.click(await screen.findByRole('button', { name: /Haan hai/ }));
    await user.click(screen.getByRole('button', { name: 'Skip' }));
    await waitFor(() => expect(answerPing).toHaveBeenCalledWith('a', { answer: 'yes' }));

    await user.click(await screen.findByRole('button', { name: /Nahi hai/ }));
    await waitFor(() => expect(answerPing).toHaveBeenCalledWith('b', { answer: 'no' }));
  });

  it('moves to the next ping, then the empty state, after answering', async () => {
    const listPings = vi
      .fn()
      .mockResolvedValueOnce([ping({ id: 'a' })])
      .mockResolvedValue([]);
    const { user } = renderApp(<PingHome api={fakeApi({ listPings })} />);
    await user.click(await screen.findByRole('button', { name: /Nahi hai/ }));
    expect(await screen.findByText(/Abhi koi sawaal nahi/)).toBeTruthy();
  });

  it('keeps the card and says so when sending fails, so the shopkeeper can try again', async () => {
    const answerPing = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(500, 'internal', 'boom'))
      .mockResolvedValue(undefined);
    const api = fakeApi({ listPings: vi.fn(async () => [ping()]), answerPing });
    const { user } = renderApp(<PingHome api={api} />);

    await user.click(await screen.findByRole('button', { name: /Nahi hai/ }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /Nahi hai/ }));
    await waitFor(() => expect(answerPing).toHaveBeenCalledTimes(2));
  });

  it('drops a ping that went stale (409) and carries on', async () => {
    const answerPing = vi.fn().mockRejectedValue(new ApiError(409, 'ping_closed', 'too old'));
    const listPings = vi.fn().mockResolvedValueOnce([ping()]).mockResolvedValue([]);
    const { user } = renderApp(<PingHome api={fakeApi({ listPings, answerPing })} />);
    await user.click(await screen.findByRole('button', { name: /Nahi hai/ }));
    expect(await screen.findByText(/Abhi koi sawaal nahi/)).toBeTruthy();
  });

  describe('live updates', () => {
    const live = { createSource: (url: string) => new FakeEventSource(url), retryMs: 1000 };

    beforeEach(() => FakeEventSource.reset());

    it('opens a stream with a fresh ticket and shows a "live" dot only while it is open', async () => {
      const api = fakeApi();
      renderApp(<PingHome api={api} live={live} />);
      await screen.findByText(/Abhi koi sawaal nahi/);
      expect(api.eventTicket).toHaveBeenCalledTimes(1);
      expect(FakeEventSource.last().url).toBe('/events?ticket=ticket-1');
      expect(screen.queryByRole('img', { name: 'Live' })).toBeNull();

      act(() => FakeEventSource.last().open());
      expect(screen.getByRole('img', { name: 'Live' })).toBeTruthy();

      act(() => FakeEventSource.last().fail());
      expect(screen.queryByRole('img', { name: 'Live' })).toBeNull();
    });

    it('refetches the list on every event, so a missed event can never leave the screen wrong', async () => {
      const listPings = vi.fn<() => Promise<ReturnType<typeof ping>[]>>(async () => []);
      renderApp(<PingHome api={fakeApi({ listPings })} live={live} />);
      await screen.findByText(/Abhi koi sawaal nahi/);
      expect(listPings).toHaveBeenCalledTimes(1);

      listPings.mockResolvedValue([ping({ id: 'new' })]);
      act(() => FakeEventSource.last().emit('ping.created', { pingId: 'new' }));
      expect(await screen.findByText('आटा')).toBeTruthy();
      expect(listPings).toHaveBeenCalledTimes(2);

      listPings.mockResolvedValue([]);
      act(() => FakeEventSource.last().emit('ping.closed', { pingId: 'new' }));
      expect(await screen.findByText(/Abhi koi sawaal nahi/)).toBeTruthy();
      expect(listPings).toHaveBeenCalledTimes(3);
    });

    it('trusts the list, not the event: a ping.created that carries a wrong id changes nothing', async () => {
      const listPings = vi.fn(async () => [ping({ id: 'real' })]);
      renderApp(<PingHome api={fakeApi({ listPings })} live={live} />);
      await screen.findByText('आटा');
      act(() => FakeEventSource.last().emit('ping.created', { pingId: 'bogus' }));
      await waitFor(() => expect(listPings).toHaveBeenCalledTimes(2));
      expect(screen.getAllByText('आटा')).toHaveLength(1);
    });

    it('asks for a new ticket on each reconnect, and still polls every 30 s while down', async () => {
      const listPings = vi.fn(async () => []);
      const api = fakeApi({ listPings });
      renderApp(<PingHome api={api} live={live} />);
      await screen.findByText(/Abhi koi sawaal nahi/);
      act(() => FakeEventSource.last().fail());
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1100);
      });
      expect(api.eventTicket).toHaveBeenCalledTimes(2);
      expect(FakeEventSource.instances).toHaveLength(2);

      act(() => FakeEventSource.last().fail());
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
      });
      expect(listPings.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    it('closes the stream when it goes away', async () => {
      const { unmount } = renderApp(<PingHome api={fakeApi()} live={live} />);
      await screen.findByText(/Abhi koi sawaal nahi/);
      const source = FakeEventSource.last();
      unmount();
      expect(source.closed).toBe(true);
    });

    it('works without live updates (an old browser, no stream): polling alone', async () => {
      const listPings = vi.fn(async () => []);
      renderApp(<PingHome api={fakeApi({ listPings })} />);
      await screen.findByText(/Abhi koi sawaal nahi/);
      expect(screen.queryByRole('img', { name: 'Live' })).toBeNull();
    });
  });
});

describe('PingHome: the open / closed switch and the standing delivery offer (ADR-0031)', () => {
  it('shows "Dukaan khuli hai" and closes the shop for the day with one tap', async () => {
    const api = fakeApi();
    const { user } = renderApp(<PingHome api={api} />);
    const toggle = await screen.findByRole('switch', { name: 'Dukaan khuli hai' });
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    await user.click(toggle);
    expect(api.setShopOpen).toHaveBeenCalledWith(false);
    expect(await screen.findByRole('switch', { name: 'Dukaan aaj band hai' })).toBeTruthy();
    await user.click(screen.getByRole('switch', { name: 'Dukaan aaj band hai' }));
    expect(api.setShopOpen).toHaveBeenLastCalledWith(true);
    expect(await screen.findByRole('switch', { name: 'Dukaan khuli hai' })).toBeTruthy();
  });

  it('starts closed when the shop is closed', async () => {
    const api = fakeApi({ getMyShop: vi.fn(async () => shop({ open: false })) });
    renderApp(<PingHome api={api} />);
    expect(await screen.findByRole('switch', { name: 'Dukaan aaj band hai' })).toBeTruthy();
  });

  it('keeps the shop open on screen if closing fails', async () => {
    const api = fakeApi({ setShopOpen: vi.fn().mockRejectedValue(new Error('x')) });
    const { user } = renderApp(<PingHome api={api} />);
    await user.click(await screen.findByRole('switch', { name: 'Dukaan khuli hai' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/nahi ho paya|dobara/i);
    expect(screen.getByRole('switch', { name: 'Dukaan khuli hai' })).toBeTruthy();
  });

  it('lets the shop set its standing delivery offer under "Delivery ki settings"', async () => {
    const api = fakeApi();
    const { user } = renderApp(<PingHome api={api} />);
    await user.click(await screen.findByText('Delivery ki settings'));
    await user.click(screen.getByRole('checkbox', { name: 'Hum ghar bhejte hain' }));
    await user.type(screen.getByLabelText('Delivery ka daam (₹)'), '25');
    await user.type(screen.getByLabelText('Kitne minute mein?'), '40');
    await user.click(screen.getByRole('button', { name: 'Save karein' }));
    await waitFor(() =>
      expect(api.updateDelivery).toHaveBeenCalledWith({ feePaise: 2500, minutes: 40 }),
    );
    await user.click(screen.getByRole('checkbox', { name: 'Hum ghar bhejte hain' }));
    await user.click(screen.getByRole('button', { name: 'Save karein' }));
    await waitFor(() => expect(api.updateDelivery).toHaveBeenLastCalledWith(null));
  });
});

describe('delivery orders on the shop home (ADR-0031)', () => {
  const live = { createSource: (url: string) => new FakeEventSource(url), retryMs: 1000 };
  beforeEach(() => FakeEventSource.reset());

  it('lists the shop’s orders, with Accept and Decline on a new one', async () => {
    const listOrders = vi.fn(async () => [shopOrder()]);
    renderApp(<PingHome api={fakeApi({ listOrders })} />);
    expect(await screen.findByRole('button', { name: 'Accept' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Decline' })).toBeTruthy();
  });

  it('shows a new order above the question, so neither hides the other', async () => {
    const api = fakeApi({
      listPings: vi.fn(async () => [ping()]),
      listOrders: vi.fn(async () => [shopOrder()]),
    });
    renderApp(<PingHome api={api} />);
    expect(await screen.findByRole('button', { name: 'Accept' })).toBeTruthy();
    expect(screen.getByText('आटा')).toBeTruthy();
  });

  it('refetches the orders on order.created and order.updated, so a missed event cannot leave it wrong', async () => {
    const listOrders = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([shopOrder()])
      .mockResolvedValue([shopOrder({ state: 'CANCELLED', final: true })]);
    renderApp(<PingHome api={fakeApi({ listOrders })} live={live} />);
    await screen.findByText(/Abhi koi sawaal nahi/);
    act(() => FakeEventSource.last().emit('order.created', { orderId: 'order-1' }));
    expect(await screen.findByRole('button', { name: 'Accept' })).toBeTruthy();
    act(() =>
      FakeEventSource.last().emit('order.updated', { orderId: 'order-1', state: 'CANCELLED' }),
    );
    expect(await screen.findByText(/Grahak ne order cancel kiya/)).toBeTruthy();
  });

  it('works when the orders cannot be fetched: the questions still show', async () => {
    const api = fakeApi({
      listPings: vi.fn(async () => [ping()]),
      listOrders: vi.fn(async () => {
        throw new Error('offline');
      }),
    });
    renderApp(<PingHome api={api} />);
    expect(await screen.findByText('आटा')).toBeTruthy();
  });

  it('after Accept the card shows the address the server now sends', async () => {
    const listOrders = vi
      .fn()
      .mockResolvedValueOnce([shopOrder()])
      .mockResolvedValue([
        shopOrder({
          state: 'ACCEPTED',
          addressText: 'Flat 4B, Sapna Apartments',
          mapUrl: 'https://www.google.com/maps/search/?api=1&query=22.72,75.86',
        }),
      ]);
    const { user } = renderApp(<PingHome api={fakeApi({ listOrders })} />);
    await user.click(await screen.findByRole('button', { name: 'Accept' }));
    expect(await screen.findByText('Flat 4B, Sapna Apartments')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Map par dekho' })).toBeTruthy();
  });
});

describe('a question that the customer no longer needs', () => {
  const live = { createSource: (url: string) => new FakeEventSource(url), retryMs: 1000 };
  beforeEach(() => FakeEventSource.reset());
  const THANKS = 'Grahak ko jawab mil gaya — shukriya';

  it('is not dropped silently: it says "Grahak ko jawab mil gaya — shukriya" for a moment, then goes', async () => {
    const listPings = vi
      .fn<() => Promise<ReturnType<typeof ping>[]>>()
      .mockResolvedValueOnce([ping({ id: 'p1' })])
      .mockResolvedValue([]);
    renderApp(<PingHome api={fakeApi({ listPings })} live={live} />);
    await screen.findByText('आटा');
    act(() =>
      FakeEventSource.last().emit('ping.closed', { pingId: 'p1', reason: 'enough_answers' }),
    );
    expect(await screen.findByText(THANKS)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Haan hai/ })).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
    });
    expect(screen.queryByText(THANKS)).toBeNull();
    expect(screen.getByText(/Abhi koi sawaal nahi/)).toBeTruthy();
  });

  it('says nothing when the shop answered it itself', async () => {
    const listPings = vi
      .fn<() => Promise<ReturnType<typeof ping>[]>>()
      .mockResolvedValueOnce([ping({ id: 'p1' })])
      .mockResolvedValue([]);
    renderApp(<PingHome api={fakeApi({ listPings })} live={live} />);
    await screen.findByText('आटा');
    act(() => FakeEventSource.last().emit('ping.closed', { pingId: 'p1', reason: 'answered' }));
    expect(await screen.findByText(/Abhi koi sawaal nahi/)).toBeTruthy();
    expect(screen.queryByText(THANKS)).toBeNull();
  });

  it('says nothing about a question the shop was not looking at', async () => {
    const listPings = vi
      .fn<() => Promise<ReturnType<typeof ping>[]>>()
      .mockResolvedValueOnce([ping({ id: 'p1' }), ping({ id: 'p2' })])
      .mockResolvedValue([ping({ id: 'p1' })]);
    renderApp(<PingHome api={fakeApi({ listPings })} live={live} />);
    await screen.findByText('आटा');
    act(() =>
      FakeEventSource.last().emit('ping.closed', { pingId: 'p2', reason: 'enough_answers' }),
    );
    await waitFor(() => expect(listPings).toHaveBeenCalledTimes(2));
    expect(screen.queryByText(THANKS)).toBeNull();
    expect(screen.getByText('आटा')).toBeTruthy();
  });

  it('shows the next question after the thanks', async () => {
    const listPings = vi
      .fn<() => Promise<ReturnType<typeof ping>[]>>()
      .mockResolvedValueOnce([
        ping({ id: 'p1' }),
        ping({ id: 'p2', item: { slug: 'rice', nameEn: 'rice', nameHi: 'चावल' } }),
      ])
      .mockResolvedValue([
        ping({ id: 'p2', item: { slug: 'rice', nameEn: 'rice', nameHi: 'चावल' } }),
      ]);
    renderApp(<PingHome api={fakeApi({ listPings })} live={live} />);
    await screen.findByText('आटा');
    act(() =>
      FakeEventSource.last().emit('ping.closed', { pingId: 'p1', reason: 'enough_answers' }),
    );
    expect(await screen.findByText(THANKS)).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
    });
    expect(await screen.findByText('चावल')).toBeTruthy();
  });
});
