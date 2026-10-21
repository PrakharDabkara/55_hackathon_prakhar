import { formatQuantity } from '@askbuy/shared';
import { useT } from '../i18n/index.js';
import { formatDistance } from '../lib/format.js';
import { formatRupees } from '../lib/money.js';
import type { SeekerOrder } from '../lib/orders.js';
import { daysSince, directionsUrl } from '../lib/results.js';
import type { PhotoApi } from '../lib/photoApi.js';
import type { ShopResult } from '../lib/seekerApi.js';
import { agoFrom } from '../lib/time.js';
import { Button, LinkButton } from '../ui/Button.js';
import { ShopLogo } from '../ui/ShopLogo.js';
import { AuthPhoto } from './AuthPhoto.js';
import '../customer/replies.css';

interface CardProps {
  api: PhotoApi;
  result: ShopResult;
  now: number;
  /** The strictly cheapest live reply: gets the caption. */
  best: boolean;
  /** This request's order with the shop, if there is a live one. */
  order: SeekerOrder | undefined;
  onChoose: () => void;
  onTrack: (orderId: string) => void;
}

/** One shop that said yes to this request, just now. */
export function ReplyCard({ api, result, now, best, order, onChoose, onTrack }: CardProps) {
  const { t } = useT();
  const quantity = result.quantity ? formatQuantity(result.quantity) : null;
  const fee = result.delivery?.feePaise ?? null;
  return (
    <li className="cu-reply">
      {best && <p className="cu-reply__best">{t.c.bestPrice}</p>}
      <div className="cu-reply__head">
        <ShopLogo name={result.name} logoUrl={result.logoUrl ?? null} size={44} />
        <div className="cu-reply__who">
          <h3 className="sh-heading">{result.name}</h3>
          <p className="sh-caption sh-muted">
            <span>{formatDistance(result.distanceM)}</span>
            {' · '}
            <span>{t.c.answeredAgo(t.c.ago(agoFrom(result.lastConfirmedAt, now)))}</span>
          </p>
        </div>
        <div className="cu-reply__offer">
          <span className="cu-reply__price">
            {result.pricePaise === null ? t.c.priceNotShared : formatRupees(result.pricePaise)}
          </span>
          {quantity && <span className="sh-caption sh-muted">{quantity}</span>}
        </div>
      </div>
      <div className="cu-reply__chips">
        {result.delivery ? (
          <span className="cu-pill">
            {t.c.delivers(
              fee !== null && fee > 0 ? formatRupees(fee) : null,
              fee === 0,
              result.delivery.minutes,
            )}
          </span>
        ) : (
          <span className="cu-pill cu-pill--muted">{t.c.pickupOnly}</span>
        )}
        {result.quantityCheck === 'short' && (
          <span className="cu-pill cu-pill--warn">{t.c.notEnough}</span>
        )}
        {result.photoId && (
          <AuthPhoto
            api={api}
            id={result.photoId}
            alt={t.c.photoAlt}
            chip={{ label: t.c.photo, close: t.c.photoClose }}
          />
        )}
      </div>
      <div className="cu-reply__action">
        {order ? (
          <a
            className="sh-btn sh-btn--secondary"
            href={`/app/order/${order.id}`}
            onClick={(event) => {
              event.preventDefault();
              onTrack(order.id);
            }}
          >
            {t.c.trackOrder}
          </a>
        ) : (
          <Button variant="secondary" onClick={onChoose}>
            {t.c.chooseShop}
          </Button>
        )}
      </div>
    </li>
  );
}

interface RememberedProps {
  result: ShopResult;
  now: number;
  onWay: () => void;
}

/** A shop that said yes before. Muted, never orderable: it may have sold out since. */
export function RememberedCard({ result, now, onWay }: RememberedProps) {
  const { t } = useT();
  const quantity = result.quantity ? formatQuantity(result.quantity) : null;
  const price = result.pricePaise === null ? null : formatRupees(result.pricePaise);
  return (
    <li className="cu-reply cu-reply--muted">
      <div className="cu-reply__head">
        <ShopLogo name={result.name} logoUrl={result.logoUrl ?? null} size={36} />
        <div className="cu-reply__who">
          <h3 className="sh-heading">{result.name}</h3>
          <p className="sh-caption sh-muted">{formatDistance(result.distanceM)}</p>
        </div>
      </div>
      <p className="sh-body">
        {t.c.hadIt(daysSince(result.lastConfirmedAt, now), price)}
        {quantity ? <span className="sh-muted"> · {quantity}</span> : null}
      </p>
      {result.customerVerified && (
        <p>
          <span className="cu-pill">{t.c.confirmedByCustomer}</span>
        </p>
      )}
      <div className="cu-reply__action">
        <LinkButton
          variant="quiet"
          external
          href={directionsUrl(result.lat, result.lng)}
          onClick={onWay}
        >
          {t.c.showWay}
        </LinkButton>
      </div>
    </li>
  );
}
