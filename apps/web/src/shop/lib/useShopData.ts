import { useCallback, useEffect, useRef, useState } from 'react';
import type { MyShop, ShopApi, ShopPing } from '../../lib/api.js';
import { canGoLive, connectLive, type LiveOptions } from '../../lib/live.js';
import type { ShopOrder } from '../../lib/orders.js';
import { newlyAccepted } from './deck.js';

export interface ShopData {
  shop: MyShop;
  setShop: (shop: MyShop) => void;
  /** null until the first answer from the server. */
  pings: ShopPing[] | null;
  orders: ShopOrder[] | null;
  /** The first load failed and there is nothing to show yet: show the retry state. */
  loadFailed: boolean;
  /** A refresh failed or the phone is offline, but there is something on screen. */
  offline: boolean;
  ordersFailed: boolean;
  /** The live event stream is open. */
  isLive: boolean;
  /** A customer just chose this shop: the newest such order, until it is dismissed. */
  banner: ShopOrder | null;
  dismissBanner: () => void;
  refresh: () => Promise<void>;
  removePing: (id: string) => void;
  /** The shop answered this question itself: its closing is not news. */
  markAnswered: (id: string) => void;
  /** Resolves when the server has the new state; rejects (and changes nothing) when it could not. */
  setOpen: (open: boolean) => Promise<void>;
}

interface Options {
  /** Fallback poll. Live events do the real work; this only covers a stream that is down. */
  pollMs?: number;
  /** For tests: a stand-in for EventSource and a short reconnect pause. */
  live?: Pick<LiveOptions, 'createSource' | 'retryMs'>;
  /** A question on the list was withdrawn because the customer has enough answers or chose a shop. */
  onPingGone?: () => void;
}

/**
 * Everything the shop screens share: the shop itself, the questions and the orders, kept fresh by
 * server events with a 30 s poll as a safety net. Events are hints: each one is just a refetch.
 */
export function useShopData(
  api: ShopApi,
  initialShop: MyShop,
  { pollMs = 30_000, live, onPingGone }: Options = {},
): ShopData {
  const [shop, setShop] = useState(initialShop);
  const [pings, setPings] = useState<ShopPing[] | null>(null);
  const [orders, setOrders] = useState<ShopOrder[] | null>(null);
  const [pingsFailed, setPingsFailed] = useState(false);
  const [ordersFailed, setOrdersFailed] = useState(false);
  const [browserOffline, setBrowserOffline] = useState(
    () => typeof navigator !== 'undefined' && navigator.onLine === false,
  );
  const [isLive, setIsLive] = useState(false);
  const [banner, setBanner] = useState<ShopOrder | null>(null);
  const seen = useRef<Set<string> | null>(null);
  const alive = useRef(true);
  const listed = useRef<ShopPing[] | null>(null);
  const mine = useRef(new Set<string>());
  const gone = useRef(onPingGone);
  gone.current = onPingGone;
  listed.current = pings;

  const refresh = useCallback(async () => {
    const [pingsResult, ordersResult] = await Promise.allSettled([
      api.listPings(),
      api.listOrders(),
    ]);
    if (!alive.current) return;
    if (pingsResult.status === 'fulfilled') {
      setPings(pingsResult.value);
      setPingsFailed(false);
    } else setPingsFailed(true);
    if (ordersResult.status === 'fulfilled') {
      const next = ordersResult.value;
      const fresh = newlyAccepted(seen.current, next);
      if (fresh.length > 0) setBanner(fresh[fresh.length - 1] ?? null);
      seen.current = new Set(next.filter((o) => o.state === 'ACCEPTED').map((o) => o.id));
      setOrders(next);
      setOrdersFailed(false);
    } else setOrdersFailed(true);
  }, [api]);

  useEffect(() => {
    alive.current = true;
    void refresh();
    const timer = setInterval(() => void refresh(), pollMs);
    return () => {
      alive.current = false;
      clearInterval(timer);
    };
  }, [refresh, pollMs]);

  useEffect(() => {
    if (!live?.createSource && !canGoLive()) return;
    const connection = connectLive({
      getTicket: () => api.eventTicket(),
      onEvent: (type, event) => {
        // Not dropped silently: if a question in front of the shop is withdrawn, say why.
        const id = event?.['pingId'];
        const reason = event?.['reason'];
        if (
          type === 'ping.closed' &&
          (reason === 'enough_answers' || reason === 'customer_chose') &&
          typeof id === 'string' &&
          !mine.current.has(id) &&
          listed.current?.some((p) => p.id === id)
        )
          gone.current?.();
        void refresh();
      },
      onStatus: (up) => {
        if (alive.current) setIsLive(up);
      },
      ...live,
    });
    return () => connection.close();
  }, [api, refresh, live]);

  useEffect(() => {
    const online = () => {
      setBrowserOffline(false);
      void refresh();
    };
    const offline = () => setBrowserOffline(true);
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    return () => {
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offline);
    };
  }, [refresh]);

  const setOpen = useCallback(
    async (open: boolean) => {
      setShop(await api.setShopOpen(open));
    },
    [api],
  );

  const markAnswered = useCallback((id: string) => void mine.current.add(id), []);
  const dismissBanner = useCallback(() => setBanner(null), []);
  const removePing = useCallback(
    (id: string) => setPings((all) => all?.filter((p) => p.id !== id) ?? null),
    [],
  );

  const loadFailed = pings === null && pingsFailed;
  return {
    shop,
    setShop,
    pings,
    orders,
    loadFailed,
    offline: browserOffline || (pingsFailed && pings !== null),
    ordersFailed,
    isLive,
    banner,
    dismissBanner,
    refresh,
    removePing,
    markAnswered,
    setOpen,
  };
}
