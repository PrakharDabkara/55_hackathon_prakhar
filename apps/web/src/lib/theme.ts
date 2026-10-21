/** The person's choice of look, kept on this device (ADR-0054). System follows the phone. */
export type Theme = 'system' | 'light' | 'dark';

const THEME_KEY = 'km-theme';

/** The saved choice; System when nothing is saved, storage is blocked or the value is unknown. */
export function readTheme(): Theme {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    return saved === 'light' || saved === 'dark' ? saved : 'system';
  } catch {
    return 'system';
  }
}

/** Light and Dark set data-theme on <html>; System removes it so the phone decides. */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
}

/** Applies the choice now and keeps it. The shop app reads the same key: same origin. */
export function saveTheme(theme: Theme): void {
  applyTheme(theme);
  try {
    if (theme === 'system') localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Not saved; it holds until the page closes.
  }
}
