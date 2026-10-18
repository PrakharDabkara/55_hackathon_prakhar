import { useCallback, useEffect, useState } from 'react';
import { LangToggle } from './components/LangToggle.js';
import { useT } from './i18n/index.js';
import type { Session } from './lib/session.js';
import type { SeekerApi, SeekerRequest } from './lib/seekerApi.js';
import {
  errandIdFromPath,
  isErrandPath,
  isOrdersPath,
  orderIdFromPath,
  requestIdFromPath,
} from './routing.js';
import { Errand } from './screens/Errand.js';
import { Home } from './screens/Home.js';
import { Login } from './screens/Login.js';
import { MyOrders } from './screens/MyOrders.js';
import { OrderPage } from './screens/OrderPage.js';
import { RequestPage } from './screens/RequestPage.js';
import { Results } from './screens/Results.js';

/** The API client fires this when the server says the login is no longer valid. */
export const SEEKER_UNAUTHORIZED_EVENT = 'km-seeker-unauthorized';

interface Props {
  api: SeekerApi;
  session: Session;
}

type Screen =
  | { name: 'login' }
  | { name: 'search' }
  | { name: 'errand'; id: string | null }
  | { name: 'orders' }
  | { name: 'order'; id: string }
  | { name: 'request'; id: string }
  | { name: 'results'; request: SeekerRequest; origin: { lat: number; lng: number } };

/** The screen an address of the customer app stands for; anything else is the search. */
const screenFor = (pathname: string): Screen => {
  if (isErrandPath(pathname)) return { name: 'errand', id: errandIdFromPath(pathname) };
  if (isOrdersPath(pathname)) return { name: 'orders' };
  const orderId = orderIdFromPath(pathname);
  if (orderId) return { name: 'order', id: orderId };
  const requestId = requestIdFromPath(pathname);
  if (requestId) return { name: 'request', id: requestId };
  return { name: 'search' };
};

/** Login → search (with Mere orders and Haal ke kaam) → results. "Ho gaya" returns to search. */
export function SeekerApp({ api, session }: Props) {
  const { t } = useT();
  const [screen, setScreen] = useState<Screen>(() =>
    session.getToken() ? screenFor(location.pathname) : { name: 'login' },
  );

  /** Every screen but the results has an address of its own, so it can be bookmarked and reloaded. */
  const navigate = useCallback((path: string) => {
    window.history.pushState({}, '', path);
    setScreen(screenFor(path));
  }, []);

  /** The errand on screen is in the address, so a reload shows the same one (not the empty form). */
  const errandOpened = useCallback((id: string | null) => {
    window.history.replaceState({}, '', id ? `/app/errand/${id}` : '/app/errand');
  }, []);

  // The browser's back button walks the addresses above.
  useEffect(() => {
    const onPop = () => {
      if (session.getToken()) setScreen(screenFor(location.pathname));
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [session]);

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
              setScreen(screenFor(location.pathname));
            }}
          />
        )}
        {screen.name === 'search' && (
          <Home
            api={api}
            navigate={navigate}
            onFound={(request, origin) => setScreen({ name: 'results', request, origin })}
          />
        )}
        {screen.name === 'errand' && (
          <Errand
            api={api}
            errandId={screen.id}
            onOpened={errandOpened}
            onBack={() => navigate('/app/')}
          />
        )}
        {screen.name === 'orders' && (
          <MyOrders
            api={api}
            onOpen={(id) => navigate(`/app/order/${id}`)}
            onBack={() => navigate('/app/')}
          />
        )}
        {screen.name === 'order' && (
          <OrderPage
            key={screen.id}
            api={api}
            orderId={screen.id}
            navigate={navigate}
            onBack={() => navigate('/app/orders')}
          />
        )}
        {screen.name === 'request' && (
          <RequestPage
            key={screen.id}
            api={api}
            requestId={screen.id}
            onDone={() => navigate('/app/')}
          />
        )}
        {screen.name === 'results' && (
          <Results
            key={screen.request.id}
            api={api}
            initial={screen.request}
            origin={screen.origin}
            onDone={() => navigate('/app/')}
          />
        )}
        {(screen.name === 'login' || screen.name === 'search') && (
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
