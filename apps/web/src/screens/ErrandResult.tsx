import { formatQuantity } from '@kahanmilega/shared';
import { useMemo, useState } from 'react';
import { AuthPhoto } from '../components/AuthPhoto.js';
import { PlanMap } from '../components/PlanMap.js';
import '../customer/errand.css';
import { useT } from '../i18n/index.js';
import { directionsForRoute, plansDiffer, roundTripM, stopsForMap } from '../lib/errand.js';
import { formatDistance } from '../lib/format.js';
import { formatRupees } from '../lib/money.js';
import { orderForShop, type SeekerOrder } from '../lib/orders.js';
import type { PhotoApi } from '../lib/photoApi.js';
import type { PickupApi } from '../lib/pickupApi.js';
import type { ErrandPlan, PlanItem, PlanKind, SeekerApi } from '../lib/seekerApi.js';
import { Button, LinkButton } from '../ui/Button.js';
import { ErrandOrder } from './ErrandOrder.js';
import { Icon } from '../ui/Icon.js';
import { SegmentedControl } from '../ui/SegmentedControl.js';

type OrderApi = Pick<SeekerApi, 'placeOrder' | 'cancelOrder' | 'savedAddress' | 'receiveOrder'>;

interface Props {
  plan: ErrandPlan;
  /** Shows the shops' photos on the cards. Without it, no photos. */
  photos?: PhotoApi;
  origin: { lat: number; lng: number };
  busy?: boolean;
  /** The customer switched a shop between pickup and delivery. */
  onMode?: (shopId: string, mode: 'pickup' | 'delivery') => void;
  /** Nothing was found: a new errand with the same task and place. */
  onAskAgain?: () => void;
  /** Delivery orders from this plan's shops (ADR-0031). Without `orderApi` there is no ordering. */
  orderApi?: OrderApi;
  errandId?: string;
  /** "Start route" notes the pickup shops so the home screen can ask "Got it?" (ADR-0035). */
  pickupApi?: Pick<PickupApi, 'recordPickup'>;
  orders?: SeekerOrder[];
  onOrderChange?: () => void;
}

interface Ordering {
  api: OrderApi;
  errandId: string;
  orders: SeekerOrder[];
  onChange: () => void;
}

interface Stop {
  n: number;
  shopId: string;
  name: string;
  distanceM: number | null;
  items: PlanItem[];
  /** The delivery the shop offered, if any. */
  offer: NonNullable<PlanItem['delivery']> | null;
  mode: 'pickup' | 'delivery';
}

/** The found items grouped by shop, in route order (shops the route misses come last). */
function stopsOf(items: PlanItem[], order: { shopId: string; label: string }[]): Stop[] {
  const byShop = new Map<string, PlanItem[]>();
  for (const item of items) {
    if (!item.shopId) continue;
    byShop.set(item.shopId, [...(byShop.get(item.shopId) ?? []), item]);
  }
  const ids = [...new Set([...order.map((s) => s.shopId), ...byShop.keys()])].filter((id) =>
    byShop.has(id),
  );
  return ids.map((shopId, i) => {
    const list = byShop.get(shopId) ?? [];
    const first = list[0] as PlanItem;
    return {
      n: i + 1,
      shopId,
      name: first.shopName ?? order.find((s) => s.shopId === shopId)?.label ?? '',
      distanceM: first.distanceM,
      items: list,
      offer: list.find((item) => item.delivery)?.delivery ?? null,
      mode: list.some((item) => item.mode === 'delivery') ? 'delivery' : 'pickup',
    };
  });
}

/** One plan at a time, the suggested one first: tiles, the route on a map, then numbered stops. */
export function ErrandResult({
  plan,
  photos,
  origin,
  busy = false,
  onAskAgain,
  onMode,
  orderApi,
  errandId,
  pickupApi,
  orders = [],
  onOrderChange,
}: Props) {
  const { t } = useT();
  const c = t.c;
  const [kind, setKind] = useState<PlanKind>(plan.recommended);
  // Two plans with the same shops and total are one plan: nothing to switch to.
  const differ = plansDiffer(plan.plans.sasta, plan.plans.kam_dukaan);
  const shownKind = differ ? kind : plan.recommended;
  const variant = plan.plans[shownKind];
  const orderedStops = variant.route?.orderedStops ?? [];
  const mapStops = useMemo(() => stopsForMap(orderedStops), [orderedStops]);
  const link = directionsForRoute(origin, orderedStops);
  const found = variant.items.filter((item) => item.status !== 'not_found');
  const missing = variant.items.filter((item) => item.status === 'not_found');
  const stops = useMemo(() => stopsOf(found, orderedStops), [found, orderedStops]);
  const roundTrip = roundTripM(origin, variant.route);
  const total = variant.grandTotalPaise ?? variant.totalPricePaise;
  const unknownPrices = variant.unknownPriceCount ?? 0;
  const unknownFees = variant.unknownFeeCount ?? 0;
  const ordering: Ordering | undefined =
    orderApi && errandId && onOrderChange
      ? { api: orderApi, errandId, orders, onChange: onOrderChange }
      : undefined;

  /** Each pickup shop and item of this plan, once. Delivery shops and items nobody found are not. */
  function notePickups() {
    if (!pickupApi || !errandId) return;
    const seen = new Set<string>();
    for (const item of found) {
      if (!item.shopId || !item.itemId || item.mode === 'delivery') continue;
      const key = `${item.shopId}:${item.itemId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      pickupApi
        .recordPickup({ shopId: item.shopId, itemId: item.itemId, errandId })
        .catch(() => undefined);
    }
  }

  const { extraPaise, stopsSaved, reason } = plan.recommendation;
  let why: string | null = null;
  if (differ && shownKind === plan.recommended && reason !== 'no_stops_saved')
    why =
      shownKind === 'kam_dukaan'
        ? c.planWhyFewest(extraPaise > 0 ? formatRupees(extraPaise) : null, stopsSaved)
        : c.planWhyCheapest(formatRupees(extraPaise), stopsSaved);

  return (
    <section className="cu-stack" aria-label={c.planTitle}>
      {found.length === 0 ? (
        <p className="cu-surface sh-body" role="status">
          {c.planNothingYet}
        </p>
      ) : (
        <>
          <section aria-label={c.planTilesLabel}>
            <dl className="cu-errand-tiles">
              <div className="cu-errand-tile">
                <dt>{c.tileShops}</dt>
                <dd>{variant.shopCount}</dd>
              </div>
              <div className="cu-errand-tile">
                <dt>{roundTrip === null ? c.tileStops : c.tileRoundTrip}</dt>
                <dd>{roundTrip === null ? stops.length : formatDistance(roundTrip)}</dd>
              </div>
              <div className="cu-errand-tile">
                <dt>{c.tileTotal}</dt>
                <dd>{formatRupees(total)}</dd>
                {unknownPrices > 0 && (
                  <dd className="cu-errand-tile__note">{c.tileUnknownPrices(unknownPrices)}</dd>
                )}
                {unknownFees > 0 && (
                  <dd className="cu-errand-tile__note">{c.tileUnknownFees(unknownFees)}</dd>
                )}
              </div>
            </dl>
          </section>

          <div className="cu-errand-ai">
            <Icon name="robot" size={20} />
            <p>{c.planAiNote}</p>
          </div>

          {differ && (
            <div className="cu-section">
              <div className="cu-section__head">
                <span className="cu-pill">
                  {shownKind === 'kam_dukaan' ? c.planFewest : c.planCheapest}
                  {shownKind === plan.recommended && ` · ${c.planSuggested}`}
                </span>
                <Button
                  variant="quiet"
                  onClick={() => setKind(shownKind === 'kam_dukaan' ? 'sasta' : 'kam_dukaan')}
                >
                  {shownKind === plan.recommended ? c.planSeeOther : c.planSeeSuggested}
                </Button>
              </div>
              {why && <p className="cu-errand-why">{why}</p>}
            </div>
          )}
          {missing.length > 0 && (
            <p className="cu-errand-why">{c.planFound(found.length, variant.items.length)}</p>
          )}

          {mapStops.length > 0 && (
            <>
              <PlanMap
                origin={origin}
                stops={mapStops}
                label={c.planMapLabel}
                youAreHere={c.planYouAreHere}
              />
              {link && (
                <LinkButton
                  variant="primary"
                  className="sh-btn--block"
                  href={link}
                  external
                  onClick={notePickups}
                >
                  {c.planStartRoute}
                </LinkButton>
              )}
            </>
          )}

          <ol className="cu-errand-stops" aria-label={c.planStopsLabel}>
            {stops.map((stop) => (
              <StopCard
                key={stop.shopId}
                stop={stop}
                photos={photos}
                busy={busy}
                onMode={onMode}
                ordering={ordering}
              />
            ))}
          </ol>
        </>
      )}

      {missing.length > 0 && (
        <div className="cu-section">
          <h3 className="sh-caption cu-errand-group-title">{c.planNotFound}</h3>
          <ul className="cu-list cu-errand-missing" aria-label={c.planNotFound}>
            {missing.map((item, i) => (
              <MissingRow key={`${item.text}-${i}`} item={item} />
            ))}
          </ul>
        </div>
      )}

      {found.length === 0 &&
        onAskAgain &&
        // Asking again cannot help when every missing item was refused for good (blocked, or over
        // the limit): it would only be refused again.
        missing.some((item) => !item.refused || item.refused === 'unavailable') && (
          <Button variant="primary" disabled={busy} onClick={onAskAgain}>
            {c.planAskAgain}
          </Button>
        )}
    </section>
  );
}

function StopCard({
  stop,
  photos,
  busy,
  onMode,
  ordering,
}: {
  stop: Stop;
  photos: PhotoApi | undefined;
  busy: boolean;
  onMode: Props['onMode'];
  ordering: Ordering | undefined;
}) {
  const { t } = useT();
  const c = t.c;
  const fee =
    stop.offer && stop.offer.feePaise !== null && stop.offer.feePaise > 0
      ? formatRupees(stop.offer.feePaise)
      : null;
  const order = ordering ? orderForShop(ordering.orders, stop.shopId) : undefined;
  return (
    <li className="cu-errand-stop-card" aria-label={c.planStop(stop.n, stop.name)}>
      <span className="cu-errand-num" aria-hidden="true">
        {stop.n}
      </span>
      <div className="cu-errand-stop-card__body">
        <h3 className="sh-heading cu-errand-stop-card__name">{stop.name}</h3>
        <p className="cu-errand-stop-card__meta">
          {stop.distanceM !== null && <span>{formatDistance(stop.distanceM)}</span>}{' '}
          <span>{stop.mode === 'delivery' ? c.stopDelivers(fee) : c.stopPickup}</span>
        </p>
        <ul className="cu-errand-lines">
          {stop.items.map((item, i) => (
            <ItemLine key={`${item.text}-${i}`} item={item} photos={photos} />
          ))}
        </ul>
        {onMode && stop.offer && (
          <SegmentedControl
            label={c.stopChoiceLabel(stop.name)}
            value={stop.mode}
            options={[
              { value: 'pickup', label: c.stopChoosePickup },
              { value: 'delivery', label: c.stopChooseDelivery },
            ]}
            onChange={(mode) => {
              if (!busy && mode !== stop.mode) onMode(stop.shopId, mode);
            }}
          />
        )}
        {ordering && stop.offer && (stop.mode === 'delivery' || order) && (
          // The customer chose delivery from this shop, or already has an order with it (which may
          // have been declined, and so put the shop back on pickup: the message must stay).
          <ErrandOrder
            api={ordering.api}
            shop={{ id: stop.shopId, name: stop.name }}
            errandId={ordering.errandId}
            offer={stop.offer}
            order={order}
            onChange={ordering.onChange}
          />
        )}
      </div>
    </li>
  );
}

function ItemLine({ item, photos }: { item: PlanItem; photos: PhotoApi | undefined }) {
  const { t } = useT();
  const c = t.c;
  const name = item.itemName ?? item.text;
  const said = name.toLowerCase() !== item.text.toLowerCase();
  const tags = [
    item.isNew && t.newItemTag,
    item.status === 'likely' && c.itemEarlierAnswer,
    item.customerVerified && t.verifiedByCustomer,
  ].filter(Boolean);
  const amount = item.offeredQuantity ? formatQuantity(item.offeredQuantity) : null;
  const quantityLine = !amount
    ? null
    : item.status === 'likely'
      ? t.qtyLast(amount)
      : item.quantityCheck === 'short'
        ? `${t.qtyShort(amount)} · ${t.qtyNotEnough}`
        : t.qtyHas(amount);
  return (
    <li className="cu-errand-line">
      <div className="cu-errand-line__top">
        <h4 className="cu-errand-line__name">
          {name}
          {item.quantity > 1 && <span className="sh-muted"> {c.itemQty(item.quantity)}</span>}
        </h4>
        <p
          className={`cu-errand-line__price${item.pricePaise === null ? ' cu-errand-line__price--unknown' : ''}`}
        >
          {item.pricePaise === null ? c.itemPriceUnknown : formatRupees(item.pricePaise)}
        </p>
      </div>
      {said && <p>{item.text}</p>}
      {item.freshness && <p>{item.freshness}</p>}
      {item.quantityHint && <p>{item.quantityHint === 'few' ? t.few : t.plenty}</p>}
      {tags.length > 0 && (
        <p className="cu-errand-line__tags">
          {tags.map((tag) => (
            <span key={String(tag)} className="cu-pill cu-pill--muted">
              {tag}
            </span>
          ))}
        </p>
      )}
      {quantityLine && <p>{quantityLine}</p>}
      {item.matchedAs && item.itemName && (
        <p>{t.errandMatched(item.text, item.itemName, item.status === 'confirmed')}</p>
      )}
      {photos && item.photoId && <AuthPhoto api={photos} id={item.photoId} alt={c.itemPhotoAlt} />}
    </li>
  );
}

/** An item nobody has: the group it sits in says so; no shop or price. */
function MissingRow({ item }: { item: PlanItem }) {
  const { t } = useT();
  const name = item.itemName ?? item.text;
  return (
    <li className="cu-surface">
      <h4 className="sh-body cu-errand-line__name">{name}</h4>
      {name.toLowerCase() !== item.text.toLowerCase() && (
        <p className="cu-errand-small">{item.text}</p>
      )}
      {item.refused === 'blocked' && <p className="cu-errand-small">{t.errandBlocked}</p>}
      {item.refused === 'unavailable' && <p className="cu-errand-small">{t.errItemUnavailable}</p>}
      {item.refused === 'limit' && <p className="cu-errand-small">{t.errNewItemLimit('errand')}</p>}
    </li>
  );
}
