import { useEffect, useState, type MouseEvent } from 'react';
import { useT } from '../i18n/index.js';
import { isActiveOrder } from '../lib/orders.js';
import type { RecentItem, SeekerApi, SeekerRequest } from '../lib/seekerApi.js';
import { Search } from './Search.js';

interface Props {
  api: SeekerApi;
  onFound: (request: SeekerRequest, origin: { lat: number; lng: number }) => void;
  /** Goes to another address of the customer app without a page load. */
  navigate: (path: string) => void;
}

/** A link that opens inside the app on a plain tap, and lets the browser handle ctrl/middle-click. */
export function appLink(navigate: (path: string) => void, path: string) {
  return {
    href: path,
    onClick(event: MouseEvent<HTMLAnchorElement>) {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
      event.preventDefault();
      navigate(path);
    },
  };
}

/**
 * Where a signed-in customer lands: the search, the whole-errand entry, "Mere orders" with a badge
 * for the orders still moving, and "Haal ke kaam", the last searches and errands. The two extras
 * are best effort: if they cannot be fetched the search still works.
 */
export function Home({ api, onFound, navigate }: Props) {
  const { t } = useT();
  const [active, setActive] = useState(0);
  const [recent, setRecent] = useState<RecentItem[]>([]);

  useEffect(() => {
    let alive = true;
    api.myOrders().then(
      (orders) => alive && setActive(orders.filter(isActiveOrder).length),
      () => undefined,
    );
    api.recentWork().then(
      (items) => alive && setRecent(items),
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [api]);

  return (
    <>
      <Search api={api} onFound={onFound} />
      <a className="btn btn-no errand-entry" {...appLink(navigate, '/app/errand')}>
        {t.errandEntry}
      </a>
      <a className="btn btn-quiet errand-entry" {...appLink(navigate, '/app/orders')}>
        {t.myOrdersEntry}
        {active > 0 && (
          <span className="count-badge" aria-label={t.ordersActive(active)}>
            {active}
          </span>
        )}
      </a>
      {recent.length > 0 && (
        <section className="recent" aria-labelledby="recent-title">
          <h2 id="recent-title" className="section-title">
            {t.recentTitle}
          </h2>
          <ul className="plain-list">
            {recent.map((item) => (
              <li key={`${item.kind}-${item.id}`}>
                <a
                  className="row-link"
                  {...appLink(
                    navigate,
                    item.kind === 'errand' ? `/app/errand/${item.id}` : `/app/request/${item.id}`,
                  )}
                >
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
