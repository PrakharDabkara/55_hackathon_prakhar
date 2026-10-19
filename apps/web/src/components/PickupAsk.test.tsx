// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { PendingPickup } from '../lib/pickupApi.js';
import { fakePickups } from '../test/fakes.js';
import { renderApp } from '../test/render.js';
import { PickupAsk } from './PickupAsk.js';

const waiting = (over: Partial<PendingPickup> = {}): PendingPickup => ({
  id: 'p1',
  item: { nameEn: 'sugar', nameHi: 'चीनी' },
  shop: { name: 'Sharma Kirana' },
  ...over,
});
const setup = (pending: PendingPickup[], over: Parameters<typeof fakePickups>[0] = {}) => {
  const api = fakePickups({ pendingPickups: vi.fn(async () => pending), ...over });
  return { api, ...renderApp(<PickupAsk api={api} />) };
};

describe('"Le liya?" on the home screen (ADR-0035)', () => {
  it('asks about the item at the shop, with the three answers', async () => {
    setup([waiting()]);
    expect(await screen.findByText('Kya aapko sugar Sharma Kirana par mila?')).toBeTruthy();
    for (const name of ['Mil gaya', 'Wahan nahi tha', 'Gaya nahi'])
      expect(screen.getByRole('button', { name })).toBeTruthy();
  });

  it.each([
    ['Mil gaya', 'found'],
    ['Wahan nahi tha', 'not_there'],
    ['Gaya nahi', 'not_gone'],
  ] as const)('"%s" sends %s and clears the question', async (label, answer) => {
    const { api, user } = setup([waiting()]);
    await user.click(await screen.findByRole('button', { name: label }));
    expect(api.answerPickup).toHaveBeenCalledWith('p1', answer);
    await waitFor(() => expect(screen.queryByText(/Kya aapko sugar/)).toBeNull());
  });

  it('asks one question at a time, the next after the first is answered', async () => {
    const { user } = setup([
      waiting(),
      waiting({
        id: 'p2',
        item: { nameEn: 'rice', nameHi: 'चावल' },
        shop: { name: 'Gupta Stores' },
      }),
    ]);
    expect(await screen.findByText('Kya aapko sugar Sharma Kirana par mila?')).toBeTruthy();
    expect(screen.queryByText(/rice/)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Gaya nahi' }));
    expect(await screen.findByText('Kya aapko rice Gupta Stores par mila?')).toBeTruthy();
  });

  it('keeps the question and says so when the answer could not be sent', async () => {
    const { user } = setup([waiting()], {
      answerPickup: vi.fn(async () => {
        throw new Error('offline');
      }),
    });
    await user.click(await screen.findByRole('button', { name: 'Mil gaya' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText(/Kya aapko sugar/)).toBeTruthy();
  });

  it('shows nothing, and no error, when there is nothing to ask or it cannot be fetched', async () => {
    const empty = setup([]);
    await waitFor(() => expect(empty.api.pendingPickups).toHaveBeenCalled());
    expect(screen.queryByRole('button')).toBeNull();
    empty.unmount();
    setup([], {
      pendingPickups: vi.fn(async () => {
        throw new Error('offline');
      }),
    });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('speaks English when asked to', async () => {
    const api = fakePickups({ pendingPickups: vi.fn(async () => [waiting()]) });
    renderApp(<PickupAsk api={api} />, 'en');
    expect(await screen.findByText('Did you find sugar at Sharma Kirana?')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Found it' })).toBeTruthy();
  });
});
