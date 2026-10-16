import { useCallback, useEffect, useState } from 'react';
import { LangToggle } from './components/LangToggle.js';
import { useT } from './i18n/index.js';
import type { Session } from './lib/session.js';
import type { SeekerApi, SeekerRequest } from './lib/seekerApi.js';
import { Login } from './screens/Login.js';
import { Results } from './screens/Results.js';
import { Search } from './screens/Search.js';

/** The API client fires this when the server says the login is no longer valid. */
export const SEEKER_UNAUTHORIZED_EVENT = 'km-seeker-unauthorized';

interface Props {
  api: SeekerApi;
  session: Session;
}

type Screen =
  | { name: 'login' }
  | { name: 'search' }
  | { name: 'results'; request: SeekerRequest; origin: { lat: number; lng: number } };

/** Login → search → results. "Ho gaya" returns to search. */
export function SeekerApp({ api, session }: Props) {
  const { t } = useT();
  const [screen, setScreen] = useState<Screen>(() =>
    session.getToken() ? { name: 'search' } : { name: 'login' },
  );

  const logout = useCallback(() => {
    session.clear();
    setScreen({ name: 'login' });
  }, [session]);

  useEffect(() => {
    window.addEventListener(SEEKER_UNAUTHORIZED_EVENT, logout);
    return () => window.removeEventListener(SEEKER_UNAUTHORIZED_EVENT, logout);
  }, [logout]);

  return (
    <div className="app">
      <header className="app-header">
        <span className="brand">{t.appName}</span>
        <LangToggle />
      </header>
      <main className="screen">
        {screen.name === 'login' && (
          <Login
            api={api}
            onLoggedIn={(token) => {
              session.setToken(token);
              setScreen({ name: 'search' });
            }}
          />
        )}
        {screen.name === 'search' && (
          <Search
            api={api}
            onFound={(request, origin) => setScreen({ name: 'results', request, origin })}
          />
        )}
        {screen.name === 'results' && (
          <Results
            key={screen.request.id}
            api={api}
            initial={screen.request}
            origin={screen.origin}
            onDone={() => setScreen({ name: 'search' })}
          />
        )}
        {screen.name !== 'results' && (
          <div className="screen-links">
            <a className="btn btn-quiet" href="/app/shop">
              {t.forShopkeepers}
            </a>
          </div>
        )}
      </main>
    </div>
  );
}
