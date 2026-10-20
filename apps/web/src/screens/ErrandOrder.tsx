import { useEffect, useRef, useState, type FormEvent } from 'react';
import '../customer/errand.css';
import { useT } from '../i18n/index.js';
import { ApiError } from '../lib/api.js';
import { formatRupees } from '../lib/money.js';
import type { SeekerOrder } from '../lib/orders.js';
import type { SeekerApi } from '../lib/seekerApi.js';
import { Button } from '../ui/Button.js';
import { Field } from '../ui/Field.js';

interface Props {
  api: Pick<SeekerApi, 'placeOrder' | 'cancelOrder' | 'savedAddress' | 'receiveOrder'>;
  shop: { id: string; name: string };
  errandId: string;
  /** What the shop offered: shown before the order is placed. */
  offer: { feePaise: number | null; minutes: number | null };
  /** The newest order for this shop on this screen, if any. */
  order: SeekerOrder | undefined;
  /** The order changed on the server: fetch the screen's orders again. */
  onChange: () => void;
}

const MIN_ADDRESS = 5;

/**
 * Delivery from one shop of the plan (ADR-0031): the fee and a fixed cash-on-delivery line, "Send
 * order", the address step, then the order's status, live. No money moves in the app. These are
 * secondary buttons: the screen's one primary is "Start route".
 */
export function ErrandOrder({ api, shop, errandId, offer, order, onChange }: Props) {
  const { t } = useT();
  const [step, setStep] = useState<'summary' | 'address'>('summary');
  const [address, setAddress] = useState('');
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
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

  /** Runs one request at a time; the screen's orders are fetched again afterwards. */
  async function once(work: () => Promise<unknown>, refetch: boolean) {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    try {
      await work();
    } catch {
      // The order may have moved meanwhile; the refresh shows where it is.
    } finally {
      sending.current = false;
      if (alive.current) setBusy(false);
      if (refetch) onChange();
    }
  }

  async function place(event: FormEvent) {
    event.preventDefault();
    if (sending.current || placed || address.trim().length < MIN_ADDRESS) return;
    sending.current = true;
    setBusy(true);
    setError(null);
    try {
      await api.placeOrder({
        shopId: shop.id,
        errandId,
        addressText: address.trim(),
        ...(name.trim() !== '' && { customerName: name.trim() }),
        ...(note.trim() !== '' && { note: note.trim() }),
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

  if (order && order.state !== 'CANCELLED') {
    const message = {
      REQUESTED: t.orderWaiting,
      ACCEPTED: t.orderAccepted,
      OUT_FOR_DELIVERY: t.orderOut,
      DELIVERED: t.orderDelivered,
      DECLINED: t.orderDeclined,
      EXPIRED: t.orderExpired,
      NOT_CONFIRMED: t.orderNotConfirmed,
    }[order.state];
    const open = order.state === 'REQUESTED' || order.state === 'ACCEPTED';
    const going = open || order.state === 'OUT_FOR_DELIVERY' || order.state === 'DELIVERED';
    return (
      <div className="cu-errand-order" role="status">
        <p className="sh-label">{message}</p>
        {going && order.addressText && (
          <p className="cu-errand-small">{t.orderYourAddress(order.addressText)}</p>
        )}
        {going && <p className="cu-errand-small">{t.orderCod}</p>}
        {order.state === 'OUT_FOR_DELIVERY' && (
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => void once(() => api.receiveOrder(order.id), true)}
          >
            {t.orderReceived}
          </Button>
        )}
        {open && (
          <Button
            variant="quiet"
            disabled={busy}
            onClick={() => void once(() => api.cancelOrder(order.id), true)}
          >
            {t.orderCancel}
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="cu-errand-order">
      {order?.state === 'CANCELLED' && (
        <p className="cu-errand-small">
          {order.cancelledBy === 'shop' ? t.orderCancelledByShop : t.orderCancelled}
        </p>
      )}
      <p className="cu-errand-small">{feeLine}</p>
      <p className="cu-errand-small">{t.orderCod}</p>
      {step === 'summary' ? (
        <Button variant="secondary" onClick={() => setStep('address')}>
          {t.orderSend}
        </Button>
      ) : (
        <form className="cu-stack" onSubmit={(event) => void place(event)}>
          {saved && (
            <Button
              variant="quiet"
              onClick={() => {
                setAddress(saved.addressText);
                if (saved.customerName) setName(saved.customerName);
              }}
            >
              {t.orderSaved(saved.addressText)}
            </Button>
          )}
          <div className="sh-field">
            <label htmlFor={`address-${shop.id}`} className="sh-label">
              {t.orderAddressLabel}
            </label>
            <textarea
              id={`address-${shop.id}`}
              className="cu-errand-text"
              rows={3}
              maxLength={300}
              autoComplete="street-address"
              value={address}
              onChange={(event) => setAddress(event.target.value)}
            />
          </div>
          <Field
            label={t.orderNoteLabel}
            maxLength={140}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
          <Field
            label={t.orderNameLabel}
            maxLength={60}
            autoComplete="given-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <label className="cu-errand-row__label">
            <input
              type="checkbox"
              checked={remember}
              onChange={(event) => setRemember(event.target.checked)}
            />
            <span>{t.orderRemember}</span>
          </label>
          <p className="cu-errand-small">{t.orderPinNote}</p>
          {error && (
            <p className="sh-alert" role="alert">
              {error}
            </p>
          )}
          <Button
            type="submit"
            variant="secondary"
            disabled={busy || placed || address.trim().length < MIN_ADDRESS}
          >
            {t.orderConfirm}
          </Button>
        </form>
      )}
    </div>
  );
}
