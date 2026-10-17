import { useMemo, useState } from 'react';
import { PlanMap } from '../components/PlanMap.js';
import { useT } from '../i18n/index.js';
import { directionsForRoute, stopsForMap } from '../lib/errand.js';
import { formatDistance } from '../lib/format.js';
import { formatRupees } from '../lib/money.js';
import type { ErrandPlan, PlanItem, PlanKind } from '../lib/seekerApi.js';

interface Props {
  plan: ErrandPlan;
  origin: { lat: number; lng: number };
}

const TABS: PlanKind[] = ['kam_dukaan', 'sasta'];

/** Two plans in two tabs, the recommended one open: items, totals, and the route on a map. */
export function ErrandResult({ plan, origin }: Props) {
  const { t } = useT();
  const [kind, setKind] = useState<PlanKind>(plan.recommended);
  const variant = plan.plans[kind];
  const stops = useMemo(() => stopsForMap(variant.route?.orderedStops ?? []), [variant]);
  const link = directionsForRoute(origin, variant.route?.orderedStops ?? []);

  const { extraPaise, stopsSaved, reason } = plan.recommendation;
  const extra = extraPaise > 0 ? formatRupees(extraPaise) : null;
  let why: string;
  if (reason === 'no_stops_saved') why = t.reasonSame;
  else if (plan.recommended === 'kam_dukaan') why = t.reasonKam(extra, stopsSaved);
  else why = t.reasonSasta(extra ?? formatRupees(0), stopsSaved);

  return (
    <section className="stack" aria-label={t.errandStates.PLAN_READY}>
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

      <div role="tabpanel" id="plan-panel" aria-labelledby={`plan-tab-${kind}`} className="stack">
        <ul className="result-list">
          {variant.items.map((item, i) => (
            <PlanRow key={`${item.text}-${i}`} item={item} />
          ))}
        </ul>
      </div>

      <div className="totals" role="group" aria-label={t.errandTotals}>
        <dl>
          <div>
            <dt>{t.errandTotal}</dt>
            <dd>{formatRupees(variant.totalPricePaise)}</dd>
          </div>
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
      </div>

      {stops.length > 0 && (
        <>
          <PlanMap
            origin={origin}
            stops={stops}
            label={t.errandMapLabel}
            youAreHere={t.youAreHere}
          />
          {link && (
            <a className="btn btn-yes" href={link} target="_blank" rel="noopener noreferrer">
              {t.errandRoute}
            </a>
          )}
        </>
      )}
      {plan.notes && <p className="note">{plan.notes}</p>}
    </section>
  );
}

function PlanRow({ item }: { item: PlanItem }) {
  const { t } = useT();
  const found = item.status !== 'not_found';
  const name = item.itemName ?? item.text;
  return (
    <li className={`plan-item plan-item-${item.status}`}>
      <h3 className="plan-item-name">{name}</h3>
      {name.toLowerCase() !== item.text.toLowerCase() && <p className="meta">{item.text}</p>}
      <p>
        {item.status === 'confirmed' && (
          <span className="status-badge ok">{t.errandConfirmed}</span>
        )}
        {item.status === 'likely' && <span className="status-badge warn">{t.errandLikely}</span>}
        {item.status === 'not_found' && (
          <span className="status-badge none">{t.errandNotFound}</span>
        )}
      </p>
      {found && (
        <>
          <p className="meta">
            {item.shopName}
            {item.distanceM !== null && ` · ${formatDistance(item.distanceM)}`}
          </p>
          <p className="price">
            {item.pricePaise === null ? t.noPrice : formatRupees(item.pricePaise)}
            {item.quantity > 1 && <span className="qty"> × {item.quantity}</span>}
          </p>
          {item.freshness && <p className="meta">{item.freshness}</p>}
          {item.matchedAs && item.itemName && (
            <p className="note">
              {t.errandMatched(item.text, item.itemName, item.status === 'confirmed')}
            </p>
          )}
        </>
      )}
    </li>
  );
}
