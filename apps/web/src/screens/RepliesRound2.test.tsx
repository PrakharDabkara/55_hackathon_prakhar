// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../lib/api.js';
import { FakeEventSource, fakeSeekerApi, seekerRequest } from '../test/fakes.js';
import { REPLIES_NOW, answeredRequest, liveYes, remembered } from '../test/fakesReplies.js';
import { renderApp } from '../test/render.js';
import { RequestPage } from './RequestPage.js';

vi.mock('../components/ResultsMap.js', () => ({ ResultsMap: () => <div data-testid="map" /> }));

const origin = { lat: 22.7196, lng: 75.8577 };
const live = { createSource: (url: string) => new FakeEventSource(url), retryMs: 1000 };

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date(REPLIES_NOW) });
  FakeEventSource.reset();
});
afterEach(() => vi.useRealTimers());

function show(
  initial: ReturnType<typeof seekerRequest>,
  extra: Parameters<typeof fakeSeekerApi>[0] = {},
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
    />,
    'en',
  );
  return { api, navigate, onDone, ...utils };
}

const sugar = {
  id: 'i9',
  slug: 'sugar',
  nameEn: 'sugar',
  nameHi: 'चीनी',
  category: 'grocery',
  unverified: false,
};

describe('C-07: nothing says "no shops" before the server has asked', () => {
  const asking = () =>
    seekerRequest({
      state: 'PINGING',
      asking: true,
      pingStats: { sent: 0, yes: 0, no: 0, pending: 0 },
    });

  it('shows "Asking shops nearby…" and no zero-shops state while the shops are being chosen', () => {
    show(asking());
    expect(screen.getByRole('status', { name: '' }).textContent).toBe('Asking shops nearby…');
    expect(screen.getByText('Within 2 km')).toBeTruthy();
    expect(screen.queryByText(/No shops asked/)).toBeNull();
    expect(screen.queryByText(/No open shops within/)).toBeNull();
    expect(screen.queryByText('All shops have replied.')).toBeNull();
    expect(screen.queryByRole('button', { name: /Search 5 km/ })).toBeNull();
  });

  it('moves on when the server settles the shops (a hint arrives)', async () => {
    const { api } = show(asking());
    vi.mocked(api.getRequest).mockResolvedValue(
      seekerRequest({
        state: 'PINGING',
        asking: false,
        pingStats: { sent: 4, yes: 0, no: 0, pending: 4 },
      }),
    );
    await waitFor(() => expect(FakeEventSource.instances.length).toBeGreaterThan(0));
    FakeEventSource.last().emit('request.updated', { requestId: 'req-1', state: 'PINGING' });
    expect(await screen.findByText('Sent to 4 shops · 2 km')).toBeTruthy();
    expect(screen.queryByText('Asking shops nearby…')).toBeNull();
  });
});

describe('C-13: zero shops asked is never "all shops have replied"', () => {
  const nobody = (over: Partial<ReturnType<typeof seekerRequest>> = {}) =>
    seekerRequest({
      state: 'PINGING',
      asking: false,
      typed: 'unicorn horn',
      pingStats: { sent: 0, yes: 0, no: 0, pending: 0 },
      ...over,
    });

  it('says no shops were asked, in the same words on the parchi and under it', () => {
    show(nobody());
    expect(screen.queryByText('All shops have replied.')).toBeNull();
    expect(screen.getByText('No shops asked · 2 km')).toBeTruthy();
    expect(screen.getByRole('status', { name: '' }).textContent).toBe('No shops were asked.');
  });

  it('says so with remembered answers too', () => {
    show(nobody({ results: [remembered(2)] }));
    expect(screen.queryByText('All shops have replied.')).toBeNull();
    expect(screen.getByText('No shops were asked.')).toBeTruthy();
  });

  it('still says all have replied when shops were asked and all answered', () => {
    show(answeredRequest([liveYes()], { pingStats: { sent: 3, yes: 1, no: 2, pending: 0 } }));
    expect(screen.getByText(/All shops have replied\./)).toBeTruthy();
  });
});

describe('C-05: ask shops now', () => {
  const memory = () =>
    seekerRequest({
      state: 'ANSWERED',
      asking: false,
      results: [remembered(1), remembered(2, { shopId: 's2', name: 'Gupta Store' })],
      pingStats: { sent: 0, yes: 0, no: 0, pending: 0 },
    });

  it('offers the action when shops had it recently and nobody was asked', async () => {
    const asked = seekerRequest({ state: 'PINGING', asking: true });
    const { user, api } = show(memory(), { askShopsNow: vi.fn(async () => asked) });
    await user.click(screen.getByRole('button', { name: 'Ask shops now' }));
    expect(api.askShopsNow).toHaveBeenCalledWith('req-1');
    expect((await screen.findAllByText('Asking shops nearby…')).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Ask shops now' })).toBeNull();
  });

  it('says what went wrong, with the ref, and lets the customer try again', async () => {
    const askShopsNow = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(500, 'boom', 'x', { requestId: 'K-9' }))
      .mockResolvedValue(seekerRequest({ state: 'PINGING', asking: true }));
    const { user } = show(memory(), { askShopsNow });
    await user.click(screen.getByRole('button', { name: 'Ask shops now' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('K-9');
    await user.click(screen.getByRole('button', { name: 'Ask shops now' }));
    await waitFor(() => expect(askShopsNow).toHaveBeenCalledTimes(2));
  });

  it('is not offered once shops were asked, or after the request ended', () => {
    const first = show(answeredRequest([liveYes(), remembered(2)]));
    expect(screen.queryByRole('button', { name: 'Ask shops now' })).toBeNull();
    first.unmount();
    show({ ...memory(), state: 'EXPIRED' });
    expect(screen.queryByRole('button', { name: 'Ask shops now' })).toBeNull();
  });
});

describe('C-06: no empty "1 shop doesn\'t have it" section', () => {
  it('has no disclosure for shops that said no; the count is in the status line', () => {
    show(answeredRequest([liveYes()], { pingStats: { sent: 4, yes: 1, no: 3, pending: 0 } }));
    expect(screen.queryByRole('button', { name: /don't have it|doesn't have it/ })).toBeNull();
    expect(screen.queryByText("These shops said they don't have it.")).toBeNull();
    expect(screen.getByText("All shops have replied. 3 said they don't have it.")).toBeTruthy();
  });
});

describe('C-11a: the item the customer chose is the request', () => {
  it('shows the chosen item as the heading and their words small', () => {
    show(
      answeredRequest([], {
        picked: true,
        typed: 'chini',
        item: sugar,
        pingStats: { sent: 1, yes: 0, no: 0, pending: 1 },
      }),
    );
    const heading = screen.getByRole('heading', { name: 'Sugar' });
    expect(heading.className).toContain('sh-parchi__item');
    expect(screen.getByText('you typed: chini').className).toContain('sh-parchi__alias');
  });

  it('shows no second line when the words are the item', () => {
    show(answeredRequest([], { picked: true, typed: 'sugar', item: sugar }));
    expect(screen.queryByText(/you typed/)).toBeNull();
  });

  it('leaves a request typed as words as it was', () => {
    show(answeredRequest([], { picked: false, typed: 'chini', item: sugar }));
    expect(screen.getByRole('heading', { name: 'chini' })).toBeTruthy();
    expect(within(document.body).queryByText(/you typed/)).toBeNull();
  });
});

describe('C-08, C-10: the back arrow, a wider search and the limit', () => {
  it('the back arrow goes home and does not stop the request', async () => {
    const { user, onDone, api } = show(answeredRequest([liveYes()]));
    await user.click(screen.getByRole('button', { name: /back/i }));
    expect(onDone).toHaveBeenCalled();
    expect(api.closeRequest).not.toHaveBeenCalled();
  });

  it('a wider search stops the empty one first, so it does not use a second place', async () => {
    const calls: string[] = [];
    const nobody = seekerRequest({
      state: 'PINGING',
      asking: false,
      typed: 'unicorn',
      pingStats: { sent: 0, yes: 0, no: 0, pending: 0 },
    });
    const { user, navigate } = show(nobody, {
      closeRequest: vi.fn(async () => (calls.push('close'), seekerRequest({ state: 'CLOSED' }))),
      createRequest: vi.fn(async () => (calls.push('create'), seekerRequest({ id: 'req-2' }))),
    });
    await user.click(screen.getByRole('button', { name: 'Search 5 km' }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/app/request/req-2'));
    expect(calls).toEqual(['close', 'create']);
  });
});
