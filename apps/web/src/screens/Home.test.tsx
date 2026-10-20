// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../lib/api.js';
import { errandListItem, fakeSeekerApi, seekerOrder, seekerRequest } from '../test/fakes.js';
import { renderApp } from '../test/render.js';
import { Home } from './Home.js';

// jsdom cannot decode or draw a picture: the shrink step (canvas) is replaced by a pass-through.
vi.mock('../lib/photo.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/photo.js')>()),
  shrinkPhoto: async (file: Blob) => file,
}));

beforeEach(() => sessionStorage.clear());
afterEach(() => vi.unstubAllGlobals());

function geolocation(impl: (ok: (p: unknown) => void, fail: (e: unknown) => void) => void) {
  vi.stubGlobal('navigator', { ...navigator, geolocation: { getCurrentPosition: impl } });
}
const here = () => geolocation((ok) => ok({ coords: { latitude: 12.97, longitude: 77.59 } }));

function setup(
  overrides: Parameters<typeof fakeSeekerApi>[0] = {},
  { loggedIn = true }: { loggedIn?: boolean } = {},
) {
  const api = fakeSeekerApi(overrides);
  const navigate = vi.fn();
  const onFound = vi.fn();
  const onLoggedIn = vi.fn();
  function Harness() {
    const [on, setOn] = useState(loggedIn);
    return (
      <Home
        api={api}
        loggedIn={on}
        onLoggedIn={(token) => {
          onLoggedIn(token);
          setOn(true);
        }}
        navigate={navigate}
        onFound={onFound}
      />
    );
  }
  const utils = renderApp(<Harness />, 'en');
  return { api, navigate, onFound, onLoggedIn, ...utils };
}

describe('Find', () => {
  it('shows the title, one box, the delivery switch and the errand card', () => {
    setup();
    expect(screen.getByRole('heading', { name: 'What do you need?' })).toBeTruthy();
    const box = screen.getByLabelText('What do you need?') as HTMLInputElement;
    expect(box.placeholder).toBe('e.g. javitri, 50 g');
    expect(screen.getByRole('switch', { name: 'Deliver to me' })).toBeTruthy();
    expect(screen.getByText('Shops that deliver will tell you their fee')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Find nearby' })).toBeTruthy();
    expect(screen.queryByLabelText(/seen elsewhere|dekha/i)).toBeNull();
  });

  it('links the errand card to /app/errand and never starts an errand by itself', async () => {
    const { user, navigate, api } = setup();
    const card = screen.getByRole('link', { name: /Plan an errand/ });
    expect(card.getAttribute('href')).toBe('/app/errand');
    expect(card.textContent).toMatch(/AI drafts the list/);
    await user.click(card);
    expect(navigate).toHaveBeenCalledWith('/app/errand');
    expect(api.createErrand).not.toHaveBeenCalled();
  });

  it('puts a chevron on the right of the errand card, and the whole card is one link', () => {
    setup();
    const card = screen.getByRole('link', { name: /Plan an errand/ });
    expect(card.querySelector('.cu-find__chevron')).toBeTruthy();
    expect(card.querySelector('.cu-find__chevron')?.getAttribute('aria-hidden')).toBe('true');
    expect(card.querySelectorAll('a, button')).toHaveLength(0);
  });

  describe('Continue your errand', () => {
    it('shows one card to the running errand, as a single link with a chevron', async () => {
      const myErrands = vi.fn(async () => [
        errandListItem({ id: 'e-9', task: 'school things for Riya' }),
      ]);
      const { user, navigate } = setup({ myErrands });
      const card = await screen.findByRole('link', { name: /Continue your errand/ });
      expect(card.getAttribute('href')).toBe('/app/errand/e-9');
      expect(card.textContent).toContain('school things for Riya');
      expect(card.textContent).toContain('Asking shops');
      expect(card.querySelector('.cu-find__chevron')).toBeTruthy();
      await user.click(card);
      expect(navigate).toHaveBeenCalledWith('/app/errand/e-9');
    });

    it('also shows a plan that is ready and recent', async () => {
      const recent = new Date(Date.now() - 3_600_000).toISOString();
      const myErrands = vi.fn(async () => [
        errandListItem({ state: 'PLAN_READY', createdAt: recent, expiresAt: recent }),
      ]);
      setup({ myErrands });
      const card = await screen.findByRole('link', { name: /Continue your errand/ });
      expect(card.textContent).toContain('Plan ready');
    });

    it('is not shown without an errand to continue, when logged out, or when the list fails', async () => {
      const ended = errandListItem({ state: 'CANCELLED' });
      const first = setup({ myErrands: vi.fn(async () => [ended]) });
      await waitFor(() => expect(first.api.myErrands).toHaveBeenCalled());
      expect(screen.queryByRole('link', { name: /Continue your errand/ })).toBeNull();
      first.unmount();
      const second = setup(
        { myErrands: vi.fn(async () => [errandListItem()]) },
        { loggedIn: false },
      );
      expect(second.api.myErrands).not.toHaveBeenCalled();
      second.unmount();
      setup({ myErrands: vi.fn(async () => Promise.reject(new Error('offline'))) });
      await waitFor(() =>
        expect(screen.getByRole('link', { name: /Plan an errand/ })).toBeTruthy(),
      );
      expect(screen.queryByRole('link', { name: /Continue your errand/ })).toBeNull();
    });
  });

  it('links to shopkeepers and no longer shows pickup, notifications or recent work', () => {
    setup({ recentWork: vi.fn(async () => []) });
    expect(screen.getByRole('link', { name: 'For shopkeepers' }).getAttribute('href')).toBe(
      '/app/shop',
    );
    expect(screen.queryByText(/Le liya|Did you pick/)).toBeNull();
  });

  it('says Near you and opens a location sheet with demo and manual entry', async () => {
    const { user, api, onFound } = setup();
    await user.click(screen.getByRole('button', { name: /Near you/ }));
    const sheet = screen.getByRole('dialog', { name: 'Change location' });
    await user.click(within(sheet).getByRole('button', { name: 'Use demo location (Indore)' }));
    await user.click(within(sheet).getByRole('button', { name: 'Done' }));
    await user.type(screen.getByLabelText('What do you need?'), 'chini');
    await user.click(screen.getByRole('button', { name: 'Find nearby' }));
    await waitFor(() =>
      expect(api.createRequest).toHaveBeenCalledExactlyOnceWith({
        q: 'chini',
        lat: 22.7196,
        lng: 75.8577,
      }),
    );
    expect(onFound).toHaveBeenCalledWith(seekerRequest(), { lat: 22.7196, lng: 75.8577 });
  });

  it('takes a typed latitude and longitude', async () => {
    const { user, api } = setup();
    await user.click(screen.getByRole('button', { name: /Near you/ }));
    await user.type(screen.getByLabelText('Latitude'), '28.61');
    await user.type(screen.getByLabelText('Longitude'), '77.2');
    await user.click(screen.getByRole('button', { name: 'Done' }));
    await user.type(screen.getByLabelText('What do you need?'), 'aata');
    await user.click(screen.getByRole('button', { name: 'Find nearby' }));
    await waitFor(() =>
      expect(api.createRequest).toHaveBeenCalledWith({ q: 'aata', lat: 28.61, lng: 77.2 }),
    );
  });

  it('tries the phone location by itself on Find, and opens the sheet if it fails', async () => {
    geolocation((_ok, fail) => fail({ code: 1 }));
    const { user, api } = setup();
    await user.type(screen.getByLabelText('What do you need?'), 'aata');
    await user.click(screen.getByRole('button', { name: 'Find nearby' }));
    expect(await screen.findByRole('dialog', { name: 'Change location' })).toBeTruthy();
    expect(screen.getByText(/Couldn't get your location/)).toBeTruthy();
    expect(api.createRequest).not.toHaveBeenCalled();
  });

  it('uses the phone location when allowed', async () => {
    here();
    const { user, api } = setup();
    await user.type(screen.getByLabelText('What do you need?'), 'aata');
    await user.click(screen.getByRole('button', { name: 'Find nearby' }));
    await waitFor(() =>
      expect(api.createRequest).toHaveBeenCalledWith({ q: 'aata', lat: 12.97, lng: 77.59 }),
    );
  });

  it('sends the delivery address it keeps, and reuses a saved one', async () => {
    here();
    const { user, api } = setup();
    await user.type(screen.getByLabelText('What do you need?'), 'aata');
    await user.click(screen.getByRole('switch', { name: 'Deliver to me' }));
    const find = screen.getByRole('button', { name: 'Find nearby' }) as HTMLButtonElement;
    expect(find.disabled).toBe(true);
    await user.type(screen.getByLabelText('Delivery address'), '12 MG Road');
    expect(screen.getByText(/We'll save this address so you don't type it again/)).toBeTruthy();
    await user.click(find);
    await waitFor(() =>
      expect(api.createRequest).toHaveBeenCalledWith({
        q: 'aata',
        lat: 12.97,
        lng: 77.59,
        wantsDelivery: true,
        deliveryAddressId: 'addr-1',
      }),
    );
    expect(api.keepAddress).toHaveBeenCalledWith({ addressText: '12 MG Road' });
  });

  it('shows the saved address as a line with a Change option', async () => {
    here();
    const { user, api } = setup({
      savedAddress: vi.fn(async () => ({ id: 'a9', addressText: '5 Park St', customerName: null })),
    });
    await user.type(screen.getByLabelText('What do you need?'), 'aata');
    await user.click(screen.getByRole('switch', { name: 'Deliver to me' }));
    expect(await screen.findByText('Deliver to: 5 Park St')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Find nearby' }));
    await waitFor(() =>
      expect(api.createRequest).toHaveBeenCalledWith(
        expect.objectContaining({ wantsDelivery: true, deliveryAddressId: 'a9' }),
      ),
    );
    expect(api.keepAddress).not.toHaveBeenCalled();
  });

  describe('the address field while the saved address loads', () => {
    function pendingSaved() {
      let resolve!: (value: {
        id: string | null;
        addressText: string | null;
        customerName: null;
      }) => void;
      const promise = new Promise<{
        id: string | null;
        addressText: string | null;
        customerName: null;
      }>((done) => (resolve = done));
      return { savedAddress: vi.fn(() => promise), resolve };
    }

    it('shows a skeleton, then one field that keeps its value and focus, with no saved address', async () => {
      const pending = pendingSaved();
      const { user } = setup({ savedAddress: pending.savedAddress });
      await user.click(screen.getByRole('switch', { name: 'Deliver to me' }));
      expect(screen.queryByLabelText('Delivery address')).toBeNull();
      expect(document.querySelector('.sh-skeleton')).not.toBeNull();
      pending.resolve({ id: null, addressText: null, customerName: null });
      const field = (await screen.findByLabelText('Delivery address')) as HTMLTextAreaElement;
      await user.type(field, '12 MG');
      // Nothing re-renders the field into a new node while the customer types.
      await user.type(field, ' Road');
      expect(screen.getByLabelText('Delivery address')).toBe(field);
      expect(field.isConnected).toBe(true);
      expect(field.value).toBe('12 MG Road');
      expect(document.activeElement).toBe(field);
    });

    it('never shows a field to type in when an address is already saved', async () => {
      const pending = pendingSaved();
      const { user } = setup({ savedAddress: pending.savedAddress });
      await user.click(screen.getByRole('switch', { name: 'Deliver to me' }));
      // Still loading: nothing to type into yet, so nothing can vanish under the customer's hands.
      expect(screen.queryByLabelText('Delivery address')).toBeNull();
      pending.resolve({ id: 'a9', addressText: '5 Park St', customerName: null });
      expect(await screen.findByText('Deliver to: 5 Park St')).toBeTruthy();
      expect(screen.queryByLabelText('Delivery address')).toBeNull();
    });

    it('shows the field to type in when the saved address cannot be loaded', async () => {
      const { user } = setup({ savedAddress: vi.fn(async () => Promise.reject(new Error('x'))) });
      await user.click(screen.getByRole('switch', { name: 'Deliver to me' }));
      expect(await screen.findByLabelText('Delivery address')).toBeTruthy();
    });
  });

  it('shows the offline banner', () => {
    vi.stubGlobal('navigator', { ...navigator, onLine: false });
    setup();
    expect(screen.getByText(/You're offline/)).toBeTruthy();
  });

  it('attaches an uploaded photo to the request', async () => {
    here();
    const { user, api, container } = setup();
    await user.type(screen.getByLabelText('What do you need?'), 'aata');
    const file = new File([new Uint8Array(20)], 'a.jpg', { type: 'image/jpeg' });
    await user.upload(container.querySelector('input[type="file"]') as HTMLInputElement, file);
    await screen.findByRole('img', { name: 'Your photo' });
    await user.click(screen.getByRole('button', { name: 'Find nearby' }));
    await waitFor(() =>
      expect(api.createRequest).toHaveBeenCalledWith(
        expect.objectContaining({ photoId: 'photo-1' }),
      ),
    );
  });
});

describe('Find: login on first send', () => {
  it('opens the login sheet, logs in, and then sends the draft exactly once', async () => {
    here();
    const { user, api, onFound, onLoggedIn } = setup({}, { loggedIn: false });
    await user.type(screen.getByLabelText('What do you need?'), 'javitri');
    await user.click(screen.getByRole('switch', { name: 'Deliver to me' }));
    await user.type(screen.getByLabelText('Delivery address'), '12 MG Road');
    await user.click(screen.getByRole('button', { name: 'Find nearby' }));

    const sheet = await screen.findByRole('dialog', { name: 'Log in to send your request' });
    expect(api.createRequest).not.toHaveBeenCalled();
    await user.type(within(sheet).getByLabelText('Mobile number'), '9876543210');
    await user.click(within(sheet).getByRole('button', { name: 'Send code' }));
    await user.type(await within(sheet).findByLabelText('6-digit code'), '123456');
    await user.click(within(sheet).getByRole('button', { name: 'Log in' }));

    await waitFor(() => expect(onFound).toHaveBeenCalledTimes(1));
    expect(onLoggedIn).toHaveBeenCalledWith('seeker-token');
    expect(api.createRequest).toHaveBeenCalledExactlyOnceWith({
      q: 'javitri',
      lat: 12.97,
      lng: 77.59,
      wantsDelivery: true,
      deliveryAddressId: 'addr-1',
    });
    expect(screen.queryByRole('dialog', { name: 'Log in to send your request' })).toBeNull();
    expect(sessionStorage.getItem('km-find-draft')).toBeNull();
  });

  it('keeps the draft in the tab while the customer types', async () => {
    const { user } = setup({}, { loggedIn: false });
    await user.type(screen.getByLabelText('What do you need?'), 'chini');
    expect(JSON.parse(sessionStorage.getItem('km-find-draft') ?? '{}').query).toBe('chini');
  });

  it('starts from a saved draft', () => {
    sessionStorage.setItem(
      'km-find-draft',
      JSON.stringify({ query: 'haldi', wantsDelivery: false, address: '', lat: '', lng: '' }),
    );
    setup({}, { loggedIn: false });
    expect((screen.getByLabelText('What do you need?') as HTMLInputElement).value).toBe('haldi');
  });

  it('opens the login sheet from the photo button without sending', async () => {
    const { user, api } = setup({}, { loggedIn: false });
    await user.click(screen.getByRole('button', { name: 'Add photo' }));
    expect(await screen.findByRole('dialog', { name: 'Log in to send your request' })).toBeTruthy();
    expect(api.createRequest).not.toHaveBeenCalled();
  });
});

describe('Find: Did you mean?', () => {
  const options = [
    { itemId: 'i-1', nameEn: 'sugar', nameHi: 'चीनी' },
    { itemId: 'i-2', nameEn: 'sugar-free tablets', nameHi: 'sugar-free tablets' },
  ];

  it('asks which one for an ambiguous item and re-sends with the chosen item', async () => {
    here();
    const createRequest = vi
      .fn()
      .mockRejectedValueOnce(
        new ApiError(409, 'item_ambiguous', 'x', { question: 'Which sugar do you mean?', options }),
      )
      .mockResolvedValue(seekerRequest());
    const { user, onFound } = setup({ createRequest });
    await user.type(screen.getByLabelText('What do you need?'), 'chini');
    await user.click(screen.getByRole('button', { name: 'Find nearby' }));
    const sheet = await screen.findByRole('dialog', { name: 'Which sugar do you mean?' });
    await user.click(within(sheet).getByRole('button', { name: 'sugar-free tablets' }));
    await waitFor(() => expect(onFound).toHaveBeenCalled());
    expect(createRequest).toHaveBeenLastCalledWith({
      q: 'chini',
      lat: 12.97,
      lng: 77.59,
      itemId: 'i-2',
    });
  });

  it('asks Did you mean {name}? and confirms, or changes, the understanding', async () => {
    here();
    const details = { item: options[0], alternatives: [options[1]] };
    const createRequest = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(409, 'item_confirm', 'x', details))
      .mockResolvedValue(seekerRequest());
    const { user } = setup({ createRequest });
    await user.type(screen.getByLabelText('What do you need?'), 'chini');
    await user.click(screen.getByRole('button', { name: 'Find nearby' }));
    const sheet = await screen.findByRole('dialog', { name: 'Did you mean sugar?' });
    await user.click(within(sheet).getByRole('button', { name: /sugar$/ }));
    await waitFor(() =>
      expect(createRequest).toHaveBeenLastCalledWith(
        expect.objectContaining({ itemId: 'i-1', understanding: 'confirmed' }),
      ),
    );
  });

  it('sends an alternative as a change', async () => {
    here();
    const details = { item: options[0], alternatives: [options[1]] };
    const createRequest = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(409, 'item_confirm', 'x', details))
      .mockResolvedValue(seekerRequest());
    const { user } = setup({ createRequest });
    await user.type(screen.getByLabelText('What do you need?'), 'chini');
    await user.click(screen.getByRole('button', { name: 'Find nearby' }));
    const sheet = await screen.findByRole('dialog', { name: 'Did you mean sugar?' });
    await user.click(within(sheet).getByRole('button', { name: 'sugar-free tablets' }));
    await waitFor(() =>
      expect(createRequest).toHaveBeenLastCalledWith(
        expect.objectContaining({ itemId: 'i-2', understanding: 'changed' }),
      ),
    );
  });

  it('searches the words typed under Something else exactly as typed, as a change', async () => {
    here();
    const createRequest = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(409, 'item_ambiguous', 'x', { question: 'q', options }))
      .mockResolvedValue(seekerRequest());
    const { user } = setup({ createRequest });
    await user.type(screen.getByLabelText('What do you need?'), 'chini');
    await user.click(screen.getByRole('button', { name: 'Find nearby' }));
    const sheet = await screen.findByRole('dialog');
    await user.type(within(sheet).getByLabelText('Something else'), 'pencil HB{Enter}');
    await waitFor(() =>
      expect(createRequest).toHaveBeenLastCalledWith({
        q: 'pencil HB',
        lat: 12.97,
        lng: 77.59,
        understanding: 'changed',
        asTyped: true,
      }),
    );
  });

  it('offers "Search for exactly what I typed" first, and sends the typed text as the item', async () => {
    here();
    const details = { item: options[0], alternatives: [options[1]] };
    const createRequest = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(409, 'item_confirm', 'x', details))
      .mockResolvedValue(seekerRequest());
    const { user } = setup({ createRequest });
    await user.type(screen.getByLabelText('What do you need?'), 'pencil HB');
    await user.click(screen.getByRole('button', { name: 'Find nearby' }));
    const sheet = await screen.findByRole('dialog', { name: 'Did you mean sugar?' });
    const buttons = within(sheet).getAllByRole('button');
    const typed = within(sheet).getByRole('button', {
      name: 'Search for exactly what I typed: "pencil HB"',
    });
    // First choice in the sheet, before the app's own guess (the close button comes first in the DOM).
    expect(buttons.filter((b) => b.className.includes('cu-find__option'))[0]).toBe(typed);
    await user.click(typed);
    await waitFor(() =>
      expect(createRequest).toHaveBeenLastCalledWith({
        q: 'pencil HB',
        lat: 12.97,
        lng: 77.59,
        understanding: 'changed',
        asTyped: true,
      }),
    );
  });

  it('keeps the sheet open and says why when an exact search is refused, instead of dropping to Home', async () => {
    here();
    const createRequest = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(409, 'item_ambiguous', 'x', { question: 'q', options }))
      .mockRejectedValueOnce(new ApiError(422, 'item_unresolved', 'x'));
    const { user } = setup({ createRequest });
    await user.type(screen.getByLabelText('What do you need?'), 'chini');
    await user.click(screen.getByRole('button', { name: 'Find nearby' }));
    const sheet = await screen.findByRole('dialog');
    await user.type(within(sheet).getByLabelText('Something else'), 'asdfgh');
    await user.click(within(sheet).getByRole('button', { name: 'Search again' }));
    const still = await screen.findByRole('dialog');
    expect(within(still).getByRole('alert').textContent).toMatch(/couldn't understand/i);
  });

  it('shows the question the server asked as the sheet title, and a fallback without one', async () => {
    here();
    const first = setup({
      createRequest: vi
        .fn()
        .mockRejectedValue(
          new ApiError(422, 'item_ambiguous', 'x', { question: 'Which dal do you mean?', options }),
        ),
    });
    await first.user.type(screen.getByLabelText('What do you need?'), 'dal');
    await first.user.click(screen.getByRole('button', { name: 'Find nearby' }));
    expect(await screen.findByRole('dialog', { name: 'Which dal do you mean?' })).toBeTruthy();
    first.unmount();
    const second = setup({
      createRequest: vi
        .fn()
        .mockRejectedValue(new ApiError(422, 'item_ambiguous', 'x', { question: '', options })),
    });
    await second.user.type(screen.getByLabelText('What do you need?'), 'dal');
    await second.user.click(screen.getByRole('button', { name: 'Find nearby' }));
    expect(await screen.findByRole('dialog', { name: 'Which one do you mean?' })).toBeTruthy();
  });

  it.each([
    [new ApiError(422, 'item_unresolved', 'x'), /couldn't understand/i],
    [new ApiError(422, 'item_blocked', 'x'), /can't send this item/i],
    [new ApiError(503, 'item_unavailable', 'x'), /right now/i],
    [new ApiError(429, 'new_item_limit', 'x', { scope: 'day' }), /new item/i],
    [new ApiError(403, 'forbidden', 'x'), /shop/i],
    [new ApiError(500, 'boom', 'x'), /Something went wrong/],
  ])('says what happened for %s', async (error, message) => {
    here();
    const { user } = setup({ createRequest: vi.fn().mockRejectedValue(error) });
    await user.type(screen.getByLabelText('What do you need?'), 'x');
    await user.click(screen.getByRole('button', { name: 'Find nearby' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(message);
    expect(
      (screen.getByRole('button', { name: 'Find nearby' }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });
});

describe('Find: My orders and the active order strip', () => {
  it('has a My orders button to /app/orders, with a dot only when something is active', async () => {
    const { user, navigate } = setup({
      myOrders: vi.fn(async () => [seekerOrder({ state: 'DELIVERED' })]),
    });
    const entry = screen.getByRole('link', { name: 'My orders' });
    expect(entry.getAttribute('href')).toBe('/app/orders');
    await waitFor(() => expect(screen.queryByText('You have an order in progress')).toBeNull());
    await user.click(entry);
    expect(navigate).toHaveBeenCalledWith('/app/orders');
  });

  it('shows the dot and the strip for the newest active order', async () => {
    const { user, navigate } = setup({
      myOrders: vi.fn(async () => [
        seekerOrder({ id: 'old', state: 'REQUESTED', createdAt: '2026-10-16T09:00:00.000Z' }),
        seekerOrder({
          id: 'new',
          state: 'REQUESTED',
          shopName: 'Gupta Store',
          createdAt: '2026-10-16T10:00:00.000Z',
        }),
        seekerOrder({ id: 'done', state: 'DELIVERED', createdAt: '2026-10-16T11:00:00.000Z' }),
      ]),
    });
    expect(await screen.findByText('You have an order in progress')).toBeTruthy();
    expect(await screen.findByText('sugar · Waiting for shop')).toBeTruthy();
    expect(screen.getByText('Gupta Store')).toBeTruthy();
    const track = screen.getByRole('link', { name: /Track/ });
    expect(track.getAttribute('href')).toBe('/app/order/new');
    await user.click(track);
    expect(navigate).toHaveBeenCalledWith('/app/order/new');
  });

  it('adds "by {time}" only when out for delivery with a known fee time', async () => {
    setup({
      myOrders: vi.fn(async () => [
        seekerOrder({
          state: 'OUT_FOR_DELIVERY',
          feeMinutes: 30,
          outForDeliveryAt: '2026-10-16T10:00:00.000Z',
        }),
      ]),
    });
    expect(await screen.findByText('sugar · Out for delivery')).toBeTruthy();
    expect(screen.getByText(/Mishra Kirana · by \d/)).toBeTruthy();
  });

  it('shows nothing, and does not fetch orders, when logged out', () => {
    const { api } = setup({}, { loggedIn: false });
    expect(api.myOrders).not.toHaveBeenCalled();
    expect(screen.queryByText('Track')).toBeNull();
  });

  it('keeps Find usable when orders cannot be fetched', async () => {
    setup({
      myOrders: vi.fn(async () => {
        throw new Error('offline');
      }),
    });
    expect(screen.getByLabelText('What do you need?')).toBeTruthy();
    expect(screen.queryByText('Track')).toBeNull();
  });
});
