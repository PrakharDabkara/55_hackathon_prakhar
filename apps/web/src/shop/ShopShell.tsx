import { useEffect, useRef, useState } from 'react';
import { useT } from '../i18n/index.js';
import type { MyShop, ShopApi } from '../lib/api.js';
import type { LiveOptions } from '../lib/live.js';
import type { PushClient } from '../lib/push.js';
import { useNow } from './lib/hooks.js';
import { useShopData } from './lib/useShopData.js';
import { useView } from './lib/view.js';
import { Delivery } from './screens/Delivery.js';
import { Home } from './screens/Home.js';
import { Insights } from './screens/Insights.js';
import { Notifications } from './screens/Notifications.js';
import { Orders } from './screens/Orders.js';
import { Settings } from './screens/Settings.js';
import { ShopHeader } from './ui/ShopHeader.js';
import { useToast } from './ui/Toast.js';
import { Sidebar } from './ui/Sidebar.js';

interface Props {
  api: ShopApi;
  shop: MyShop;
  onLogout: () => void;
  pollMs?: number;
  /** For tests: a stand-in for EventSource and a short reconnect pause. */
  live?: Pick<LiveOptions, 'createSource' | 'retryMs'>;
  pushClient?: PushClient;
}

/** Everything after login and setup: the header, the menu, and the screen the address asks for. */
export function ShopShell({ api, shop, onLogout, pollMs, live, pushClient }: Props) {
  const { t } = useT();
  const toast = useToast();
  const data = useShopData(api, shop, {
    ...(pollMs && { pollMs }),
    ...(live && { live }),
    onPingGone: () => toast(t.shop.pingGone),
  });
  const now = useNow();
  const view = useView();
  const [menu, setMenu] = useState(false);
  const main = useRef<HTMLElement>(null);
  const first = useRef(true);

  // A new screen starts at the top, with focus on it, so a keyboard or screen reader follows along.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    window.scrollTo?.(0, 0);
    main.current?.focus();
  }, [view]);

  const pending =
    (data.pings?.length ?? 0) + (data.orders ?? []).filter((o) => o.state === 'REQUESTED').length;
  const activeOrders = (data.orders ?? []).filter((o) => !o.final).length;

  return (
    <div className="sh-column">
      <ShopHeader
        name={data.shop.name}
        logoUrl={data.shop.logoUrl}
        open={data.shop.open}
        onMenu={() => setMenu(true)}
        onToggleOpen={data.setOpen}
      />
      <main ref={main} className="sh-main" tabIndex={-1}>
        {data.offline && (
          <p className="sh-banner sh-banner--warn" role="status">
            {t.shop.offline}
          </p>
        )}
        {view === 'requests' && (
          <Home api={api} data={data} now={now} {...(pushClient && { pushClient })} />
        )}
        {view === 'orders' && <Orders api={api} data={data} now={now} />}
        {view === 'insights' && <Insights api={api} />}
        {view === 'delivery' && <Delivery api={api} shop={data.shop} onSaved={data.setShop} />}
        {view === 'notifications' && (
          <Notifications api={api} {...(pushClient && { pushClient })} />
        )}
        {view === 'settings' && <Settings api={api} shop={data.shop} onSaved={data.setShop} />}
      </main>
      <Sidebar
        open={menu}
        onClose={() => setMenu(false)}
        onLogout={onLogout}
        shop={data.shop}
        view={view}
        pendingCount={pending}
        activeOrders={activeOrders}
      />
    </div>
  );
}
