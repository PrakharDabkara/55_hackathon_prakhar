// @vitest-environment jsdom
import { act, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../lib/api.js';
import type { ActiveSearch } from '../lib/seekerApi.js';
import { fakeSeekerApi, seekerRequest } from '../test/fakes.js';
import { renderApp } from '../test/render.js';
import { Home } from './Home.js';

vi.mock('../lib/photo.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/photo.js')>()),
  shrinkPhoto: async (file: Blob) => file,
}));

beforeEach(() => sessionStorage.clear());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const here = () =>
  vi.stubGlobal('navigator', {
    ...navigator,
    geolocation: {
      getCurrentPosition: (ok: (p: unknown) => void) =>
        ok({ coords: { latitude: 12.97, longitude: 77.59 } }),
    },
  });

function setup(overrides: Parameters<typeof fakeSeekerApi>[0] = {}) {
  const api = fakeSeekerApi(overrides);
  const navigate = vi.fn();
  const onFound = vi.fn();
  function Harness() {
    const [on, setOn] = useState(true);
    return (
      <Home
        api={api}
        loggedIn={on}
        onLoggedIn={() => setOn(true)}
        navigate={navigate}
        onFound={onFound}
        onList={vi.fn()}
      />
    );
  }
  return { api, navigate, onFound, ...renderApp(<Harness />, 'en') };
}
const find = async (user: ReturnType<typeof setup>['user'], text: string) => {
  await user.type(screen.getByLabelText('What do you need?'), text);
  await user.click(screen.getByRole('button', { name: 'Find nearby' }));
};

describe('C-14, C-15: every error shows its ref, and an AI failure is not "unclear"', () => {
  it('says the assistant is busy, with the ref, and never "couldn\'t understand"', async () => {
    here();
    const { user } = setup({
      createRequest: vi
        .fn()
        .mockRejectedValue(new ApiError(503, 'ai_busy', 'x', { requestId: 'AB12CD' })),
    });
    await find(user, 'Mobile phone');
    const alert = (await screen.findByRole('alert')).textContent ?? '';
    expect(alert).toContain('Our assistant is busy right now. Please try again in a minute.');
    expect(alert).toContain('AB12CD');
    expect(alert).not.toMatch(/couldn't understand/i);
  });

  it.each([
    [new ApiError(422, 'item_unresolved', 'x', { requestId: 'R-1' }), /couldn't understand/i],
    [new ApiError(422, 'item_blocked', 'x', { requestId: 'R-1' }), /can't send this item/i],
    [new ApiError(429, 'new_item_limit', 'x', { requestId: 'R-1', scope: 'day' }), /new item/i],
    [new ApiError(500, 'boom', 'x', { requestId: 'R-1' }), /Something went wrong/],
    [new ApiError(502, 'unknown', 'Bad Gateway', { requestId: 'R-1' }), /Something went wrong/],
  ])('%s shows ref R-1', async (error, message) => {
    here();
    const { user } = setup({ createRequest: vi.fn().mockRejectedValue(error) });
    await find(user, 'x');
    const alert = (await screen.findByRole('alert')).textContent ?? '';
    expect(alert).toMatch(message);
    expect(alert).toContain('R-1');
  });

  it('a failure with no server answer at all (offline, cut) still shows a ref to quote', async () => {
    here();
    const { user } = setup({
      createRequest: vi.fn().mockRejectedValue(new TypeError('fetch failed')),
    });
    await find(user, 'x');
    const alert = (await screen.findByRole('alert')).textContent ?? '';
    expect(alert).toMatch(/Something went wrong/);
    expect(alert).toMatch(/Ref\s*[:·]?\s*[A-Za-z0-9-]{4,}/);
  });
});

describe('C-09: a Find that is being understood never looks frozen', () => {
  it('shows changing progress words', async () => {
    here();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let finish: (v: ReturnType<typeof seekerRequest>) => void = () => undefined;
    const { user } = setup({
      createRequest: vi.fn(
        () => new Promise<ReturnType<typeof seekerRequest>>((resolve) => (finish = resolve)),
      ),
    });
    await find(user, 'Mobile phone');
    expect(await screen.findByText('Reading your request…')).toBeTruthy();
    await act(async () => void (await vi.advanceTimersByTimeAsync(3500)));
    expect(screen.getByText('Finding the right item…')).toBeTruthy();
    await act(async () => void (await vi.advanceTimersByTimeAsync(5000)));
    expect(screen.getByText('Asking shops nearby…')).toBeTruthy();
    await act(async () => finish(seekerRequest()));
  });
});

describe('C-12: a photo never makes every later search fail', () => {
  const attach = async (
    user: ReturnType<typeof setup>['user'],
    container: HTMLElement,
  ): Promise<void> => {
    const file = new File([new Uint8Array(20)], 'a.jpg', { type: 'image/jpeg' });
    await user.upload(container.querySelector('input[type="file"]') as HTMLInputElement, file);
    await screen.findByRole('img', { name: 'Your photo' });
  };

  it('a photo that cannot be attached is dropped with a clear message; the next search is text only', async () => {
    here();
    const createRequest = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(409, 'photo_taken', 'x', { requestId: 'P-1' }))
      .mockResolvedValue(seekerRequest());
    const { user, container, onFound } = setup({ createRequest });
    await user.type(screen.getByLabelText('What do you need?'), 'Softtoy');
    await attach(user, container);
    await user.click(screen.getByRole('button', { name: 'Find nearby' }));
    const alert = (await screen.findByRole('alert')).textContent ?? '';
    expect(alert).toMatch(/couldn't attach your photo/i);
    expect(alert).toContain('P-1');
    expect(screen.queryByRole('img', { name: 'Your photo' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Add photo' })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Find nearby' }));
    await waitFor(() => expect(onFound).toHaveBeenCalled());
    expect(createRequest.mock.calls[1]?.[0]).not.toHaveProperty('photoId');
  });

  it("after a failure that is not the photo's fault the photo stays and the retry reuses the same key", async () => {
    here();
    const createRequest = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(503, 'ai_busy', 'x', { requestId: 'B-1' }))
      .mockResolvedValue(seekerRequest());
    const { user, container, onFound } = setup({ createRequest });
    await user.type(screen.getByLabelText('What do you need?'), 'Softtoy');
    await attach(user, container);
    await user.click(screen.getByRole('button', { name: 'Find nearby' }));
    await screen.findByRole('alert');
    expect(screen.getByRole('img', { name: 'Your photo' })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Find nearby' }));
    await waitFor(() => expect(onFound).toHaveBeenCalled());
    const [first, second] = createRequest.mock.calls.map((c) => c[0]);
    expect(second).toMatchObject({ photoId: 'photo-1' });
    // A search the server did finish (the reply was lost) comes back instead of being made twice.
    expect(second.idempotencyKey).toBeTruthy();
    expect(second.idempotencyKey).toBe(first.idempotencyKey);
  });

  it('changing the words starts a new search key', async () => {
    here();
    const createRequest = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(503, 'ai_busy', 'x'))
      .mockResolvedValue(seekerRequest());
    const { user } = setup({ createRequest });
    await find(user, 'Softtoy');
    await screen.findByRole('alert');
    await user.clear(screen.getByLabelText('What do you need?'));
    await user.type(screen.getByLabelText('What do you need?'), 'Teddy');
    await user.click(screen.getByRole('button', { name: 'Find nearby' }));
    await waitFor(() => expect(createRequest).toHaveBeenCalledTimes(2));
    expect(createRequest.mock.calls[1]?.[0].idempotencyKey).not.toBe(
      createRequest.mock.calls[0]?.[0].idempotencyKey,
    );
  });
});

describe('C-11: did you mean', () => {
  const options = [
    { itemId: 'i-1', nameEn: 'sugar', nameHi: 'चीनी' },
    { itemId: 'i-2', nameEn: 'sugar-free tablets', nameHi: 'sugar-free tablets' },
  ];
  const confirm = () =>
    new ApiError(409, 'item_confirm', 'x', { item: options[0], alternatives: [options[1]] });

  it('"Something else" submits with the button and with Enter, once each, and shows the words', async () => {
    here();
    const createRequest = vi
      .fn()
      .mockRejectedValueOnce(confirm())
      .mockRejectedValueOnce(new ApiError(503, 'ai_busy', 'x', { requestId: 'S-1' }))
      .mockResolvedValue(seekerRequest());
    const { user, onFound } = setup({ createRequest });
    await find(user, 'chini');
    const sheet = await screen.findByRole('dialog');
    await user.type(within(sheet).getByLabelText('Something else'), 'pencil HB');
    await user.click(within(sheet).getByRole('button', { name: 'Search again' }));
    // The sheet stays, says why with the ref, and keeps the words for another go.
    const still = await screen.findByRole('dialog');
    expect(within(still).getByRole('alert').textContent).toContain('S-1');
    expect((within(still).getByLabelText('Something else') as HTMLInputElement).value).toBe(
      'pencil HB',
    );
    await user.type(within(still).getByLabelText('Something else'), '{Enter}');
    await waitFor(() => expect(onFound).toHaveBeenCalledTimes(1));
    expect(createRequest).toHaveBeenCalledTimes(3);
    expect(createRequest.mock.calls[2]?.[0]).toMatchObject({ q: 'pencil HB', asTyped: true });
  });

  it('"exactly what I typed" sends the typed text and never says "couldn\'t understand" for it', async () => {
    here();
    const createRequest = vi
      .fn()
      .mockRejectedValueOnce(confirm())
      .mockResolvedValue(seekerRequest());
    const { user, onFound } = setup({ createRequest });
    await find(user, 'Softtoy');
    const sheet = await screen.findByRole('dialog');
    await user.click(
      within(sheet).getByRole('button', { name: 'Search for exactly what I typed: "Softtoy"' }),
    );
    await waitFor(() => expect(onFound).toHaveBeenCalled());
    expect(createRequest.mock.calls[1]?.[0]).toMatchObject({ q: 'Softtoy', asTyped: true });
  });

  it('choosing a suggestion sends that item (the screen then shows it as the request)', async () => {
    here();
    const createRequest = vi
      .fn()
      .mockRejectedValueOnce(confirm())
      .mockResolvedValue(seekerRequest({ picked: true, typed: 'chini' }));
    const { user, onFound } = setup({ createRequest });
    await find(user, 'chini');
    const sheet = await screen.findByRole('dialog');
    await user.click(within(sheet).getByRole('button', { name: /sugar$/ }));
    await waitFor(() => expect(onFound).toHaveBeenCalled());
    expect(createRequest.mock.calls[1]?.[0]).toMatchObject({ q: 'chini', itemId: 'i-1' });
  });
});

describe('C-08: the place chosen for one search is still there for the next', () => {
  it('a second Find does not ask for the location again', async () => {
    here();
    const first = setup();
    await find(first.user, 'haldi');
    await waitFor(() => expect(first.onFound).toHaveBeenCalled());
    first.unmount();
    sessionStorage.removeItem('km-find-draft'); // what sending does to the draft
    vi.stubGlobal('navigator', { ...navigator, geolocation: undefined });
    const second = setup();
    await find(second.user, 'chini');
    await waitFor(() => expect(second.api.createRequest).toHaveBeenCalled());
    expect(second.api.createRequest).toHaveBeenCalledWith(
      expect.objectContaining({ q: 'chini', lat: 12.97, lng: 77.59 }),
    );
  });
});

describe('C-08, C-10: up to three active searches', () => {
  const card = (n: number, over: Partial<Extract<ActiveSearch, { kind: 'request' }>> = {}) =>
    ({
      kind: 'request',
      id: `r-${n}`,
      state: 'PINGING',
      typed: `thing ${n}`,
      item: { nameEn: `Thing ${n}`, nameHi: `चीज़ ${n}` },
      replies: n,
      createdAt: '2026-10-16T10:00:00.000Z',
      expiresAt: '2026-10-16T10:15:00.000Z',
      ...over,
    }) satisfies ActiveSearch;
  const list: ActiveSearch = {
    kind: 'list',
    id: 'l-1',
    lineCount: 3,
    lines: ['sugar', 'tea', 'milk'],
    replies: 0,
    createdAt: '2026-10-16T09:00:00.000Z',
    expiresAt: '2026-10-16T09:15:00.000Z',
  };

  it('shows a card per live search that reopens its replies, and a list card', async () => {
    const { user, navigate } = setup({
      activeSearches: vi.fn(async () => ({ limit: 3, searches: [card(2), card(1), list] })),
    });
    const cards = await screen.findAllByRole('link', { name: /· View/ });
    expect(cards.map((c) => c.textContent)).toEqual([
      'Thing 2 · 2 replies · View',
      'Thing 1 · 1 reply · View',
      'Shopping list · 3 items · No replies yet · View',
    ]);
    expect(cards[0]?.getAttribute('href')).toBe('/app/request/r-2');
    expect(cards[2]?.getAttribute('href')).toBe('/app/list/l-1');
    await user.click(cards[0] as HTMLElement);
    expect(navigate).toHaveBeenCalledWith('/app/request/r-2');
  });

  it('shows no section without live searches', async () => {
    const { api } = setup();
    await waitFor(() => expect(api.activeSearches).toHaveBeenCalled());
    expect(screen.queryByRole('link', { name: /· View/ })).toBeNull();
    expect(screen.queryByText('Need several things? Make a list')).toBeNull();
  });

  it('hints at a list while fewer than three are live, and not at three', async () => {
    const first = setup({
      activeSearches: vi.fn(async () => ({ limit: 3, searches: [card(1)] })),
    });
    const hint = await screen.findByRole('button', { name: 'Need several things? Make a list' });
    await first.user.click(hint);
    expect(screen.getByRole('button', { name: 'A list' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    first.unmount();
    setup({
      activeSearches: vi.fn(async () => ({ limit: 3, searches: [card(1), card(2), card(3)] })),
    });
    await screen.findAllByRole('link', { name: /· View/ });
    expect(screen.queryByRole('button', { name: 'Need several things? Make a list' })).toBeNull();
  });

  it('a 4th search asks which of the three to stop, stops it, then sends', async () => {
    here();
    const searches = [card(1), card(2), card(3)];
    const activeSearches = vi
      .fn()
      .mockResolvedValueOnce({ limit: 3, searches })
      .mockResolvedValue({ limit: 3, searches: searches.slice(0, 2) });
    const { user, api, onFound } = setup({ activeSearches });
    await screen.findAllByRole('link', { name: /· View/ });
    await find(user, 'rice');
    const sheet = await screen.findByRole('dialog', { name: 'You can have 3 searches at a time' });
    expect(api.createRequest).not.toHaveBeenCalled();
    await user.click(within(sheet).getByRole('button', { name: 'Stop Thing 2' }));
    await waitFor(() => expect(api.closeRequest).toHaveBeenCalledWith('r-2'));
    await waitFor(() => expect(onFound).toHaveBeenCalled());
    expect(api.createRequest).toHaveBeenCalledTimes(1);
  });

  it('cancelling the prompt stops nothing and sends nothing', async () => {
    here();
    const searches = [card(1), card(2), card(3)];
    const { user, api } = setup({ activeSearches: vi.fn(async () => ({ limit: 3, searches })) });
    await screen.findAllByRole('link', { name: /· View/ });
    await find(user, 'rice');
    const sheet = await screen.findByRole('dialog');
    await user.click(within(sheet).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(api.closeRequest).not.toHaveBeenCalled();
    expect(api.stopList).not.toHaveBeenCalled();
    expect(api.createRequest).not.toHaveBeenCalled();
  });

  it('stops a list with the list call', async () => {
    here();
    const searches = [card(1), card(2), list];
    const { user, api } = setup({ activeSearches: vi.fn(async () => ({ limit: 3, searches })) });
    await screen.findAllByRole('link', { name: /· View/ });
    await find(user, 'rice');
    const sheet = await screen.findByRole('dialog');
    await user.click(within(sheet).getByRole('button', { name: 'Stop Shopping list · 3 items' }));
    await waitFor(() => expect(api.stopList).toHaveBeenCalledWith('l-1'));
  });

  it("the server's search_limit answer opens the same prompt", async () => {
    here();
    const searches = [card(1), card(2), card(3)];
    const createRequest = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(409, 'search_limit', 'x', { limit: 3 }))
      .mockResolvedValue(seekerRequest());
    const { user } = setup({
      createRequest,
      // The cards had not loaded when the customer pressed Find.
      activeSearches: vi
        .fn()
        .mockResolvedValueOnce({ limit: 3, searches: [] })
        .mockResolvedValue({ limit: 3, searches }),
    });
    await find(user, 'rice');
    expect(
      await screen.findByRole('dialog', { name: 'You can have 3 searches at a time' }),
    ).toBeTruthy();
  });
});
