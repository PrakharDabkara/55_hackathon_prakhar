import type { ReactNode } from 'react';
import { useT } from '../i18n/index.js';

interface Props {
  /** A delivery request: a marigold band with a DELIVERY stamp across the top. */
  delivery?: boolean;
  /** A band across the top in the brand's soft colour (a list parchi: its stamp and timer). */
  band?: ReactNode;
  children: ReactNode;
  className?: string;
}

/**
 * The paper slip: torn top edge, ruled lines, square bottom. It is the only thing in the shop app
 * that imitates paper, and it is used only for request cards (CLAUDE.md, UI rules).
 */
export function Parchi({ delivery = false, band, children, className }: Props) {
  const { t } = useT();
  return (
    <article className={`sh-parchi${className ? ` ${className}` : ''}`}>
      <div className="sh-parchi__paper">
        {delivery && (
          <div className="sh-parchi__band">
            <span className="sh-delivery-stamp">{t.shop.deliveryStamp}</span>
            <span className="sh-parchi__cod">{t.shop.cashOnDelivery}</span>
          </div>
        )}
        {band && <div className="sh-lband">{band}</div>}
        <div className="sh-parchi__body">{children}</div>
      </div>
    </article>
  );
}
