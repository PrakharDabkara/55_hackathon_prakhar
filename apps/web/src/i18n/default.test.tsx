// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { LangProvider, useT } from './index.js';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function Probe() {
  const { lang, t } = useT();
  return (
    <p>
      {lang}:{t.appName}
    </p>
  );
}

describe('default language', () => {
  it('is English when nothing is saved', () => {
    render(
      <LangProvider>
        <Probe />
      </LangProvider>,
    );
    expect(screen.getByText(/^en:/)).toBeTruthy();
    expect(document.documentElement.lang).toBe('en');
  });

  it('keeps a saved choice', () => {
    localStorage.setItem('km-lang', 'hi');
    render(
      <LangProvider>
        <Probe />
      </LangProvider>,
    );
    expect(screen.getByText(/^hi:/)).toBeTruthy();
  });
});
