import { useRef } from 'react';
import { BRAND_NAME } from '../../brand.js';
import { useT } from '../../i18n/index.js';
import { hrefFor, VIEWS, type ShopView } from '../lib/view.js';
import { Icon, type IconName } from '../../ui/Icon.js';
import { LangSwitch } from './LangSwitch.js';
import { ShopLogo } from './ShopLogo.js';
import { useFocusTrap } from '../../ui/useFocusTrap.js';

interface Props {
  open: boolean;
  onClose: () => void;
  onLogout: () => void;
  shop: { name: string; logoUrl: string | null; open: boolean };
  view: ShopView;
  /** Requests waiting for an answer. */
  pendingCount: number;
  /** Orders not finished yet. */
  activeOrders: number;
}

const ICONS: Record<ShopView, IconName> = {
  requests: 'requests',
  orders: 'orders',
  insights: 'insights',
  delivery: 'delivery',
  notifications: 'bell',
  settings: 'settings',
};

/** The drawer from the left: places to go, log out, and who made the app. */
export function Sidebar({ open, ...rest }: Props) {
  return open ? <Drawer {...rest} /> : null;
}

function Drawer({
  onClose,
  onLogout,
  shop,
  view,
  pendingCount,
  activeOrders,
}: Omit<Props, 'open'>) {
  const { t } = useT();
  const ref = useRef<HTMLElement>(null);
  useFocusTrap(ref, onClose);

  const label: Record<ShopView, string> = {
    requests: t.shop.navRequests,
    orders: t.shop.navOrders,
    insights: t.shop.navInsights,
    delivery: t.shop.navDelivery,
    notifications: t.shop.navNotifications,
    settings: t.shop.navSettings,
  };

  return (
    <div className="sh-drawer-layer">
      <div className="sh-scrim" data-testid="scrim" onClick={onClose} aria-hidden="true" />
      <aside
        ref={ref}
        className="sh-drawer"
        role="dialog"
        aria-modal="true"
        aria-label={t.shop.mainMenu}
        tabIndex={-1}
      >
        <div className="sh-drawer__who">
          <ShopLogo name={shop.name} logoUrl={shop.logoUrl} size={52} />
          <div className="sh-drawer__text">
            <p className="sh-drawer__name">{shop.name}</p>
            <p className="sh-drawer__state">{shop.open ? t.shop.openNow : t.shop.closedNow}</p>
          </div>
        </div>
        <nav className="sh-drawer__nav">
          {VIEWS.map((v) => (
            <a
              key={v}
              href={hrefFor(v)}
              className="sh-navlink"
              {...(v === view && { 'aria-current': 'page' as const })}
              onClick={onClose}
            >
              <Icon name={ICONS[v]} />
              <span className="sh-navlink__label">{label[v]}</span>
              {v === 'requests' && pendingCount > 0 && (
                <span className="sh-badge">{pendingCount}</span>
              )}
              {v === 'orders' && activeOrders > 0 && (
                <span className="sh-navlink__note">{t.shop.activeCount(activeOrders)}</span>
              )}
            </a>
          ))}
        </nav>
        <div className="sh-drawer__lang">
          <LangSwitch />
        </div>
        <button type="button" className="sh-navlink sh-navlink--button" onClick={onLogout}>
          <Icon name="logout" />
          <span className="sh-navlink__label">{t.shop.logout}</span>
        </button>
        <p className="sh-drawer__foot">{`${t.shop.poweredBy} ${BRAND_NAME}`}</p>
      </aside>
    </div>
  );
}
