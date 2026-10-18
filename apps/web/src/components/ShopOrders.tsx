import { useRef, useState } from 'react';
import { useT } from '../i18n/index.js';
import { ApiError, type ShopApi } from '../lib/api.js';
import { formatRupees } from '../lib/money.js';
import type { ShopOrder, ShopOrderVerb } from '../lib/orders.js';

interface Props {
  api: Pick<ShopApi, 'orderAction'>;
  orders: ShopOrder[];
  /** The orders changed on the server: fetch them again. */
  onChange: () => void;
}

/**
 * The shop's delivery orders (ADR-0031). A new one shows what to bring and Accept / Decline; only
 * after Accept does it show the address, a "Map par dekho" link and the contact line (a first
 * name or "Grahak", never a phone). Then "Nikal gaye" and "Pahuncha diya".
 */
export function ShopOrders({ api, orders, onChange }: Props) {
  const { t } = useT();
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  /** Taps already sent, by order, button and the state it was tapped in: a double tap sends one. */
  const [sent, setSent] = useState<ReadonlySet<string>>(new Set());
  const sending = useRef(false);

  if (orders.length === 0) return null;

  const key = (order: ShopOrder, verb: ShopOrderVerb) => `${order.id}:${verb}:${order.state}`;

  async function act(order: ShopOrder, verb: ShopOrderVerb) {
    const id = order.id;
    if (sending.current || sent.has(key(order, verb))) return;
    sending.current = true;
    setBusy(id);
    setFailed(false);
    setSent((all) => new Set(all).add(key(order, verb)));
    try {
      await api.orderAction(id, verb);
    } catch (e) {
      // 404 or 409: the customer cancelled, or it ran out of time. Showing it again says so.
      if (!(e instanceof ApiError && (e.status === 404 || e.status === 409))) {
        setFailed(true);
        setSent((all) => {
          const next = new Set(all);
          next.delete(key(order, verb));
          return next;
        });
      }
    } finally {
      sending.current = false;
      setBusy(null);
      onChange();
    }
  }

  const done = {
    DELIVERED: t.shopOrderDone,
    DECLINED: t.shopOrderDeclined,
    EXPIRED: t.shopOrderExpired,
    CANCELLED: t.shopOrderCancelled,
  } as const;

  return (
    <section className="stack" aria-label={t.shopOrderTitle}>
      {failed && (
        <p className="alert" role="alert">
          {t.errSend}
        </p>
      )}
      {orders.map((order) => (
        <article key={order.id} className="order-card" aria-label={t.shopOrderTitle}>
          <ul className="order-lines">
            {order.lines.map((line, i) => (
              <li key={`${line.name}-${i}`}>
                {line.count} × {line.name}
              </li>
            ))}
          </ul>
          {order.itemsTotalPaise !== null && (
            <p className="meta">
              {t.shopOrderItems}: {formatRupees(order.itemsTotalPaise)}
            </p>
          )}
          {order.feePaise !== null && order.feePaise > 0 && (
            <p className="meta">
              {t.shopOrderFee}: {formatRupees(order.feePaise)}
            </p>
          )}
          <p className="meta">{t.shopOrderCod}</p>
          {order.final ? (
            <p className={`order-state order-${order.state}`}>
              {done[order.state as keyof typeof done]}
            </p>
          ) : (
            <p className="meta">
              {t.shopOrderContact}: <strong>{order.contactName}</strong>
            </p>
          )}
          {order.addressText && <p className="order-address">{order.addressText}</p>}
          {order.mapUrl && (
            <a
              className="btn btn-quiet"
              href={order.mapUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              {t.shopOrderMap}
            </a>
          )}
          {order.state === 'REQUESTED' && (
            <div className="order-actions">
              <button
                type="button"
                className="btn btn-yes"
                disabled={busy !== null}
                onClick={() => void act(order, 'accept')}
              >
                {t.shopOrderAccept}
              </button>
              <button
                type="button"
                className="btn btn-no"
                disabled={busy !== null}
                onClick={() => void act(order, 'decline')}
              >
                {t.shopOrderDecline}
              </button>
            </div>
          )}
          {order.state === 'ACCEPTED' && (
            <button
              type="button"
              className="btn btn-yes"
              disabled={busy !== null}
              onClick={() => void act(order, 'out')}
            >
              {t.shopOrderOut}
            </button>
          )}
          {order.state === 'OUT_FOR_DELIVERY' && (
            <button
              type="button"
              className="btn btn-yes"
              disabled={busy !== null}
              onClick={() => void act(order, 'delivered')}
            >
              {t.shopOrderDelivered}
            </button>
          )}
        </article>
      ))}
    </section>
  );
}
