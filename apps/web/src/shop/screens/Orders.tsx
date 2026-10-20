import { useRef, useState } from 'react';
import { useT } from '../../i18n/index.js';
import { ApiError, type ShopApi } from '../../lib/api.js';
import { formatRupees } from '../../lib/money.js';
import type { ShopCancelReason, ShopOrder } from '../../lib/orders.js';
import { displayItemName, formatClock, isToday } from '../lib/format.js';
import type { ShopData } from '../lib/useShopData.js';
import { BottomSheet } from '../../ui/BottomSheet.js';
import { Button, LinkButton } from '../../ui/Button.js';
import { Chip } from '../../ui/Chip.js';
import { Field } from '../../ui/Field.js';
import { SegmentedControl } from '../../ui/SegmentedControl.js';
import { Skeleton } from '../../ui/Skeleton.js';
import { useToast } from '../../ui/Toast.js';

interface Props {
  api: ShopApi;
  data: ShopData;
  now: number;
}

const REASONS: ShopCancelReason[] = ['out_of_stock', 'cannot_deliver_now', 'other'];

/** Orders: what to send out now, and what finished today. Money is cash on delivery. */
export function Orders({ api, data, now }: Props) {
  const { t } = useT();
  const s = t.shop;
  const toast = useToast();
  const { orders } = data;
  const [tab, setTab] = useState<'active' | 'done'>('active');
  const [busy, setBusy] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<ShopOrder | null>(null);
  const [reason, setReason] = useState<ShopCancelReason | null>(null);
  const [reasonText, setReasonText] = useState('');
  /**
   * Taps already sent, by order, action and the state it was tapped in: a double tap sends once, and
   * the same button works again only when the order has moved on (or the send failed).
   */
  const sent = useRef(new Set<string>());

  const today = new Date(now);
  const active = (orders ?? []).filter((o) => !o.final);
  const done = (orders ?? []).filter((o) => o.final && isToday(o.updatedAt, today));
  const firstAccepted = active.find((o) => o.state === 'ACCEPTED')?.id;

  const reasonLabel: Record<ShopCancelReason, string> = {
    out_of_stock: s.reasonOutOfStock,
    cannot_deliver_now: s.reasonCannotDeliver,
    other: s.reasonOther,
  };

  async function run(id: string, action: string, state: string, work: () => Promise<unknown>) {
    const key = `${id}:${action}:${state}`;
    if (sent.current.has(key)) return;
    sent.current.add(key);
    setBusy(id);
    try {
      await work();
    } catch (error) {
      // 404 or 409: the customer cancelled, or it ran out of time. The refresh shows it.
      if (!(error instanceof ApiError && (error.status === 404 || error.status === 409))) {
        sent.current.delete(key);
        toast(s.sendFailed);
      }
    } finally {
      setBusy(null);
      void data.refresh();
    }
  }

  async function confirmCancel() {
    if (!cancelling || !reason) return;
    const order = cancelling;
    const text = reasonText.trim();
    setCancelling(null);
    await run(order.id, 'cancel', order.state, () =>
      api.cancelOrder(order.id, { reason, ...(text !== '' && reason === 'other' && { text }) }),
    );
  }

  function statusText(order: ShopOrder): string {
    switch (order.state) {
      case 'DELIVERED':
        return s.delivered;
      case 'NOT_CONFIRMED':
        return s.notConfirmed;
      case 'CANCELLED':
        return order.cancelReason ? s.cancelledWhy(reasonLabel[order.cancelReason]) : s.cancelled;
      case 'DECLINED':
        return s.declined;
      default:
        return s.expired;
    }
  }

  function card(order: ShopOrder) {
    const fee = order.feePaise ?? 0;
    const total = order.itemsTotalPaise === null ? null : order.itemsTotalPaise + fee;
    return (
      <article key={order.id} className="sh-card sh-order" aria-label={s.deliveryChip}>
        <div className="sh-order__top">
          <span className="sh-tag">{s.deliveryChip}</span>
          <span className="sh-label sh-muted">
            {order.state === 'REQUESTED'
              ? s.requestedAt(formatClock(order.createdAt))
              : s.chosenAt(formatClock(order.createdAt))}
          </span>
        </div>
        <ul className="sh-order__lines">
          {order.lines.map((line, i) => (
            <li key={`${line.name}-${i}`} className="sh-body">
              {line.count} × {displayItemName(line.name)}
            </li>
          ))}
        </ul>
        <p className="sh-label">
          {total === null
            ? s.priceNotSet
            : fee > 0
              ? s.inclFee(formatRupees(total), formatRupees(fee))
              : s.collectCash(formatRupees(total))}
        </p>
        {!order.final && order.addressText && (
          <div className="sh-order__address">
            <p className="sh-body">{order.addressText}</p>
            <p className="sh-label sh-muted">{s.forName(order.contactName)}</p>
            {order.mapUrl && (
              <LinkButton variant="secondary" external href={order.mapUrl}>
                {s.openMap}
              </LinkButton>
            )}
          </div>
        )}
        {order.note && <p className="sh-body sh-muted">{s.customerNote(order.note)}</p>}
        {order.final && <p className="sh-label sh-order__status">{statusText(order)}</p>}
        {order.state === 'REQUESTED' && (
          <div className="sh-order__actions">
            <Button
              variant="secondary"
              disabled={busy !== null}
              onClick={() =>
                void run(order.id, 'decline', order.state, () =>
                  api.orderAction(order.id, 'decline'),
                )
              }
            >
              {s.decline}
            </Button>
            <Button
              variant="solid"
              disabled={busy !== null}
              onClick={() =>
                void run(order.id, 'accept', order.state, () => api.orderAction(order.id, 'accept'))
              }
            >
              {s.accept}
            </Button>
          </div>
        )}
        {order.state === 'ACCEPTED' && (
          <div className="sh-order__actions sh-order__actions--stack">
            <Button
              variant={order.id === firstAccepted ? 'primary' : 'solid'}
              disabled={busy !== null}
              onClick={() =>
                void run(order.id, 'out', order.state, () => api.orderAction(order.id, 'out'))
              }
            >
              {s.outForDelivery}
            </Button>
            <Button
              variant="quiet"
              disabled={busy !== null}
              onClick={() => {
                setCancelling(order);
                setReason(null);
                setReasonText('');
              }}
            >
              {s.cancelOrder}
            </Button>
          </div>
        )}
        {order.state === 'OUT_FOR_DELIVERY' && (
          <p className="sh-label sh-muted">{s.waitingConfirm}</p>
        )}
      </article>
    );
  }

  const list = tab === 'active' ? active : done;

  return (
    <>
      <h1 className="sh-title">{s.ordersTitle}</h1>
      <SegmentedControl
        label={s.ordersTitle}
        value={tab}
        options={[
          { value: 'active', label: s.tabActive(active.length) },
          { value: 'done', label: s.tabDone(done.length) },
        ]}
        onChange={setTab}
      />
      {orders === null && data.ordersFailed ? (
        <div className="sh-center">
          <p className="sh-alert" role="alert">
            {s.loadFailed}
          </p>
          <Button variant="secondary" onClick={() => void data.refresh()}>
            {s.retry}
          </Button>
        </div>
      ) : orders === null ? (
        <div className="sh-stack" aria-busy="true">
          <span className="sh-visually-hidden">{s.loading}</span>
          <Skeleton height="160px" radius="12px" />
          <Skeleton height="160px" radius="12px" />
        </div>
      ) : list.length === 0 ? (
        <div className="sh-center">
          <p className="sh-heading">{tab === 'active' ? s.noActiveOrders : s.noDoneOrders}</p>
        </div>
      ) : (
        <div className="sh-stack">{list.map(card)}</div>
      )}

      <BottomSheet
        open={cancelling !== null}
        title={s.cancelTitle}
        onClose={() => setCancelling(null)}
        footer={
          <div className="sh-order__actions sh-order__actions--stack">
            <Button
              variant="danger"
              disabled={reason === null}
              onClick={() => void confirmCancel()}
            >
              {s.cancelConfirm}
            </Button>
            <Button variant="quiet" onClick={() => setCancelling(null)}>
              {s.keepOrder}
            </Button>
          </div>
        }
      >
        <div className="sh-chips" role="group" aria-label={s.cancelTitle}>
          {REASONS.map((value) => (
            <Chip key={value} pressed={reason === value} onClick={() => setReason(value)}>
              {reasonLabel[value]}
            </Chip>
          ))}
        </div>
        {reason === 'other' && (
          <Field
            label={s.reasonText}
            maxLength={140}
            value={reasonText}
            onChange={(event) => setReasonText(event.target.value)}
          />
        )}
      </BottomSheet>
    </>
  );
}
