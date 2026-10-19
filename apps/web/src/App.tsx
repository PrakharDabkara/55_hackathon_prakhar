import { useCallback, useEffect, useState } from 'react';
import { useT } from './i18n/index.js';
import { ApiError, type MyShop, type ShopApi } from './lib/api.js';
import type { LiveOptions } from './lib/live.js';
import type { PushClient } from './lib/push.js';
import type { Session } from './lib/session.js';
import { ShopShell } from './shop/ShopShell.js';
import { Login } from './shop/screens/Login.js';
import { Setup } from './shop/screens/Setup.js';
import { Button } from './shop/ui/Button.js';
import { LangSwitch } from './shop/ui/LangSwitch.js';
import { Skeleton } from './shop/ui/Skeleton.js';
import { ToastProvider } from './shop/ui/Toast.js';
import './shop/shopStyles.js';

/** The API client fires this when the server says the login is no longer valid. */
export const UNAUTHORIZED_EVENT = 'km-unauthorized';

type Phase =
  | { name: 'login' }
  | { name: 'loading' }
  | { name: 'setup' }
  | { name: 'home'; shop: MyShop }
  | { name: 'not-shop' }
  | { name: 'failed' };

interface Props {
  api: ShopApi;
  session: Session;
  /** For tests. */
  live?: Pick<LiveOptions, 'createSource' | 'retryMs'>;
  pushClient?: PushClient;
}

/** Login → (set up the shop, once) → the shop screens (ADR-0041). */
export function App({ api, session, live, pushClient }: Props) {
  const { t } = useT();
  const [phase, setPhase] = useState<Phase>(() =>
    session.getToken() ? { name: 'loading' } : { name: 'login' },
  );

  const logout = useCallback(() => {
    session.clear();
    setPhase({ name: 'login' });
  }, [session]);

  const loadShop = useCallback(async () => {
    setPhase({ name: 'loading' });
    try {
      const shop = await api.getMyShop();
      setPhase(shop ? { name: 'home', shop } : { name: 'setup' });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) logout();
      else if (error instanceof ApiError && error.status === 403) setPhase({ name: 'not-shop' });
      else setPhase({ name: 'failed' });
    }
  }, [api, logout]);

  useEffect(() => {
    if (session.getToken()) void loadShop();
    // Only on first load; logging in calls loadShop itself.
  }, []);

  useEffect(() => {
    window.addEventListener(UNAUTHORIZED_EVENT, logout);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, logout);
  }, [logout]);

  return (
    <div className="shop-app">
      <ToastProvider>
        {phase.name === 'home' ? (
          <ShopShell
            api={api}
            shop={phase.shop}
            onLogout={logout}
            {...(live && { live })}
            {...(pushClient && { pushClient })}
          />
        ) : (
          <div className="sh-column">
            <div className="sh-langbar">
              <LangSwitch />
            </div>
            <main className="sh-main sh-main--bare">
              {phase.name === 'login' && (
                <Login
                  api={api}
                  onLoggedIn={(token) => {
                    session.setToken(token);
                    void loadShop();
                  }}
                />
              )}
              {phase.name === 'loading' && (
                <div className="sh-stack" aria-busy="true">
                  <span className="sh-visually-hidden">{t.shop.loading}</span>
                  <Skeleton height="64px" radius="12px" />
                  <Skeleton height="320px" radius="12px" />
                </div>
              )}
              {phase.name === 'setup' && (
                <Setup api={api} onDone={(shop) => setPhase({ name: 'home', shop })} />
              )}
              {phase.name === 'not-shop' && (
                <div className="sh-center">
                  <p className="sh-alert" role="alert">
                    {t.shop.errNotShop}
                  </p>
                  <Button variant="secondary" onClick={logout}>
                    {t.shop.otherNumber}
                  </Button>
                </div>
              )}
              {phase.name === 'failed' && (
                <div className="sh-center">
                  <p className="sh-alert" role="alert">
                    {t.shop.loadFailed}
                  </p>
                  <Button variant="secondary" onClick={() => void loadShop()}>
                    {t.shop.retry}
                  </Button>
                </div>
              )}
            </main>
          </div>
        )}
      </ToastProvider>
    </div>
  );
}
