import { useT } from '../../i18n/index.js';
import { formatRupees } from '../../lib/money.js';
import type { ShopOrder } from '../../lib/orders.js';
import { displayItemName } from '../lib/format.js';
import { TickBox } from './TickBox.js';

interface Props {
  order: ShopOrder;
  /** The shop ticked (or cleared) the line at this position. */
  onPack: (index: number, packed: boolean) => void;
}

/**
 * The packing list of an order with several lines, written to sit on a parchi: "tick as you pack",
 * one full-width row per line, and the total to collect. A finished order is just the list.
 */
export function PackingSlip({ order, onPack }: Props) {
  const { t } = useT();
  const s = t.shop;
  const fee = order.feePaise ?? 0;
  const total = order.itemsTotalPaise === null ? null : order.itemsTotalPaise + fee;
  const live = !order.final;
  return (
    <div className="sh-pack">
      <div className="sh-pack__head">
        <span className="sh-caption sh-paper-muted">{s.tickAsYouPack}</span>
        <span className="sh-pack__count">{s.packedOf(order.packedCount, order.lineCount)}</span>
      </div>
      <ul className="sh-pack__rows">
        {order.lines.map((line, i) => {
          const packed = line.packed === true;
          const content = (
            <>
              {live && <TickBox on={packed} />}
              <span className="sh-pack__name">
                {line.count} × {line.displayName ?? displayItemName(line.name)}
              </span>
              <span className="sh-pack__price">
                {line.pricePaise === null
                  ? s.priceNotSet
                  : formatRupees(line.pricePaise * line.count)}
              </span>
            </>
          );
          return (
            <li key={`${line.name}-${i}`}>
              {live ? (
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={packed}
                  className={`sh-pack__row${packed ? ' is-packed' : ''}`}
                  onClick={() => onPack(i, !packed)}
                >
                  {content}
                </button>
              ) : (
                <div className="sh-pack__row">{content}</div>
              )}
            </li>
          );
        })}
      </ul>
      <hr className="sh-parchi__rule" />
      <p className="sh-parchi__note sh-pack__total">
        {total === null
          ? s.priceNotSet
          : fee > 0
            ? s.inclFee(formatRupees(total), formatRupees(fee))
            : s.collectCash(formatRupees(total))}
      </p>
    </div>
  );
}
