import { useCallback, useEffect, useRef, useState } from 'react';
import {
  OfflineBanner,
  OrdersSkeleton,
  appLink,
  arrivalTime,
  useOnline,
} from '../customer/ordersShared.js';
import { ScreenBar } from '../customer/ScreenBar.js';
import { useT } from '../i18n/index.js';
import { ApiError } from '../lib/api.js';
import type { LiveOptions } from '../lib/live.js';
import { formatRupees } from '../lib/money.js';
import { lineName, orderSourcePath, orderTotalPaise, type SeekerOrder } from '../lib/orders.js';
import { orderCaption } from '../lib/orderText.js';
import type { SeekerApi } from '../lib/seekerApi.js';
import { timeOfDay } from '../lib/time.js';
import { useLive } from '../lib/useLive.js';
import { BottomSheet } from '../ui/BottomSheet.js';
import { Button } from '../ui/Button.js';
import { Field } from '../ui/Field.js';
import { Icon } from '../ui/Icon.js';
import { ShopLogo } from '../ui/ShopLogo.js';

interface Props {
  api: Pick<SeekerApi, 'getOrder' | 'cancelOrder' | 'receiveOrder' | 'eventTicket'>;
  orderId: string;
  onBack: () => void;
  /** Goes to the search or plan the order came from. Without it the link is a plain link. */
  navigate?: (path: string) => void;
  pollMs?: number;
  live?: Pick<LiveOptions, 'createSource' | 'retryMs'>;
}

const MOVING: readonly SeekerOrder['state'][] = [
  'REQUESTED',
  'ACCEPTED',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
];

/**
 * One order at /app/order/<id>: where it stands, live (ADR-0033), the steps with their times, the
 * items and the cash to pay. It reads the order from the server, so it works after a reload.
 */
export function OrderPage({ api, orderId, onBack, navigate, pollMs = 15_000, live }: Props) {
  const { t, lang } = useT();
  const c = t.c;
  const online = useOnline();
  const [order, setOrder] = useState<SeekerOrder | null>(null);
  const [problem, setProblem] = useState<'missing' | 'failed' | null>(null);
  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [reason, setReason] = useState('');
  const [actionFailed, setActionFailed] = useState(false);
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
        if (!alive.current) return;
        setProblem(error instanceof ApiError && error.status === 404 ? 'missing' : 'failed');
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

  async function act(run: () => Promise<unknown>) {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    setActionFailed(false);
    try {
      await run();
    } catch {
      // It may have moved meanwhile; the refresh below shows where it is.
      if (alive.current) setActionFailed(true);
    } finally {
      sending.current = false;
      if (alive.current) {
        setBusy(false);
        setSheet(false);
      }
      refresh();
    }
  }

  const cancel = () => {
    const text = reason.trim();
    return act(() => (text ? api.cancelOrder(orderId, text) : api.cancelOrder(orderId)));
  };

  const bar = <ScreenBar title={c.orderTitle} onBack={onBack} />;

  if (!order) {
    return (
      <>
        {bar}
        <main className="cu-main">
          {!online && <OfflineBanner />}
          {problem === null ? (
            <OrdersSkeleton rows={4} />
          ) : problem === 'missing' ? (
            <div className="cu-empty">
              <p className="sh-heading">{c.orderNotFound}</p>
            </div>
          ) : (
            <div className="cu-empty" role="alert">
              <p className="sh-heading">{c.loadFailed}</p>
              <p>{c.loadFailedHelp}</p>
              <Button variant="primary" onClick={refresh}>
                {c.retry}
              </Button>
            </div>
          )}
        </main>
      </>
    );
  }

  const total = orderTotalPaise(order);
  const moving = MOVING.includes(order.state);
  const open = order.state === 'REQUESTED' || order.state === 'ACCEPTED';
  const noMoneyDue = ['DECLINED', 'EXPIRED', 'CANCELLED'].includes(order.state);
  const source = orderSourcePath(order);
  const sourceProps = source ? (navigate ? appLink(navigate, source) : { href: source }) : null;
  const arrival = arrivalTime(order);

  const reached = { REQUESTED: 0, ACCEPTED: 1, OUT_FOR_DELIVERY: 2, DELIVERED: 3 } as Record<
    string,
    number
  >;
  const at = reached[order.state] ?? 0;
  const steps: { label: string; time: string | null }[] = [
    { label: c.stepPlaced, time: order.createdAt },
    { label: c.stepAccepted, time: order.acceptedAt ?? null },
    { label: c.stepOut, time: order.outForDeliveryAt ?? null },
    { label: c.stepReceived, time: order.state === 'DELIVERED' ? order.updatedAt : null },
  ];

  const plainHelp: Partial<Record<SeekerOrder['state'], string>> = {
    NOT_CONFIRMED: c.notConfirmedHelp,
    DECLINED: c.declined,
    EXPIRED: c.expired,
  };
  const plainCaption =
    order.state === 'CANCELLED'
      ? order.cancelledBy === 'shop'
        ? c.cancelledByShop
        : c.cancelledByYou
      : order.state === 'NOT_CONFIRMED'
        ? c.notConfirmed
        : order.state === 'DECLINED'
          ? c.statusDeclined
          : c.statusExpired;
  const shopReason =
    order.state === 'CANCELLED' && order.cancelledBy === 'shop'
      ? {
          out_of_stock: c.reasonOutOfStock,
          cannot_deliver_now: c.reasonCannotDeliver,
          other: c.reasonOther,
        }[order.cancelReason ?? 'other']
      : null;

  return (
    <>
      {bar}
      <main className="cu-main">
        {!online && <OfflineBanner />}
        <div className="cu-order__shop">
          <ShopLogo name={order.shopName} logoUrl={order.logoUrl ?? null} size={48} />
          <p className="sh-heading cu-order__shop-name">{c.orderFrom(order.shopName)}</p>
        </div>

        {moving ? (
          <>
            <div className="cu-order-status" role="status">
              <p className="cu-order-status__caption">{orderCaption(c, order.state)}</p>
              {order.state === 'OUT_FOR_DELIVERY' && (
                <>
                  {arrival ? (
                    <p className="cu-order-status__time">{c.reachingBy(arrival)}</p>
                  ) : order.outForDeliveryAt ? (
                    <p className="cu-order-status__time">
                      {c.outSince(timeOfDay(order.outForDeliveryAt))}
                    </p>
                  ) : null}
                  <p className="cu-order-status__note">{c.ownPerson}</p>
                </>
              )}
            </div>
            <ol className="cu-steps" aria-label={c.stepsLabel}>
              {steps.map((step, i) => (
                <li
                  key={step.label}
                  className={`cu-step${i < at || order.state === 'DELIVERED' ? ' cu-step--done' : ''}${i === at ? ' cu-step--current' : ''}`}
                  {...(i === at && { 'aria-current': 'step' as const })}
                >
                  <span className="cu-step__dot" aria-hidden="true">
                    {(i < at || order.state === 'DELIVERED') && <Icon name="check" size={16} />}
                  </span>
                  <span className="cu-step__label">{step.label}</span>
                  {step.time && <span className="cu-step__time">{timeOfDay(step.time)}</span>}
                </li>
              ))}
            </ol>
          </>
        ) : (
          <div className="cu-plain" role="status">
            <p className="cu-plain__caption">{plainCaption}</p>
            {shopReason && <p>{shopReason}</p>}
            {shopReason && order.cancelText && <p>{order.cancelText}</p>}
            {plainHelp[order.state] && <p className="sh-muted">{plainHelp[order.state]}</p>}
            {sourceProps && (order.state === 'DECLINED' || order.state === 'EXPIRED') && (
              <a className="sh-btn sh-btn--secondary" {...sourceProps}>
                {c.seeShops}
              </a>
            )}
          </div>
        )}

        <section className="cu-section" aria-labelledby="order-items">
          <h2 id="order-items" className="sh-caption">
            {c.itemsTitle}
          </h2>
          <ul className="cu-lines">
            {order.lines.map((line, i) => (
              <li key={`${line.name}-${i}`}>
                {line.count} × {lineName(line, lang)}
              </li>
            ))}
          </ul>
          {order.feePaise !== null && (
            <p className="cu-row sh-muted">
              <span>{c.feeLabel}</span>
              <span>{order.feePaise === 0 ? c.freeDelivery : formatRupees(order.feePaise)}</span>
            </p>
          )}
          {!noMoneyDue &&
            (total === null ? (
              <p className="sh-muted">{c.priceUnknown}</p>
            ) : (
              <p className="cu-row cu-row--total">
                <span>{c.orderPayCash(formatRupees(total))}</span>
                {order.unknownPriceCount > 0 && (
                  <span className="sh-muted">{c.priceUnknownMore(order.unknownPriceCount)}</span>
                )}
              </p>
            ))}
        </section>

        <section className="cu-section" aria-labelledby="order-address">
          <h2 id="order-address" className="sh-caption">
            {c.addressTitle}
          </h2>
          <p>{order.addressText ?? c.addressGone}</p>
          {order.note && (
            <>
              <h3 className="sh-caption">{c.noteTitle}</h3>
              <p>{order.note}</p>
            </>
          )}
        </section>

        {actionFailed && (
          <p className="sh-alert" role="alert">
            {c.orderActionFailed}
          </p>
        )}

        {order.state === 'OUT_FOR_DELIVERY' && (
          <>
            <Button
              variant="primary"
              disabled={busy}
              onClick={() => void act(() => api.receiveOrder(orderId))}
            >
              {c.received}
            </Button>
            <p className="sh-helper">{c.cannotCancelOut}</p>
          </>
        )}
        {open && (
          <Button variant="quiet" disabled={busy} onClick={() => setSheet(true)}>
            {c.cancelOrder}
          </Button>
        )}
      </main>

      <BottomSheet
        open={sheet}
        title={c.cancelSheetTitle}
        onClose={() => setSheet(false)}
        footer={
          <div className="cu-sheet-foot">
            <Button variant="danger" disabled={busy} onClick={() => void cancel()}>
              {c.cancelOrder}
            </Button>
            <Button variant="quiet" onClick={() => setSheet(false)}>
              {c.cancelKeep}
            </Button>
          </div>
        }
      >
        <div className="cu-sheet-form">
          <Field
            label={c.cancelReasonLabel}
            helper={c.cancelReasonHelp}
            maxLength={140}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
      </BottomSheet>
    </>
  );
}
