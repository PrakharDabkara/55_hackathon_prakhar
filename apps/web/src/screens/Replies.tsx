import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChooseShopSheet } from '../components/ChooseShopSheet.js';
import { ReplyCard, RememberedCard } from '../components/ReplyCard.js';
import { StopAskingSheet } from '../components/StopAskingSheet.js';
import { RequestParchi } from '../components/RequestParchi.js';
import { ResultsMap } from '../components/ResultsMap.js';
import { DEMO_PLACE, inDemoArea } from '../lib/demoPlace.js';
import { ScreenBar } from '../customer/ScreenBar.js';
import { useT } from '../i18n/index.js';
import { withRef } from '../lib/errorRef.js';
import type { LiveOptions } from '../lib/live.js';
import { isActiveOrder, orderForShop, type SeekerOrder } from '../lib/orders.js';
import { bestPriceShopId, learnedReplies, liveReplies, pinsFor } from '../lib/results.js';
import type { SeekerApi, SeekerRequest, ShopResult } from '../lib/seekerApi.js';
import { useLive } from '../lib/useLive.js';
import { Button } from '../ui/Button.js';
import { SegmentedControl } from '../ui/SegmentedControl.js';
import { Skeleton } from '../ui/Skeleton.js';
import '../customer/replies.css';

interface Props {
  api: SeekerApi;
  initial: SeekerRequest;
  /** Null when the search is opened again from a link: the server does not keep it for us. */
  origin: { lat: number; lng: number } | null;
  navigate: (path: string) => void;
  onDone: () => void;
  /** Fallback poll. Events do the real work; this only covers a stream that is down. */
  pollMs: number;
  live: Pick<LiveOptions, 'createSource' | 'retryMs'> | undefined;
}

const CLOCK_MS = 30_000;
/** How often to look again while the shops are still being chosen. */
const ASKING_POLL_MS = 2_000;
/** The widest area the server will search (POST /requests allows up to 5 km). */
const WIDE_RADIUS_M = 5000;
const km = (metres: number) => String(Math.round(metres / 100) / 10);

function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine !== false);
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);
  return online;
}

/** The customer's request as a parchi, who said yes at what price, who may still have it, and who does not. */
export function Replies({ api, initial, origin, navigate, onDone, pollMs, live }: Props) {
  const { t } = useT();
  const [request, setRequest] = useState(initial);
  const [view, setView] = useState<'list' | 'map'>('list');
  const [now, setNow] = useState(() => Date.now());
  const [asking, setAsking] = useState(false);
  const [closing, setClosing] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);
  const [orders, setOrders] = useState<SeekerOrder[]>([]);
  const [choosing, setChoosing] = useState<ShopResult | null>(null);
  const [askingNow, setAskingNow] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);
  const [widening, setWidening] = useState(false);
  const [wideFailed, setWideFailed] = useState<string | null>(null);
  const online = useOnline();
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), CLOCK_MS);
    return () => clearInterval(timer);
  }, []);

  /**
   * Going to a pickup shop is noted so the home screen can later ask "got it?" (ADR-0035).
   * Never for a shop the customer is having it delivered from, and never in the way of the route.
   */
  function notePickup(shopId: string) {
    if (!request.item || orderForShop(orders, shopId)) return;
    api
      .recordPickup({ shopId, itemId: request.item.id, requestId: request.id })
      .catch(() => undefined);
  }

  // Orders for this request. They are an extra: if they cannot be fetched the results still show.
  const loadOrders = useCallback(() => {
    api
      .listOrders({ requestId: initial.id })
      .then((next) => {
        if (alive.current) setOrders(next);
      })
      .catch(() => undefined);
  }, [api, initial.id]);
  useEffect(() => loadOrders(), [loadOrders]);

  // Each server event is only a hint: fetch the request again and draw what it says.
  const refresh = useCallback(() => {
    api
      .getRequest(initial.id)
      .then((next) => {
        if (alive.current) setRequest(next);
      })
      .catch(() => undefined);
    loadOrders();
  }, [api, initial.id, loadOrders]);
  // Until the server has chosen the shops, look again soon: its hint may have gone out before
  // this screen was listening, and "Asking shops nearby…" must not outlast the truth.
  const settling = request.asking === true;
  useEffect(() => {
    if (!settling) return;
    const timer = setInterval(refresh, ASKING_POLL_MS);
    return () => clearInterval(timer);
  }, [settling, refresh]);
  const getTicket = useCallback(() => api.eventTicket(), [api]);
  const isLive = useLive({ getTicket, refresh, pollMs, live });

  const liveRows = useMemo(() => liveReplies(request.results), [request.results]);
  const learnedRows = useMemo(() => learnedReplies(request.results), [request.results]);
  const best = useMemo(() => bestPriceShopId(liveRows), [liveRows]);
  const pins = useMemo(() => pinsFor(request.results), [request.results]);

  const { pending, no } = request.pingStats;
  const ended = request.state === 'CLOSED' || request.state === 'EXPIRED';
  /** The server has not yet chosen the shops: never "no shops" (nor "all replied") before it has. */
  const waiting = request.asking === true && !ended;
  const askedNobody = request.pingStats.sent === 0 && !waiting;
  /** Over with nobody left: every shop asked said no, or there was nobody to ask (round 3 C-17). */
  const expiredEmpty = request.state === 'EXPIRED' && liveRows.length === 0;
  const noMoreShops = askedNobody || expiredEmpty;
  const status = ended
    ? expiredEmpty && request.pingStats.sent > 0 && pending === 0
      ? no > 0
        ? t.c.allRepliedNo(no)
        : t.c.allReplied
      : t.c.requestEnded
    : waiting
      ? t.c.askingNearby
      : askedNobody
        ? t.c.statusNoShops
        : pending > 0
          ? t.c.stillChecking(pending)
          : no > 0
            ? t.c.allRepliedNo(no)
            : t.c.allReplied;

  /** Closing is what lets the account be deleted, so a failure is shown and can be tried again. */
  async function finish() {
    setClosing(true);
    setCloseError(null);
    try {
      await api.closeRequest(request.id);
    } catch (failure) {
      if (alive.current) {
        setCloseError(withRef(t.c.stopFailed, failure, t.c.refLine));
        setClosing(false);
      }
      return;
    }
    onDone();
  }

  /** Nobody was asked and nobody remembered has it: ask again over the widest area the server allows. */
  const canWiden =
    noMoreShops &&
    origin !== null &&
    request.radiusM < WIDE_RADIUS_M &&
    request.wantsDelivery !== true &&
    !!request.typed?.trim();

  /** The demo area is offered to anyone who is somewhere else (or whose place is not known). */
  const canDemo =
    noMoreShops &&
    request.wantsDelivery !== true &&
    !!request.typed?.trim() &&
    !(origin !== null && inDemoArea(origin));

  /** Asks the same words again from another place, or over a wider area, and opens that search. */
  async function searchAgain(place: { lat: number; lng: number }, radiusM?: number) {
    if (!request.typed) return;
    setWidening(true);
    setWideFailed(null);
    try {
      // The empty search is stopped first: it would otherwise hold one of the customer's three places.
      await api.closeRequest(request.id).catch(() => undefined);
      const next = await api.createRequest({
        q: request.typed,
        lat: place.lat,
        lng: place.lng,
        ...(radiusM !== undefined && { radiusM }),
      });
      navigate(`/app/request/${next.id}`);
    } catch (failure) {
      if (alive.current) {
        setWideFailed(withRef(t.c.noShopsWiderFailed, failure, t.c.refLine));
        setWidening(false);
      }
    }
  }

  /** Shops had it recently and nobody was asked: ask the live shops in range now. */
  async function askNow() {
    setAskingNow(true);
    setAskError(null);
    try {
      const next = await api.askShopsNow(request.id);
      if (alive.current) setRequest(next);
    } catch (failure) {
      if (alive.current) setAskError(withRef(t.c.askNowFailed, failure, t.c.refLine));
    } finally {
      if (alive.current) setAskingNow(false);
    }
  }

  const openOrder = (shopId: string) => {
    const order = orderForShop(orders, shopId);
    return order && (isActiveOrder(order) || order.state === 'DELIVERED') ? order : undefined;
  };

  return (
    <>
      <ScreenBar
        title={t.c.repliesTitle}
        onBack={onDone}
        right={
          isLive && !ended ? (
            <span className="cu-live" role="img" aria-label={t.c.liveLabel} title={t.c.liveLabel} />
          ) : undefined
        }
      />
      <main className="cu-main">
        {!online && (
          <p className="sh-banner sh-banner--warn" role="status">
            {t.c.offline}
          </p>
        )}
        {request.item?.unverified && liveRows.length === 0 && (
          <p className="sh-banner" role="status">
            {t.c.newItemNote}
          </p>
        )}

        <RequestParchi request={request} />
        <p className="sh-body cu-status" role="status">
          {status}
        </p>

        <section className="cu-section">
          <div className="cu-section__head">
            <h2 className="sh-heading">{t.c.repliesHeading}</h2>
            <SegmentedControl
              label={t.c.viewLabel}
              value={view}
              onChange={setView}
              options={[
                { value: 'list', label: t.c.viewList },
                { value: 'map', label: t.c.viewMap },
              ]}
            />
          </div>

          {view === 'map' ? (
            <ResultsMap
              origin={origin}
              pins={pins}
              label={t.c.mapLabel}
              youAreHere={t.c.youAreHere}
            />
          ) : liveRows.length > 0 ? (
            <ul className="cu-list" aria-label={t.c.repliesHeading}>
              {liveRows.map((r) => (
                <ReplyCard
                  key={r.shopId}
                  api={api}
                  result={r}
                  now={now}
                  best={r.shopId === best}
                  order={openOrder(r.shopId)}
                  onChoose={() => setChoosing(r)}
                  onTrack={(id) => navigate(`/app/order/${id}`)}
                />
              ))}
            </ul>
          ) : askedNobody && learnedRows.length > 0 ? (
            <div className="cu-empty">
              <p className="sh-heading">{t.c.knownTitle}</p>
              <p className="sh-body">{t.c.knownHelp}</p>
              {!ended && (
                <Button variant="solid" disabled={askingNow} onClick={() => void askNow()}>
                  {t.c.askNow}
                </Button>
              )}
              {askError && (
                <p className="sh-alert" role="alert">
                  {askError}
                </p>
              )}
            </div>
          ) : noMoreShops ? (
            <div className="cu-empty">
              <p className="sh-heading">
                {askedNobody ? t.c.noShopsTitle(km(request.radiusM)) : t.c.noneFoundTitle}
              </p>
              <p className="sh-body">{askedNobody ? t.c.noShopsHelp : t.c.noneFoundHelp}</p>
              <div className="cu-stack">
                <Button variant="secondary" onClick={onDone}>
                  {t.c.noShopsWords}
                </Button>
                {canDemo && (
                  <Button
                    variant="secondary"
                    disabled={widening}
                    onClick={() => void searchAgain(DEMO_PLACE)}
                  >
                    {t.c.noShopsDemo}
                  </Button>
                )}
                {canWiden && (
                  <Button
                    variant="solid"
                    disabled={widening}
                    onClick={() => origin && void searchAgain(origin, WIDE_RADIUS_M)}
                  >
                    {t.c.noShopsWider(km(WIDE_RADIUS_M))}
                  </Button>
                )}
              </div>
              {wideFailed && (
                <p className="sh-alert" role="alert">
                  {wideFailed}
                </p>
              )}
            </div>
          ) : (
            <div className="cu-empty">
              <p className="sh-heading">{ended ? t.c.noneFoundTitle : t.c.noneYetTitle}</p>
              <p className="sh-body">{ended ? t.c.noneFoundHelp : t.c.noneYetHelp}</p>
              {!ended && (
                <div className="cu-stack" aria-hidden="true">
                  <Skeleton height="72px" radius="var(--r-md)" />
                  <Skeleton height="72px" radius="var(--r-md)" />
                </div>
              )}
            </div>
          )}
        </section>

        {learnedRows.length > 0 && (
          <section className="cu-section">
            <h2 className="sh-label cu-caps">{t.c.recentHeading}</h2>
            <ul className="cu-list">
              {learnedRows.map((r) => (
                <RememberedCard
                  key={r.shopId}
                  result={r}
                  now={now}
                  onWay={() => notePickup(r.shopId)}
                />
              ))}
            </ul>
          </section>
        )}

        {!ended && (
          <Button variant="quiet" onClick={() => setAsking(true)}>
            {t.c.stopAsking}
          </Button>
        )}
      </main>

      <StopAskingSheet
        open={asking}
        body={t.c.stopBodyRequest}
        busy={closing}
        error={closeError}
        onConfirm={() => void finish()}
        onClose={() => {
          setAsking(false);
          setCloseError(null);
        }}
      />

      {choosing && (
        <ChooseShopSheet
          api={api}
          request={request}
          shop={choosing}
          navigate={navigate}
          onClose={() => setChoosing(null)}
          onPickup={notePickup}
          onOrdered={loadOrders}
        />
      )}
    </>
  );
}
