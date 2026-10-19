import { useT } from '../../i18n/index.js';
import { formatRupees } from '../../lib/money.js';
import type { ShopOrder } from '../../lib/orders.js';
import { Button } from './Button.js';
import { Parchi } from './Parchi.js';
import { TimeRing } from './TimeRing.js';

interface Props {
  order: ShopOrder;
  now: number;
  busy?: boolean;
  onAccept: () => void;
  onDecline: () => void;
}

/**
 * A customer's order request (a stale offer, ADR-0039): items with prices, the fee, the total, their
 * note, and ten minutes to accept. Who they are stays hidden until the order is accepted.
 */
export function OrderSlip({ order, now, busy = false, onAccept, onDecline }: Props) {
  const { t } = useT();
  const fee = order.feePaise ?? 0;
  return (
    <Parchi delivery>
      <div className="sh-parchi__meta">
        <span className="sh-caption sh-paper-muted">{t.shop.orderRequest}</span>
        <span className="sh-parchi__reply">
          <span className="sh-label sh-paper-muted">{t.shop.replyIn}</span>
          <TimeRing startedAt={order.createdAt} expiresAt={order.expiresAt} now={now} />
        </span>
      </div>
      <ul className="sh-parchi__lines">
        {order.lines.map((line, i) => (
          <li key={`${line.name}-${i}`} className="sh-parchi__line">
            <span className="sh-parchi__note">
              {line.count} × {line.name}
            </span>
            <span className="sh-parchi__price">
              {line.pricePaise === null
                ? t.shop.priceNotSet
                : formatRupees(line.pricePaise * line.count)}
            </span>
          </li>
        ))}
        {fee > 0 && (
          <li className="sh-parchi__line">
            <span className="sh-parchi__note">{t.shop.deliveryLine}</span>
            <span className="sh-parchi__price">{formatRupees(fee)}</span>
          </li>
        )}
      </ul>
      <hr className="sh-parchi__rule" />
      <p className="sh-parchi__line sh-parchi__total">
        <span>{t.shop.total}</span>
        <span>
          {order.itemsTotalPaise === null
            ? t.shop.priceNotSet
            : formatRupees(order.itemsTotalPaise + fee)}
        </span>
      </p>
      {order.note && <p className="sh-parchi__note">{t.shop.customerNote(order.note)}</p>}
      <div className="sh-parchi__foot sh-parchi__foot--two">
        <Button variant="secondary" disabled={busy} onClick={onDecline}>
          {t.shop.decline}
        </Button>
        <Button variant="ink" disabled={busy} onClick={onAccept}>
          {t.shop.accept}
        </Button>
      </div>
    </Parchi>
  );
}
