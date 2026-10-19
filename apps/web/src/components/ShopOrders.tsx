import { useRef, useState } from 'react';
import { useT } from '../i18n/index.js';
import { ApiError, type ShopApi } from '../lib/api.js';
import { formatRupees } from '../lib/money.js';
import type { ShopCancelReason, ShopOrder, ShopOrderVerb } from '../lib/orders.js';

interface Props {
  api: Pick<ShopApi, 'orderAction' | 'cancelOrder'>;
  orders: ShopOrder[];
  /** The orders changed on the server: fetch them again. */
  onChange: () => void;
}

/**
 * The shop's delivery orders (ADR-0031). A new one shows what to bring and Accept / Decline; only
 * after Accept does it show the address, a "Map par dekho" link and the contact line (a first
 * name or "Grahak", never a phone). Then "Nikal gaye". The shop never marks an order delivered:
 * the customer's Received does (ADR-0039). An ACCEPTED order can be cancelled with a reason.
 */
export function ShopOrders({ api, orders, onChange }: Props) {
  const { t } = useT();
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  /** Taps already sent, by order, button and the state it was tapped in: a double tap sends one. */
  const [sent, setSent] = useState<ReadonlySet<string>>(new Set());
  const sending = useRef(false);
  /** The order whose cancel form is open, the reason picked and the words typed. */
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [reason, setReason] = useState<ShopCancelReason | null>(null);
  const [reasonText, setReasonText] = useState('');

  if (orders.length === 0) return null;

  async function cancel(order: ShopOrder) {
    if (sending.current || reason === null) return;
    sending.current = true;
    setBusy(order.id);
    setFailed(false);
    try {
      const text = reasonText.trim();
      await api.cancelOrder(order.id, { reason, ...(text !== '' && { text }) });
      setCancelling(null);
    } catch (e) {
      if (!(e instanceof ApiError && (e.status === 404 || e.status === 409))) setFailed(true);
      else setCancelling(null);
    } finally {
      sending.current = false;
      setBusy(null);
      onChange();
    }
  }

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
    NOT_CONFIRMED: t.shopOrderNotConfirmed,
  } as const;

  // Orders to act on come first; finished ones follow under their own heading.
  const active = orders.filter((o) => !o.final);
  const past = orders.filter((o) => o.final);

  const card = (order: ShopOrder) => (
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
      {order.note && <p className="meta">{t.shopOrderNote(order.note)}</p>}
      {order.addressText && <p className="order-address">{order.addressText}</p>}
      {order.mapUrl && (
        <a className="btn btn-quiet" href={order.mapUrl} target="_blank" rel="noopener noreferrer">
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
        <>
          <button
            type="button"
            className="btn btn-yes"
            disabled={busy !== null}
            onClick={() => void act(order, 'out')}
          >
            {t.shopOrderOut}
          </button>
          {cancelling === order.id ? (
            <div className="stack-tight">
              <div className="chips" role="group" aria-label={t.shopCancel}>
                {(
                  [
                    ['out_of_stock', t.shopCancelOutOfStock],
                    ['cannot_deliver_now', t.shopCancelCannotDeliver],
                    ['other', t.shopCancelOther],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    className="chip"
                    aria-pressed={reason === value}
                    onClick={() => setReason(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {reason === 'other' && (
                <label className="field">
                  <span>{t.shopCancelTextLabel}</span>
                  <input
                    type="text"
                    maxLength={140}
                    value={reasonText}
                    onChange={(event) => setReasonText(event.target.value)}
                  />
                </label>
              )}
              <button
                type="button"
                className="btn btn-no"
                disabled={busy !== null || reason === null}
                onClick={() => void cancel(order)}
              >
                {t.shopCancelConfirm}
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="btn btn-quiet"
              disabled={busy !== null}
              onClick={() => {
                setCancelling(order.id);
                setReason(null);
                setReasonText('');
              }}
            >
              {t.shopCancel}
            </button>
          )}
        </>
      )}
    </article>
  );

  return (
    <section className="stack" aria-label={t.shopOrderTitle}>
      {failed && (
        <p className="alert" role="alert">
          {t.errSend}
        </p>
      )}
      {past.length > 0 && active.length > 0 && (
        <h2 className="section-title">{t.shopOrdersActiveTitle}</h2>
      )}
      {active.map(card)}
      {past.length > 0 && <h2 className="section-title">{t.shopOrdersPastTitle}</h2>}
      {past.map(card)}
    </section>
  );
}
