// @vitest-environment jsdom
import { act, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../lib/api.js';
import { fakeApi } from '../../test/fakes.js';
import { renderApp } from '../../test/render.js';
import { Login } from './Login.js';

const BAD = "That doesn't look like an Indian mobile number.";
const DEMO = "AskBuy is in demo mode. Real numbers can't receive codes yet.";

const login = (api = fakeApi()) => {
  const onLoggedIn = vi.fn();
  return { api, onLoggedIn, ...renderApp(<Login api={api} onLoggedIn={onLoggedIn} />, 'en') };
};

const toCodeStep = async (user: ReturnType<typeof login>['user'], number = '9000000102') => {
  await user.type(screen.getByLabelText('Mobile number'), number);
  await user.click(screen.getByRole('button', { name: 'Send code' }));
  await screen.findByLabelText('6-digit code');
};

describe('Login: the words (A-01)', () => {
  it('greets with an upbeat line', () => {
    login();
    expect(screen.getByText("Let's lift your shutter online!")).toBeTruthy();
    expect(document.body.textContent).not.toContain('in a minute');
  });
});

describe('Login: Indian mobiles only (A-02)', () => {
  it.each(['9999999999', '1234567890', '5876543210', '12345'])(
    'refuses %s without asking the server',
    async (number) => {
      const { user, api } = login();
      await user.type(screen.getByLabelText('Mobile number'), number);
      await user.click(screen.getByRole('button', { name: 'Send code' }));
      expect(screen.getByText(BAD)).toBeTruthy();
      expect(api.requestOtp).not.toHaveBeenCalled();
    },
  );

  it('keeps accepting +91 and 0 in front', async () => {
    const { user, api } = login();
    await user.type(screen.getByLabelText('Mobile number'), '+91 90000 00102');
    await user.click(screen.getByRole('button', { name: 'Send code' }));
    expect(api.requestOtp).toHaveBeenCalledWith('9000000102');
  });

  it('shows the same words when the server says 400', async () => {
    const api = fakeApi({
      requestOtp: vi.fn(async () => Promise.reject(new ApiError(400, 'invalid_request', 'x'))),
    });
    const { user } = login(api);
    await user.type(screen.getByLabelText('Mobile number'), '9876543210');
    await user.click(screen.getByRole('button', { name: 'Send code' }));
    expect(await screen.findByText(BAD)).toBeTruthy();
  });
});

describe('Login: demo mode (A-03, A-04)', () => {
  it('says it is demo mode and offers the public numbers as chips that fill the field', async () => {
    const { user } = login();
    expect(await screen.findByText(DEMO)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '9000000103' }));
    expect((screen.getByLabelText('Mobile number') as HTMLInputElement).value).toBe('9000000103');
  });

  it('shows no notice and no chips when the server is not in demo mode', async () => {
    const api = fakeApi({ demoNumbers: vi.fn(async () => ({ demo: false, numbers: [] })) });
    login(api);
    await waitFor(() => expect(api.demoNumbers).toHaveBeenCalled());
    expect(screen.queryByText(DEMO)).toBeNull();
  });

  it('still lets a person log in when the demo numbers cannot be fetched', async () => {
    const api = fakeApi({ demoNumbers: vi.fn(async () => Promise.reject(new Error('offline'))) });
    const { user } = login(api);
    await toCodeStep(user);
    expect(screen.getByLabelText('6-digit code')).toBeTruthy();
  });

  it('tells a non-demo number it is demo mode at once, without a code screen', async () => {
    const api = fakeApi({
      requestOtp: vi.fn(async () => Promise.reject(new ApiError(403, 'demo_mode', 'x'))),
    });
    const { user } = login(api);
    await user.type(screen.getByLabelText('Mobile number'), '9876543210');
    await user.click(screen.getByRole('button', { name: 'Send code' }));
    expect((await screen.findByRole('alert')).textContent).toBe(DEMO);
    expect(screen.queryByLabelText('6-digit code')).toBeNull();
    expect((screen.getByLabelText('Mobile number') as HTMLInputElement).readOnly).toBe(false);
  });

  it('does not talk about SMS', async () => {
    const { user } = login();
    await screen.findByText(DEMO);
    expect(document.body.textContent).not.toMatch(/SMS/);
    await toCodeStep(user);
    expect(document.body.textContent).not.toMatch(/SMS/);
  });
});

describe('Login: Change number (A-05)', () => {
  it('goes back to the number with the field editable and the code and error gone', async () => {
    const { user } = login();
    await toCodeStep(user);
    await user.type(screen.getByLabelText('6-digit code'), '123');
    await user.click(screen.getByRole('button', { name: 'Change number' }));
    const field = screen.getByLabelText('Mobile number') as HTMLInputElement;
    expect(field.readOnly).toBe(false);
    expect(screen.queryByLabelText('6-digit code')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    await user.clear(field);
    await user.type(field, '9000000103');
    await user.click(screen.getByRole('button', { name: 'Send code' }));
    expect((await screen.findByLabelText('6-digit code')) as HTMLInputElement).toHaveProperty(
      'value',
      '',
    );
  });

  it('does the same on the browser back button', async () => {
    const { user } = login();
    await toCodeStep(user);
    act(() => window.history.back());
    await waitFor(() => expect(screen.queryByLabelText('6-digit code')).toBeNull());
    expect((screen.getByLabelText('Mobile number') as HTMLInputElement).readOnly).toBe(false);
  });
});

describe('Login: a wrong code (A-06)', () => {
  it('stays on screen, with the tries left, until the code is edited', async () => {
    let finish: () => void = () => undefined;
    const verifyOtp = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(401, 'invalid_code', 'x', { attemptsLeft: 3 }))
      .mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            finish = () => reject(new ApiError(401, 'invalid_code', 'x', { attemptsLeft: 2 }));
          }),
      );
    const { user } = login(fakeApi({ verifyOtp }));
    await toCodeStep(user);
    await user.type(screen.getByLabelText('6-digit code'), '000000');
    await user.click(screen.getByRole('button', { name: 'Log in' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'That code is wrong. Check it and try again. 3 tries left.',
    );
    await user.click(screen.getByRole('button', { name: 'Log in' }));
    expect(screen.getByRole('alert').textContent).toMatch(/3 tries left/);
    await act(async () => finish());
    expect((await screen.findByRole('alert')).textContent).toMatch(/2 tries left/);
    await user.type(screen.getByLabelText('6-digit code'), '{backspace}');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('says "1 try left" and then asks for a new code', async () => {
    const verifyOtp = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(401, 'invalid_code', 'x', { attemptsLeft: 1 }))
      .mockRejectedValueOnce(new ApiError(401, 'invalid_code', 'x', { attemptsLeft: 0 }));
    const { user } = login(fakeApi({ verifyOtp }));
    await toCodeStep(user);
    await user.type(screen.getByLabelText('6-digit code'), '000000');
    await user.click(screen.getByRole('button', { name: 'Log in' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/1 try left/);
    await user.type(screen.getByLabelText('6-digit code'), '{backspace}1');
    await user.click(screen.getByRole('button', { name: 'Log in' }));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toMatch(/No tries left\. Ask for a new code\./),
    );
  });

  it('shows no count when the server gives none', async () => {
    const verifyOtp = vi.fn().mockRejectedValue(new ApiError(401, 'invalid_code', 'x'));
    const { user } = login(fakeApi({ verifyOtp }));
    await toCodeStep(user);
    await user.type(screen.getByLabelText('6-digit code'), '000000');
    await user.click(screen.getByRole('button', { name: 'Log in' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'That code is wrong. Check it and try again.',
    );
  });
});
