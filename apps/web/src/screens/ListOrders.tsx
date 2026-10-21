import { useRef, useState } from 'react';
import { appLink } from '../customer/ordersShared.js';
import { useT } from '../i18n/index.js';
import { formatRupees } from '../lib/money.js';
import { lineName, orderTotalPaise, type SeekerOrder } from '../lib/orders.js';
import { orderCaption } from '../lib/orderText.js';
import { directionsUrl } from '../lib/results.js';
import type { SeekerApi } from '../lib/seekerApi.js';
import { Button, LinkButton } from '../ui/Button.js';
import { ShopLogo } from '../ui/ShopLogo.js';
import '../customer/lists.css';

interface Props {
  api: Pick<SeekerApi, 'collectOrder' | 'receiveOrder'>;
  orders: SeekerOrder[];
  navigate: (path: string) => void;
  /** An order changed on the server: fetch the orders again. */
  onChange: () => void;
}

/**
 * The orders of an ordered list, one card per shop: a pickup is packed, then ready to collect
 * ("Got it"); a delivery goes out, then is received. Live: the packed count follows `order.packed`.
 */
export function ListOrders({ api, orders, navigate, onChange }: Props) {
  const { t, lang } = useT();
  const c = t.c;
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const sending = useRef(false);

  async function act(id: string, run: () => Promise<unknown>) {
    if (sending.current) return;
    sending.current = true;
    setBusy(id);
    setFailed(false);
    try {
      await run();
    } catch {
      // It may have moved meanwhile; the refresh shows where it is.
      setFailed(true);
    } finally {
      sending.current = false;
      setBusy(null);
      onChange();
    }
  }

  function caption(order: SeekerOrder): string {
    if (order.fulfilment === 'pickup' && order.state === 'ACCEPTED')
      return c.listPacked(order.packedCount, order.lines.length);
    return orderCaption(c, order.state);
  }

  return (
    <>
      {failed && (
        <p className="sh-alert" role="alert">
          {c.orderActionFailed}
        </p>
      )}
      <ul className="cu-lorders">
        {orders.map((order) => {
          const total = orderTotalPaise(order);
          return (
            <li key={order.id} aria-label={order.shopName} className="cu-lorder">
              <div className="cu-lorder__head">
                <ShopLogo name={order.shopName} logoUrl={order.logoUrl ?? null} size={40} />
                <div className="cu-lorder__who">
                  <p className="sh-heading">{order.shopName}</p>
                  <p>
                    <span className="cu-pill">{caption(order)}</span>
                  </p>
                </div>
              </div>
              <ul className="cu-lorder__lines">
                {order.lines.map((line, i) => (
                  <li key={`${line.name}-${i}`} className="sh-body">
                    {line.count} × {lineName(line, lang)}
                  </li>
                ))}
              </ul>
              {total !== null && <p className="sh-label">{c.orderPayCash(formatRupees(total))}</p>}
              <div className="cu-lorder__actions">
                {order.fulfilment === 'pickup' && order.state === 'READY' && (
                  <>
                    <LinkButton
                      variant="secondary"
                      external
                      href={directionsUrl(order.shopLocation.lat, order.shopLocation.lng)}
                    >
                      {c.directions}
                    </LinkButton>
                    <Button
                      variant="solid"
                      disabled={busy !== null}
                      onClick={() => void act(order.id, () => api.collectOrder(order.id))}
                    >
                      {c.pickupFound}
                    </Button>
                  </>
                )}
                {order.state === 'OUT_FOR_DELIVERY' && (
                  <Button
                    variant="solid"
                    disabled={busy !== null}
                    onClick={() => void act(order.id, () => api.receiveOrder(order.id))}
                  >
                    {c.received}
                  </Button>
                )}
              </div>
              <a
                className="cu-link cu-lorder__open"
                {...appLink(navigate, `/app/order/${order.id}`)}
              >
                {c.trackOrder}
              </a>
            </li>
          );
        })}
      </ul>
    </>
  );
}
