import { useMemo, useState } from 'react';
import { AuthPhoto } from '../components/AuthPhoto.js';
import { DeliveryOrder } from '../components/DeliveryOrder.js';
import { OfferLines } from '../components/OfferLines.js';
import { PlanMap } from '../components/PlanMap.js';
import { useT } from '../i18n/index.js';
import { directionsForRoute, plansIdentical, stopsForMap } from '../lib/errand.js';
import { formatDistance } from '../lib/format.js';
import { formatRupees } from '../lib/money.js';
import { orderForShop, type SeekerOrder } from '../lib/orders.js';
import type { PhotoApi } from '../lib/photoApi.js';
import type { PickupApi } from '../lib/pickupApi.js';
import type { ErrandPlan, PlanItem, PlanKind, SeekerApi } from '../lib/seekerApi.js';

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
  orderApi?: Pick<SeekerApi, 'placeOrder' | 'cancelOrder' | 'savedAddress' | 'receiveOrder'>;
  errandId?: string;
  /** "Raasta kholo" notes the pickup shops so the home screen can ask "Le liya?" (ADR-0035). */
  pickupApi?: Pick<PickupApi, 'recordPickup'>;
  orders?: SeekerOrder[];
  onOrderChange?: () => void;
}

const TABS: PlanKind[] = ['kam_dukaan', 'sasta'];

/** Two plans in two tabs, the recommended one open: items, totals, and the route on a map. */
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
  const [kind, setKind] = useState<PlanKind>(plan.recommended);
  // Two plans that are the same thing are shown once: no tabs, nothing "recommended".
  const single = plansIdentical(plan.plans.kam_dukaan, plan.plans.sasta);
  const variant = plan.plans[single ? plan.recommended : kind];
  const stops = useMemo(() => stopsForMap(variant.route?.orderedStops ?? []), [variant]);
  const link = directionsForRoute(origin, variant.route?.orderedStops ?? []);
  const found = variant.items.filter((item) => item.status !== 'not_found');
  const missing = variant.items.filter((item) => item.status === 'not_found');

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
  const extra = extraPaise > 0 ? formatRupees(extraPaise) : null;
  let why: string;
  if (reason === 'no_stops_saved') why = t.reasonSame;
  else if (plan.recommended === 'kam_dukaan') why = t.reasonKam(extra, stopsSaved);
  else why = t.reasonSasta(extra ?? formatRupees(0), stopsSaved);

  // The pickup / delivery choice is one per shop: it sits on the first item of that shop.
  const rows = (items: PlanItem[]) => {
    const choiceShown = new Set<string>();
    return items.map((item, i) => {
      const first = Boolean(item.shopId && item.delivery && !choiceShown.has(item.shopId));
      if (first && item.shopId) choiceShown.add(item.shopId);
      return (
        <PlanRow
          key={`${item.text}-${i}`}
          item={item}
          photos={photos}
          busy={busy}
          {...(first && onMode && { onMode })}
          {...(first &&
            orderApi &&
            errandId &&
            onOrderChange && {
              ordering: { api: orderApi, errandId, orders, onChange: onOrderChange },
            })}
        />
      );
    });
  };

  return (
    <section className="stack" aria-label={t.errandStates.PLAN_READY}>
      {!single && (
        <>
          <div className="tabs" role="tablist" aria-label={t.errandPickPlan}>
            {TABS.map((k) => (
              <button
                key={k}
                type="button"
                role="tab"
                id={`plan-tab-${k}`}
                aria-selected={kind === k}
                aria-controls="plan-panel"
                className="tab"
                onClick={() => setKind(k)}
              >
                <span>{k === 'kam_dukaan' ? t.errandTabKam : t.errandTabSasta}</span>
                {plan.recommended === k && <span className="badge">{t.errandRecommended}</span>}
              </button>
            ))}
          </div>
          <p className="reason">{why}</p>
        </>
      )}

      {found.length === 0 ? (
        <p className="nothing-yet" role="status">
          {t.errandNothingYet}
        </p>
      ) : (
        // Built from the plan, in this screen's language: never the model's own sentence.
        <div className="summary" role="status" aria-label={t.errandSummaryTitle}>
          <p>
            {t.errandSummary(
              found.length,
              variant.items.length,
              variant.shopCount,
              formatDistance(variant.totalDistanceM),
            )}
          </p>
          {missing.length > 0 && (
            <p>{t.errandNotFoundNames(missing.map((m) => m.itemName ?? m.text).join(', '))}</p>
          )}
          {found.some((item) => item.status === 'likely') && (
            <p>{t.errandNotConfirmed(found.filter((item) => item.status === 'likely').length)}</p>
          )}
        </div>
      )}

      <div
        {...(single
          ? {}
          : { role: 'tabpanel', id: 'plan-panel', 'aria-labelledby': `plan-tab-${kind}` })}
        className="stack"
      >
        {found.length > 0 && (
          <ul className="result-list" aria-label={t.errandFoundTitle}>
            {rows(found)}
          </ul>
        )}
        {missing.length > 0 && (
          <>
            <h3 className="group-title">{t.errandNotFound}</h3>
            <ul className="result-list result-list-missing" aria-label={t.errandNotFound}>
              {rows(missing)}
            </ul>
          </>
        )}
      </div>

      {found.length === 0 ? (
        // Asking again cannot help when every missing item was refused for good (blocked, or over
        // the limit): it would only be refused again.
        onAskAgain &&
        missing.some((item) => !item.refused || item.refused === 'unavailable') && (
          <button type="button" className="btn btn-yes" disabled={busy} onClick={onAskAgain}>
            {t.errandAskAgain}
          </button>
        )
      ) : (
        <div className="totals" role="group" aria-label={t.errandTotals}>
          <dl>
            <div>
              <dt>{t.errandTotal}</dt>
              <dd>{formatRupees(variant.totalPricePaise)}</dd>
            </div>
            {(variant.deliveryShopCount ?? 0) > 0 && (
              <>
                <div>
                  <dt>{t.feeLine}</dt>
                  <dd>{formatRupees(variant.deliveryFeePaise ?? 0)}</dd>
                </div>
                <div>
                  <dt>{t.grandTotal}</dt>
                  <dd>{formatRupees(variant.grandTotalPaise ?? variant.totalPricePaise)}</dd>
                </div>
              </>
            )}
            {variant.savingsPaise > 0 && (
              <div>
                <dt>{t.errandSavings}</dt>
                <dd>{formatRupees(variant.savingsPaise)}</dd>
              </div>
            )}
            <div>
              <dt>{t.errandStops}</dt>
              <dd>{variant.shopCount}</dd>
            </div>
            <div>
              <dt>{t.errandDistance}</dt>
              <dd>{formatDistance(variant.totalDistanceM)}</dd>
            </div>
          </dl>
          {(variant.unknownPriceCount ?? 0) > 0 && (
            <p className="meta">{t.unknownPrices(variant.unknownPriceCount ?? 0)}</p>
          )}
          {(variant.unknownFeeCount ?? 0) > 0 && (
            <p className="meta">{t.unknownFees(variant.unknownFeeCount ?? 0)}</p>
          )}
        </div>
      )}

      {stops.length > 0 && (
        <>
          <PlanMap
            origin={origin}
            stops={stops}
            label={t.errandMapLabel}
            youAreHere={t.youAreHere}
          />
          {link && (
            <a
              className="btn btn-yes"
              href={link}
              target="_blank"
              rel="noopener noreferrer"
              onClick={notePickups}
            >
              {t.errandRoute}
            </a>
          )}
        </>
      )}
    </section>
  );
}

function PlanRow({
  item,
  photos,
  busy,
  onMode,
  ordering,
}: {
  item: PlanItem;
  photos: PhotoApi | undefined;
  busy: boolean;
  onMode?: (shopId: string, mode: 'pickup' | 'delivery') => void;
  /** The order panel, on the first item of a shop that delivers. */
  ordering?: {
    api: Pick<SeekerApi, 'placeOrder' | 'cancelOrder' | 'savedAddress' | 'receiveOrder'>;
    errandId: string;
    orders: SeekerOrder[];
    onChange: () => void;
  };
}) {
  const { t } = useT();
  const name = item.itemName ?? item.text;
  const label = name.toLowerCase() !== item.text.toLowerCase() && (
    <p className="meta">{item.text}</p>
  );
  // Not found: the group it sits in says so; no badge, shop or price. An item that was never sent
  // to shops says why.
  if (item.status === 'not_found')
    return (
      <li className="plan-item plan-item-not_found">
        <h3 className="plan-item-name">{name}</h3>
        {label}
        {item.refused === 'blocked' && <p className="note">{t.errandBlocked}</p>}
        {item.refused === 'unavailable' && <p className="note">{t.errItemUnavailable}</p>}
        {item.refused === 'limit' && <p className="note">{t.errNewItemLimit('errand')}</p>}
      </li>
    );
  return (
    <li className={`plan-item plan-item-${item.status}`}>
      <h3 className="plan-item-name">{name}</h3>
      {label}
      <p>
        {item.isNew && <span className="status-badge">{t.newItemTag}</span>}{' '}
        {item.status === 'confirmed' ? (
          <span className="status-badge ok">{t.errandConfirmed}</span>
        ) : (
          <span className="status-badge warn">{t.errandLikely}</span>
        )}{' '}
        {item.customerVerified && <span className="status-badge ok">{t.verifiedByCustomer}</span>}
      </p>
      <p className="meta">
        {item.shopName}
        {item.distanceM !== null && ` · ${formatDistance(item.distanceM)}`}
      </p>
      <p className="price">
        {item.pricePaise === null ? t.noPrice : formatRupees(item.pricePaise)}
        {item.quantity > 1 && <span className="qty"> × {item.quantity}</span>}
      </p>
      {item.freshness && <p className="meta">{item.freshness}</p>}
      {item.quantityHint && (
        <p className="meta">{item.quantityHint === 'few' ? t.few : t.plenty}</p>
      )}
      <OfferLines
        quantity={item.offeredQuantity}
        check={item.quantityCheck}
        remembered={item.status === 'likely'}
        delivery={item.delivery}
      />
      {onMode && item.shopId && (
        <div className="chips" role="group" aria-label={item.shopName ?? ''}>
          {(['pickup', 'delivery'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              className="chip"
              aria-pressed={(item.mode ?? 'pickup') === mode}
              disabled={busy}
              onClick={() => onMode(item.shopId as string, mode)}
            >
              {mode === 'pickup' ? t.modePickup : t.modeDelivery}
            </button>
          ))}
        </div>
      )}
      {ordering && item.shopId && item.delivery && (
        // The customer chose delivery from this shop, or already has an order with it (which may
        // have been declined, and so put the shop back on pickup: the message must stay).
        <PlanOrder
          ordering={ordering}
          shopId={item.shopId}
          shopName={item.shopName ?? ''}
          delivery={item.delivery}
          chosen={item.mode === 'delivery'}
        />
      )}
      {photos && item.photoId && <AuthPhoto api={photos} id={item.photoId} alt={t.photoShop} />}
      {item.matchedAs && item.itemName && (
        <p className="note">
          {t.errandMatched(item.text, item.itemName, item.status === 'confirmed')}
        </p>
      )}
    </li>
  );
}

function PlanOrder({
  ordering,
  shopId,
  shopName,
  delivery,
  chosen,
}: {
  ordering: NonNullable<Parameters<typeof PlanRow>[0]['ordering']>;
  shopId: string;
  shopName: string;
  delivery: { feePaise: number | null; minutes: number | null };
  chosen: boolean;
}) {
  const order = orderForShop(ordering.orders, shopId);
  if (!chosen && !order) return null;
  return (
    <DeliveryOrder
      api={ordering.api}
      shop={{ id: shopId, name: shopName }}
      source={{ errandId: ordering.errandId }}
      offer={delivery}
      order={order}
      onChange={ordering.onChange}
    />
  );
}
