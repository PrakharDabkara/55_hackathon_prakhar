import { AuthPhoto } from '../../components/AuthPhoto.js';
import { useT } from '../../i18n/index.js';
import type { ShopPing } from '../../lib/api.js';
import type { PhotoApi } from '../../lib/photoApi.js';
import { displayItemName, formatQuantity } from '../lib/format.js';
import { Button } from './Button.js';
import { Parchi } from './Parchi.js';
import { Stamp } from './Stamp.js';
import { TimeRing } from './TimeRing.js';

interface Props {
  ping: ShopPing;
  now: number;
  /** Shows the customer's photo when the ping carries one. */
  photos?: PhotoApi;
  /** Set once the shop has answered: the stamp lands and the button stops. */
  stamp?: 'yes' | 'no' | null;
  onAnswer: () => void;
}

/** One question as a paper slip: how far, how long left, what, how many, and one button. */
export function PingSlip({ ping, now, photos, stamp = null, onAnswer }: Props) {
  const { t, lang } = useT();
  const quantity = formatQuantity(ping.quantity);
  return (
    <Parchi delivery={ping.wantsDelivery}>
      <div className="sh-parchi__meta">
        <span className="sh-caption sh-paper-muted">
          {t.bands[ping.distanceBand as keyof typeof t.bands] ?? ping.distanceBand}
        </span>
        <span className="sh-parchi__reply">
          <span className="sh-label sh-paper-muted">{t.shop.replyIn}</span>
          <TimeRing startedAt={ping.sentAt} expiresAt={ping.expiresAt} now={now} />
        </span>
      </div>
      <div className="sh-parchi__ruled">
        <h2 className="sh-parchi__item">
          {lang === 'hi' ? ping.item.nameHi : displayItemName(ping.item.nameEn)}
        </h2>
        {quantity && <p className="sh-parchi__note">{quantity}</p>}
        {ping.wantsDelivery && <p className="sh-parchi__note">{t.shop.wantsDeliveryLine}</p>}
      </div>
      {photos && ping.photoId && (
        <div className="sh-photo">
          <span className="sh-photo__tape" aria-hidden="true" />
          <AuthPhoto api={photos} id={ping.photoId} alt={t.shop.customerPhoto} />
        </div>
      )}
      <div className="sh-parchi__foot">
        <Button
          variant="primary"
          className="sh-btn--block"
          disabled={stamp !== null}
          onClick={onAnswer}
        >
          {t.shop.answer}
        </Button>
        {stamp && (
          <span className="sh-parchi__stamp">
            <Stamp variant={stamp} />
          </span>
        )}
      </div>
    </Parchi>
  );
}
