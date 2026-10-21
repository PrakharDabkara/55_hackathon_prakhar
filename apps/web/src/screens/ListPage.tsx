import { useCallback, useEffect, useRef, useState } from 'react';
import { OfflineBanner, OrdersSkeleton, useOnline } from '../customer/ordersShared.js';
import { ScreenBar } from '../customer/ScreenBar.js';
import { useT } from '../i18n/index.js';
import { ApiError } from '../lib/api.js';
import type { ListView, OrderListResult } from '../lib/listApi.js';
import type { LiveOptions } from '../lib/live.js';
import type { SeekerOrder } from '../lib/orders.js';
import type { Place } from '../lib/place.js';
import { clearListDraft } from '../lib/lists.js';
import type { SeekerApi } from '../lib/seekerApi.js';
import { useLive } from '../lib/useLive.js';
import { Button } from '../ui/Button.js';
import { Skeleton } from '../ui/Skeleton.js';
import '../customer/lists.css';
import '../customer/replies.css';
import { ListCheck } from './ListCheck.js';
import { ListOrders } from './ListOrders.js';
import { ListPlan } from './ListPlan.js';
import { ListReplies } from './ListReplies.js';

interface Props {
  api: SeekerApi;
  listId: string;
  navigate: (path: string) => void;
  /** Back to Find. */
  onDone: () => void;
  /** The list as Find returned it, so the first paint needs no extra fetch. */
  initial?: ListView;
  /** Where the customer asked from. Missing after a reload or a notification: the list knows it once sent. */
  origin?: Place;
  /** Fallback poll. Events do the real work; this only covers a stream that is down. */
  pollMs?: number;
  live?: Pick<LiveOptions, 'createSource' | 'retryMs'> | undefined;
}

const CLOCK_MS = 30_000;

/**
 * /app/list/<id>: one shopping list through its life. A sorted draft is checked, a sent list shows
 * its replies and the plan, an ordered list shows its orders. It reads the list from the server, so
 * it works after a reload and from a notification (ADR-0055).
 */
export function ListPage({
  api,
  listId,
  navigate,
  onDone,
  initial,
  origin,
  pollMs = 15_000,
  live,
}: Props) {
  const { t } = useT();
  const c = t.c;
  const online = useOnline();
  const [list, setList] = useState<ListView | null>(initial ?? null);
  const [orders, setOrders] = useState<SeekerOrder[]>([]);
  const [problem, setProblem] = useState<'missing' | 'failed' | null>(null);
  const [step, setStep] = useState<'replies' | 'plan'>('replies');
  const [now, setNow] = useState(() => Date.now());
  const [from, setFrom] = useState<Place | null>(origin ?? null);
  const alive = useRef(true);
  const state = list?.state;

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

  const refresh = useCallback(() => {
    api.getList(listId).then(
      (next) => {
        if (!alive.current) return;
        setList(next);
        setProblem(null);
      },
      (error: unknown) => {
        // A failed refetch keeps what is on screen; only a first load has nothing to keep.
        if (alive.current)
          setProblem(error instanceof ApiError && error.status === 404 ? 'missing' : 'failed');
      },
    );
  }, [api, listId]);

  const loadOrders = useCallback(() => {
    api.listOrders({ listId }).then(
      (next) => alive.current && setOrders(next),
      () => undefined,
    );
  }, [api, listId]);

  useEffect(() => {
    if (!initial) refresh();
  }, [initial, refresh]);

  // An ordered list is its orders: fetch them whenever the list is (or becomes) ordered.
  useEffect(() => {
    if (state === 'ORDERED') loadOrders();
  }, [state, loadOrders]);

  const refreshAll = useCallback(() => {
    refresh();
    if (state === 'ORDERED') loadOrders();
  }, [refresh, loadOrders, state]);
  const getTicket = useCallback(() => api.eventTicket(), [api]);
  const isLive = useLive({ getTicket, refresh: refreshAll, pollMs, live });

  const place: Place | null =
    from ??
    (list && list.lat !== null && list.lng !== null ? { lat: list.lat, lng: list.lng } : null);

  function ordered(result?: OrderListResult) {
    if (result) setList(result.list);
    else refresh();
    setStep('replies');
  }

  if (!list)
    return (
      <>
        <ScreenBar title={c.listTitle} onBack={onDone} />
        <main className="cu-main">
          {!online && <OfflineBanner />}
          {problem === 'missing' ? (
            <div className="cu-empty">
              <p className="sh-heading">{c.listNotFound}</p>
            </div>
          ) : problem === 'failed' ? (
            <div className="cu-empty">
              <p className="sh-alert" role="alert">
                {c.loadFailed}
              </p>
              <p className="sh-body">{c.loadFailedHelp}</p>
              <Button variant="secondary" onClick={refresh}>
                {c.retry}
              </Button>
            </div>
          ) : (
            <div className="cu-stack" aria-busy="true">
              <Skeleton height="200px" radius="var(--r-md)" />
              <Skeleton height="24px" width="60%" />
              <Skeleton height="64px" radius="var(--r-md)" />
              <Skeleton height="64px" radius="var(--r-md)" />
            </div>
          )}
        </main>
      </>
    );

  if (list.state === 'DRAFT')
    return (
      <ListCheck
        api={api}
        list={list}
        origin={place}
        onSent={(sent, at) => {
          clearListDraft();
          setFrom(at);
          setList(sent);
        }}
        onEdit={onDone}
        onBack={onDone}
      />
    );

  if (list.state === 'ORDERED')
    return (
      <>
        <ScreenBar title={c.listOrdersTitle} onBack={onDone} />
        <main className="cu-main">
          {!online && <OfflineBanner />}
          {orders.length === 0 ? (
            <OrdersSkeleton rows={2} />
          ) : (
            <ListOrders api={api} orders={orders} navigate={navigate} onChange={refreshAll} />
          )}
        </main>
      </>
    );

  if (step === 'plan')
    return (
      <ListPlan
        key={list.id}
        api={api}
        list={list}
        origin={place}
        onBack={() => setStep('replies')}
        onOrdered={ordered}
      />
    );

  return (
    <>
      <ScreenBar
        title={c.listTitle}
        onBack={onDone}
        right={
          isLive ? (
            <span className="cu-live" role="img" aria-label={c.liveLabel} title={c.liveLabel} />
          ) : undefined
        }
      />
      {!online && (
        <p className="sh-banner sh-banner--warn" role="status">
          {c.offline}
        </p>
      )}
      <ListReplies
        api={api}
        list={list}
        now={now}
        onMakePlan={() => setStep('plan')}
        onStopped={(stopped) => {
          setList(stopped);
          refresh();
        }}
      />
    </>
  );
}
