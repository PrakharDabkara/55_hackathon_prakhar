// @vitest-environment jsdom
import { act, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SeekerApp, SEEKER_UNAUTHORIZED_EVENT } from './SeekerApp.js';
import type { Session } from './lib/session.js';
import { fakeSeekerApi, result, seekerRequest } from './test/fakes.js';
import { renderApp } from './test/render.js';

vi.mock('./components/ResultsMap.js', () => ({
  ResultsMap: () => <div data-testid="map" />,
}));

const memorySession = (token: string | null = null): Session => {
  let value = token;
  return {
    getToken: () => value,
    setToken: (t) => void (value = t),
    clear: () => void (value = null),
  };
};

describe('SeekerApp', () => {
  it('starts at login with the Demo mode box after the code is sent', async () => {
    const { user } = renderApp(<SeekerApp api={fakeSeekerApi()} session={memorySession()} />);
    await user.type(screen.getByLabelText(/mobile number/i), '9876543210');
    await user.click(screen.getByRole('button', { name: 'OTP bhejo' }));
    expect(await screen.findByText('Demo mode')).toBeTruthy();
  });

  it('logs in as a seeker, then shows the search box', async () => {
    const api = fakeSeekerApi();
    const session = memorySession();
    const { user } = renderApp(<SeekerApp api={api} session={session} />);
    await user.type(screen.getByLabelText(/mobile number/i), '9876543210');
    await user.click(screen.getByRole('button', { name: 'OTP bhejo' }));
    await user.click(await screen.findByRole('button', { name: 'Demo OTP bharein' }));
    await user.click(screen.getByRole('button', { name: 'Login karein' }));
    expect(await screen.findByLabelText('क्या चाहिए?')).toBeTruthy();
    expect(session.getToken()).toBe('seeker-token');
  });

  it('goes from search to results, and back to search after "Ho gaya"', async () => {
    const api = fakeSeekerApi({
      createRequest: vi.fn(async () =>
        seekerRequest({ state: 'ANSWERED', results: [result({ name: 'Sharma Kirana' })] }),
      ),
    });
    const { user } = renderApp(<SeekerApp api={api} session={memorySession('t')} />);
    await user.type(screen.getByLabelText('क्या चाहिए?'), 'chini');
    await user.click(screen.getByRole('button', { name: 'Demo location (Indore)' }));
    await user.click(screen.getByRole('button', { name: 'Dhoondho' }));
    expect(await screen.findByText('Sharma Kirana')).toBeTruthy();
    expect(screen.getByTestId('map')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Ho gaya' }));
    expect(await screen.findByLabelText('क्या चाहिए?')).toBeTruthy();
  });

  it('returns to login when the server says the session is over', async () => {
    renderApp(<SeekerApp api={fakeSeekerApi()} session={memorySession('t')} />);
    expect(screen.getByLabelText('क्या चाहिए?')).toBeTruthy();
    act(() => void window.dispatchEvent(new Event(SEEKER_UNAUTHORIZED_EVENT)));
    await waitFor(() => expect(screen.getByRole('button', { name: 'OTP bhejo' })).toBeTruthy());
  });

  it('links to the shop app for shopkeepers', () => {
    renderApp(<SeekerApp api={fakeSeekerApi()} session={memorySession()} />);
    expect(screen.getByRole('link', { name: /Dukaan/ }).getAttribute('href')).toBe('/app/shop');
  });
});
