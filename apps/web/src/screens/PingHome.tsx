import { useCallback, useEffect, useRef, useState } from 'react';
import { ShopOrders } from '../components/ShopOrders.js';
import { useT } from '../i18n/index.js';
import { ApiError, type AnswerBody, type MyShop, type ShopApi, type ShopPing } from '../lib/api.js';
import { canGoLive, connectLive, type LiveOptions } from '../lib/live.js';
import type { ShopOrder } from '../lib/orders.js';
import { PingCard } from './PingCard.js';
import { ShopBar } from './ShopBar.js';

interface Props {
  api: ShopApi;
  /** Fallback poll. Live events do the real work; this only covers a stream that is down. */
  pollMs?: number;
  /** For tests: a stand-in for EventSource and a short reconnect pause. */
  live?: Pick<LiveOptions, 'createSource' | 'retryMs'>;
}

/** How long "the customer already has an answer" stays on screen before the next question. */
const THANKS_MS = 3500;

/** The whole home screen: delivery orders, the newest question, or a calm empty state. */
export function PingHome({ api, pollMs = 30_000, live }: Props) {
  const { t } = useT();
  const [pings, setPings] = useState<ShopPing[] | null>(null);
  const [offline, setOffline] = useState(false);
  const [sendFailed, setSendFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [isLive, setIsLive] = useState(false);
  const [shop, setShop] = useState<MyShop | null>(null);
  const [orders, setOrders] = useState<ShopOrder[]>([]);
  /** "Grahak ko jawab mil gaya": a question that went away because it was answered elsewhere. */
  const [thanks, setThanks] = useState(false);
  const thanksTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const shownId = useRef<string | undefined>(undefined);
  const alive = useRef(true);

  // The shop's own record: the open switch and the standing delivery offer. Without it the screen
  // simply has no bar; a question never waits for it.
  useEffect(() => {
    let live = true;
    api.getMyShop().then(
      (mine) => live && setShop(mine),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [api]);

  const refresh = useCallback(async () => {
    // Orders are an extra: a failure leaves the questions alone.
    api.listOrders().then(
      (next) => {
        if (alive.current) setOrders(next);
      },
      () => undefined,
    );
    try {
      const next = await api.listPings();
      if (!alive.current) return;
      setPings(next);
      setOffline(false);
    } catch {
      if (alive.current) setOffline(true);
    }
  }, [api]);

  useEffect(() => {
    alive.current = true;
    void refresh();
    const timer = setInterval(() => void refresh(), pollMs);
    return () => {
      alive.current = false;
      clearInterval(timer);
      clearTimeout(thanksTimer.current);
    };
  }, [refresh, pollMs]);

  /** The question on screen is gone because the customer already has enough answers. */
  const sayThanks = useCallback(() => {
    setThanks(true);
    clearTimeout(thanksTimer.current);
    thanksTimer.current = setTimeout(() => {
      if (alive.current) setThanks(false);
    }, THANKS_MS);
  }, []);

  // Events are hints: each one just triggers a refetch, so a missed event cannot leave the screen wrong.
  useEffect(() => {
    if (!live?.createSource && !canGoLive()) return;
    const connection = connectLive({
      getTicket: () => api.eventTicket(),
      onEvent: (type, data) => {
        // Not dropped silently: if the card in front of the shop is the one withdrawn, say why.
        if (
          type === 'ping.closed' &&
          data?.['reason'] === 'enough_answers' &&
          data['pingId'] === shownId.current
        )
          sayThanks();
        void refresh();
      },
      onStatus: (up) => {
        if (alive.current) setIsLive(up);
      },
      ...live,
    });
    return () => connection.close();
  }, [api, refresh, live, sayThanks]);

  const current = pings?.[0];
  shownId.current = current?.id;

  async function answer(body: AnswerBody) {
    if (!current) return;
    setBusy(true);
    setSendFailed(false);
    try {
      await api.answerPing(current.id, body);
      setPings((all) => all?.filter((p) => p.id !== current.id) ?? null);
      await refresh();
    } catch (error) {
      // 404 or 409: the question is gone or too old; there is nothing left to answer.
      if (error instanceof ApiError && (error.status === 404 || error.status === 409)) {
        setPings((all) => all?.filter((p) => p.id !== current.id) ?? null);
        await refresh();
      } else {
        setSendFailed(true);
      }
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  return (
    <section aria-live="polite">
      {isLive && <span className="live-dot" role="img" aria-label={t.live} title={t.live} />}
      {shop && <ShopBar api={api} shop={shop} onChange={setShop} />}
      {offline && (
        <p role="status" className="status">
          {t.errOffline}
        </p>
      )}
      {sendFailed && (
        <p className="alert" role="alert">
          {t.errSend}
        </p>
      )}
      <ShopOrders api={api} orders={orders} onChange={() => void refresh()} />
      {thanks ? (
        <p className="ping-gone" role="status">
          {t.pingGone}
        </p>
      ) : pings === null ? (
        <p className="empty">{t.loading}</p>
      ) : current ? (
        <PingCard
          key={current.id}
          photos={api}
          {...(shop && { defaults: shop })}
          ping={current}
          busy={busy}
          onAnswer={(body) => void answer(body)}
        />
      ) : (
        <p className="empty">{t.emptyHome}</p>
      )}
    </section>
  );
}
