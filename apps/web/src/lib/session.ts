import type { Lang } from '../i18n/index.js';

/** Where the login token lives. Behind an interface so tests do not need a browser. */
export interface Session {
  getToken(): string | null;
  setToken(token: string): void;
  clear(): void;
}

const SHOP_TOKEN_KEY = 'km-token';
const SEEKER_TOKEN_KEY = 'km-seeker-token';
const LANG_KEY = 'km-lang';

// Storage can throw (private windows, blocked site data); the app must work without it.
function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Not saved; the app keeps working for this visit.
  }
}

/**
 * The bearer token is kept in localStorage: it survives closing the tab, which a shopkeeper's
 * phone does all day. Any script that runs on the page can read it, which is why the page has a
 * strict Content-Security-Policy. Trade-off in ADR-0017.
 */
export function localStorageSession(TOKEN_KEY = SHOP_TOKEN_KEY): Session {
  let memory: string | null = null;
  return {
    getToken: () => read(TOKEN_KEY) ?? memory,
    setToken(token) {
      memory = token;
      write(TOKEN_KEY, token);
    },
    clear() {
      memory = null;
      write(TOKEN_KEY, null);
    },
  };
}

/** The customer app keeps its own token, so a phone used for both never mixes the two logins. */
export const seekerSession = (): Session => localStorageSession(SEEKER_TOKEN_KEY);

export function readLang(): Lang | null {
  const saved = read(LANG_KEY);
  return saved === 'hi' || saved === 'en' ? saved : null;
}

export function saveLang(lang: Lang): void {
  write(LANG_KEY, lang);
}
