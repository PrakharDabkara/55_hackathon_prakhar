import { useCallback, useEffect, useState } from 'react';
import { LoginSheet } from './components/LoginSheet.js';
import './customer/customer.css';
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
import { MyOrders } from './screens/MyOrders.js';
import { OrderPage } from './screens/OrderPage.js';
import { RequestPage } from './screens/RequestPage.js';

/** The API client fires this when the server says the login is no longer valid. */
export const SEEKER_UNAUTHORIZED_EVENT = 'km-seeker-unauthorized';

interface Props {
  api: SeekerApi;
  session: Session;
}

type Screen =
  | { name: 'search' }
  | { name: 'errand'; id: string | null }
  | { name: 'orders' }
  | { name: 'order'; id: string }
  | { name: 'request'; id: string; initial?: SeekerRequest; origin?: Origin };

type Origin = { lat: number; lng: number };

/** The screen an address of the customer app stands for; anything else is Find. */
const screenFor = (pathname: string): Screen => {
  if (isErrandPath(pathname)) return { name: 'errand', id: errandIdFromPath(pathname) };
  if (isOrdersPath(pathname)) return { name: 'orders' };
  const orderId = orderIdFromPath(pathname);
  if (orderId) return { name: 'order', id: orderId };
  const requestId = requestIdFromPath(pathname);
  if (requestId) return { name: 'request', id: requestId };
  return { name: 'search' };
};

/**
 * Find opens for anyone (no login wall). Everything that belongs to a customer needs a login: if
 * someone opens such an address signed out, the login sheet comes up over a plain page and a
 * successful login shows the screen they asked for.
 */
export function SeekerApp({ api, session }: Props) {
  const [screen, setScreen] = useState<Screen>(() => screenFor(location.pathname));
  const [loggedIn, setLoggedIn] = useState(() => session.getToken() !== null);

  const navigate = useCallback((path: string) => {
    window.history.pushState({}, '', path);
    setScreen(screenFor(path));
  }, []);

  /** The errand on screen is in the address, so a reload shows the same one (not the empty form). */
  const errandOpened = useCallback((id: string | null) => {
    window.history.replaceState({}, '', id ? `/app/errand/${id}` : '/app/errand');
  }, []);

  /** A search was sent: its replies have an address of their own, and the map knows where we asked from. */
  const found = useCallback((request: SeekerRequest, origin: Origin) => {
    window.history.pushState({}, '', `/app/request/${request.id}`);
    setScreen({ name: 'request', id: request.id, initial: request, origin });
  }, []);

  useEffect(() => {
    const onPop = () => setScreen(screenFor(location.pathname));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const logout = useCallback(() => {
    session.clear();
    setLoggedIn(false);
  }, [session]);

  const loggedInWith = useCallback(
    (token: string) => {
      session.setToken(token);
      setLoggedIn(true);
    },
    [session],
  );

  useEffect(() => {
    window.addEventListener(SEEKER_UNAUTHORIZED_EVENT, logout);
    return () => window.removeEventListener(SEEKER_UNAUTHORIZED_EVENT, logout);
  }, [logout]);

  const home = () => navigate('/app/');

  return (
    <div className="km-app cu-app">
      <div className="cu-column">
        {screen.name === 'search' && (
          <Home
            api={api}
            loggedIn={loggedIn}
            onLoggedIn={loggedInWith}
            navigate={navigate}
            onFound={found}
          />
        )}
        {screen.name !== 'search' && !loggedIn && (
          <LoginSheet api={api} open onClose={home} onLoggedIn={loggedInWith} />
        )}
        {loggedIn && screen.name === 'errand' && (
          <Errand
            api={api}
            errandId={screen.id}
            onOpened={errandOpened}
            onBack={home}
            navigate={navigate}
          />
        )}
        {loggedIn && screen.name === 'orders' && (
          <MyOrders api={api} navigate={navigate} onBack={home} />
        )}
        {loggedIn && screen.name === 'order' && (
          <OrderPage
            key={screen.id}
            api={api}
            orderId={screen.id}
            navigate={navigate}
            onBack={() => navigate('/app/orders')}
          />
        )}
        {loggedIn && screen.name === 'request' && (
          <RequestPage
            key={screen.id}
            api={api}
            requestId={screen.id}
            navigate={navigate}
            onDone={home}
            {...(screen.initial && { initial: screen.initial })}
            {...(screen.origin && { origin: screen.origin })}
          />
        )}
      </div>
    </div>
  );
}
