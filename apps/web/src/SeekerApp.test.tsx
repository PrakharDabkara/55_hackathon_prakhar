// @vitest-environment jsdom
import { act, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SeekerApp, SEEKER_UNAUTHORIZED_EVENT } from './SeekerApp.js';
import type { Session } from './lib/session.js';
import { errandView, fakeSeekerApi, result, seekerOrder, seekerRequest } from './test/fakes.js';
import { renderApp } from './test/render.js';

vi.mock('./components/PlanMap.js', () => ({
  PlanMap: () => <div data-testid="plan-map" />,
}));
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

describe('SeekerApp: the errand entry (Day 14b)', () => {
  it('offers "Poora kaam batao" on the search screen and opens the errand screen', async () => {
    const { user } = renderApp(<SeekerApp api={fakeSeekerApi()} session={memorySession('t')} />);
    await user.click(screen.getByRole('link', { name: 'Poora kaam batao' }));
    expect(await screen.findByLabelText('Kya kaam hai?')).toBeTruthy();
    expect(location.pathname).toBe('/app/errand');

    await user.click(screen.getByRole('button', { name: 'Wapas' }));
    expect(await screen.findByLabelText('क्या चाहिए?')).toBeTruthy();
    expect(location.pathname).toBe('/app/');
  });

  it('opens straight on the errand screen at /app/errand', async () => {
    window.history.pushState({}, '', '/app/errand');
    renderApp(<SeekerApp api={fakeSeekerApi()} session={memorySession('t')} />);
    expect(await screen.findByLabelText('Kya kaam hai?')).toBeTruthy();
    window.history.pushState({}, '', '/app/');
  });

  it('puts the errand id in the address when an errand starts, and "Naya kaam" takes it out', async () => {
    window.history.pushState({}, '', '/app/errand');
    const api = fakeSeekerApi({
      createErrand: vi.fn(async () => ({ id: 'errand-7', state: 'PLANNING' as const })),
      getErrand: vi.fn(async () => errandView({ id: 'errand-7', state: 'CANCELLED' })),
    });
    const { user } = renderApp(<SeekerApp api={api} session={memorySession('t')} />);
    await user.type(await screen.findByLabelText('Kya kaam hai?'), 'chai');
    await user.click(screen.getByRole('button', { name: 'Demo location (Indore)' }));
    await user.click(screen.getByRole('button', { name: 'Plan banao' }));
    await screen.findByRole('button', { name: 'Naya kaam' });
    expect(location.pathname).toBe('/app/errand/errand-7');
    await user.click(screen.getByRole('button', { name: 'Naya kaam' }));
    expect(location.pathname).toBe('/app/errand');
    window.history.pushState({}, '', '/app/');
  });

  it('a reload at /app/errand/<id> shows the same errand, not the empty form', async () => {
    window.history.pushState({}, '', '/app/errand/errand-7');
    const getErrand = vi.fn(async () =>
      errandView({ id: 'errand-7', state: 'WAITING_FOR_SHOPS', task: 'puja ka saaman' }),
    );
    renderApp(<SeekerApp api={fakeSeekerApi({ getErrand })} session={memorySession('t')} />);
    expect(await screen.findByText('puja ka saaman')).toBeTruthy();
    expect(getErrand).toHaveBeenCalledWith('errand-7');
    expect(screen.queryByLabelText('Kya kaam hai?')).toBeNull();
    window.history.pushState({}, '', '/app/');
  });
});

describe('SeekerApp: addresses of its own (PR E)', () => {
  const at = (path: string) => window.history.pushState({}, '', path);
  afterEach(() => at('/app/'));

  it('opens /app/order/<id> straight on that order, as after a reload', async () => {
    at('/app/order/o-42');
    const api = fakeSeekerApi({ getOrder: vi.fn(async () => seekerOrder({ id: 'o-42' })) });
    renderApp(<SeekerApp api={api} session={memorySession('t')} />);
    expect(await screen.findByText('Mishra Kirana')).toBeTruthy();
    expect(api.getOrder).toHaveBeenCalledWith('o-42');
    expect(window.location.pathname).toBe('/app/order/o-42');
  });

  it('opens /app/orders on the list', async () => {
    at('/app/orders');
    const api = fakeSeekerApi({ myOrders: vi.fn(async () => [seekerOrder({ id: 'o-1' })]) });
    renderApp(<SeekerApp api={api} session={memorySession('t')} />);
    expect(await screen.findByRole('link', { name: /Mishra Kirana/ })).toBeTruthy();
  });

  it('opens /app/request/<id> on the results of that search, from its stored origin', async () => {
    at('/app/request/req-9');
    const api = fakeSeekerApi({
      getRequest: vi.fn(async () =>
        seekerRequest({
          id: 'req-9',
          state: 'CLOSED',
          results: [result({ name: 'Sharma Kirana' })],
        }),
      ),
    });
    renderApp(<SeekerApp api={api} session={memorySession('t')} />);
    expect(await screen.findByText('Sharma Kirana')).toBeTruthy();
    expect(api.getRequest).toHaveBeenCalledWith('req-9');
  });

  it('goes home → Mere orders → one order → back, keeping the address bar in step', async () => {
    at('/app/');
    const api = fakeSeekerApi({
      myOrders: vi.fn(async () => [seekerOrder({ id: 'o-1', state: 'ACCEPTED' })]),
      getOrder: vi.fn(async () => seekerOrder({ id: 'o-1', state: 'ACCEPTED' })),
    });
    const { user } = renderApp(<SeekerApp api={api} session={memorySession('t')} />);
    await user.click(await screen.findByRole('link', { name: /Mere orders/ }));
    expect(window.location.pathname).toBe('/app/orders');
    await user.click(await screen.findByRole('link', { name: /Mishra Kirana/ }));
    expect(window.location.pathname).toBe('/app/order/o-1');
    await user.click(await screen.findByRole('button', { name: 'Wapas' }));
    expect(window.location.pathname).toBe('/app/orders');
  });
});
