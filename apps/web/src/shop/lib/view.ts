import { useEffect, useState } from 'react';

/** The places the shop can go. Hash routes under /app/shop, so Back works and no router is needed. */
export const VIEWS = [
  'requests',
  'orders',
  'insights',
  'delivery',
  'notifications',
  'settings',
] as const;
export type ShopView = (typeof VIEWS)[number];

export const hrefFor = (view: ShopView): string => `#/${view}`;

export function viewFromHash(hash: string): ShopView {
  const name = /^#\/([a-z]+)/.exec(hash)?.[1];
  return VIEWS.find((view) => view === name) ?? 'requests';
}

/** The current view, following the address bar. */
export function useView(): ShopView {
  const [view, setView] = useState<ShopView>(() => viewFromHash(location.hash));
  useEffect(() => {
    const onChange = () => setView(viewFromHash(location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return view;
}
