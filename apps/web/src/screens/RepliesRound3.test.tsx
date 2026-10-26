// @vitest-environment jsdom
import { act, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeEventSource, fakeSeekerApi, seekerRequest } from '../test/fakes.js';
import { REPLIES_NOW } from '../test/fakesReplies.js';
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
  const utils = renderApp(
    <RequestPage
      api={api}
      requestId={initial.id}
      navigate={vi.fn()}
      onDone={vi.fn()}
      initial={initial}
      origin={origin}
      live={live}
    />,
    'en',
  );
  return { api, ...utils };
}

const allSaidNo = () =>
  seekerRequest({
    state: 'EXPIRED',
    asking: false,
    typed: 'sugar',
    pingStats: { sent: 1, yes: 0, no: 1, pending: 0 },
  });

describe('C-17: the final state stops waiting', () => {
  it('every asked shop said no: says so, offers the next steps, and shows nothing that waits', () => {
    show(allSaidNo());
    expect(screen.getByText('None of the shops nearby have it')).toBeTruthy();
    expect(screen.queryByText('No replies yet')).toBeNull();
    expect(document.querySelector('.sh-skeleton, [aria-hidden="true"] .sh-skeleton')).toBeNull();
    expect(screen.getByRole('button', { name: 'Search 5 km' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try different words' })).toBeTruthy();
    // The seeker is already in the demo area: that step is not offered.
    expect(screen.queryByRole('button', { name: 'Use the demo area (Indore)' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Stop asking/ })).toBeNull();
  });

  it('shows no live dot once the request is over, even with the stream open', async () => {
    show(allSaidNo());
    await act(async () => void (await vi.advanceTimersByTimeAsync(50)));
    FakeEventSource.last()?.open();
    await act(async () => void (await vi.advanceTimersByTimeAsync(50)));
    expect(screen.queryByRole('img', { name: 'Live' })).toBeNull();
  });

  it('nobody could be asked: the zero-shops text with the same next steps', () => {
    show(seekerRequest({ state: 'EXPIRED', asking: false, typed: 'sugar' }));
    expect(screen.getByText(/No open shops within 2 km/)).toBeTruthy();
    expect(screen.queryByText('No replies yet')).toBeNull();
    expect(screen.getByRole('button', { name: 'Search 5 km' })).toBeTruthy();
  });

  it('moves from waiting to the final state when the poll brings the end', async () => {
    const waiting = seekerRequest({
      state: 'PINGING',
      asking: false,
      typed: 'sugar',
      pingStats: { sent: 1, yes: 0, no: 0, pending: 1 },
    });
    const { api } = show(waiting, { getRequest: vi.fn(async () => allSaidNo()) });
    expect(screen.getByText('No replies yet')).toBeTruthy();
    await act(async () => void (await vi.advanceTimersByTimeAsync(15_100)));
    expect(api.getRequest).toHaveBeenCalled();
    expect(await screen.findByText('None of the shops nearby have it')).toBeTruthy();
    expect(screen.queryByText('No replies yet')).toBeNull();
  });
});
