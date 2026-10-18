// @vitest-environment jsdom
import { act, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeEventSource, fakeSeekerApi, result, seekerRequest } from '../test/fakes.js';
import { renderApp } from '../test/render.js';
import { Results } from './Results.js';

// jsdom cannot draw a Leaflet map; the map is one small component, replaced here by a probe.
vi.mock('../components/ResultsMap.js', () => ({
  ResultsMap: (props: { origin: unknown; pins: unknown[] }) => (
    <div
      data-testid="map"
      data-origin={JSON.stringify(props.origin)}
      data-pins={JSON.stringify(props.pins)}
    />
  ),
}));

const origin = { lat: 22.7196, lng: 75.8577 };
const live = { createSource: (url: string) => new FakeEventSource(url), retryMs: 1000 };
const pinsOnMap = () => JSON.parse(screen.getByTestId('map').getAttribute('data-pins') ?? '[]');

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date('2026-10-16T10:03:00.000Z') });
  FakeEventSource.reset();
});
afterEach(() => {
  vi.useRealTimers();
});

const answered = seekerRequest({
  state: 'ANSWERED',
  targetPricePaise: 6000,
  pingStats: { sent: 10, yes: 4, no: 6, pending: 0 },
  results: [
    result({
      shopId: 'a',
      name: 'Sharma Kirana',
      pricePaise: 5500,
      distanceM: 350,
      lat: 22.72,
      lng: 75.86,
      savingsPaise: 500,
    }),
    result({
      shopId: 'b',
      name: 'Gupta Stores',
      pricePaise: 4800,
      distanceM: 1200,
      lat: 22.73,
      lng: 75.87,
      savingsPaise: 1200,
      freshness: 'Confirmed 5 min ago',
    }),
    result({
      shopId: 'c',
      name: 'Jain Mart',
      pricePaise: 7000,
      distanceM: 90,
      source: 'learned',
      freshness: 'Had it yesterday',
    }),
  ],
});

const rows = () => screen.getAllByRole('listitem');

describe('Results', () => {
  it('shows the item, a map with the user and one pin per shop, and the origin', () => {
    renderApp(
      <Results api={fakeSeekerApi()} initial={answered} origin={origin} onDone={vi.fn()} />,
    );
    expect(screen.getByText('चीनी')).toBeTruthy();
    expect(JSON.parse(screen.getByTestId('map').getAttribute('data-origin') as string)).toEqual(
      origin,
    );
    expect(
      pinsOnMap()
        .map((p: { kind: string }) => p.kind)
        .sort(),
    ).toEqual(['learned', 'live', 'live']);
  });

  it('lists name, price, saving badge, distance, freshness and a Raasta link for each shop', () => {
    renderApp(
      <Results api={fakeSeekerApi()} initial={answered} origin={origin} onDone={vi.fn()} />,
    );
    const gupta = rows().find((r) => within(r).queryByText('Gupta Stores')) as HTMLElement;
    expect(within(gupta).getByText('₹48')).toBeTruthy();
    expect(within(gupta).getByText('₹12 bachenge')).toBeTruthy();
    expect(within(gupta).getByText('1.2 km door')).toBeTruthy();
    expect(within(gupta).getByText('Confirmed 5 min ago')).toBeTruthy();
    const link = within(gupta).getByRole('link', { name: 'Raasta' });
    expect(link.getAttribute('href')).toBe(
      'https://www.google.com/maps/dir/?api=1&destination=22.73,75.87',
    );
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toMatch(/noopener/);
  });

  it('shows no badge when there is no saving', () => {
    renderApp(
      <Results api={fakeSeekerApi()} initial={answered} origin={origin} onDone={vi.fn()} />,
    );
    const jain = rows().find((r) => within(r).queryByText('Jain Mart')) as HTMLElement;
    expect(within(jain).queryByText(/bachenge/)).toBeNull();
  });

  it('sorts by price (Sasta) when the user gave a price, and switches to distance (Paas)', async () => {
    const { user } = renderApp(
      <Results api={fakeSeekerApi()} initial={answered} origin={origin} onDone={vi.fn()} />,
    );
    const names = () => rows().map((r) => r.querySelector('h3')?.textContent);
    expect(names()).toEqual(['Gupta Stores', 'Sharma Kirana', 'Jain Mart']);
    expect(screen.getByRole('button', { name: 'Sasta' }).getAttribute('aria-pressed')).toBe('true');

    await user.click(screen.getByRole('button', { name: 'Paas' }));
    expect(names()).toEqual(['Jain Mart', 'Sharma Kirana', 'Gupta Stores']);
    expect(screen.getByRole('button', { name: 'Paas' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('sorts by distance first when there is no price to beat', () => {
    const noTarget = { ...answered };
    delete noTarget.targetPricePaise;
    renderApp(
      <Results api={fakeSeekerApi()} initial={noTarget} origin={origin} onDone={vi.fn()} />,
    );
    expect(rows()[0]?.querySelector('h3')?.textContent).toBe('Jain Mart');
  });

  it('says how many shops were asked, said yes and are still to reply', () => {
    renderApp(
      <Results api={fakeSeekerApi()} initial={answered} origin={origin} onDone={vi.fn()} />,
    );
    expect(
      screen.getByText(
        '10 dukaanon se poocha · 4 ne haan kaha · 6 ne mana kiya · 0 ka jawab baaki',
      ),
    ).toBeTruthy();
  });

  it('counts down to the deadline', async () => {
    renderApp(
      <Results api={fakeSeekerApi()} initial={answered} origin={origin} onDone={vi.fn()} />,
    );
    expect(screen.getByText('Bache hain 12:00')).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(screen.getByText('Bache hain 11:55')).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(12 * 60_000);
    });
    expect(screen.getByText('Samay poora hua')).toBeTruthy();
  });

  it('waits kindly while no shop has said yes', () => {
    renderApp(
      <Results
        api={fakeSeekerApi()}
        initial={seekerRequest({ pingStats: { sent: 4, yes: 0, no: 1, pending: 3 } })}
        origin={origin}
        onDone={vi.fn()}
      />,
    );
    expect(screen.getByText(/Abhi kisi ne haan nahi kaha/)).toBeTruthy();
    expect(
      screen.getByText('4 dukaanon se poocha · 0 ne haan kaha · 1 ne mana kiya · 3 ka jawab baaki'),
    ).toBeTruthy();
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
  });

  describe('live', () => {
    it('opens a stream with a ticket and shows the live dot only while it is open', async () => {
      const api = fakeSeekerApi();
      renderApp(
        <Results api={api} initial={answered} origin={origin} onDone={vi.fn()} live={live} />,
      );
      await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
      expect(FakeEventSource.last().url).toBe('/events?ticket=ticket-1');
      expect(screen.queryByRole('img', { name: 'Live' })).toBeNull();
      act(() => FakeEventSource.last().open());
      expect(screen.getByRole('img', { name: 'Live' })).toBeTruthy();
      act(() => FakeEventSource.last().fail());
      expect(screen.queryByRole('img', { name: 'Live' })).toBeNull();
    });

    it('refetches the request on request.updated, so new shops and pins appear without a reload', async () => {
      const first = seekerRequest({ pingStats: { sent: 3, yes: 0, no: 0, pending: 3 } });
      const getRequest = vi.fn().mockResolvedValue(first);
      renderApp(
        <Results
          api={fakeSeekerApi({ getRequest })}
          initial={first}
          origin={origin}
          onDone={vi.fn()}
          live={live}
        />,
      );
      await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
      expect(pinsOnMap()).toEqual([]);

      getRequest.mockResolvedValue(
        seekerRequest({
          state: 'ANSWERED',
          pingStats: { sent: 3, yes: 1, no: 0, pending: 2 },
          results: [result({ shopId: 'n', name: 'New Pin Store', pricePaise: 5000 })],
        }),
      );
      act(() =>
        FakeEventSource.last().emit('request.updated', { requestId: 'req-1', state: 'ANSWERED' }),
      );
      expect(await screen.findByText('New Pin Store')).toBeTruthy();
      expect(pinsOnMap()).toHaveLength(1);
      expect(
        screen.getByText(
          '3 dukaanon se poocha · 1 ne haan kaha · 0 ne mana kiya · 2 ka jawab baaki',
        ),
      ).toBeTruthy();
      expect(getRequest).toHaveBeenCalledWith('req-1');
    });

    it('polls every 15 seconds as a fallback', async () => {
      const getRequest = vi.fn().mockResolvedValue(answered);
      renderApp(
        <Results
          api={fakeSeekerApi({ getRequest })}
          initial={answered}
          origin={origin}
          onDone={vi.fn()}
        />,
      );
      await act(async () => {
        await vi.advanceTimersByTimeAsync(14_000);
      });
      expect(getRequest).not.toHaveBeenCalled();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1500);
      });
      expect(getRequest).toHaveBeenCalledTimes(1);
    });

    it('stops listening and polling when it goes away', async () => {
      const getRequest = vi.fn().mockResolvedValue(answered);
      const { unmount } = renderApp(
        <Results
          api={fakeSeekerApi({ getRequest })}
          initial={answered}
          origin={origin}
          onDone={vi.fn()}
          live={live}
        />,
      );
      await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
      const source = FakeEventSource.last();
      unmount();
      expect(source.closed).toBe(true);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });
      expect(getRequest).not.toHaveBeenCalled();
    });
  });

  it('"Ho gaya" closes the request and goes back', async () => {
    const api = fakeSeekerApi();
    const onDone = vi.fn();
    const { user } = renderApp(
      <Results api={api} initial={answered} origin={origin} onDone={onDone} />,
    );
    await user.click(screen.getByRole('button', { name: 'Ho gaya' }));
    await waitFor(() => expect(api.closeRequest).toHaveBeenCalledExactlyOnceWith('req-1'));
    expect(onDone).toHaveBeenCalled();
  });

  it('speaks English when asked to', () => {
    renderApp(
      <Results api={fakeSeekerApi()} initial={answered} origin={origin} onDone={vi.fn()} />,
      'en',
    );
    expect(
      screen.getByText('10 shops asked · 4 said yes · 6 said no · 0 yet to reply'),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cheapest' })).toBeTruthy();
    expect(screen.getAllByRole('link', { name: 'Directions' })).toHaveLength(3);
  });
});

describe('Results for a new item (ADR-0028)', () => {
  const fresh = seekerRequest({
    state: 'PINGING',
    item: {
      id: 'u1',
      slug: 'u-123',
      nameEn: 'Bead dazzling kit',
      nameHi: 'Bead dazzling kit',
      category: 'stationery',
      unverified: true,
    },
    pingStats: { sent: 3, yes: 0, no: 0, pending: 3 },
  });

  it('says "Nayi cheez: dukaanon se pooch rahe hain" while nobody has confirmed it', () => {
    renderApp(
      <Results
        api={fakeSeekerApi()}
        initial={fresh}
        origin={origin}
        onDone={vi.fn()}
        live={live}
      />,
    );
    expect(screen.getByText('Nayi cheez: dukaanon se pooch rahe hain')).toBeTruthy();
  });

  it('says nothing special for a catalog item or once a shop has said yes', () => {
    const verified = { ...fresh, item: { ...(fresh.item as object), unverified: false } };
    renderApp(
      <Results
        api={fakeSeekerApi()}
        initial={verified as typeof fresh}
        origin={origin}
        onDone={vi.fn()}
        live={live}
      />,
    );
    expect(screen.queryByText('Nayi cheez: dukaanon se pooch rahe hain')).toBeNull();
  });
});

describe('Results with a shop photo', () => {
  it("shows the shop's photo on its card, tap to enlarge, and none for a shop without one", async () => {
    const api = fakeSeekerApi();
    const request = seekerRequest({
      state: 'ANSWERED',
      pingStats: { sent: 2, yes: 2, no: 0, pending: 0 },
      results: [
        result({ shopId: 'a', name: 'Sharma Kirana', photoId: 'shop-photo-1' }),
        result({ shopId: 'b', name: 'Gupta Stores' }),
      ],
    });
    const { user } = renderApp(
      <Results api={api} initial={request} origin={origin} onDone={vi.fn()} live={live} />,
    );
    const photo = await screen.findByRole('button', { name: 'Dukaan ki photo: bada karein' });
    expect(within(photo.closest('li') as HTMLElement).getByText('Sharma Kirana')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /Dukaan ki photo/ })).toHaveLength(1);
    expect(api.photoSrc).toHaveBeenCalledWith('shop-photo-1');
    await user.click(photo);
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});
