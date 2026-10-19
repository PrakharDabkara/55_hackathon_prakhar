// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeEventSource, fakeApi, ping, shop, shopOrder } from '../../test/fakes.js';
import { useShopData } from './useShopData.js';

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  FakeEventSource.reset();
});
afterEach(() => vi.useRealTimers());

// One object for the whole test: a new one on every render would reopen the stream each time.
const liveOpts = {
  createSource: (url: string) => new FakeEventSource(url),
  retryMs: 10,
};

describe('useShopData', () => {
  it('loads the pings and the orders', async () => {
    const api = fakeApi({
      listPings: vi.fn(async () => [ping()]),
      listOrders: vi.fn(async () => [shopOrder({ id: 'o1' })]),
    });
    const { result } = renderHook(() => useShopData(api, shop(), { live: liveOpts }));
    expect(result.current.pings).toBeNull();
    await waitFor(() => expect(result.current.pings).toHaveLength(1));
    expect(result.current.orders?.[0]?.id).toBe('o1');
    expect(result.current.loadFailed).toBe(false);
    expect(result.current.offline).toBe(false);
  });

  it('says the first load failed when there is nothing to show yet, and retries on request', async () => {
    const listPings = vi
      .fn<() => Promise<ReturnType<typeof ping>[]>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue([ping()]);
    const api = fakeApi({ listPings });
    const { result } = renderHook(() => useShopData(api, shop(), { live: liveOpts }));
    await waitFor(() => expect(result.current.loadFailed).toBe(true));
    expect(result.current.pings).toBeNull();
    await act(() => result.current.refresh());
    await waitFor(() => expect(result.current.pings).toHaveLength(1));
    expect(result.current.loadFailed).toBe(false);
  });

  it('keeps what it has and says offline when a later refresh fails', async () => {
    const listPings = vi
      .fn<() => Promise<ReturnType<typeof ping>[]>>()
      .mockResolvedValueOnce([ping()])
      .mockRejectedValue(new Error('offline'));
    const api = fakeApi({ listPings });
    const { result } = renderHook(() => useShopData(api, shop(), { live: liveOpts }));
    await waitFor(() => expect(result.current.pings).toHaveLength(1));
    await act(() => result.current.refresh());
    expect(result.current.offline).toBe(true);
    expect(result.current.pings).toHaveLength(1);
    expect(result.current.loadFailed).toBe(false);
  });

  it('polls every 30 seconds as a fallback', async () => {
    const listPings = vi.fn(async () => []);
    const api = fakeApi({ listPings });
    renderHook(() => useShopData(api, shop(), { live: liveOpts }));
    await waitFor(() => expect(listPings).toHaveBeenCalledTimes(1));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_500);
    });
    expect(listPings).toHaveBeenCalledTimes(2);
  });

  it('refetches on a live event and shows the live dot state', async () => {
    const listPings = vi.fn(async () => []);
    const api = fakeApi({ listPings });
    const { result } = renderHook(() => useShopData(api, shop(), { live: liveOpts }));
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    await act(async () => FakeEventSource.last().open());
    expect(result.current.isLive).toBe(true);
    const before = listPings.mock.calls.length;
    await act(async () => FakeEventSource.last().emit('ping.created', { pingId: 'p9' }));
    await waitFor(() => expect(listPings.mock.calls.length).toBeGreaterThan(before));
  });

  it('announces an order that becomes ACCEPTED after the first look, not before', async () => {
    const listOrders = vi
      .fn<() => Promise<ReturnType<typeof shopOrder>[]>>()
      .mockResolvedValueOnce([shopOrder({ id: 'old', state: 'ACCEPTED' })])
      .mockResolvedValue([
        shopOrder({ id: 'old', state: 'ACCEPTED' }),
        shopOrder({ id: 'new', state: 'ACCEPTED' }),
      ]);
    const api = fakeApi({ listOrders });
    const { result } = renderHook(() => useShopData(api, shop(), { live: liveOpts }));
    await waitFor(() => expect(result.current.orders).toHaveLength(1));
    expect(result.current.banner).toBeNull();
    await act(() => result.current.refresh());
    expect(result.current.banner?.id).toBe('new');
    act(() => result.current.dismissBanner());
    expect(result.current.banner).toBeNull();
    await act(() => result.current.refresh());
    expect(result.current.banner).toBeNull();
  });

  it('opens and closes the shop through the server and keeps the answer', async () => {
    const api = fakeApi();
    const { result } = renderHook(() => useShopData(api, shop({ open: true }), { live: liveOpts }));
    await act(() => result.current.setOpen(false));
    expect(api.setShopOpen).toHaveBeenCalledWith(false);
    expect(result.current.shop.open).toBe(false);
  });

  it('leaves the shop as it was when the change fails', async () => {
    const api = fakeApi({ setShopOpen: vi.fn(async () => Promise.reject(new Error('offline'))) });
    const { result } = renderHook(() => useShopData(api, shop({ open: true }), { live: liveOpts }));
    await expect(act(() => result.current.setOpen(false))).rejects.toThrow();
    expect(result.current.shop.open).toBe(true);
  });

  it('stops everything when it goes away', async () => {
    const listPings = vi.fn(async () => []);
    const api = fakeApi({ listPings });
    const { unmount } = renderHook(() => useShopData(api, shop(), { live: liveOpts }));
    await waitFor(() => expect(listPings).toHaveBeenCalledTimes(1));
    unmount();
    expect(FakeEventSource.last().closed).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(90_000);
    });
    expect(listPings).toHaveBeenCalledTimes(1);
  });

  describe('a question the customer no longer needs', () => {
    const close = (reason: string, pingId = 'p1') =>
      act(async () => FakeEventSource.last().emit('ping.closed', { pingId, reason }));

    async function start(onPingGone: () => void) {
      const api = fakeApi({ listPings: vi.fn(async () => [ping({ id: 'p1' })]) });
      const view = renderHook(() => useShopData(api, shop(), { live: liveOpts, onPingGone }));
      await waitFor(() => expect(view.result.current.pings).toHaveLength(1));
      await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
      return view;
    }

    it('is said out loud, not dropped silently', async () => {
      const onPingGone = vi.fn();
      await start(onPingGone);
      await close('enough_answers');
      expect(onPingGone).toHaveBeenCalledOnce();
    });

    it('is also said when the customer chose another shop', async () => {
      const onPingGone = vi.fn();
      await start(onPingGone);
      await close('customer_chose');
      expect(onPingGone).toHaveBeenCalledOnce();
    });

    it('says nothing when the shop answered it itself', async () => {
      const onPingGone = vi.fn();
      const { result } = await start(onPingGone);
      act(() => result.current.markAnswered('p1'));
      await close('enough_answers');
      expect(onPingGone).not.toHaveBeenCalled();
    });

    it('says nothing about a question that is not on the list, or another reason', async () => {
      const onPingGone = vi.fn();
      await start(onPingGone);
      await close('enough_answers', 'someone-else');
      await close('expired');
      expect(onPingGone).not.toHaveBeenCalled();
    });
  });

  it('works without live updates (an old browser, no stream): polling alone', async () => {
    const listPings = vi.fn(async () => []);
    const api = fakeApi({ listPings });
    // No EventSource in this browser, and no stand-in given.
    vi.stubGlobal('EventSource', undefined);
    try {
      renderHook(() => useShopData(api, shop()));
      await waitFor(() => expect(listPings).toHaveBeenCalledTimes(1));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_500);
      });
      expect(listPings).toHaveBeenCalledTimes(2);
      expect(FakeEventSource.instances).toHaveLength(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
