import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App, UNAUTHORIZED_EVENT } from './App.js';
import { LangProvider } from './i18n/index.js';
import { createApi } from './lib/api.js';
import { localStorageSession } from './lib/session.js';
import './styles.css';

// Served at /app/shop (ADR-0017); any other /app/ address lands there.
if (!location.pathname.startsWith('/app/shop')) {
  location.replace('/app/shop');
}

const session = localStorageSession();
const api = createApi({
  getToken: session.getToken,
  onUnauthorized: () => window.dispatchEvent(new Event(UNAUTHORIZED_EVENT)),
});

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <LangProvider>
        <App api={api} session={session} />
      </LangProvider>
    </StrictMode>,
  );
}
