import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App, UNAUTHORIZED_EVENT } from './App.js';
import { LangProvider } from './i18n/index.js';
import { createApi } from './lib/api.js';
import { registerServiceWorker } from './lib/push.js';
import { createSeekerApi } from './lib/seekerApi.js';
import { localStorageSession, seekerSession } from './lib/session.js';
import { isShopPath } from './routing.js';
import { SEEKER_UNAUTHORIZED_EVENT, SeekerApp } from './SeekerApp.js';
import './ui/baseStyles.js';

// /app/shop is the shop app (ADR-0017); every other address under /app/ is the customer app.
function start() {
  if (isShopPath(location.pathname)) {
    const session = localStorageSession();
    const api = createApi({
      getToken: session.getToken,
      onUnauthorized: () => window.dispatchEvent(new Event(UNAUTHORIZED_EVENT)),
    });
    return <App api={api} session={session} />;
  }
  const session = seekerSession();
  const api = createSeekerApi({
    getToken: session.getToken,
    onUnauthorized: () => window.dispatchEvent(new Event(SEEKER_UNAUTHORIZED_EVENT)),
  });
  return <SeekerApp api={api} session={session} />;
}

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <LangProvider>{start()}</LangProvider>
    </StrictMode>,
  );
}

// Needed to show a push; registering is not a permission prompt.
registerServiceWorker();
