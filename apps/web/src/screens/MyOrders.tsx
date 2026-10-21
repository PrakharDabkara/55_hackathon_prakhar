import { useCallback, useEffect, useRef, useState } from 'react';
import { PickupAsk } from '../components/PickupAsk.js';
import { NotifyToggle } from '../components/NotifyToggle.js';
import {
  OfflineBanner,
  OrdersSkeleton,
  appLink,
  arrivalTime,
  useOnline,
} from '../customer/ordersShared.js';
import { ScreenBar } from '../customer/ScreenBar.js';
import { useT } from '../i18n/index.js';
import type { LiveOptions } from '../lib/live.js';
import { formatRupees } from '../lib/money.js';
import {
  activeFirst,
  isActiveOrder,
  lineName,
  orderTotalPaise,
  type SeekerOrder,
} from '../lib/orders.js';
import { earlierStatus, orderCaption } from '../lib/orderText.js';
import type { PushClient } from '../lib/push.js';
import type { ErrandListItem, SeekerApi } from '../lib/seekerApi.js';
import { useLive } from '../lib/useLive.js';
import { Button } from '../ui/Button.js';
import { Icon } from '../ui/Icon.js';
import { ShopLogo } from '../ui/ShopLogo.js';

interface Props {
  api: Pick<
    SeekerApi,
    | 'myOrders'
    | 'myErrands'
    | 'savedAddress'
    | 'forgetAddress'
    | 'eventTicket'
    | 'pendingPickups'
    | 'answerPickup'
    | 'pushConfig'
    | 'pushSubscribe'
    | 'pushUnsubscribe'
  >;
  /** Opens an /app/... path. */
  navigate: (path: string) => void;
  onBack: () => void;
  pollMs?: number;
  live?: Pick<LiveOptions, 'createSource' | 'retryMs'>;
  /** For tests: a stand-in for the browser's push side. */
  pushClient?: PushClient;
}

interface ListGroup {
  kind: 'list';
  listId: string;
  orders: SeekerOrder[];
}
type Entry = ListGroup | { kind: 'order'; order: SeekerOrder };

/**
 * Orders that came from the same list become one entry (at the place of the first of them), the
 * rest stay as they are. Every order of the list is in the entry, whichever section it would be in.
 */
function groupLists(shown: readonly SeekerOrder[], all: readonly SeekerOrder[]): Entry[] {
  const seen = new Set<string>();
  return shown.flatMap((order): Entry[] => {
    if (!order.listId) return [{ kind: 'order', order }];
    if (seen.has(order.listId)) return [];
    seen.add(order.listId);
    return [
      { kind: 'list', listId: order.listId, orders: all.filter((o) => o.listId === order.listId) },
    ];
  });
}

const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

/**
 * "My orders": the question about a pickup first, then the orders still moving, the earlier ones,
 * the address the customer chose to keep (which they can delete) and the notifications switch.
 */
export function MyOrders({ api, navigate, onBack, pollMs = 15_000, live, pushClient }: Props) {
  const { t, lang } = useT();
  const c = t.c;
  const online = useOnline();
  const [orders, setOrders] = useState<SeekerOrder[] | null>(null);
  const [errands, setErrands] = useState<ErrandListItem[]>([]);
  const [failed, setFailed] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [deleted, setDeleted] = useState(false);
  const alive = useRef(true);

  const refresh = useCallback(() => {
    api.myOrders().then(
      (next) => {
        if (!alive.current) return;
        setOrders(activeFirst(next));
        setFailed(false);
      },
      () => alive.current && setFailed(true),
    );
    // Errands are a bonus list: if it cannot load, the orders still show.
    api.myErrands().then(
      (next) => alive.current && setErrands(next),
      () => undefined,
    );
  }, [api]);

  useEffect(() => {
    alive.current = true;
    refresh();
    api.savedAddress().then(
      (found) => alive.current && setSaved(found.addressText),
      () => undefined,
    );
    return () => {
      alive.current = false;
    };
  }, [api, refresh]);

  const getTicket = useCallback(() => api.eventTicket(), [api]);
  useLive({ getTicket, refresh, pollMs, live });

  async function forget() {
    try {
      await api.forgetAddress();
      const found = await api.savedAddress();
      if (!alive.current) return;
      setSaved(found.addressText);
      setDeleted(found.addressText === null);
    } catch {
      // Still kept; the button stays so the customer can try again.
    }
  }

  /** The orders of one list are one row: "List · 5 items", the shops, and where they stand. */
  function listRow(group: ListGroup) {
    const items = group.orders.reduce((sum, o) => sum + o.lines.length, 0);
    const lead =
      group.orders.find((o) => o.state === 'READY') ??
      group.orders.find((o) => o.state === 'OUT_FOR_DELIVERY') ??
      group.orders.find(isActiveOrder) ??
      group.orders[0];
    return (
      <li key={`list-${group.listId}`}>
        <a className="cu-order-row" {...appLink(navigate, `/app/list/${group.listId}`)}>
          <span className="cu-order-row__body">
            <span className="cu-order-row__shop">{c.myListRow(items)}</span>
            <span className="cu-order-row__meta">
              <span>{c.myListShops(group.orders.length)}</span>
            </span>
            <span className="cu-order-row__meta">
              {lead && <span className="cu-pill">{orderCaption(c, lead.state)}</span>}
            </span>
          </span>
          <Icon name="right" size={20} />
        </a>
      </li>
    );
  }

  function row(order: SeekerOrder, active: boolean) {
    const total = orderTotalPaise(order);
    const [first, ...rest] = order.lines;
    const arrival = active ? arrivalTime(order) : null;
    return (
      <li key={order.id}>
        <a className="cu-order-row" {...appLink(navigate, `/app/order/${order.id}`)}>
          <ShopLogo name={order.shopName} logoUrl={order.logoUrl ?? null} size={40} />
          <span className="cu-order-row__body">
            <span className="cu-order-row__shop">{order.shopName}</span>
            <span className="cu-order-row__meta">
              {first && (
                <span>
                  {first.count} × {lineName(first, lang)}
                  {rest.length > 0 && ` ${c.moreItems(rest.length)}`}
                </span>
              )}
              <span>{total === null ? c.priceUnknown : formatRupees(total)}</span>
            </span>
            <span className="cu-order-row__meta">
              {active ? (
                <span className="cu-pill">{orderCaption(c, order.state)}</span>
              ) : (
                <span>{earlierStatus(c, order)}</span>
              )}
              {arrival && <span>{c.byTime(arrival)}</span>}
            </span>
          </span>
          <Icon name="right" size={20} />
        </a>
      </li>
    );
  }

  const active = groupLists(orders?.filter(isActiveOrder) ?? [], orders ?? []);
  const earlier = groupLists(orders?.filter((o) => !isActiveOrder(o)) ?? [], orders ?? []);

  return (
    <>
      <ScreenBar title={c.myOrdersTitle} onBack={onBack} />
      <main className="cu-main">
        {!online && <OfflineBanner />}
        <PickupAsk api={api} />

        {orders === null && !failed && <OrdersSkeleton rows={3} />}
        {orders === null && failed && (
          <div className="cu-empty" role="alert">
            <p className="sh-heading">{c.loadFailed}</p>
            <p>{c.loadFailedHelp}</p>
            <Button variant="secondary" onClick={refresh}>
              {c.retry}
            </Button>
          </div>
        )}
        {orders?.length === 0 && errands.length === 0 && (
          <div className="cu-empty">
            <p className="sh-heading">{c.emptyTitle}</p>
            <p>{c.emptyHelp}</p>
            <a className="sh-btn sh-btn--primary" {...appLink(navigate, '/app/')}>
              {c.emptyCta}
            </a>
          </div>
        )}
        {active.length > 0 && (
          <section className="cu-section" aria-labelledby="orders-active">
            <h2 id="orders-active" className="sh-caption">
              {c.activeTitle}
            </h2>
            <ul className="cu-list">
              {active.map((e) => (e.kind === 'list' ? listRow(e) : row(e.order, true)))}
            </ul>
          </section>
        )}
        {earlier.length > 0 && (
          <section className="cu-section" aria-labelledby="orders-earlier">
            <h2 id="orders-earlier" className="sh-caption">
              {c.earlierTitle}
            </h2>
            <ul className="cu-list">
              {earlier.map((e) => (e.kind === 'list' ? listRow(e) : row(e.order, false)))}
            </ul>
          </section>
        )}

        {errands.length > 0 && (
          <section className="cu-section" aria-labelledby="orders-errands">
            <h2 id="orders-errands" className="sh-caption">
              {c.errandsTitle}
            </h2>
            <ul className="cu-list">
              {errands.map((errand) => (
                <li key={errand.id}>
                  <a className="cu-order-row" {...appLink(navigate, `/app/errand/${errand.id}`)}>
                    <span className="cu-order-row__body">
                      <span className="cu-order-row__shop cu-order-row__task">{errand.task}</span>
                      <span className="cu-order-row__meta">
                        <span className="cu-pill">{c.errandState(errand.state)}</span>
                        <span>{shortDate(errand.createdAt)}</span>
                      </span>
                    </span>
                    <Icon name="right" size={20} />
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}

        {saved ? (
          <div className="cu-saved">
            <div className="cu-saved__text">
              <p className="sh-label">
                {c.savedTitle} · {c.savedHelp}
              </p>
              <p>{saved}</p>
            </div>
            <Button variant="quiet" onClick={() => void forget()}>
              {c.savedDelete}
            </Button>
          </div>
        ) : (
          deleted && (
            <p className="sh-helper" role="status">
              {c.savedDeleted}
            </p>
          )
        )}

        <NotifyToggle api={api} {...(pushClient && { client: pushClient })} />
      </main>
    </>
  );
}
