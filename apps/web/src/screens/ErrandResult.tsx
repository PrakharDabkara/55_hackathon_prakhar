import { useMemo, useState } from 'react';
import { PlanMap } from '../components/PlanMap.js';
import { useT } from '../i18n/index.js';
import { directionsForRoute, plansIdentical, stopsForMap } from '../lib/errand.js';
import { formatDistance } from '../lib/format.js';
import { formatRupees } from '../lib/money.js';
import type { ErrandPlan, PlanItem, PlanKind } from '../lib/seekerApi.js';

interface Props {
  plan: ErrandPlan;
  origin: { lat: number; lng: number };
  busy?: boolean;
  /** Nothing was found: a new errand with the same task and place. */
  onAskAgain?: () => void;
}

const TABS: PlanKind[] = ['kam_dukaan', 'sasta'];

/** Two plans in two tabs, the recommended one open: items, totals, and the route on a map. */
export function ErrandResult({ plan, origin, busy = false, onAskAgain }: Props) {
  const { t } = useT();
  const [kind, setKind] = useState<PlanKind>(plan.recommended);
  // Two plans that are the same thing are shown once: no tabs, nothing "recommended".
  const single = plansIdentical(plan.plans.kam_dukaan, plan.plans.sasta);
  const variant = plan.plans[single ? plan.recommended : kind];
  const stops = useMemo(() => stopsForMap(variant.route?.orderedStops ?? []), [variant]);
  const link = directionsForRoute(origin, variant.route?.orderedStops ?? []);
  const found = variant.items.filter((item) => item.status !== 'not_found');
  const missing = variant.items.filter((item) => item.status === 'not_found');

  const { extraPaise, stopsSaved, reason } = plan.recommendation;
  const extra = extraPaise > 0 ? formatRupees(extraPaise) : null;
  let why: string;
  if (reason === 'no_stops_saved') why = t.reasonSame;
  else if (plan.recommended === 'kam_dukaan') why = t.reasonKam(extra, stopsSaved);
  else why = t.reasonSasta(extra ?? formatRupees(0), stopsSaved);

  const rows = (items: PlanItem[]) =>
    items.map((item, i) => <PlanRow key={`${item.text}-${i}`} item={item} />);

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

      {found.length === 0 && (
        <p className="nothing-yet" role="status">
          {t.errandNothingYet}
        </p>
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
        onAskAgain && (
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
  const name = item.itemName ?? item.text;
  const label = name.toLowerCase() !== item.text.toLowerCase() && (
    <p className="meta">{item.text}</p>
  );
  // Not found: the group it sits in says so; no badge, shop or price.
  if (item.status === 'not_found')
    return (
      <li className="plan-item plan-item-not_found">
        <h3 className="plan-item-name">{name}</h3>
        {label}
      </li>
    );
  return (
    <li className={`plan-item plan-item-${item.status}`}>
      <h3 className="plan-item-name">{name}</h3>
      {label}
      <p>
        {item.status === 'confirmed' ? (
          <span className="status-badge ok">{t.errandConfirmed}</span>
        ) : (
          <span className="status-badge warn">{t.errandLikely}</span>
        )}
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
      {item.matchedAs && item.itemName && (
        <p className="note">
          {t.errandMatched(item.text, item.itemName, item.status === 'confirmed')}
        </p>
      )}
    </li>
  );
}
