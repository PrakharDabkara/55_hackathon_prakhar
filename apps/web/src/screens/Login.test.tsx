// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../lib/api.js';
import { fakeApi } from '../test/fakes.js';
import { renderApp } from '../test/render.js';
import { Login } from './Login.js';

describe('Login', () => {
  it('asks for the phone, then the OTP, then logs in as a shop', async () => {
    const api = fakeApi();
    const onLoggedIn = vi.fn();
    const { user } = renderApp(<Login api={api} onLoggedIn={onLoggedIn} />);

    await user.type(screen.getByLabelText(/mobile number/i), '9876543210');
    await user.click(screen.getByRole('button', { name: 'OTP bhejo' }));
    expect(api.requestOtp).toHaveBeenCalledWith('9876543210');

    await user.type(await screen.findByLabelText(/OTP/), '123456');
    await user.click(screen.getByRole('button', { name: 'Login karein' }));
    await waitFor(() => expect(onLoggedIn).toHaveBeenCalledWith('token-1'));
    expect(api.verifyOtp).toHaveBeenCalledWith('9876543210', '123456');
  });

  it('has a clearly labelled Demo mode box that fetches and fills the code', async () => {
    const api = fakeApi({ devInbox: vi.fn(async () => '482913') });
    const { user } = renderApp(<Login api={api} onLoggedIn={vi.fn()} />);

    await user.type(screen.getByLabelText(/mobile number/i), '9876543210');
    await user.click(screen.getByRole('button', { name: 'OTP bhejo' }));

    expect(await screen.findByText('Demo mode')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Demo OTP bharein' }));
    expect(api.devInbox).toHaveBeenCalledWith('9876543210');
    await waitFor(() =>
      expect((screen.getByLabelText(/OTP/) as HTMLInputElement).value).toBe('482913'),
    );
  });

  it('explains a wrong code and a rate limit in plain words', async () => {
    const verifyOtp = vi.fn().mockRejectedValue(new ApiError(401, 'invalid_code', 'x'));
    const requestOtp = vi.fn().mockRejectedValue(new ApiError(429, 'rate_limited', 'x'));
    const { user } = renderApp(
      <Login api={fakeApi({ verifyOtp, requestOtp })} onLoggedIn={vi.fn()} />,
    );

    await user.type(screen.getByLabelText(/mobile number/i), '9876543210');
    await user.click(screen.getByRole('button', { name: 'OTP bhejo' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/bahut baar/i);

    requestOtp.mockResolvedValue(undefined);
    await user.click(screen.getByRole('button', { name: 'OTP bhejo' }));
    await user.type(await screen.findByLabelText(/OTP/), '000000');
    await user.click(screen.getByRole('button', { name: 'Login karein' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/OTP galat/i);
  });

  it('does not call the API for a phone number that is not 10 digits', async () => {
    const api = fakeApi();
    const { user } = renderApp(<Login api={api} onLoggedIn={vi.fn()} />);
    await user.type(screen.getByLabelText(/mobile number/i), '12345');
    await user.click(screen.getByRole('button', { name: 'OTP bhejo' }));
    expect(api.requestOtp).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toBeTruthy();
  });
});
