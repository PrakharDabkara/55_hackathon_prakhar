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
import type { SeekerApi } from '../lib/seekerApi.js';
import { useLive } from '../lib/useLive.js';
import { Button } from '../ui/Button.js';
import { Icon } from '../ui/Icon.js';
import { ShopLogo } from '../ui/ShopLogo.js';

interface Props {
  api: Pick<
    SeekerApi,
    | 'myOrders'
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

/**
 * "My orders": the question about a pickup first, then the orders still moving, the earlier ones,
 * the address the customer chose to keep (which they can delete) and the notifications switch.
 */
export function MyOrders({ api, navigate, onBack, pollMs = 15_000, live, pushClient }: Props) {
  const { t, lang } = useT();
  const c = t.c;
  const online = useOnline();
  const [orders, setOrders] = useState<SeekerOrder[] | null>(null);
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

  const active = orders?.filter(isActiveOrder) ?? [];
  const earlier = orders?.filter((o) => !isActiveOrder(o)) ?? [];

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
        {orders?.length === 0 && (
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
            <ul className="cu-list">{active.map((o) => row(o, true))}</ul>
          </section>
        )}
        {earlier.length > 0 && (
          <section className="cu-section" aria-labelledby="orders-earlier">
            <h2 id="orders-earlier" className="sh-caption">
              {c.earlierTitle}
            </h2>
            <ul className="cu-list">{earlier.map((o) => row(o, false))}</ul>
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
