import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChooseShopSheet } from '../components/ChooseShopSheet.js';
import { ReplyCard, RememberedCard } from '../components/ReplyCard.js';
import { StopAskingSheet } from '../components/StopAskingSheet.js';
import { RequestParchi } from '../components/RequestParchi.js';
import { ResultsMap } from '../components/ResultsMap.js';
import { DEMO_PLACE, inDemoArea } from '../lib/demoPlace.js';
import { ScreenBar } from '../customer/ScreenBar.js';
import { useT } from '../i18n/index.js';
import type { LiveOptions } from '../lib/live.js';
import { isActiveOrder, orderForShop, type SeekerOrder } from '../lib/orders.js';
import { bestPriceShopId, learnedReplies, liveReplies, pinsFor } from '../lib/results.js';
import type { SeekerApi, SeekerRequest, ShopResult } from '../lib/seekerApi.js';
import { useLive } from '../lib/useLive.js';
import { Button } from '../ui/Button.js';
import { Icon } from '../ui/Icon.js';
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
  const [showNo, setShowNo] = useState(false);
  const [widening, setWidening] = useState(false);
  const [wideFailed, setWideFailed] = useState(false);
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
  const getTicket = useCallback(() => api.eventTicket(), [api]);
  const isLive = useLive({ getTicket, refresh, pollMs, live });

  const liveRows = useMemo(() => liveReplies(request.results), [request.results]);
  const learnedRows = useMemo(() => learnedReplies(request.results), [request.results]);
  const best = useMemo(() => bestPriceShopId(liveRows), [liveRows]);
  const pins = useMemo(() => pinsFor(request.results), [request.results]);

  const { pending, no } = request.pingStats;
  const ended = request.state === 'CLOSED' || request.state === 'EXPIRED';
  const status =
    !ended && pending > 0 ? t.c.stillChecking(pending) : ended ? t.c.requestEnded : t.c.allReplied;

  /** Closing is what lets the account be deleted, so a failure is shown and can be tried again. */
  async function finish() {
    setClosing(true);
    setCloseError(null);
    try {
      await api.closeRequest(request.id);
    } catch {
      if (alive.current) {
        setCloseError(t.c.stopFailed);
        setClosing(false);
      }
      return;
    }
    onDone();
  }

  /** Nobody was asked and nobody remembered has it: ask again over the widest area the server allows. */
  const askedNobody = request.pingStats.sent === 0;
  const canWiden =
    askedNobody &&
    origin !== null &&
    request.radiusM < WIDE_RADIUS_M &&
    request.wantsDelivery !== true &&
    !!request.typed?.trim();

  /** The demo area is offered to anyone who is somewhere else (or whose place is not known). */
  const canDemo =
    askedNobody &&
    request.wantsDelivery !== true &&
    !!request.typed?.trim() &&
    !(origin !== null && inDemoArea(origin));

  /** Asks the same words again from another place, or over a wider area, and opens that search. */
  async function searchAgain(place: { lat: number; lng: number }, radiusM?: number) {
    if (!request.typed) return;
    setWidening(true);
    setWideFailed(false);
    try {
      const next = await api.createRequest({
        q: request.typed,
        lat: place.lat,
        lng: place.lng,
        ...(radiusM !== undefined && { radiusM }),
      });
      navigate(`/app/request/${next.id}`);
    } catch {
      if (alive.current) {
        setWideFailed(true);
        setWidening(false);
      }
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
          isLive ? (
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
            </div>
          ) : askedNobody ? (
            <div className="cu-empty">
              <p className="sh-heading">{t.c.noShopsTitle(km(request.radiusM))}</p>
              <p className="sh-body">{t.c.noShopsHelp}</p>
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
                  {t.c.noShopsWiderFailed}
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

        {no > 0 && (
          <section className="cu-section">
            <button
              type="button"
              className="cu-disclosure"
              aria-expanded={showNo}
              onClick={() => setShowNo((open) => !open)}
            >
              <span>{t.c.noCount(no)}</span>
              <Icon name="chevron" size={20} />
            </button>
            {showNo && <p className="sh-body sh-muted">{t.c.noBody}</p>}
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
