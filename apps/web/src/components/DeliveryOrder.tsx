import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useT } from '../i18n/index.js';
import { ApiError } from '../lib/api.js';
import { formatRupees } from '../lib/money.js';
import type { OrderSource, SeekerOrder } from '../lib/orders.js';
import type { SeekerApi } from '../lib/seekerApi.js';

interface Props {
  api: Pick<SeekerApi, 'placeOrder' | 'cancelOrder' | 'savedAddress'>;
  shop: { id: string; name: string };
  source: OrderSource;
  /** What the shop offered: shown before the order is placed. */
  offer: { feePaise: number | null; minutes: number | null };
  /** The newest order for this shop on this screen, if any. */
  order: SeekerOrder | undefined;
  /** The order changed on the server: fetch the screen's orders again. */
  onChange: () => void;
}

const MIN_ADDRESS = 5;

/**
 * "Ghar mangwao" for one shop (ADR-0031): the fee and a fixed cash-on-delivery line, "Order bhejo",
 * then the address step (typed text; the pin is the request's own location, never dragged), and
 * after that the order's status, live. No money moves in the app.
 */
export function DeliveryOrder({ api, shop, source, offer, order, onChange }: Props) {
  const { t } = useT();
  const [step, setStep] = useState<'summary' | 'address'>('summary');
  const [address, setAddress] = useState('');
  const [name, setName] = useState('');
  /** Unticked unless the customer ticks it: no tick, nothing is kept after the order (ADR-0033). */
  const [remember, setRemember] = useState(false);
  const [saved, setSaved] = useState<{ addressText: string; customerName: string | null } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  /** Sent: stays locked until the order shows up (or changes), so a double tap sends one. */
  const [placed, setPlaced] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sending = useRef(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  // A new state of the order (cancelled, say) opens the form again.
  useEffect(() => setPlaced(false), [order?.id, order?.state]);

  // Only the address step needs it; a failure just means nothing is offered.
  useEffect(() => {
    if (step !== 'address') return;
    api.savedAddress().then(
      (found) => {
        if (alive.current && found.addressText)
          setSaved({ addressText: found.addressText, customerName: found.customerName });
      },
      () => undefined,
    );
  }, [api, step]);

  const fee = order?.feePaise ?? offer.feePaise;
  const minutes = order?.feeMinutes ?? offer.minutes;
  const feeLine = t.orderFeeLine(
    fee !== null && fee > 0 ? formatRupees(fee) : null,
    fee === 0,
    minutes,
  );

  async function place(event: FormEvent) {
    event.preventDefault();
    if (sending.current || placed || address.trim().length < MIN_ADDRESS) return;
    sending.current = true;
    setBusy(true);
    setError(null);
    try {
      await api.placeOrder({
        shopId: shop.id,
        ...source,
        addressText: address.trim(),
        ...(name.trim() !== '' && { customerName: name.trim() }),
        ...(remember && { saveAddress: true }),
      });
      setPlaced(true);
      onChange();
    } catch (e) {
      if (alive.current)
        setError(
          e instanceof ApiError && e.code === 'shop_closed' ? t.orderErrClosed : t.orderErrGeneric,
        );
    } finally {
      sending.current = false;
      if (alive.current) setBusy(false);
    }
  }

  async function cancel() {
    if (!order || sending.current) return;
    sending.current = true;
    setBusy(true);
    try {
      await api.cancelOrder(order.id);
    } catch {
      // The order may have moved meanwhile; the refresh below shows where it is.
    } finally {
      sending.current = false;
      if (alive.current) setBusy(false);
      onChange();
    }
  }

  const live = order && order.state !== 'CANCELLED';
  if (live) {
    const message = {
      REQUESTED: t.orderWaiting,
      ACCEPTED: t.orderAccepted,
      OUT_FOR_DELIVERY: t.orderOut,
      DELIVERED: t.orderDelivered,
      DECLINED: t.orderDeclined,
      EXPIRED: t.orderExpired,
    }[order.state as Exclude<SeekerOrder['state'], 'CANCELLED'>];
    const open = order.state === 'REQUESTED' || order.state === 'ACCEPTED';
    const going = open || order.state === 'OUT_FOR_DELIVERY' || order.state === 'DELIVERED';
    return (
      <div className="order-box" role="status">
        <p className={`order-state order-${order.state}`}>{message}</p>
        {going && order.addressText && (
          <p className="meta">{t.orderYourAddress(order.addressText)}</p>
        )}
        {going && <p className="meta">{t.orderCod}</p>}
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
      </div>
    );
  }

  return (
    <div className="order-box">
      {order?.state === 'CANCELLED' && <p className="meta">{t.orderCancelled}</p>}
      {step === 'summary' ? (
        <>
          <p className="meta">{shop.name}</p>
          <p className="meta">{feeLine}</p>
          <p className="meta">{t.orderCod}</p>
          <button type="button" className="btn btn-yes" onClick={() => setStep('address')}>
            {t.orderSend}
          </button>
        </>
      ) : (
        <form className="stack-tight" onSubmit={(event) => void place(event)}>
          {saved && (
            <button
              type="button"
              className="btn btn-quiet"
              onClick={() => {
                setAddress(saved.addressText);
                if (saved.customerName) setName(saved.customerName);
              }}
            >
              {t.orderSaved(saved.addressText)}
            </button>
          )}
          <label className="field">
            <span>{t.orderAddressLabel}</span>
            <textarea
              rows={3}
              maxLength={300}
              autoComplete="street-address"
              value={address}
              onChange={(event) => setAddress(event.target.value)}
            />
          </label>
          <label className="field">
            <span>{t.orderNameLabel}</span>
            <input
              type="text"
              maxLength={60}
              autoComplete="given-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label className="check-option">
            <input
              type="checkbox"
              checked={remember}
              onChange={(event) => setRemember(event.target.checked)}
            />
            <span>{t.orderRemember}</span>
          </label>
          <p className="meta">{t.orderPinNote}</p>
          <p className="meta">{t.orderCod}</p>
          {error && (
            <p className="alert" role="alert">
              {error}
            </p>
          )}
          <button
            type="submit"
            className="btn btn-yes"
            disabled={busy || placed || address.trim().length < MIN_ADDRESS}
          >
            {t.orderConfirm}
          </button>
        </form>
      )}
    </div>
  );
}
