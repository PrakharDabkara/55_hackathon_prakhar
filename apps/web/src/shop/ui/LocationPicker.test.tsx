// @vitest-environment jsdom
import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderApp } from '../../test/render.js';
import { arrowDelta, DEFAULT_CENTRE, isValidPosition } from '../lib/geo.js';
import { LocationPicker } from './LocationPicker.js';

// jsdom cannot draw a map; the real one is PinMap, covered by the browser tests.
vi.mock('./PinMap.js', () => ({
  PinMap: ({
    pin,
    confirmed,
    onMove,
  }: {
    pin: { lat: number; lng: number };
    confirmed: boolean;
    onMove: (p: { lat: number; lng: number }) => void;
  }) => (
    <div data-testid="map" data-lat={pin.lat} data-confirmed={String(confirmed)}>
      <button onClick={() => onMove({ lat: 1, lng: 2 })}>move pin</button>
    </div>
  ),
}));

describe('LocationPicker', () => {
  it('starts with just the button', () => {
    renderApp(<LocationPicker value={null} onChange={vi.fn()} locate={vi.fn()} />, 'en');
    expect(screen.getByRole('button', { name: 'Use my current location' })).toBeTruthy();
    expect(screen.queryByTestId('map')).toBeNull();
  });

  it('uses the phone’s position and tells the shop to stand in the shop', async () => {
    const onChange = vi.fn();
    const { user, rerender } = renderApp(
      <LocationPicker
        value={null}
        onChange={onChange}
        locate={async () => ({ lat: 22.7, lng: 75.8 })}
      />,
      'en',
    );
    await user.click(screen.getByRole('button', { name: 'Use my current location' }));
    expect(onChange).toHaveBeenCalledWith({ lat: 22.7, lng: 75.8 });
    rerender(
      <LocationPicker value={{ lat: 22.7, lng: 75.8 }} onChange={onChange} locate={vi.fn()} />,
    );
    expect(screen.getByText('Stand inside your shop, or drag the pin to it.')).toBeTruthy();
    expect(screen.getByTestId('map').getAttribute('data-confirmed')).toBe('true');
  });

  it('opens on the city centre when the phone says no, and saves nothing until the pin is moved', async () => {
    const onChange = vi.fn();
    const { user } = renderApp(
      <LocationPicker value={null} onChange={onChange} locate={async () => null} />,
      'en',
    );
    await user.click(screen.getByRole('button', { name: 'Use my current location' }));
    expect(onChange).not.toHaveBeenCalled();
    const map = await screen.findByTestId('map');
    expect(map.getAttribute('data-lat')).toBe(String(DEFAULT_CENTRE.lat));
    expect(map.getAttribute('data-confirmed')).toBe('false');
    expect(screen.getByText('Location is blocked. Drag the pin to your shop.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'move pin' }));
    expect(onChange).toHaveBeenCalledWith({ lat: 1, lng: 2 });
  });

  it('shows the map straight away for a shop that already has a place', () => {
    renderApp(<LocationPicker value={{ lat: 22.7, lng: 75.8 }} onChange={vi.fn()} />, 'en');
    expect(screen.getByTestId('map')).toBeTruthy();
  });
});

describe('geo helpers', () => {
  it('maps arrow keys to pixel nudges and ignores other keys', () => {
    expect(arrowDelta('ArrowLeft', 10)).toEqual({ dx: -10, dy: 0 });
    expect(arrowDelta('ArrowRight', 10)).toEqual({ dx: 10, dy: 0 });
    expect(arrowDelta('ArrowUp', 10)).toEqual({ dx: 0, dy: -10 });
    expect(arrowDelta('ArrowDown', 10)).toEqual({ dx: 0, dy: 10 });
    expect(arrowDelta('a')).toBeNull();
  });

  it('accepts only real positions', () => {
    expect(isValidPosition({ lat: 22, lng: 75 })).toBe(true);
    expect(isValidPosition({ lat: 91, lng: 75 })).toBe(false);
    expect(isValidPosition({ lat: Number.NaN, lng: 75 })).toBe(false);
  });
});
