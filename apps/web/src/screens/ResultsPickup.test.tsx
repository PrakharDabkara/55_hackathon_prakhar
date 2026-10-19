// @vitest-environment jsdom
import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { fakeSeekerApi, result, seekerOrder, seekerRequest } from '../test/fakes.js';
import { renderApp } from '../test/render.js';
import { Results } from './Results.js';

vi.mock('../components/ResultsMap.js', () => ({ ResultsMap: () => <div /> }));

const origin = { lat: 22.7196, lng: 75.8577 };
const asked = seekerRequest({
  id: 'req-9',
  state: 'ANSWERED',
  results: [
    result({ shopId: 'a', name: 'Sharma Kirana', pricePaise: 5500 }),
    result({ shopId: 'b', name: 'Gupta Stores', pricePaise: 4800, distanceM: 900 }),
  ],
});
const card = (name: string) =>
  screen.getAllByRole('listitem').find((r) => within(r).queryByText(name)) as HTMLElement;
// Tapping the link would open maps; the page only needs to see the tap.
const noNavigation = (event: Event) => event.preventDefault();

describe('"Raasta" on a result card records the visit (ADR-0035)', () => {
  it('tells the server which shop and item, and still opens the route', async () => {
    const api = fakeSeekerApi();
    const { user } = renderApp(
      <Results api={api} initial={asked} origin={origin} onDone={vi.fn()} />,
    );
    const link = within(card('Gupta Stores')).getByRole('link', { name: 'Raasta' });
    link.addEventListener('click', noNavigation);
    await user.click(link);
    expect(api.recordPickup).toHaveBeenCalledOnce();
    expect(api.recordPickup).toHaveBeenCalledWith({
      shopId: 'b',
      itemId: 'i1',
      requestId: 'req-9',
    });
    // The link itself is untouched: it still goes to the map in a new tab.
    expect(link.getAttribute('href')).toMatch(/google\.com\/maps/);
    expect(link.getAttribute('target')).toBe('_blank');
  });

  it('opens the route even when recording it fails', async () => {
    const api = fakeSeekerApi({
      recordPickup: vi.fn(async () => {
        throw new Error('offline');
      }),
    });
    const { user } = renderApp(
      <Results api={api} initial={asked} origin={origin} onDone={vi.fn()} />,
    );
    const link = within(card('Sharma Kirana')).getByRole('link', { name: 'Raasta' });
    link.addEventListener('click', noNavigation);
    await user.click(link);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(link.getAttribute('href')).toBeTruthy();
  });

  it('records nothing for a shop the customer has a delivery order with', async () => {
    const api = fakeSeekerApi({
      listOrders: vi.fn(async () => [seekerOrder({ shopId: 'a', state: 'ACCEPTED' })]),
    });
    const { user } = renderApp(
      <Results api={api} initial={asked} origin={origin} onDone={vi.fn()} />,
    );
    await screen.findByText('Sharma Kirana');
    const link = within(card('Sharma Kirana')).getByRole('link', { name: 'Raasta' });
    link.addEventListener('click', noNavigation);
    await user.click(link);
    expect(api.recordPickup).not.toHaveBeenCalled();
  });
});

describe('"Grahak ne confirm kiya" on learned cards', () => {
  const learnedAsk = (customerVerified?: boolean) =>
    seekerRequest({
      state: 'ANSWERED',
      results: [
        result({
          shopId: 'a',
          name: 'Jain Mart',
          source: 'learned',
          freshness: 'Confirmed today',
          ...(customerVerified && { customerVerified }),
        }),
      ],
    });

  it('shows on a learned card a customer confirmed', () => {
    renderApp(
      <Results api={fakeSeekerApi()} initial={learnedAsk(true)} origin={origin} onDone={vi.fn()} />,
    );
    expect(within(card('Jain Mart')).getByText('Grahak ne confirm kiya')).toBeTruthy();
  });

  it('is not there otherwise', () => {
    renderApp(
      <Results api={fakeSeekerApi()} initial={learnedAsk()} origin={origin} onDone={vi.fn()} />,
    );
    expect(screen.queryByText('Grahak ne confirm kiya')).toBeNull();
  });

  it('speaks English when asked to', () => {
    renderApp(
      <Results api={fakeSeekerApi()} initial={learnedAsk(true)} origin={origin} onDone={vi.fn()} />,
      'en',
    );
    expect(screen.getByText('Confirmed by a customer')).toBeTruthy();
  });
});
