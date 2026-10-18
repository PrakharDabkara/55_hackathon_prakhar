import { formatQuantity, type ExactQuantity } from '@kahanmilega/shared';
import { useT } from '../i18n/index.js';
import { formatRupees } from '../lib/money.js';

interface Props {
  quantity?: ExactQuantity | null | undefined;
  /** Enough for what the customer asked? Only for a live answer. */
  check?: 'enough' | 'short' | 'unknown' | null | undefined;
  /** A remembered answer (learned stock) says "Pichhli baar", never "hai". */
  remembered?: boolean;
  delivery?: { feePaise: number | null; minutes: number | null } | null | undefined;
}

/** What a shop said besides the price: how much it has, and whether it brings it home. */
export function OfferLines({ quantity, check, remembered = false, delivery }: Props) {
  const { t } = useT();
  const text = quantity ? formatQuantity(quantity) : null;
  return (
    <>
      {text && remembered && <p className="meta">{t.qtyLast(text)}</p>}
      {text && !remembered && (
        <p className="meta">
          {check === 'short' ? t.qtyShort(text) : t.qtyHas(text)}
          {check === 'short' && <span className="status-badge warn"> {t.qtyNotEnough}</span>}
        </p>
      )}
      {delivery && (
        <p className="meta">
          <span className="status-badge">
            {t.deliveryChip(
              delivery.feePaise !== null && delivery.feePaise > 0
                ? formatRupees(delivery.feePaise)
                : null,
              delivery.feePaise === 0,
              delivery.minutes,
            )}
          </span>
        </p>
      )}
    </>
  );
}
