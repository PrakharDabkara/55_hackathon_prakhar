// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { App } from './App.js';
import { ApiError } from './lib/api.js';
import type { Session } from './lib/session.js';
import { fakeApi, ping } from './test/fakes.js';
import { renderApp } from './test/render.js';

const memorySession = (token: string | null = null): Session & { token: string | null } => {
  const s = {
    token,
    getToken: () => s.token,
    setToken: (t: string) => {
      s.token = t;
    },
    clear: () => {
      s.token = null;
    },
  };
  return s;
};

describe('App', () => {
  it('starts at the login screen when there is no session', () => {
    renderApp(<App api={fakeApi()} session={memorySession()} />);
    expect(screen.getByRole('button', { name: 'OTP bhejo' })).toBeTruthy();
  });

  it('goes straight to the ping card for a shop that is set up', async () => {
    const api = fakeApi({ listPings: vi.fn(async () => [ping()]) });
    renderApp(<App api={api} session={memorySession('t')} />);
    expect(await screen.findByText('आटा')).toBeTruthy();
  });

  it('sends a new shop to onboarding (GET /shops/me is 404)', async () => {
    const api = fakeApi({ getMyShop: vi.fn(async () => null) });
    renderApp(<App api={api} session={memorySession('t')} />);
    expect(await screen.findByRole('button', { name: 'Dukaan shuru karein' })).toBeTruthy();
  });

  it('logs in, keeps the token, then loads the shop', async () => {
    const session = memorySession();
    const api = fakeApi();
    const { user } = renderApp(<App api={api} session={session} />);
    await user.type(screen.getByLabelText(/mobile number/i), '9876543210');
    await user.click(screen.getByRole('button', { name: 'OTP bhejo' }));
    await user.type(await screen.findByLabelText(/OTP/), '123456');
    await user.click(screen.getByRole('button', { name: 'Login karein' }));
    await waitFor(() => expect(session.token).toBe('token-1'));
    expect(await screen.findByText(/Abhi koi sawaal nahi/)).toBeTruthy();
  });

  it('returns to login when the session is no longer valid (401)', async () => {
    const session = memorySession('stale');
    const api = fakeApi({
      getMyShop: vi.fn().mockRejectedValue(new ApiError(401, 'unauthorized', 'x')),
    });
    renderApp(<App api={api} session={session} />);
    expect(await screen.findByRole('button', { name: 'OTP bhejo' })).toBeTruthy();
    expect(session.token).toBeNull();
  });

  it('tells a customer account that this app is for shops (403)', async () => {
    const api = fakeApi({
      getMyShop: vi.fn().mockRejectedValue(new ApiError(403, 'forbidden', 'x')),
    });
    renderApp(<App api={api} session={memorySession('t')} />);
    expect((await screen.findByRole('alert')).textContent).toMatch(/dukaan/i);
  });

  describe('language', () => {
    it('is Hindi by default and switches to English and back with one button', async () => {
      const { user } = renderApp(<App api={fakeApi()} session={memorySession()} />, 'hi');
      expect(screen.getByRole('button', { name: 'OTP bhejo' })).toBeTruthy();

      await user.click(screen.getByRole('button', { name: 'English' }));
      expect(screen.getByRole('button', { name: 'Send OTP' })).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'OTP bhejo' })).toBeNull();

      await user.click(screen.getByRole('button', { name: 'हिंदी' }));
      expect(screen.getByRole('button', { name: 'OTP bhejo' })).toBeTruthy();
    });

    it('remembers the choice for next time', async () => {
      const { user, unmount } = renderApp(<App api={fakeApi()} session={memorySession()} />);
      await user.click(screen.getByRole('button', { name: 'English' }));
      unmount();

      // A fresh start with no explicit language reads what was saved.
      const { render } = await import('@testing-library/react');
      const { LangProvider } = await import('./i18n/index.js');
      render(
        <LangProvider>
          <App api={fakeApi()} session={memorySession()} />
        </LangProvider>,
      );
      expect(screen.getByRole('button', { name: 'Send OTP' })).toBeTruthy();
    });
  });
});
