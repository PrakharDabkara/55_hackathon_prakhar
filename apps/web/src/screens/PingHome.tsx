import { useCallback, useEffect, useRef, useState } from 'react';
import { useT } from '../i18n/index.js';
import { ApiError, type AnswerBody, type MyShop, type ShopApi, type ShopPing } from '../lib/api.js';
import { canGoLive, connectLive, type LiveOptions } from '../lib/live.js';
import { PingCard } from './PingCard.js';
import { ShopBar } from './ShopBar.js';

interface Props {
  api: ShopApi;
  /** Fallback poll. Live events do the real work; this only covers a stream that is down. */
  pollMs?: number;
  /** For tests: a stand-in for EventSource and a short reconnect pause. */
  live?: Pick<LiveOptions, 'createSource' | 'retryMs'>;
}

/** The whole home screen: the newest question, or a calm empty state. */
export function PingHome({ api, pollMs = 30_000, live }: Props) {
  const { t } = useT();
  const [pings, setPings] = useState<ShopPing[] | null>(null);
  const [offline, setOffline] = useState(false);
  const [sendFailed, setSendFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [isLive, setIsLive] = useState(false);
  const [shop, setShop] = useState<MyShop | null>(null);
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
    };
  }, [refresh, pollMs]);

  // Events are hints: each one just triggers a refetch, so a missed event cannot leave the screen wrong.
  useEffect(() => {
    if (!live?.createSource && !canGoLive()) return;
    const connection = connectLive({
      getTicket: () => api.eventTicket(),
      onEvent: () => void refresh(),
      onStatus: (up) => {
        if (alive.current) setIsLive(up);
      },
      ...live,
    });
    return () => connection.close();
  }, [api, refresh, live]);

  const current = pings?.[0];

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
      {pings === null ? (
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
