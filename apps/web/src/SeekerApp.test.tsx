// @vitest-environment jsdom
import { act, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SeekerApp, SEEKER_UNAUTHORIZED_EVENT } from './SeekerApp.js';
import type { Session } from './lib/session.js';
import { errandView, fakeSeekerApi, result, seekerOrder, seekerRequest } from './test/fakes.js';
import { openList } from './test/fakesLists.js';
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

beforeEach(() => sessionStorage.clear());
afterEach(() => vi.unstubAllGlobals());

const here = () =>
  vi.stubGlobal('navigator', {
    ...navigator,
    geolocation: {
      getCurrentPosition: (ok: (p: unknown) => void) =>
        ok({ coords: { latitude: 12.97, longitude: 77.59 } }),
    },
  });

const render = (api = fakeSeekerApi(), session = memorySession()) =>
  renderApp(<SeekerApp api={api} session={session} />, 'en');

describe('SeekerApp', () => {
  it('opens on Find without a login wall, with a link for shopkeepers', () => {
    render();
    expect(screen.getByRole('heading', { name: 'What do you need?' })).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('link', { name: 'For shopkeepers' }).getAttribute('href')).toBe(
      '/app/shop',
    );
  });

  it('asks for a login when Find is pressed signed out, then sends the request and shows its replies', async () => {
    here();
    const api = fakeSeekerApi({
      createRequest: vi.fn(async () =>
        seekerRequest({
          id: 'req-5',
          state: 'ANSWERED',
          results: [result({ name: 'Sharma Kirana' })],
        }),
      ),
    });
    const session = memorySession();
    const { user } = render(api, session);
    await user.type(screen.getByLabelText('What do you need?'), 'chini');
    await user.click(screen.getByRole('button', { name: 'Find nearby' }));
    await user.type(await screen.findByLabelText('Mobile number'), '9876543210');
    await user.click(screen.getByRole('button', { name: 'Send code' }));
    await user.click(await screen.findByRole('button', { name: 'Fill demo OTP' }));
    await user.click(screen.getByRole('button', { name: 'Log in' }));
    expect(await screen.findByText('Sharma Kirana')).toBeTruthy();
    expect(session.getToken()).toBe('seeker-token');
    expect(api.createRequest).toHaveBeenCalledTimes(1);
    expect(api.createRequest).toHaveBeenCalledWith(expect.objectContaining({ q: 'chini' }));
    expect(location.pathname).toBe('/app/request/req-5');
    at('/app/');
  });

  it('falls back to a signed-out Find when the server says the session is over', async () => {
    const session = memorySession('t');
    render(fakeSeekerApi(), session);
    act(() => void window.dispatchEvent(new Event(SEEKER_UNAUTHORIZED_EVENT)));
    await waitFor(() => expect(session.getToken()).toBeNull());
    expect(screen.getByRole('heading', { name: 'What do you need?' })).toBeTruthy();
  });

  it('shows the login sheet over an address that needs a login, and closing it goes to Find', async () => {
    at('/app/orders');
    const { user } = render();
    expect(await screen.findByRole('dialog', { name: 'Log in to send your request' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(location.pathname).toBe('/app/');
    expect(screen.getByRole('heading', { name: 'What do you need?' })).toBeTruthy();
  });
});

const at = (path: string) => window.history.pushState({}, '', path);

describe('SeekerApp: the errand entry', () => {
  afterEach(() => at('/app/'));

  it('opens the errand screen from the Plan an errand card, and Back returns to Find', async () => {
    const { user } = render(fakeSeekerApi(), memorySession('t'));
    await user.click(screen.getByRole('link', { name: /Plan an errand/ }));
    expect(await screen.findByLabelText("What's the job?")).toBeTruthy();
    expect(location.pathname).toBe('/app/errand');
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByRole('heading', { name: 'What do you need?' })).toBeTruthy();
    expect(location.pathname).toBe('/app/');
  });

  it('opens straight on the errand screen at /app/errand', async () => {
    at('/app/errand');
    render(fakeSeekerApi(), memorySession('t'));
    expect(await screen.findByLabelText("What's the job?")).toBeTruthy();
  });

  it('a reload at /app/errand/<id> shows the same errand, not the empty form', async () => {
    at('/app/errand/errand-7');
    const getErrand = vi.fn(async () =>
      errandView({ id: 'errand-7', state: 'WAITING_FOR_SHOPS', task: 'puja ka saaman' }),
    );
    render(fakeSeekerApi({ getErrand }), memorySession('t'));
    expect(await screen.findByText('puja ka saaman')).toBeTruthy();
    expect(getErrand).toHaveBeenCalledWith('errand-7');
    expect(screen.queryByLabelText("What's the job?")).toBeNull();
  });
});

describe('SeekerApp: addresses of its own', () => {
  afterEach(() => at('/app/'));

  it('opens /app/order/<id> straight on that order, as after a reload', async () => {
    at('/app/order/o-42');
    const api = fakeSeekerApi({ getOrder: vi.fn(async () => seekerOrder({ id: 'o-42' })) });
    render(api, memorySession('t'));
    expect(await screen.findByText(/Mishra Kirana/)).toBeTruthy();
    expect(api.getOrder).toHaveBeenCalledWith('o-42');
    expect(location.pathname).toBe('/app/order/o-42');
  });

  it('opens /app/request/<id> on the replies of that search, without the customer’s own point', async () => {
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
    render(api, memorySession('t'));
    expect(await screen.findByText('Sharma Kirana')).toBeTruthy();
    expect(api.getRequest).toHaveBeenCalledWith('req-9');
  });

  it('goes Find → My orders → one order → back, keeping the address bar in step', async () => {
    const api = fakeSeekerApi({
      myOrders: vi.fn(async () => [seekerOrder({ id: 'o-1', state: 'ACCEPTED' })]),
      getOrder: vi.fn(async () => seekerOrder({ id: 'o-1', state: 'ACCEPTED' })),
    });
    const { user } = render(api, memorySession('t'));
    await user.click(await screen.findByRole('link', { name: /My orders/ }));
    expect(location.pathname).toBe('/app/orders');
    await user.click(await screen.findByRole('link', { name: /Mishra Kirana/ }));
    expect(location.pathname).toBe('/app/order/o-1');
    await user.click(await screen.findByRole('button', { name: 'Back' }));
    expect(location.pathname).toBe('/app/orders');
  });
});

describe('a list push link', () => {
  afterEach(() => window.history.pushState({}, '', '/'));

  it('/app/list/<id> opens that list’s replies', async () => {
    window.history.pushState({}, '', '/app/list/list-1');
    const api = fakeSeekerApi({ getList: vi.fn(async () => openList()) });
    render(api, memorySession('token'));
    expect(await screen.findByText('Sent to 6 shops · 5 items')).toBeTruthy();
    expect(api.getList).toHaveBeenCalledWith('list-1');
  });

  it('asks for a login first when signed out', async () => {
    window.history.pushState({}, '', '/app/list/list-1');
    render();
    expect(await screen.findByRole('dialog', { name: 'Log in to send your request' })).toBeTruthy();
  });
});
