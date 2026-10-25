import { useEffect, useMemo, useRef, useState } from 'react';
import { useT } from '../../i18n/index.js';
import {
  ApiError,
  type AnswerBody,
  type ListAnswerBody,
  type ShopApi,
  type ShopListParchi,
  type ShopPing,
} from '../../lib/api.js';
import type { PushClient } from '../../lib/push.js';
import { buildDeck } from '../lib/deck.js';
import { displayItemName } from '../lib/format.js';
import { useDemand, usePush } from '../lib/hooks.js';
import type { ShopData } from '../lib/useShopData.js';
import { Button } from '../../ui/Button.js';
import { ClosedSign } from '../ui/ClosedSign.js';
import { Deck } from '../ui/Deck.js';
import { Icon } from '../../ui/Icon.js';
import { ListSlip } from '../ui/ListSlip.js';
import { OrderSlip } from '../ui/OrderSlip.js';
import { PingSlip } from '../ui/PingSlip.js';
import { Skeleton } from '../../ui/Skeleton.js';
import { useToast } from '../../ui/Toast.js';
import { AnswerSheet } from './AnswerSheet.js';
import { UndoBar } from '../ui/UndoBar.js';
import { WantsDeliverySheet } from './WantsDeliverySheet.js';

interface Props {
  api: ShopApi;
  data: ShopData;
  now: number;
  /** For tests: a stand-in for the browser's push side. */
  pushClient?: PushClient;
  /** A list parchi to open the deck at (a tap on its push notification). */
  openAt?: string;
}

/** The stamp lands, then 300 ms later the deck moves on (UI spec C). */
const STAMP_MS = 300;
/** A Not available answer waits this long, with an Undo bar, before it is sent (S-07). */
const UNDO_MS = 5000;
/** An answered list shows its stamp for about a second (the stamp itself does not move under reduced motion). */
const LIST_STAMP_MS = 1000;
/** A list that closed stays in front of the shop this long, saying so, then leaves. */
const CLOSED_MS = 4000;

/** Home: the request deck, the new-order banner, and two numbers to glance at. */
export function Home({ api, data, now, pushClient, openAt }: Props) {
  const { t } = useT();
  const s = t.shop;
  const toast = useToast();
  const { shop, pings, orders, lists, closedLists } = data;
  const [index, setIndex] = useState(0);
  const [sheetFor, setSheetFor] = useState<ShopPing | null>(null);
  const [stamped, setStamped] = useState<Record<string, 'yes' | 'no'>>({});
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set());
  /** Lists this shop found closed when it tried to answer. */
  const [closedKeys, setClosedKeys] = useState<ReadonlySet<string>>(new Set());
  const [busyOrder, setBusyOrder] = useState<string | null>(null);
  /** Taps already sent, by order, action and state: a double tap sends once. */
  const sentOrder = useRef(new Set<string>());
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  /** A Not available answer in its 5 seconds: sent when they pass, never if undone. */
  const [holding, setHolding] = useState<{ ping: ShopPing; body: AnswerBody } | null>(null);
  const hold = useRef<{
    ping: ShopPing;
    body: AnswerBody;
    timer: ReturnType<typeof setTimeout>;
  } | null>(null);
  const scheduledClosed = useRef(new Set<string>());
  const opened = useRef(false);
  const today = useDemand(api, 1);
  const push = usePush(api, pushClient);

  useEffect(
    () => () => {
      timers.current.forEach(clearTimeout);
      // Leaving the screen makes the waiting answer final: it was given, and the customer waits for it.
      const waiting = hold.current;
      if (waiting) {
        clearTimeout(waiting.timer);
        hold.current = null;
        void api.answerPing(waiting.ping.id, waiting.body).catch(() => undefined);
      }
    },
    [api],
  );

  const slips = useMemo(
    () =>
      buildDeck(pings ?? [], orders ?? [], lists ?? [], closedLists).filter(
        (slip) => !gone.has(slip.key),
      ),
    [pings, orders, lists, closedLists, gone],
  );
  const current = Math.min(index, Math.max(0, slips.length - 1));
  const activeOrders = (orders ?? []).filter((order) => !order.final).length;

  function leaveDeck(key: string, after: () => void, ms = STAMP_MS) {
    timers.current.push(
      setTimeout(() => {
        setGone((all) => new Set(all).add(key));
        after();
      }, ms),
    );
  }

  // A list the customer closed: say so for a few seconds, then let it go.
  useEffect(() => {
    for (const parchi of closedLists) {
      const key = `list:${parchi.id}`;
      if (scheduledClosed.current.has(key)) continue;
      scheduledClosed.current.add(key);
      leaveDeck(key, () => data.dismissClosedList(parchi.id), CLOSED_MS);
    }
  }, [closedLists]);

  // A push for a list opens the deck at that card, once, and the address is cleaned up.
  useEffect(() => {
    if (!openAt || opened.current) return;
    const at = slips.findIndex((slip) => slip.key === `list:${openAt}`);
    if (at < 0) return;
    opened.current = true;
    setIndex(at);
    if (location.search.includes('parchi='))
      history.replaceState(null, '', `${location.pathname}${location.hash}`);
  }, [openAt, slips]);

  /** Not available: close the sheet, show Undo, and send only when the 5 seconds have passed. */
  async function submitAnswer(ping: ShopPing, body: AnswerBody) {
    // A new answer for the same question replaces the waiting one; for another question it sends it.
    if (hold.current?.ping.id === ping.id) undoHold();
    if (body.answer !== 'no') return sendAnswer(ping, body);
    await releaseHold();
    setSheetFor(null);
    const timer = setTimeout(() => void releaseHold(), UNDO_MS);
    hold.current = { ping, body, timer };
    setHolding({ ping, body });
  }

  /** Sends the waiting Not available now (a second answer, or the time passing). */
  async function releaseHold(): Promise<void> {
    const waiting = hold.current;
    if (!waiting) return;
    clearTimeout(waiting.timer);
    hold.current = null;
    setHolding(null);
    try {
      await sendAnswer(waiting.ping, waiting.body);
    } catch {
      toast(s.sendFailed);
    }
  }

  function undoHold() {
    const waiting = hold.current;
    if (!waiting) return;
    clearTimeout(waiting.timer);
    hold.current = null;
    setHolding(null);
  }

  async function sendAnswer(ping: ShopPing, body: AnswerBody) {
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

  async function submitList(parchi: ShopListParchi, body: ListAnswerBody) {
    const key = `list:${parchi.id}`;
    try {
      await api.answerList(parchi.id, body);
    } catch (error) {
      // The customer closed it, or it filled up, while the shop was ticking: say so and let it go.
      if (error instanceof ApiError && (error.status === 404 || error.code === 'ping_closed')) {
        setClosedKeys((all) => new Set(all).add(key));
        leaveDeck(
          key,
          () => {
            data.removeList(parchi.id);
            void data.refresh();
          },
          CLOSED_MS,
        );
        return;
      }
      throw error;
    }
    data.markAnswered(parchi.id);
    setStamped((all) => ({ ...all, [key]: 'yes' }));
    leaveDeck(
      key,
      () => {
        data.removeList(parchi.id);
        void data.refresh();
        void today.reload();
      },
      LIST_STAMP_MS,
    );
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
        <ClosedSign word={s.closedSign} />
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
      <div className={`sh-home${data.banner ? ' sh-home--banner' : ''}`}>
        {data.banner && (
          <div className="sh-banner" role="status">
            <span>{s.orderBanner(displayItemName(data.banner.lines[0]?.name ?? ''))}</span>
            <a className="sh-banner__link" href="#/orders" onClick={data.dismissBanner}>
              {s.viewOrder}
            </a>
          </div>
        )}
        <div className="sh-home__main">
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
                    slip.kind === 'list' ? (
                      <ListSlip
                        parchi={slip.parchi}
                        shop={shop}
                        now={now}
                        stamp={
                          slip.closed || closedKeys.has(slip.key)
                            ? 'closed'
                            : stamped[slip.key]
                              ? 'answered'
                              : null
                        }
                        onSubmit={(body) => submitList(slip.parchi, body)}
                      />
                    ) : slip.kind === 'ping' ? (
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
                        onPack={(index, packed) =>
                          void data
                            .setPacked(slip.order.id, index, packed)
                            .catch(() => toast(s.packFailed))
                        }
                        onAccept={() => void actOnOrder(slip.order.id, 'accept')}
                        onDecline={() => void actOnOrder(slip.order.id, 'decline')}
                      />
                    ),
                }))}
              />
            </>
          )}
        </div>

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

      {holding && <UndoBar onUndo={undoHold} />}
    </>
  );
}
