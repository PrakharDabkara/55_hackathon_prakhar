import { useCallback, useEffect, useRef, useState } from 'react';
import { useT } from '../i18n/index.js';
import { ApiError } from '../lib/api.js';
import type { LiveOptions } from '../lib/live.js';
import { formatRupees } from '../lib/money.js';
import { lineName, orderSourcePath, orderTotalPaise, type SeekerOrder } from '../lib/orders.js';
import { orderStatusText } from '../lib/orderText.js';
import type { SeekerApi } from '../lib/seekerApi.js';
import { useLive } from '../lib/useLive.js';
import { appLink } from './Home.js';

interface Props {
  api: Pick<SeekerApi, 'getOrder' | 'cancelOrder' | 'receiveOrder' | 'eventTicket'>;
  orderId: string;
  onBack: () => void;
  /** Goes to the search or plan the order came from. Without it the link is a plain link. */
  navigate?: (path: string) => void;
  pollMs?: number;
  live?: Pick<LiveOptions, 'createSource' | 'retryMs'>;
}

/**
 * One order at /app/order/<id>: what was ordered, the total with the fee, and where it stands, live
 * (ADR-0033). It reads the order from the server, so it works after a reload and when opened
 * directly. Declined, expired and cancelled orders say what to do next.
 */
export function OrderPage({ api, orderId, onBack, navigate, pollMs = 15_000, live }: Props) {
  const { t, lang } = useT();
  const [order, setOrder] = useState<SeekerOrder | null>(null);
  const [problem, setProblem] = useState<'missing' | 'failed' | null>(null);
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  const sending = useRef(false);

  const refresh = useCallback(() => {
    api.getOrder(orderId).then(
      (next) => {
        if (!alive.current) return;
        setOrder(next);
        setProblem(null);
      },
      (error: unknown) => {
        // A failed refetch keeps what is on screen; only a first load has nothing to keep.
        if (alive.current && error instanceof ApiError && error.status === 404)
          setProblem('missing');
        else if (alive.current) setProblem('failed');
      },
    );
  }, [api, orderId]);

  useEffect(() => {
    alive.current = true;
    refresh();
    return () => {
      alive.current = false;
    };
  }, [refresh]);

  const getTicket = useCallback(() => api.eventTicket(), [api]);
  useLive({ getTicket, refresh, pollMs, live });

  async function cancel() {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    try {
      await api.cancelOrder(orderId);
    } catch {
      // It may have moved meanwhile; the refresh below shows where it is.
    } finally {
      sending.current = false;
      if (alive.current) setBusy(false);
      refresh();
    }
  }

  async function receive() {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    try {
      await api.receiveOrder(orderId);
    } catch {
      // It may have run out of time meanwhile; the refresh below shows where it is.
    } finally {
      sending.current = false;
      if (alive.current) setBusy(false);
      refresh();
    }
  }

  const back = (
    <button type="button" className="btn btn-quiet" onClick={onBack}>
      {t.homeBack}
    </button>
  );

  if (!order) {
    return (
      <section className="stack">
        {back}
        {problem === null ? (
          <p className="empty">{t.loading}</p>
        ) : (
          <p className="alert" role="alert">
            {problem === 'missing' ? t.orderNotFound : t.myOrdersError}
          </p>
        )}
      </section>
    );
  }

  const total = orderTotalPaise(order);
  const open = order.state === 'REQUESTED' || order.state === 'ACCEPTED';
  const noMoneyDue =
    order.state === 'DECLINED' || order.state === 'EXPIRED' || order.state === 'CANCELLED';
  const source = orderSourcePath(order);
  const sourceProps = source ? (navigate ? appLink(navigate, source) : { href: source }) : null;

  return (
    <section className="stack" aria-label={order.shopName}>
      {back}
      <h1 className="screen-title">{order.shopName}</h1>
      <p className={`order-state order-${order.state}`} role="status">
        {order.state === 'CANCELLED' && order.cancelledBy === 'shop'
          ? t.orderCancelledByShop
          : orderStatusText(t, order.state)}
      </p>
      <ul className="order-lines">
        {order.lines.map((line, i) => (
          <li key={`${line.name}-${i}`}>
            {line.count} × {lineName(line, lang)}
          </li>
        ))}
      </ul>
      <p className="meta">
        {total === null ? t.orderTotalUnknown : t.orderTotal(formatRupees(total))}
      </p>
      {order.addressText ? (
        <p className="meta">{t.orderYourAddress(order.addressText)}</p>
      ) : (
        <p className="meta">{t.orderAddressGone}</p>
      )}
      {order.note && <p className="meta">{order.note}</p>}
      {!noMoneyDue && <p className="meta">{t.orderCod}</p>}
      {order.state === 'OUT_FOR_DELIVERY' && (
        <button
          type="button"
          className="btn btn-yes"
          disabled={busy}
          onClick={() => void receive()}
        >
          {t.orderReceived}
        </button>
      )}
      {open && (
        <button
          type="button"
          className="btn btn-quiet"
          disabled={busy}
          onClick={() => void cancel()}
        >
          {t.orderCancel}
        </button>
      )}
      {sourceProps && (
        <a className="btn btn-quiet" {...sourceProps}>
          {t.orderSeeSource}
        </a>
      )}
    </section>
  );
}
