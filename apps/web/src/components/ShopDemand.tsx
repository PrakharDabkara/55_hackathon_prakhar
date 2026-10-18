import { useEffect, useId, useState } from 'react';
import { useT } from '../i18n/index.js';
import type { ShopApi, ShopDemand as Demand } from '../lib/api.js';

/** The numbers stay fresh without a reload, but a shop screen is not a dashboard. */
const REFRESH_MS = 60_000;

function ItemName({ item }: { item: { nameEn: string; nameHi: string } }) {
  return (
    <span className="demand-item">
      <span lang="hi">{item.nameHi}</span> <span className="item-en">{item.nameEn}</span>
    </span>
  );
}

/**
 * "Aaj ki maang": today's questions, what people asked this shop for and did not get, and what the
 * area is asking for once 3 different customers have (ADR-0035). Counts only, never a customer.
 * Best effort: with nothing to show (or no connection) the card is simply absent.
 */
export function ShopDemand({ api }: { api: Pick<ShopApi, 'shopDemand'> }) {
  const { t } = useT();
  const [demand, setDemand] = useState<Demand | null>(null);
  const titleId = useId();
  const askedId = useId();
  const nearbyId = useId();

  useEffect(() => {
    let alive = true;
    const load = () =>
      api.shopDemand().then(
        (next) => alive && setDemand(next),
        () => undefined,
      );
    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [api]);

  if (!demand) return null;
  const stats = [
    { label: t.demandReceived, value: demand.today.received },
    { label: t.demandAnswered, value: demand.today.answered },
    { label: t.demandYes, value: demand.today.yes },
  ];
  return (
    <section className="demand" aria-labelledby={titleId}>
      <h2 id={titleId} className="section-title">
        {t.demandTitle}
      </h2>
      <div className="demand-stats">
        {stats.map(({ label, value }) => (
          <div key={label} className="demand-stat" role="group" aria-label={`${label}: ${value}`}>
            <span className="demand-number">{value}</span>
            <span className="meta">{label}</span>
          </div>
        ))}
      </div>

      <h3 id={askedId} className="demand-heading">
        {t.demandAskedTitle}
      </h3>
      {demand.asked.length === 0 ? (
        <p className="meta">{t.demandAskedNone}</p>
      ) : (
        <ul className="plain-list" aria-labelledby={askedId}>
          {demand.asked.map((row) => (
            <li key={row.item.nameEn} className="demand-row">
              <ItemName item={row.item} />
              <span className="demand-count">{t.demandAskedCount(row.count)}</span>
            </li>
          ))}
        </ul>
      )}

      <h3 id={nearbyId} className="demand-heading">
        {t.demandNearbyTitle}
      </h3>
      {demand.nearby.length === 0 ? (
        <p className="meta">{t.demandNearbyNone}</p>
      ) : (
        <ul className="plain-list" aria-labelledby={nearbyId}>
          {demand.nearby.map((row) => (
            <li key={row.item.nameEn} className="demand-row">
              <ItemName item={row.item} />
              <span className="demand-count">{t.demandNearbyCount(row.customers)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
