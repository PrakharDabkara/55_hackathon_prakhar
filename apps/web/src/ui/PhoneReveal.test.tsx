// @vitest-environment jsdom
import { act, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderApp } from '../test/render.js';
import { PhoneReveal } from './PhoneReveal.js';

const FULL = '+91 98765 43210';
const setup = (reveal = vi.fn(async () => FULL), lang: 'en' | 'hi' = 'en') => ({
  reveal,
  ...renderApp(<PhoneReveal masked="+91 98••• ••210" reveal={reveal} />, lang),
});

// A-09 (round 3): the eye shows the whole number to its owner. The number is asked for when the eye
// is pressed, kept only while it is shown, and never fetched on its own.
describe('PhoneReveal', () => {
  it('hides the number at first, asks the server for nothing, and says so to a screen reader', () => {
    const { reveal } = setup();
    expect(screen.getByTestId('phone-value').textContent).toBe('+91 ••••• •••••');
    expect(screen.queryByText('+91 98••• ••210')).toBeNull();
    expect(reveal).not.toHaveBeenCalled();
    const eye = screen.getByRole('button', { name: 'Show phone number' });
    expect(eye.getAttribute('aria-pressed')).toBe('false');
  });

  it('shows the full number on the eye, then hides it again and forgets it', async () => {
    const { user, reveal } = setup();
    await user.click(screen.getByRole('button', { name: 'Show phone number' }));
    expect(await screen.findByText(FULL)).toBeTruthy();
    expect(reveal).toHaveBeenCalledTimes(1);
    const hide = screen.getByRole('button', { name: 'Hide phone number' });
    expect(hide.getAttribute('aria-pressed')).toBe('true');
    await user.click(hide);
    expect(screen.queryByText(FULL)).toBeNull();
    expect(document.body.textContent).not.toContain('98765');
    await user.click(screen.getByRole('button', { name: 'Show phone number' }));
    await screen.findByText(FULL);
    expect(reveal).toHaveBeenCalledTimes(2);
  });

  it('cannot be pressed twice while the number is on its way', async () => {
    let answer: (value: string) => void = () => undefined;
    const reveal = vi.fn(() => new Promise<string>((resolve) => (answer = resolve)));
    const { user } = setup(reveal);
    const eye = screen.getByRole('button', { name: 'Show phone number' });
    await user.click(eye);
    expect((eye as HTMLButtonElement).disabled).toBe(true);
    await user.click(eye);
    expect(reveal).toHaveBeenCalledTimes(1);
    await act(async () => answer(FULL));
    expect(await screen.findByText(FULL)).toBeTruthy();
  });

  it('says what went wrong and stays hidden when the number cannot be fetched', async () => {
    const { user } = setup(vi.fn(async () => Promise.reject(new Error('offline'))));
    await user.click(screen.getByRole('button', { name: 'Show phone number' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/Couldn't show/);
    expect(screen.getByTestId('phone-value').textContent).toBe('+91 ••••• •••••');
  });

  it('hides the number again when the page goes to the background', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'Show phone number' }));
    await screen.findByText(FULL);
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    act(() => void document.dispatchEvent(new Event('visibilitychange')));
    await waitFor(() => expect(screen.queryByText(FULL)).toBeNull());
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  });

  it('does not keep a number that arrives after the page went to the background', async () => {
    let answer: (value: string) => void = () => undefined;
    const { user } = setup(vi.fn(() => new Promise<string>((resolve) => (answer = resolve))));
    await user.click(screen.getByRole('button', { name: 'Show phone number' }));
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    await act(async () => answer(FULL));
    expect(screen.queryByText(FULL)).toBeNull();
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  });

  it('forgets the number when the screen is left', async () => {
    const { user, unmount } = setup();
    await user.click(screen.getByRole('button', { name: 'Show phone number' }));
    await screen.findByText(FULL);
    unmount();
    expect(document.body.textContent).not.toContain('98765');
    renderApp(<PhoneReveal masked="+91 98••• ••210" reveal={vi.fn(async () => FULL)} />, 'en');
    expect(screen.getByTestId('phone-value').textContent).toBe('+91 ••••• •••••');
  });

  it('has the labels in Hindi too', () => {
    setup(undefined, 'hi');
    expect(screen.getByRole('button', { name: 'Phone number dikhayein' })).toBeTruthy();
  });
});
