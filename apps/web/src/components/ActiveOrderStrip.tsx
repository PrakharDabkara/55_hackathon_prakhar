import type { MouseEvent } from 'react';
import '../customer/find.css';
import { useT } from '../i18n/index.js';
import { lineName, type SeekerOrder } from '../lib/orders.js';
import { timeAfter } from '../lib/time.js';

interface Props {
  order: SeekerOrder;
  navigate: (path: string) => void;
}

/** The newest order still moving, pinned to the bottom of Find: what, how far along, and where to look. */
export function ActiveOrderStrip({ order, navigate }: Props) {
  const { t, lang } = useT();
  const c = t.c;
  const status =
    order.state === 'OUT_FOR_DELIVERY'
      ? c.findStatusOut
      : order.state === 'ACCEPTED'
        ? c.findStatusAccepted
        : c.findStatusWaiting;
  const line = order.lines[0];
  const item = line ? lineName(line, lang) : order.shopName;
  const showTime =
    order.state === 'OUT_FOR_DELIVERY' && order.outForDeliveryAt && order.feeMinutes != null;
  const second =
    showTime && order.outForDeliveryAt && order.feeMinutes != null
      ? c.findStripBy(order.shopName, timeAfter(order.outForDeliveryAt, order.feeMinutes))
      : order.shopName;
  const href = `/app/order/${order.id}`;
  return (
    <aside className="cu-find__strip" aria-label={c.findStripLabel}>
      <div className="cu-find__strip-text">
        <p className="sh-label">{`${item} · ${status}`}</p>
        <p className="sh-helper">{second}</p>
      </div>
      <a
        className="sh-btn sh-btn--solid"
        href={href}
        onClick={(event: MouseEvent<HTMLAnchorElement>) => {
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
          event.preventDefault();
          navigate(href);
        }}
      >
        {c.findTrack}
      </a>
    </aside>
  );
}
