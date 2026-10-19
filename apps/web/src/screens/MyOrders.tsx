import { useCallback, useEffect, useRef, useState } from 'react';
import { useT } from '../i18n/index.js';
import type { LiveOptions } from '../lib/live.js';
import { formatRupees } from '../lib/money.js';
import { activeFirst, lineName, orderTotalPaise, type SeekerOrder } from '../lib/orders.js';
import { orderStatusText } from '../lib/orderText.js';
import type { SeekerApi } from '../lib/seekerApi.js';
import { useLive } from '../lib/useLive.js';
import { appLink } from './Home.js';

interface Props {
  api: Pick<SeekerApi, 'myOrders' | 'savedAddress' | 'forgetAddress' | 'eventTicket'>;
  /** Opens one order at its own address. */
  onOpen: (id: string) => void;
  onBack: () => void;
  pollMs?: number;
  live?: Pick<LiveOptions, 'createSource' | 'retryMs'>;
}

/**
 * "Mere orders": every order of the customer, the ones still moving first (ADR-0033). Each row
 * opens its own page. Below, the address the customer chose to keep, which they can delete.
 */
export function MyOrders({ api, onOpen, onBack, pollMs = 15_000, live }: Props) {
  const { t, lang } = useT();
  const [orders, setOrders] = useState<SeekerOrder[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const alive = useRef(true);

  const refresh = useCallback(() => {
    api.myOrders().then(
      (next) => {
        if (!alive.current) return;
        setOrders(activeFirst(next));
        setFailed(false);
      },
      () => alive.current && setFailed(true),
    );
  }, [api]);

  useEffect(() => {
    alive.current = true;
    refresh();
    api.savedAddress().then(
      (found) => alive.current && setSaved(found.addressText),
      () => undefined,
    );
    return () => {
      alive.current = false;
    };
  }, [api, refresh]);

  const getTicket = useCallback(() => api.eventTicket(), [api]);
  useLive({ getTicket, refresh, pollMs, live });

  async function forget() {
    try {
      await api.forgetAddress();
      if (alive.current) setSaved(null);
    } catch {
      // Still kept; the button stays so the customer can try again.
    }
  }

  return (
    <section className="stack" aria-label={t.myOrdersEntry}>
      <button type="button" className="btn btn-quiet" onClick={onBack}>
        {t.homeBack}
      </button>
      <h1 className="screen-title">{t.myOrdersEntry}</h1>

      {failed && orders === null && (
        <p className="alert" role="alert">
          {t.myOrdersError}
        </p>
      )}
      {orders?.length === 0 && <p className="empty">{t.myOrdersEmpty}</p>}
      {orders && orders.length > 0 && (
        <ul className="plain-list">
          {orders.map((order) => {
            const total = orderTotalPaise(order);
            return (
              <li key={order.id}>
                <a
                  className="order-row"
                  {...appLink(() => onOpen(order.id), `/app/order/${order.id}`)}
                >
                  <strong>{order.shopName}</strong>
                  <span className="meta">
                    {order.lines
                      .map((line) => `${line.count} × ${lineName(line, lang)}`)
                      .join(', ')}
                  </span>
                  <span className="meta">
                    {total === null ? t.orderTotalUnknown : t.orderTotal(formatRupees(total))}
                  </span>
                  <span className={`order-state order-${order.state}`}>
                    {orderStatusText(t, order.state)}
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
      )}

      {saved && (
        <section className="saved-address" aria-label={t.savedAddressTitle}>
          <h2 className="section-title">{t.savedAddressTitle}</h2>
          <p className="order-address">{saved}</p>
          <button type="button" className="btn btn-quiet" onClick={() => void forget()}>
            {t.savedAddressForget}
          </button>
        </section>
      )}
    </section>
  );
}
