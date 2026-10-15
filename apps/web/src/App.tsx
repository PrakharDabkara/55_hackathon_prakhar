import { useCallback, useEffect, useState } from 'react';
import { LangToggle } from './components/LangToggle.js';
import { useT } from './i18n/index.js';
import { ApiError, type ShopApi } from './lib/api.js';
import type { Session } from './lib/session.js';
import { Login } from './screens/Login.js';
import { Onboarding } from './screens/Onboarding.js';
import { PingHome } from './screens/PingHome.js';

/** The API client fires this when the server says the login is no longer valid. */
export const UNAUTHORIZED_EVENT = 'km-unauthorized';

type Phase = 'login' | 'loading' | 'onboarding' | 'home' | 'not-shop' | 'failed';

interface Props {
  api: ShopApi;
  session: Session;
}

/** Login → (onboarding, once) → the ping card. Nothing else exists after onboarding. */
export function App({ api, session }: Props) {
  const { t } = useT();
  const [phase, setPhase] = useState<Phase>(session.getToken() ? 'loading' : 'login');

  const logout = useCallback(() => {
    session.clear();
    setPhase('login');
  }, [session]);

  const loadShop = useCallback(async () => {
    setPhase('loading');
    try {
      setPhase((await api.getMyShop()) ? 'home' : 'onboarding');
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) logout();
      else if (error instanceof ApiError && error.status === 403) setPhase('not-shop');
      else setPhase('failed');
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
    <div className="app">
      <header className="app-header">
        <span className="brand">{t.appName}</span>
        <LangToggle />
      </header>
      <main className="screen">
        {phase === 'login' && (
          <Login
            api={api}
            onLoggedIn={(token) => {
              session.setToken(token);
              void loadShop();
            }}
          />
        )}
        {phase === 'loading' && <p className="empty">{t.loading}</p>}
        {phase === 'onboarding' && <Onboarding api={api} onDone={() => setPhase('home')} />}
        {phase === 'home' && <PingHome api={api} />}
        {phase === 'not-shop' && (
          <div className="stack">
            <p className="alert" role="alert">
              {t.errNotShop}
            </p>
            <button type="button" className="btn btn-quiet" onClick={logout}>
              {t.otherNumber}
            </button>
          </div>
        )}
        {phase === 'failed' && (
          <div className="stack">
            <p className="alert" role="alert">
              {t.errGeneric}
            </p>
            <button type="button" className="btn btn-quiet" onClick={() => void loadShop()}>
              {t.send}
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
