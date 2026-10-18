// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeApi } from '../test/fakes.js';
import { renderApp } from '../test/render.js';
import { Onboarding } from './Onboarding.js';

function stubGeolocation(result: 'ok' | 'denied') {
  const getCurrentPosition = vi.fn((success: PositionCallback, failure: PositionErrorCallback) => {
    if (result === 'ok') {
      success({ coords: { latitude: 22.7196, longitude: 75.8577 } } as GeolocationPosition);
    } else {
      failure({ code: 1, message: 'denied' } as GeolocationPositionError);
    }
  });
  Object.defineProperty(navigator, 'geolocation', {
    value: { getCurrentPosition },
    configurable: true,
  });
  return getCurrentPosition;
}

afterEach(() => {
  Reflect.deleteProperty(navigator, 'geolocation');
});

describe('Onboarding', () => {
  it('shows 13 big category tiles with Hindi labels, including pooja, medical and dairy', () => {
    renderApp(<Onboarding api={fakeApi()} onDone={vi.fn()} />);
    const tiles = screen.getAllByRole('button', { pressed: false });
    expect(tiles).toHaveLength(13);
    for (const name of [/पूजा/, /मेडिकल/, /डेयरी/, /सब्ज़ी/, /बेकरी/])
      expect(screen.getByRole('button', { name })).toBeTruthy();
    expect(screen.getByRole('button', { name: /किराना/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /हार्डवेयर/ })).toBeTruthy();
  });

  it('lets the shopkeeper pick one to three categories, never four', async () => {
    const { user } = renderApp(<Onboarding api={fakeApi()} onDone={vi.fn()} />);
    const tile = (name: RegExp) => screen.getByRole('button', { name });

    await user.click(tile(/किराना/));
    await user.click(tile(/हार्डवेयर/));
    await user.click(tile(/स्टेशनरी/));
    await user.click(tile(/पूजा/));
    expect(tile(/किराना/).getAttribute('aria-pressed')).toBe('true');
    expect(tile(/हार्डवेयर/).getAttribute('aria-pressed')).toBe('true');
    expect(tile(/स्टेशनरी/).getAttribute('aria-pressed')).toBe('true');
    expect(tile(/पूजा/).getAttribute('aria-pressed')).toBe('false');

    await user.click(tile(/किराना/)); // tapping again clears it
    await user.click(tile(/पूजा/));
    expect(tile(/पूजा/).getAttribute('aria-pressed')).toBe('true');
  });

  it('uses the phone location, then creates the shop', async () => {
    stubGeolocation('ok');
    const api = fakeApi();
    const onDone = vi.fn();
    const { user } = renderApp(<Onboarding api={api} onDone={onDone} />);

    const start = screen.getByRole('button', { name: 'Dukaan shuru karein' }) as HTMLButtonElement;
    expect(start.disabled).toBe(true);

    await user.type(screen.getByLabelText('Dukaan ka naam'), 'Sharma Kirana');
    await user.click(screen.getByRole('button', { name: /किराना/ }));
    await user.click(screen.getByRole('button', { name: 'Meri location use karein' }));
    expect(await screen.findByText(/Location mil gayi/)).toBeTruthy();
    expect(start.disabled).toBe(false);

    await user.click(start);
    await waitFor(() =>
      expect(api.createShop).toHaveBeenCalledWith({
        name: 'Sharma Kirana',
        lat: 22.7196,
        lng: 75.8577,
        categories: ['grocery'],
      }),
    );
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it('falls back to typing latitude and longitude when location is refused', async () => {
    stubGeolocation('denied');
    const api = fakeApi();
    const { user } = renderApp(<Onboarding api={api} onDone={vi.fn()} />);

    await user.type(screen.getByLabelText('Dukaan ka naam'), '  Verma Hardware ');
    await user.click(screen.getByRole('button', { name: /हार्डवेयर/ }));
    await user.click(screen.getByRole('button', { name: /बिजली/ }));
    await user.click(screen.getByRole('button', { name: 'Meri location use karein' }));
    expect(await screen.findByRole('alert')).toBeTruthy();

    await user.type(screen.getByLabelText('Latitude'), '22.75');
    await user.type(screen.getByLabelText('Longitude'), '75.9');
    await user.click(screen.getByRole('button', { name: 'Dukaan shuru karein' }));
    await waitFor(() =>
      expect(api.createShop).toHaveBeenCalledWith({
        name: 'Verma Hardware',
        lat: 22.75,
        lng: 75.9,
        categories: ['hardware', 'electrical'],
      }),
    );
  });

  it('will not accept a latitude or longitude outside the map', async () => {
    const { user } = renderApp(<Onboarding api={fakeApi()} onDone={vi.fn()} />);
    await user.type(screen.getByLabelText('Dukaan ka naam'), 'X');
    await user.click(screen.getByRole('button', { name: /किराना/ }));
    await user.type(screen.getByLabelText('Latitude'), '95');
    await user.type(screen.getByLabelText('Longitude'), '75.9');
    expect(
      (screen.getByRole('button', { name: 'Dukaan shuru karein' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('has a "Demo location (Indore)" button, like the customer side, with the same coordinates', async () => {
    const api = fakeApi();
    const onDone = vi.fn();
    const { user } = renderApp(<Onboarding api={api} onDone={onDone} />);
    await user.type(screen.getByLabelText('Dukaan ka naam'), 'Demo Kirana');
    await user.click(screen.getByRole('button', { name: /किराना/ }));
    await user.click(screen.getByRole('button', { name: 'Demo location (Indore)' }));
    expect(screen.getByText(/✓ Demo location \(Indore\)/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Dukaan shuru karein' }));
    await waitFor(() =>
      expect(api.createShop).toHaveBeenCalledWith({
        name: 'Demo Kirana',
        lat: 22.7196,
        lng: 75.8577,
        categories: ['grocery'],
      }),
    );
    expect(onDone).toHaveBeenCalled();
  });

  it('shows each category in Devanagari with its Hinglish name under it, like the answer buttons', () => {
    renderApp(<Onboarding api={fakeApi()} onDone={vi.fn()} />);
    const tile = screen.getByRole('button', { name: /किराना/ });
    expect(tile.querySelector('.label-main')?.textContent).toBe('किराना');
    expect(tile.querySelector('.label-sub')?.textContent).toBe('Kirana');
    const pooja = screen.getByRole('button', { name: /पूजा/ });
    expect(pooja.querySelector('.label-sub')?.textContent).toMatch(/^[A-Za-z ]+$/);
  });

  it('in English the tiles carry the English name only', () => {
    renderApp(<Onboarding api={fakeApi()} onDone={vi.fn()} />, 'en');
    const tile = screen.getByRole('button', { name: 'Grocery' });
    expect(tile.querySelector('.label-sub')).toBeNull();
  });
});
