// @vitest-environment jsdom
import { act, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../lib/api.js';
import { FakeEventSource, fakeApi, ping } from '../test/fakes.js';
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
