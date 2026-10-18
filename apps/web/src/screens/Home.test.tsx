// @vitest-environment jsdom
import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { fakeSeekerApi, seekerOrder } from '../test/fakes.js';
import { renderApp } from '../test/render.js';
import { Home } from './Home.js';

vi.mock('../components/ResultsMap.js', () => ({ ResultsMap: () => <div /> }));

function setup(overrides: Parameters<typeof fakeSeekerApi>[0] = {}) {
  const api = fakeSeekerApi(overrides);
  const navigate = vi.fn();
  const utils = renderApp(<Home api={api} onFound={vi.fn()} navigate={navigate} />);
  return { api, navigate, ...utils };
}

describe('the home screen: Mere orders and Haal ke kaam', () => {
  it('has a "Mere orders" entry, with no badge when nothing is active', async () => {
    const { user, navigate } = setup({
      myOrders: vi.fn(async () => [seekerOrder({ state: 'DELIVERED' })]),
    });
    const entry = await screen.findByRole('link', { name: /Mere orders/ });
    expect(entry.getAttribute('href')).toBe('/app/orders');
    expect(within(entry).queryByLabelText(/chal rahe/)).toBeNull();
    await user.click(entry);
    expect(navigate).toHaveBeenCalledWith('/app/orders');
  });

  it('badges the number of active orders (requested, accepted, out for delivery)', async () => {
    setup({
      myOrders: vi.fn(async () => [
        seekerOrder({ id: 'a', state: 'REQUESTED' }),
        seekerOrder({ id: 'b', state: 'ACCEPTED' }),
        seekerOrder({ id: 'c', state: 'OUT_FOR_DELIVERY' }),
        seekerOrder({ id: 'd', state: 'DELIVERED' }),
        seekerOrder({ id: 'e', state: 'CANCELLED' }),
      ]),
    });
    const entry = await screen.findByRole('link', { name: /Mere orders/ });
    const badge = await within(entry).findByLabelText('3 order chal rahe hain');
    expect(badge.textContent).toBe('3');
  });

  it('keeps the search usable when orders cannot be fetched', async () => {
    setup({
      myOrders: vi.fn(async () => {
        throw new Error('offline');
      }),
    });
    expect(screen.getByLabelText('क्या चाहिए?')).toBeTruthy();
    expect(await screen.findByRole('link', { name: /Mere orders/ })).toBeTruthy();
  });

  it('lists the recent searches and errands, each linking to its own page', async () => {
    const { user, navigate } = setup({
      recentWork: vi.fn(async () => [
        {
          kind: 'errand' as const,
          id: 'e1',
          label: 'chai ka saaman',
          state: 'PLAN_READY',
          createdAt: '2026-10-16T11:00:00.000Z',
        },
        {
          kind: 'search' as const,
          id: 'r1',
          label: 'chini',
          state: 'CLOSED',
          createdAt: '2026-10-16T10:00:00.000Z',
        },
      ]),
    });
    expect(await screen.findByRole('heading', { name: 'Haal ke kaam' })).toBeTruthy();
    const errand = screen.getByRole('link', { name: /chai ka saaman/ });
    expect(errand.getAttribute('href')).toBe('/app/errand/e1');
    const search = screen.getByRole('link', { name: /chini/ });
    expect(search.getAttribute('href')).toBe('/app/request/r1');
    await user.click(search);
    expect(navigate).toHaveBeenCalledWith('/app/request/r1');
  });

  it('has no "Haal ke kaam" heading when there is nothing to show', async () => {
    setup();
    await screen.findByRole('link', { name: /Mere orders/ });
    expect(screen.queryByRole('heading', { name: 'Haal ke kaam' })).toBeNull();
  });
});
