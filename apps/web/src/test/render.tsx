import { cleanup, render } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { afterEach } from 'vitest';
import { LangProvider, type Lang } from '../i18n/index.js';

afterEach(() => {
  cleanup();
  try {
    localStorage.clear();
  } catch {
    // jsdom always has it; nothing to clear otherwise.
  }
});

/** Renders with the language provider, in Hindi unless told otherwise. */
export function renderApp(ui: ReactElement, lang: Lang = 'hi') {
  const user = userEvent.setup();
  const result = render(<LangProvider initial={lang}>{ui}</LangProvider>);
  return {
    user,
    ...result,
    // A rerender keeps the language provider, so a component that reads the copy still works.
    rerender: (next: ReactElement) =>
      result.rerender(<LangProvider initial={lang}>{next}</LangProvider>),
  };
}
