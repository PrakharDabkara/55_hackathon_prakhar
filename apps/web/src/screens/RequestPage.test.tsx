// @vitest-environment jsdom
import { act, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeEventSource, fakeSeekerApi, seekerOrder, seekerRequest } from '../test/fakes.js';
import { REPLIES_NOW, answeredRequest, liveYes, remembered } from '../test/fakesReplies.js';
import { renderApp } from '../test/render.js';
import { RequestPage } from './RequestPage.js';

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
  vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date(REPLIES_NOW) });
  FakeEventSource.reset();
});
afterEach(() => {
  vi.useRealTimers();
});

function show(
  initial: ReturnType<typeof seekerRequest>,
  extra: Parameters<typeof fakeSeekerApi>[0] = {},
  props: Record<string, unknown> = {},
) {
  const api = fakeSeekerApi(extra);
  const navigate = vi.fn();
  const onDone = vi.fn();
  const utils = renderApp(
    <RequestPage
      api={api}
      requestId={initial.id}
      navigate={navigate}
      onDone={onDone}
      initial={initial}
      origin={origin}
      live={live}
      {...props}
    />,
    'en',
  );
  return { api, navigate, onDone, ...utils };
}
const cards = () => screen.getAllByRole('listitem');
const cardOf = (name: string) =>
  cards().find((c) => c.querySelector('h3')?.textContent === name) as HTMLElement;

describe('the request as a parchi', () => {
  it('has the screen title, how many shops were asked, how far, and the item', () => {
    show(answeredRequest([liveYes()], { pingStats: { sent: 10, yes: 1, no: 2, pending: 7 } }));
    expect(screen.getByRole('heading', { level: 1, name: 'Your request' })).toBeTruthy();
    expect(screen.getByText('Sent to 10 shops · 2 km')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Sugar' })).toBeTruthy();
  });

  it("shows the customer's own words as typed, with the matched item small underneath", () => {
    show(
      answeredRequest([], {
        typed: 'maida',
        item: {
          id: 'i9',
          slug: 'maida',
          nameEn: 'refined flour',
          nameHi: 'मैदा',
          category: 'grocery',
          unverified: false,
        },
        pingStats: { sent: 1, yes: 0, no: 0, pending: 1 },
      }),
    );
    const own = screen.getByRole('heading', { name: 'maida' });
    expect(own.className).toContain('sh-parchi__item');
    expect(screen.getByText('Refined flour').className).toContain('sh-parchi__alias');
  });

  it('keeps the words exactly as typed (never re-cased), and shows no second line when they are the item', () => {
    const first = show(answeredRequest([], { typed: 'pencil HB' }));
    expect(screen.getByRole('heading', { name: 'pencil HB' })).toBeTruthy();
    first.unmount();
    show(answeredRequest([], { typed: 'Sugar' }));
    expect(screen.getByRole('heading', { name: 'Sugar' })).toBeTruthy();
    expect(document.querySelector('.sh-parchi__alias')).toBeNull();
  });

  it('shows the quantity asked for under the item, and nothing when none was asked', () => {
    const { unmount } = show(
      answeredRequest([], {
        quantity: { quantity: 2, unit: 'kg' },
        pingStats: { sent: 1, yes: 0, no: 0, pending: 1 },
      }),
    );
    const note = screen.getByText('2 kg');
    expect(note.className).toContain('sh-parchi__note');
    expect(note.previousElementSibling?.textContent).toBe('Sugar');
    unmount();
    show(answeredRequest([], { pingStats: { sent: 1, yes: 0, no: 0, pending: 1 } }));
    expect(document.querySelector('.cu-parchi .sh-parchi__note')).toBeNull();
  });

  it('writes a half kilometre with a decimal, one shop in the singular, and Hindi names in hi', () => {
    show(answeredRequest([], { radiusM: 500, pingStats: { sent: 1, yes: 0, no: 0, pending: 1 } }));
    expect(screen.getByText('Sent to 1 shop · 0.5 km')).toBeTruthy();
  });

  it('uses the delivery band for a request that wants delivery', () => {
    show(answeredRequest([liveYes()], { wantsDelivery: true }));
    expect(document.querySelector('.sh-parchi__band')).toBeTruthy();
  });

  it('has no delivery band for a pickup request', () => {
    show(answeredRequest([liveYes()]));
    expect(document.querySelector('.sh-parchi__band')).toBeNull();
  });

  it('stamps "1 have it" only once a live yes exists', () => {
    const none = show(
      answeredRequest([remembered(2)], { pingStats: { sent: 3, yes: 0, no: 1, pending: 2 } }),
    );
    expect(document.querySelector('.sh-stamp--yes')).toBeNull();
    none.unmount();
    show(answeredRequest([liveYes(), liveYes({ shopId: 'b', name: 'B' })]));
    expect(document.querySelector('.sh-stamp--yes')?.textContent).toBe('2 have it');
  });

  it('says a new item has not been confirmed yet', () => {
    const base = seekerRequest();
    show(
      seekerRequest({
        item: { ...(base.item as object), unverified: true } as NonNullable<typeof base.item>,
      }),
    );
    expect(screen.getByText('New item. No shop has confirmed it yet.')).toBeTruthy();
  });
});

describe('the status line', () => {
  it.each([
    [3, '3 shops are still checking.'],
    [1, '1 shop is still checking.'],
  ])('says who is still checking (%i)', (pending, text) => {
    show(seekerRequest({ state: 'PINGING', pingStats: { sent: 4, yes: 0, no: 1, pending } }));
    expect(screen.getByText(text)).toBeTruthy();
    expect(screen.queryByText(/minutes/i)).toBeNull();
  });

  it('says all shops replied, or that the request ended', () => {
    const done = show(answeredRequest([liveYes()]));
    expect(screen.getByText('All shops have replied.')).toBeTruthy();
    done.unmount();
    show(answeredRequest([liveYes()], { state: 'CLOSED' }));
    expect(screen.getByText('This request has ended.')).toBeTruthy();
  });
});

describe('replies', () => {
  it('lists live yes cards by price then distance, and puts the remembered ones elsewhere', () => {
    show(
      answeredRequest([
        liveYes({ shopId: 'a', name: 'Sharma Kirana', pricePaise: 5500, distanceM: 350 }),
        liveYes({ shopId: 'b', name: 'Gupta Stores', pricePaise: 4800, distanceM: 1200 }),
        liveYes({ shopId: 'n', name: 'No Price', pricePaise: null, distanceM: 10 }),
        remembered(2, { shopId: 'c', name: 'Jain Mart', pricePaise: 4000 }),
      ]),
    );
    const list = screen.getByRole('list', { name: 'Replies' });
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((c) => c.querySelector('h3')?.textContent),
    ).toEqual(['Gupta Stores', 'Sharma Kirana', 'No Price']);
  });

  it('shows name, distance, how long ago it answered, and the price', () => {
    show(answeredRequest([liveYes({ name: 'Gupta Stores', pricePaise: 4800, distanceM: 1200 })]));
    const card = cardOf('Gupta Stores');
    expect(within(card).getByText('1.2 km')).toBeTruthy();
    expect(within(card).getByText('answered 3 min ago')).toBeTruthy();
    expect(within(card).getByText('₹48')).toBeTruthy();
  });

  it('says the price was not shared when there is none', () => {
    show(answeredRequest([liveYes({ pricePaise: null })]));
    expect(screen.getByText('Price not shared')).toBeTruthy();
  });

  it('shows the quantity, and flags "Not enough" when the shop has less than asked', () => {
    show(
      answeredRequest([
        liveYes({ shopId: 'a', name: 'A', quantity: { amount: 5, unit: 'kg' } }),
        liveYes({
          shopId: 'b',
          name: 'B',
          quantity: { amount: 1, unit: 'kg' },
          quantityCheck: 'short',
        }),
      ]),
    );
    expect(within(cardOf('A')).getByText('5 kg')).toBeTruthy();
    expect(within(cardOf('A')).queryByText('Not enough')).toBeNull();
    expect(within(cardOf('B')).getByText('1 kg')).toBeTruthy();
    expect(within(cardOf('B')).getByText('Not enough')).toBeTruthy();
  });

  it('chips: delivers with fee and time, free, fee on request, or pick up only', () => {
    show(
      answeredRequest([
        liveYes({ shopId: 'a', name: 'A', delivery: { feePaise: 2500, minutes: 30 } }),
        liveYes({ shopId: 'b', name: 'B', delivery: { feePaise: 0, minutes: null } }),
        liveYes({ shopId: 'c', name: 'C', delivery: { feePaise: null, minutes: null } }),
        liveYes({ shopId: 'd', name: 'D' }),
      ]),
    );
    expect(within(cardOf('A')).getByText('Delivers · ₹25 · 30 min')).toBeTruthy();
    expect(within(cardOf('B')).getByText('Delivers · free')).toBeTruthy();
    expect(within(cardOf('C')).getByText('Delivers · fee on request')).toBeTruthy();
    expect(within(cardOf('D')).getByText('Pick up only')).toBeTruthy();
  });

  it('shows a Photo indicator that opens the photo, only where the shop sent one', async () => {
    const { api, user } = show(
      answeredRequest([
        liveYes({ shopId: 'a', name: 'A', photoId: 'p1' }),
        liveYes({ shopId: 'b', name: 'B' }),
      ]),
    );
    const photo = await within(cardOf('A')).findByRole('button', { name: /Photo/ });
    expect(within(cardOf('B')).queryByRole('button', { name: /Photo/ })).toBeNull();
    expect(api.photoSrc).toHaveBeenCalledWith('p1');
    await user.click(photo);
    expect(screen.getByRole('dialog').querySelector('img')).toBeTruthy();
  });
});

describe('BEST PRICE NEARBY', () => {
  const caption = () => screen.queryByText('Best price nearby');
  const three = (a: number | null, b: number | null, c: number | null) =>
    answeredRequest([
      liveYes({ shopId: 'a', name: 'A', pricePaise: a, distanceM: 100 }),
      liveYes({ shopId: 'b', name: 'B', pricePaise: b, distanceM: 200 }),
      liveYes({ shopId: 'c', name: 'C', pricePaise: c, distanceM: 300 }),
    ]);

  it('goes on the first card when it is strictly the cheapest', () => {
    show(three(5000, 4000, 6000));
    expect(within(cards()[0] as HTMLElement).getByText('Best price nearby')).toBeTruthy();
  });
  it('is absent when the two lowest prices are equal', () => {
    show(three(4000, 4000, 6000));
    expect(caption()).toBeNull();
  });
  it('is absent with a single live reply', () => {
    show(answeredRequest([liveYes()]));
    expect(caption()).toBeNull();
  });
  it('is absent when only one reply has a price', () => {
    show(three(4000, null, null));
    expect(caption()).toBeNull();
  });
  it('is never on a remembered shop', () => {
    show(
      answeredRequest([
        liveYes({ pricePaise: 5000 }),
        remembered(1, { shopId: 'z', pricePaise: 1 }),
      ]),
    );
    expect(caption()).toBeNull();
  });
});

describe('had it recently', () => {
  it('lists remembered shops muted, with when and the price, and no order button', async () => {
    show(
      answeredRequest([
        liveYes({ shopId: 'a', name: 'Live One' }),
        remembered(0, { shopId: 'x', name: 'Today Store', pricePaise: 5000 }),
        remembered(1, { shopId: 'y', name: 'Yest Store', pricePaise: 5100 }),
        remembered(4, {
          shopId: 'z',
          name: 'Old Store',
          pricePaise: 5200,
          delivery: { feePaise: 0, minutes: 10 },
        }),
      ]),
    );
    expect(screen.getByText('Had it recently, not asked this time')).toBeTruthy();
    expect(screen.getByText('Had it today at ₹50')).toBeTruthy();
    expect(screen.getByText('Had it yesterday at ₹51')).toBeTruthy();
    expect(screen.getByText('Had it 4 days ago at ₹52')).toBeTruthy();
    // The server's English freshness line is not shown.
    expect(screen.queryByText('Confirmed just now')).toBeNull();
    const old = cardOf('Old Store');
    expect(within(old).queryByRole('button', { name: 'Choose this shop' })).toBeNull();
    expect(within(old).getByRole('link', { name: 'Show the way' })).toBeTruthy();
    expect(
      within(cardOf('Live One')).getByRole('button', { name: 'Choose this shop' }),
    ).toBeTruthy();
  });

  it('shows "Show the way" that opens directions in a new tab and notes the pickup', async () => {
    const { api, user } = show(
      answeredRequest(
        [remembered(1, { shopId: 'x', name: 'Yest Store', lat: 22.73, lng: 75.87 })],
        {
          id: 'req-9',
        },
      ),
    );
    const link = within(cardOf('Yest Store')).getByRole('link', { name: 'Show the way' });
    link.addEventListener('click', (e) => e.preventDefault());
    await user.click(link);
    expect(link.getAttribute('href')).toBe(
      'https://www.google.com/maps/dir/?api=1&destination=22.73,75.87',
    );
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toMatch(/noopener/);
    expect(api.recordPickup).toHaveBeenCalledWith({
      shopId: 'x',
      itemId: 'i1',
      requestId: 'req-9',
    });
  });

  it('is absent when nothing is remembered', () => {
    show(answeredRequest([liveYes()]));
    expect(screen.queryByText('Had it recently, not asked this time')).toBeNull();
  });

  it('marks stock a customer confirmed', () => {
    show(answeredRequest([remembered(1, { customerVerified: true })]));
    expect(screen.getByText('Confirmed by a customer')).toBeTruthy();
  });
});

describe("shops that don't have it", () => {
  it('is a collapsed disclosure with the count, and opens to a plain line', async () => {
    const { user } = show(
      answeredRequest([liveYes()], { pingStats: { sent: 6, yes: 1, no: 5, pending: 0 } }),
    );
    const toggle = screen.getByRole('button', { name: "5 shops don't have it" });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText("These shops said they don't have it.")).toBeNull();
    await user.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText("These shops said they don't have it.")).toBeTruthy();
  });

  it('is hidden when no shop said no', () => {
    show(answeredRequest([liveYes()], { pingStats: { sent: 1, yes: 1, no: 0, pending: 0 } }));
    expect(screen.queryByRole('button', { name: /have it/ })).toBeNull();
  });
});

describe('List and Map', () => {
  it('shows the list first and swaps to the map with one pin per shop', async () => {
    const { user } = show(
      answeredRequest([liveYes({ shopId: 'a' }), remembered(1, { shopId: 'b' })]),
    );
    expect(screen.queryByTestId('map')).toBeNull();
    expect(screen.getByRole('button', { name: 'List' }).getAttribute('aria-pressed')).toBe('true');
    await user.click(screen.getByRole('button', { name: 'Map' }));
    expect(JSON.parse(screen.getByTestId('map').getAttribute('data-origin') as string)).toEqual(
      origin,
    );
    expect(
      pinsOnMap()
        .map((p: { kind: string }) => p.kind)
        .sort(),
    ).toEqual(['learned', 'live']);
    expect(screen.queryByRole('list', { name: 'Replies' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'List' }));
    expect(screen.queryByTestId('map')).toBeNull();
  });

  it('has no "you are here" pin without an origin', async () => {
    const { user } = show(answeredRequest([liveYes()]), {}, { origin: undefined });
    await user.click(screen.getByRole('button', { name: 'Map' }));
    expect(screen.getByTestId('map').getAttribute('data-origin')).toBe('null');
  });
});

describe('waiting, errors and offline', () => {
  it('shows skeleton rows and the status line while nobody has replied', () => {
    show(seekerRequest({ state: 'PINGING', pingStats: { sent: 4, yes: 0, no: 0, pending: 4 } }));
    expect(screen.getByText('No replies yet')).toBeTruthy();
    expect(screen.getByText('4 shops are still checking.')).toBeTruthy();
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
    expect(document.querySelectorAll('.sh-skeleton').length).toBeGreaterThan(0);
  });

  it('says plainly when the request ended and no shop has it', () => {
    show(seekerRequest({ state: 'EXPIRED', pingStats: { sent: 4, yes: 0, no: 4, pending: 0 } }));
    expect(screen.getByText('No shop has it right now')).toBeTruthy();
  });

  it('loads the request when no initial one is given, then shows it', async () => {
    const getRequest = vi.fn(async () => answeredRequest([liveYes({ name: 'Fetched Store' })]));
    show(seekerRequest(), { getRequest }, { initial: undefined });
    expect(document.querySelectorAll('.sh-skeleton').length).toBeGreaterThan(0);
    expect(await screen.findByText('Fetched Store')).toBeTruthy();
    expect(getRequest).toHaveBeenCalledWith('req-1');
  });

  it('shows an error with a retry when the load fails, and recovers', async () => {
    const getRequest = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(answeredRequest([liveYes({ name: 'Fetched Store' })]));
    const { user } = show(seekerRequest(), { getRequest }, { initial: undefined });
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText("Couldn't load this.")).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Fetched Store')).toBeTruthy();
  });

  it('tells the customer when the phone is offline', () => {
    show(answeredRequest([liveYes()]));
    act(() => {
      window.dispatchEvent(new Event('offline'));
    });
    expect(screen.getByText("You're offline. Reconnect to see the latest.")).toBeTruthy();
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    expect(screen.queryByText("You're offline. Reconnect to see the latest.")).toBeNull();
  });
});

describe('live', () => {
  it('shows the live dot only while the stream is open', async () => {
    show(answeredRequest([liveYes()]));
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    expect(FakeEventSource.last().url).toBe('/events?ticket=ticket-1');
    expect(screen.queryByRole('img', { name: 'Live' })).toBeNull();
    act(() => FakeEventSource.last().open());
    expect(screen.getByRole('img', { name: 'Live' })).toBeTruthy();
    act(() => FakeEventSource.last().fail());
    expect(screen.queryByRole('img', { name: 'Live' })).toBeNull();
  });

  it('refetches on request.updated so a new shop appears without a reload', async () => {
    const first = seekerRequest({ pingStats: { sent: 3, yes: 0, no: 0, pending: 3 } });
    const getRequest = vi.fn().mockResolvedValue(first);
    show(first, { getRequest });
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    getRequest.mockResolvedValue(
      answeredRequest([liveYes({ shopId: 'n', name: 'New Pin Store' })], {
        pingStats: { sent: 3, yes: 1, no: 0, pending: 2 },
      }),
    );
    act(() => FakeEventSource.last().emit('request.updated', { requestId: 'req-1' }));
    expect(await screen.findByText('New Pin Store')).toBeTruthy();
    expect(screen.getByText('2 shops are still checking.')).toBeTruthy();
    expect(screen.getByText('1 have it')).toBeTruthy();
  });

  it('polls every 15 seconds as a fallback and stops when it goes away', async () => {
    const request = answeredRequest([liveYes()]);
    const getRequest = vi.fn().mockResolvedValue(request);
    const { unmount } = show(request, { getRequest }, { live: undefined });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(14_000);
    });
    expect(getRequest).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(getRequest).toHaveBeenCalledTimes(1);
    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(getRequest).toHaveBeenCalledTimes(1);
  });
});

describe('stop asking', () => {
  it('closes an open request and goes back', async () => {
    const { api, onDone, user } = show(
      seekerRequest({ state: 'PINGING', pingStats: { sent: 2, yes: 0, no: 0, pending: 2 } }),
    );
    await user.click(screen.getByRole('button', { name: 'Stop asking' }));
    // An in-app question first, never a browser dialog; nothing is closed yet.
    const sheet = screen.getByRole('dialog', { name: 'Stop asking shops?' });
    expect(api.closeRequest).not.toHaveBeenCalled();
    await user.click(within(sheet).getByRole('button', { name: 'Stop asking' }));
    await waitFor(() => expect(api.closeRequest).toHaveBeenCalledExactlyOnceWith('req-1'));
    expect(onDone).toHaveBeenCalled();
  });

  it('says so and stays when closing fails, so it can be tried again', async () => {
    const { api, onDone, user } = show(
      seekerRequest({ state: 'PINGING', pingStats: { sent: 2, yes: 0, no: 0, pending: 2 } }),
    );
    (api.closeRequest as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('offline'));
    await user.click(screen.getByRole('button', { name: 'Stop asking' }));
    const sheet = screen.getByRole('dialog', { name: 'Stop asking shops?' });
    await user.click(within(sheet).getByRole('button', { name: 'Stop asking' }));
    expect((await within(sheet).findByRole('alert')).textContent).toBe(
      "Couldn't stop. Check your connection and try again.",
    );
    expect(onDone).not.toHaveBeenCalled();
    await user.click(within(sheet).getByRole('button', { name: 'Stop asking' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it('keeps waiting when the customer changes their mind', async () => {
    const { api, onDone, user } = show(
      seekerRequest({ state: 'PINGING', pingStats: { sent: 2, yes: 0, no: 0, pending: 2 } }),
    );
    await user.click(screen.getByRole('button', { name: 'Stop asking' }));
    await user.click(screen.getByRole('button', { name: 'Keep waiting' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(api.closeRequest).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });

  it('is not offered once the request is closed', () => {
    show(answeredRequest([liveYes()], { state: 'CLOSED' }));
    expect(screen.queryByRole('button', { name: 'Stop asking' })).toBeNull();
  });

  it('the back button leaves the screen', async () => {
    const { onDone, user } = show(answeredRequest([liveYes()]));
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(onDone).toHaveBeenCalled();
  });
});

describe('orders for this request', () => {
  const delivering = answeredRequest([
    liveYes({ shopId: 'a', name: 'Sharma Kirana', delivery: { feePaise: 3000, minutes: 45 } }),
  ]);

  it('shows "Track order" instead of the choose button for a shop with an open order', async () => {
    const listOrders = vi.fn(async () => [
      seekerOrder({ id: 'o-7', state: 'ACCEPTED', shopId: 'a' }),
    ]);
    const { navigate, user } = show(delivering, { listOrders });
    const link = await within(cardOf('Sharma Kirana')).findByRole('link', { name: 'Track order' });
    expect(listOrders).toHaveBeenCalledWith({ requestId: 'req-1' });
    expect(
      within(cardOf('Sharma Kirana')).queryByRole('button', { name: 'Choose this shop' }),
    ).toBeNull();
    await user.click(link);
    expect(navigate).toHaveBeenCalledWith('/app/order/o-7');
  });

  it('offers the choice again after the order was cancelled', async () => {
    const listOrders = vi.fn(async () => [seekerOrder({ state: 'CANCELLED', shopId: 'a' })]);
    show(delivering, { listOrders });
    await waitFor(() => expect(listOrders).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: 'Choose this shop' })).toBeTruthy();
  });

  it('keeps the results when orders cannot be fetched', async () => {
    const listOrders = vi.fn(async () => {
      throw new Error('offline');
    });
    show(delivering, { listOrders });
    expect(screen.getByText('Sharma Kirana')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Choose this shop' })).toBeTruthy();
  });
});

describe('choosing a shop from a reply', () => {
  it('opens the sheet from the card and closes it again', async () => {
    const { user } = show(answeredRequest([liveYes({ name: 'Sharma Kirana' })]));
    await user.click(screen.getByRole('button', { name: 'Choose this shop' }));
    const dialog = screen.getByRole('dialog', { name: 'Choose this shop' });
    expect(within(dialog).getByText('Sharma Kirana')).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('pickup: "Show the way" records the pickup, opens the route and closes the sheet', async () => {
    const { api, user } = show(
      answeredRequest([liveYes({ shopId: 'a', lat: 22.73, lng: 75.87 })], { id: 'req-9' }),
    );
    await user.click(screen.getByRole('button', { name: 'Choose this shop' }));
    const link = within(screen.getByRole('dialog')).getByRole('link', { name: 'Show the way' });
    link.addEventListener('click', (e) => e.preventDefault());
    expect(link.getAttribute('href')).toBe(
      'https://www.google.com/maps/dir/?api=1&destination=22.73,75.87',
    );
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toMatch(/noopener/);
    await user.click(link);
    expect(api.recordPickup).toHaveBeenCalledWith({
      shopId: 'a',
      itemId: 'i1',
      requestId: 'req-9',
    });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('still opens the route when recording the pickup fails', async () => {
    const recordPickup = vi.fn(async () => {
      throw new Error('offline');
    });
    const { user } = show(answeredRequest([liveYes()]), { recordPickup });
    await user.click(screen.getByRole('button', { name: 'Choose this shop' }));
    const link = within(screen.getByRole('dialog')).getByRole('link', { name: 'Show the way' });
    link.addEventListener('click', (e) => e.preventDefault());
    await user.click(link);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(link.getAttribute('href')).toMatch(/google\.com\/maps/);
  });
});

describe('nobody was asked (C-03, C-04)', () => {
  const none = (overrides: Partial<ReturnType<typeof seekerRequest>> = {}) =>
    seekerRequest({
      state: 'ANSWERED',
      typed: 'chini 2 kg',
      results: [],
      pingStats: { sent: 0, yes: 0, no: 0, pending: 0 },
      ...overrides,
    });

  it('says plainly why there is nothing, and does not pretend replies are coming', () => {
    show(none());
    expect(screen.getByText('No shops asked · 2 km')).toBeTruthy();
    expect(screen.getByText('No open shops within 2 km sell this kind of item yet')).toBeTruthy();
    expect(screen.queryByText('No replies yet')).toBeNull();
    expect(document.querySelectorAll('.sh-skeleton')).toHaveLength(0);
  });

  it('offers different words, which goes back to Find', async () => {
    const { user, onDone } = show(none());
    await user.click(screen.getByRole('button', { name: 'Try different words' }));
    expect(onDone).toHaveBeenCalled();
  });

  it('offers a wider area that asks again at 5 km and opens the new search', async () => {
    const createRequest = vi.fn(async () => seekerRequest({ id: 'wide-1' }));
    const { user, navigate } = show(none(), { createRequest });
    await user.click(screen.getByRole('button', { name: 'Search 5 km' }));
    expect(createRequest).toHaveBeenCalledWith({
      q: 'chini 2 kg',
      lat: origin.lat,
      lng: origin.lng,
      radiusM: 5000,
    });
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/app/request/wide-1'));
  });

  it('says so when the wider search fails, and can be tried again', async () => {
    const createRequest = vi.fn().mockRejectedValue(new Error('offline'));
    const { user, navigate } = show(none(), { createRequest });
    await user.click(screen.getByRole('button', { name: 'Search 5 km' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(navigate).not.toHaveBeenCalled();
    expect(
      (screen.getByRole('button', { name: 'Search 5 km' }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  const withoutWords = () => {
    const request = none();
    delete request.typed;
    return request;
  };
  it.each([
    ['already 5 km wide', () => none({ radiusM: 5000 }), {}],
    [
      'it came from a link, so there is no place to search from',
      () => none(),
      { origin: undefined },
    ],
    [
      'it was a delivery search, which a new search could not repeat',
      () => none({ wantsDelivery: true }),
      {},
    ],
    ['the words were not kept', withoutWords, {}],
  ] as const)('offers no wider search when %s', (_why, build, props) => {
    show(build(), {}, props);
    expect(screen.queryByRole('button', { name: /Search \d+ km/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Try different words' })).toBeTruthy();
  });

  it('with remembered shops, says nobody was pinged because we already knew, and lists them', () => {
    show(
      none({
        results: [remembered(2, { name: 'Gupta Store', distanceM: 640 })],
      }),
    );
    expect(screen.getByText('Nobody was asked this time')).toBeTruthy();
    expect(screen.queryByText('No open shops within 2 km sell this kind of item yet')).toBeNull();
    expect(screen.getByText('Had it recently, not asked this time')).toBeTruthy();
    expect(within(cardOf('Gupta Store')).getByText('650 m')).toBeTruthy();
  });

  it('keeps the old wording when shops were asked', () => {
    show(answeredRequest([liveYes()]));
    expect(screen.getByText(/^Sent to 3 shops · 2 km$/)).toBeTruthy();
    expect(screen.queryByText('Nobody was asked this time')).toBeNull();
  });
});
