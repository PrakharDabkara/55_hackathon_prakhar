// @vitest-environment jsdom
import { act, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../lib/api.js';
import { fakeSeekerApi } from '../test/fakes.js';
import { renderApp } from '../test/render.js';
import { LoginSheet } from './LoginSheet.js';

const open = (api = fakeSeekerApi(), onLoggedIn = vi.fn(), onClose = vi.fn()) => ({
  api,
  onLoggedIn,
  onClose,
  ...renderApp(<LoginSheet api={api} open onClose={onClose} onLoggedIn={onLoggedIn} />, 'en'),
});

describe('LoginSheet', () => {
  it('renders nothing when closed', () => {
    renderApp(
      <LoginSheet api={fakeSeekerApi()} open={false} onClose={vi.fn()} onLoggedIn={vi.fn()} />,
      'en',
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('asks for the mobile, then the code, then logs in; says shops never see the number', async () => {
    const { user, api, onLoggedIn } = open();
    expect(screen.getByRole('dialog', { name: 'Log in to send your request' })).toBeTruthy();
    expect(screen.getByText('Shops never see your number or name.')).toBeTruthy();
    expect(screen.getByText('+91')).toBeTruthy();
    await user.type(screen.getByLabelText('Mobile number'), '98765 43210');
    await user.click(screen.getByRole('button', { name: 'Send code' }));
    expect(api.requestOtp).toHaveBeenCalledWith('9876543210');
    await user.type(await screen.findByLabelText('6-digit code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Log in' }));
    await waitFor(() => expect(onLoggedIn).toHaveBeenCalledWith('seeker-token'));
    expect(api.verifyOtp).toHaveBeenCalledWith('9876543210', '123456');
  });

  it('shows the AskBuy mark and tagline above the phone field', () => {
    open();
    const dialog = screen.getByRole('dialog');
    expect(dialog.querySelector('svg.brand-mark')).toBeTruthy();
    expect(screen.getByText('Ask the shops nearby, then buy.')).toBeTruthy();
  });

  it('fills the demo code from the inbox', async () => {
    const api = fakeSeekerApi({ devInbox: vi.fn(async () => '482913') });
    const { user } = open(api);
    await user.type(screen.getByLabelText('Mobile number'), '9876543210');
    await user.click(screen.getByRole('button', { name: 'Send code' }));
    await user.click(await screen.findByRole('button', { name: 'Fill demo OTP' }));
    expect(api.devInbox).toHaveBeenCalledWith('9876543210');
    await waitFor(() =>
      expect((screen.getByLabelText('6-digit code') as HTMLInputElement).value).toBe('482913'),
    );
  });

  it('can send a new code', async () => {
    const { user, api } = open();
    await user.type(screen.getByLabelText('Mobile number'), '9876543210');
    await user.click(screen.getByRole('button', { name: 'Send code' }));
    await user.click(await screen.findByRole('button', { name: 'Send a new code' }));
    await waitFor(() => expect(api.requestOtp).toHaveBeenCalledTimes(2));
  });

  it('explains a wrong code and a rate limit in plain words', async () => {
    const verifyOtp = vi.fn().mockRejectedValue(new ApiError(401, 'invalid_code', 'x'));
    const requestOtp = vi.fn().mockRejectedValueOnce(new ApiError(429, 'rate_limited', 'x'));
    const { user } = open(fakeSeekerApi({ verifyOtp, requestOtp }));
    await user.type(screen.getByLabelText('Mobile number'), '9876543210');
    await user.click(screen.getByRole('button', { name: 'Send code' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/Too many/);
    await user.click(screen.getByRole('button', { name: 'Send code' }));
    await user.type(await screen.findByLabelText('6-digit code'), '000000');
    await user.click(screen.getByRole('button', { name: 'Log in' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/wrong or has expired/);
  });

  it('does not call the API for a number that is not 10 digits', async () => {
    const { user, api } = open();
    await user.type(screen.getByLabelText('Mobile number'), '12345');
    await user.click(screen.getByRole('button', { name: 'Send code' }));
    expect(api.requestOtp).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('closes with the close button', async () => {
    const { user, onClose } = open();
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
  });
});

const BAD = "That doesn't look like an Indian mobile number.";
const DEMO = "AskBuy is in demo mode. Real numbers can't receive codes yet.";

describe('LoginSheet: round 1 (A-02..A-06)', () => {
  const toCode = async (user: ReturnType<typeof open>['user']) => {
    await user.type(screen.getByLabelText('Mobile number'), '9000000202');
    await user.click(screen.getByRole('button', { name: 'Send code' }));
    await screen.findByLabelText('6-digit code');
  };

  it.each(['9999999999', '1234567890', '5876543210'])(
    'refuses %s with the one message',
    async (n) => {
      const { user, api } = open();
      await user.type(screen.getByLabelText('Mobile number'), n);
      await user.click(screen.getByRole('button', { name: 'Send code' }));
      expect(screen.getByRole('alert').textContent).toBe(BAD);
      expect(api.requestOtp).not.toHaveBeenCalled();
    },
  );

  it('says it is demo mode and fills a customer demo number from a chip', async () => {
    const { user } = open();
    expect(await screen.findByText(DEMO)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '9000000203' }));
    expect((screen.getByLabelText('Mobile number') as HTMLInputElement).value).toBe('9000000203');
  });

  it('tells a real number it is demo mode at once, with no code screen', async () => {
    const requestOtp = vi.fn().mockRejectedValue(new ApiError(403, 'demo_mode', 'x'));
    const { user } = open(fakeSeekerApi({ requestOtp }));
    await user.type(screen.getByLabelText('Mobile number'), '9876543210');
    await user.click(screen.getByRole('button', { name: 'Send code' }));
    expect((await screen.findByRole('alert')).textContent).toBe(DEMO);
    expect(screen.queryByLabelText('6-digit code')).toBeNull();
  });

  it('has Change number, which clears the code and the error and frees the field', async () => {
    const { user } = open();
    await toCode(user);
    await user.type(screen.getByLabelText('6-digit code'), '12');
    await user.click(screen.getByRole('button', { name: 'Change number' }));
    expect((screen.getByLabelText('Mobile number') as HTMLInputElement).readOnly).toBe(false);
    expect(screen.queryByLabelText('6-digit code')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('goes back to the number on the browser back button', async () => {
    const { user } = open();
    await toCode(user);
    act(() => window.history.back());
    await waitFor(() => expect(screen.queryByLabelText('6-digit code')).toBeNull());
  });

  it('keeps a wrong-code error, with the tries left, until the code is edited', async () => {
    const verifyOtp = vi
      .fn()
      .mockRejectedValue(new ApiError(401, 'invalid_code', 'x', { attemptsLeft: 2 }));
    const { user } = open(fakeSeekerApi({ verifyOtp }));
    await toCode(user);
    await user.type(screen.getByLabelText('6-digit code'), '000000');
    await user.click(screen.getByRole('button', { name: 'Log in' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/2 tries left/);
    await user.click(screen.getByRole('button', { name: 'Log in' }));
    expect(screen.getByRole('alert').textContent).toMatch(/2 tries left/);
    await user.type(screen.getByLabelText('6-digit code'), '{backspace}');
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
