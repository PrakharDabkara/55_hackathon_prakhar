import { useCallback, useEffect, useRef, useState } from 'react';
import { useT } from '../i18n/index.js';
import { ApiError, type AnswerBody, type ShopApi, type ShopPing } from '../lib/api.js';
import { PingCard } from './PingCard.js';

interface Props {
  api: ShopApi;
  /** How often to look for new questions. Day 8 replaces polling with server-sent events. */
  pollMs?: number;
}

/** The whole home screen: the newest question, or a calm empty state. */
export function PingHome({ api, pollMs = 5000 }: Props) {
  const { t } = useT();
  const [pings, setPings] = useState<ShopPing[] | null>(null);
  const [offline, setOffline] = useState(false);
  const [sendFailed, setSendFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);

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
