// @vitest-environment jsdom
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderApp } from '../test/render.js';
import { PhoneReveal } from './PhoneReveal.js';

describe('PhoneReveal', () => {
  it('hides the number at first and says so to a screen reader', () => {
    renderApp(<PhoneReveal masked="+91 98••• ••210" />, 'en');
    expect(screen.queryByText('+91 98••• ••210')).toBeNull();
    expect(screen.getByTestId('phone-value').textContent).toBe('+91 ••••• •••••');
    const eye = screen.getByRole('button', { name: 'Show phone number' });
    expect(eye.getAttribute('aria-pressed')).toBe('false');
  });

  it('shows the masked number on the eye and hides it again', async () => {
    const { user } = renderApp(<PhoneReveal masked="+91 98••• ••210" />, 'en');
    await user.click(screen.getByRole('button', { name: 'Show phone number' }));
    expect(screen.getByText('+91 98••• ••210')).toBeTruthy();
    const hide = screen.getByRole('button', { name: 'Hide phone number' });
    expect(hide.getAttribute('aria-pressed')).toBe('true');
    await user.click(hide);
    expect(screen.queryByText('+91 98••• ••210')).toBeNull();
  });

  it('has the label in Hindi too', () => {
    renderApp(<PhoneReveal masked="+91 98••• ••210" />, 'hi');
    expect(screen.getByRole('button', { name: 'Phone number dikhayein' })).toBeTruthy();
  });
});
