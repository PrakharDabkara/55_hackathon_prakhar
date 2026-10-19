import { useEffect, useMemo, useRef, useState } from 'react';
import { useT } from '../../i18n/index.js';
import { ApiError, type AnswerBody, type ShopApi, type ShopPing } from '../../lib/api.js';
import type { PushClient } from '../../lib/push.js';
import { buildDeck } from '../lib/deck.js';
import { useDemand, usePush } from '../lib/hooks.js';
import type { ShopData } from '../lib/useShopData.js';
import { Button } from '../ui/Button.js';
import { Deck } from '../ui/Deck.js';
import { Icon } from '../ui/Icon.js';
import { OrderSlip } from '../ui/OrderSlip.js';
import { PingSlip } from '../ui/PingSlip.js';
import { Skeleton } from '../ui/Skeleton.js';
import { useToast } from '../ui/Toast.js';
import { AnswerSheet } from './AnswerSheet.js';
import { WantsDeliverySheet } from './WantsDeliverySheet.js';

interface Props {
  api: ShopApi;
  data: ShopData;
  now: number;
  /** For tests: a stand-in for the browser's push side. */
  pushClient?: PushClient;
}

/** The stamp lands, then 300 ms later the deck moves on (UI spec C). */
const STAMP_MS = 300;

/** Home: the request deck, the new-order banner, and two numbers to glance at. */
export function Home({ api, data, now, pushClient }: Props) {
  const { t } = useT();
  const s = t.shop;
  const toast = useToast();
  const { shop, pings, orders } = data;
  const [index, setIndex] = useState(0);
  const [sheetFor, setSheetFor] = useState<ShopPing | null>(null);
  const [stamped, setStamped] = useState<Record<string, 'yes' | 'no'>>({});
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set());
  const [busyOrder, setBusyOrder] = useState<string | null>(null);
  /** Taps already sent, by order, action and state: a double tap sends once. */
  const sentOrder = useRef(new Set<string>());
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const today = useDemand(api, 1);
  const push = usePush(api, pushClient);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const slips = useMemo(
    () => buildDeck(pings ?? [], orders ?? []).filter((slip) => !gone.has(slip.key)),
    [pings, orders, gone],
  );
  const current = Math.min(index, Math.max(0, slips.length - 1));
  const activeOrders = (orders ?? []).filter((order) => !order.final).length;

  function leaveDeck(key: string, after: () => void) {
    timers.current.push(
      setTimeout(() => {
        setGone((all) => new Set(all).add(key));
        after();
      }, STAMP_MS),
    );
  }

  async function submitAnswer(ping: ShopPing, body: AnswerBody) {
    try {
      await api.answerPing(ping.id, body);
    } catch (error) {
      // 404 or 409: the question is gone or the customer has enough answers; nothing left to answer.
      if (error instanceof ApiError && (error.status === 404 || error.status === 409)) {
        setSheetFor(null);
        toast(s.pingGone);
        data.removePing(ping.id);
        void data.refresh();
        return;
      }
      throw error;
    }
    setSheetFor(null);
    data.markAnswered(ping.id);
    const key = `ping:${ping.id}`;
    setStamped((all) => ({ ...all, [key]: body.answer }));
    leaveDeck(key, () => {
      data.removePing(ping.id);
      void data.refresh();
      void today.reload();
    });
  }

  async function actOnOrder(id: string, verb: 'accept' | 'decline') {
    const key = `${id}:${verb}`;
    if (sentOrder.current.has(key)) return;
    sentOrder.current.add(key);
    setBusyOrder(id);
    try {
      await api.orderAction(id, verb);
      toast(verb === 'accept' ? s.orderAccepted : s.orderDeclined);
    } catch (error) {
      // 404 or 409: the customer cancelled, or it ran out of time. The refresh shows it is gone.
      if (!(error instanceof ApiError && (error.status === 404 || error.status === 409))) {
        sentOrder.current.delete(key);
        toast(s.sendFailed);
      }
    } finally {
      setBusyOrder(null);
      void data.refresh();
    }
  }

  if (!shop.open) {
    return (
      <section className="sh-center" aria-labelledby="closed-title">
        <div className="sh-blank-stack" aria-hidden="true">
          <span className="sh-blank" />
          <span className="sh-blank" />
        </div>
        <h1 id="closed-title" className="sh-title">
          {s.closedTitle}
        </h1>
        <Button
          variant="primary"
          onClick={() => void data.setOpen(true).catch(() => toast(s.openFailed))}
        >
          {s.openShop}
        </Button>
      </section>
    );
  }

  const notifications =
    push.status === 'on' ? (
      <p className="sh-pill-note">
        <Icon name="check" size={18} />
        {s.notificationsOn}
      </p>
    ) : push.status === 'off' ? (
      <Button variant="secondary" disabled={push.busy} onClick={() => void push.enable()}>
        {s.turnOnNotifications}
      </Button>
    ) : null;

  return (
    <>
      {data.banner && (
        <div className="sh-banner" role="status">
          <span>{s.orderBanner(data.banner.lines[0]?.name ?? '')}</span>
          <a className="sh-banner__link" href="#/orders" onClick={data.dismissBanner}>
            {s.viewOrder}
          </a>
        </div>
      )}
      {pings === null && data.loadFailed ? (
        <div className="sh-center">
          <p className="sh-alert" role="alert">
            {s.loadFailed}
          </p>
          <Button variant="secondary" onClick={() => void data.refresh()}>
            {s.retry}
          </Button>
        </div>
      ) : pings === null ? (
        <div className="sh-stack" aria-busy="true">
          <span className="sh-visually-hidden">{s.loading}</span>
          <Skeleton height="40px" width="60%" />
          <Skeleton height="320px" radius="0" />
        </div>
      ) : slips.length === 0 ? (
        <div className="sh-center">
          <div className="sh-blank-stack" aria-hidden="true">
            <span className="sh-blank" />
            <span className="sh-blank" />
          </div>
          <h1 className="sh-title">{s.emptyTitle}</h1>
          <p className="sh-body sh-muted">{s.emptyBody}</p>
          {notifications}
        </div>
      ) : (
        <>
          <div className="sh-deckhead">
            <div>
              <p className="sh-caption">{s.position(current + 1, slips.length)}</p>
              <h1 className="sh-title">{s.todaysRequests}</h1>
            </div>
            <div className="sh-deckhead__nav">
              <button
                type="button"
                className="sh-icon-btn"
                aria-label={s.previous}
                disabled={current === 0}
                onClick={() => setIndex(current - 1)}
              >
                <Icon name="left" />
              </button>
              <button
                type="button"
                className="sh-icon-btn"
                aria-label={s.next}
                disabled={current >= slips.length - 1}
                onClick={() => setIndex(current + 1)}
              >
                <Icon name="right" />
              </button>
            </div>
          </div>
          <Deck
            index={current}
            onIndexChange={setIndex}
            slides={slips.map((slip) => ({
              key: slip.key,
              node:
                slip.kind === 'ping' ? (
                  <PingSlip
                    ping={slip.ping}
                    now={now}
                    photos={api}
                    stamp={stamped[slip.key] ?? null}
                    onAnswer={() => setSheetFor(slip.ping)}
                  />
                ) : (
                  <OrderSlip
                    order={slip.order}
                    now={now}
                    busy={busyOrder !== null}
                    onAccept={() => void actOnOrder(slip.order.id, 'accept')}
                    onDecline={() => void actOnOrder(slip.order.id, 'decline')}
                  />
                ),
            }))}
          />
        </>
      )}

      <div className="sh-strip">
        <a className="sh-tile" href="#/orders">
          <span className="sh-figure">{activeOrders}</span>
          <span className="sh-tile__label">
            {s.activeOrders}
            <Icon name="right" size={16} />
          </span>
        </a>
        <a className="sh-tile" href="#/insights">
          <span className="sh-figure sh-figure--small">
            {today.demand
              ? s.answeredOf(today.demand.today.answered, today.demand.today.received)
              : '—'}
          </span>
          <span className="sh-tile__label">
            {s.todayLink}
            <Icon name="right" size={16} />
          </span>
        </a>
      </div>

      {sheetFor &&
        (sheetFor.wantsDelivery ? (
          <WantsDeliverySheet
            ping={sheetFor}
            shop={shop}
            onClose={() => setSheetFor(null)}
            onSubmit={(body) => submitAnswer(sheetFor, body)}
          />
        ) : (
          <AnswerSheet
            ping={sheetFor}
            shop={shop}
            photos={api}
            onClose={() => setSheetFor(null)}
            onSubmit={(body) => submitAnswer(sheetFor, body)}
          />
        ))}
    </>
  );
}
