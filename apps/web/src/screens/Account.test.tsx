// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../lib/api.js';
import type { DevicePushClient } from '../lib/push.js';
import { fakeSeekerApi } from '../test/fakes.js';
import { renderApp } from '../test/render.js';
import { Account } from './Account.js';

afterEach(() => document.documentElement.removeAttribute('data-theme'));

const pushClient = (over: Partial<DevicePushClient> = {}): DevicePushClient => ({
  status: vi.fn(async () => 'off' as const),
  enable: vi.fn(async () => 'on' as const),
  disable: vi.fn(async () => undefined),
  resync: vi.fn(async () => undefined),
  forgetDevice: vi.fn(async () => 'https://fcm.googleapis.com/fcm/send/d1'),
  ...over,
});

function setup(
  overrides: Parameters<typeof fakeSeekerApi>[0] = {},
  client: DevicePushClient = pushClient(),
) {
  const api = fakeSeekerApi({
    account: vi.fn(async () => ({ phoneMasked: '+91 98••• ••210' })),
    logout: vi.fn(async () => undefined),
    deleteAccount: vi.fn(async () => undefined),
    logoutAll: vi.fn(async () => undefined),
    ...overrides,
  });
  const navigate = vi.fn();
  const onBack = vi.fn();
  const onLoggedOut = vi.fn();
  const utils = renderApp(
    <Account
      api={api}
      navigate={navigate}
      onBack={onBack}
      onLoggedOut={onLoggedOut}
      pushClient={client}
    />,
    'en',
  );
  return { api, navigate, onBack, onLoggedOut, client, ...utils };
}

describe('Account', () => {
  it('has the title, a way back, and the phone only partly shown', async () => {
    const { user, onBack } = setup();
    expect(screen.getByRole('heading', { name: 'Account' })).toBeTruthy();
    expect(await screen.findByText('Logged in as')).toBeTruthy();
    expect(screen.queryByText('+91 98••• ••210')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Show phone number' }));
    expect(screen.getByText('+91 98••• ••210')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Hide phone number' }));
    expect(screen.queryByText('+91 98••• ••210')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(onBack).toHaveBeenCalled();
  });

  it('shows skeletons while loading and a retry when loading fails', async () => {
    const account = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue({ phoneMasked: '+91 98••• ••210' });
    const { user } = setup({ account });
    await user.click(await screen.findByRole('button', { name: 'Try again' }));
    await user.click(await screen.findByRole('button', { name: 'Show phone number' }));
    expect(await screen.findByText('+91 98••• ••210')).toBeTruthy();
  });

  it('with no address says so and adds one through the sheet', async () => {
    const keepAddress = vi.fn(async () => ({
      id: 'a1',
      addressText: '12 Palasia Square',
      customerName: null,
    }));
    const { user } = setup({ keepAddress });
    expect(await screen.findByText('No address yet')).toBeTruthy();
    expect(
      screen.getByText('Used only for deliveries. A shop sees it only after you choose them.'),
    ).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Add address' }));
    const sheet = screen.getByRole('dialog', { name: 'Add address' });
    await user.type(within(sheet).getByLabelText('Address'), '12 Palasia Square');
    await user.click(within(sheet).getByRole('button', { name: 'Save' }));
    expect(keepAddress).toHaveBeenCalledWith({ addressText: '12 Palasia Square' });
    expect(await screen.findByText('12 Palasia Square')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy();
  });

  it('refuses an address that is too short', async () => {
    const keepAddress = vi.fn();
    const { user } = setup({ keepAddress });
    await user.click(await screen.findByRole('button', { name: 'Add address' }));
    const sheet = screen.getByRole('dialog', { name: 'Add address' });
    await user.type(within(sheet).getByLabelText('Address'), 'abc');
    await user.click(within(sheet).getByRole('button', { name: 'Save' }));
    expect(keepAddress).not.toHaveBeenCalled();
    expect(within(sheet).getByRole('alert')).toBeTruthy();
  });

  it('turns reply alerts on with the permission flow and off by deleting the subscription', async () => {
    let status: 'off' | 'on' = 'off';
    const client = pushClient({
      status: vi.fn(async () => status),
      enable: vi.fn(async () => {
        status = 'on';
        return 'on' as const;
      }),
      disable: vi.fn(async () => {
        status = 'off';
      }),
    });
    const { user } = setup({}, client);
    const toggle = await screen.findByRole('switch', { name: /Reply alerts/ });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(screen.getByText('A notification when a shop answers')).toBeTruthy();
    await user.click(toggle);
    await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('true'));
    expect(client.enable).toHaveBeenCalled();
    await user.click(toggle);
    await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('false'));
    expect(client.disable).toHaveBeenCalled();
  });

  it('shows the switch disabled when the browser blocks notifications', async () => {
    setup({}, pushClient({ status: vi.fn(async () => 'blocked' as const) }));
    const toggle = await screen.findByRole('switch', { name: /Reply alerts/ });
    expect((toggle as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Blocked in your browser settings')).toBeTruthy();
  });

  it('keeps Appearance in storage and on the page', async () => {
    const { user } = setup();
    const group = await screen.findByRole('radiogroup', { name: 'Appearance' });
    expect((within(group).getByRole('radio', { name: 'System' }) as HTMLInputElement).checked).toBe(
      true,
    );
    await user.click(within(group).getByRole('radio', { name: 'Dark' }));
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(localStorage.getItem('km-theme')).toBe('dark');
    await user.click(within(group).getByRole('radio', { name: 'System' }));
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });

  it('opens My orders and the "What shops can see" sheet', async () => {
    const { user, navigate } = setup();
    await user.click(await screen.findByRole('link', { name: 'My orders' }));
    expect(navigate).toHaveBeenCalledWith('/app/orders');
    await user.click(screen.getByRole('button', { name: 'What shops can see' }));
    const sheet = screen.getByRole('dialog', { name: 'What shops can see' });
    expect(within(sheet).getByText(/never see your phone number/i)).toBeTruthy();
  });

  it('links to the shop app', async () => {
    setup();
    const link = await screen.findByRole('link', { name: 'Open the shop app' });
    expect(link.getAttribute('href')).toBe('/app/shop');
  });

  it('logs out: forgets this device, revokes the session, then leaves', async () => {
    const { user, api, onLoggedOut, client } = setup();
    await user.click(await screen.findByRole('button', { name: 'Log out' }));
    await waitFor(() => expect(onLoggedOut).toHaveBeenCalled());
    expect(client.forgetDevice).toHaveBeenCalled();
    expect(api.logout).toHaveBeenCalledWith('https://fcm.googleapis.com/fcm/send/d1');
  });

  it('still logs out here when the server cannot be reached', async () => {
    const { user, onLoggedOut } = setup({
      logout: vi.fn(async () => Promise.reject(new Error('x'))),
    });
    await user.click(await screen.findByRole('button', { name: 'Log out' }));
    await waitFor(() => expect(onLoggedOut).toHaveBeenCalled());
  });

  it('has a quiet "Log out on all devices" that asks first, and cancel changes nothing', async () => {
    const { user, api, onLoggedOut } = setup();
    const open = await screen.findByRole('button', { name: 'Log out on all devices' });
    expect(open.className).not.toContain('sh-btn--primary');
    await user.click(open);
    const sheet = screen.getByRole('dialog', { name: 'Log out on all devices?' });
    expect(within(sheet).getByText(/every phone and browser/i)).toBeTruthy();
    await user.click(within(sheet).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(api.logoutAll).not.toHaveBeenCalled();
    expect(onLoggedOut).not.toHaveBeenCalled();
  });

  it('logs out everywhere: one call, this browser forgets its alerts, then leaves', async () => {
    const { user, api, onLoggedOut, client } = setup();
    await user.click(await screen.findByRole('button', { name: 'Log out on all devices' }));
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Log out everywhere' }),
    );
    await waitFor(() => expect(onLoggedOut).toHaveBeenCalled());
    expect(api.logoutAll).toHaveBeenCalledTimes(1);
    expect(client.forgetDevice).toHaveBeenCalled();
  });

  it('when the server cannot be reached it says so and stays logged in, never claiming it worked', async () => {
    const { user, onLoggedOut } = setup({
      logoutAll: vi.fn(async () => Promise.reject(new Error('offline'))),
    });
    await user.click(await screen.findByRole('button', { name: 'Log out on all devices' }));
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Log out everywhere' }),
    );
    expect(
      await screen.findByText("Couldn't log out everywhere. Check your connection and try again."),
    ).toBeTruthy();
    expect(onLoggedOut).not.toHaveBeenCalled();
  });

  it('asks before deleting, and cancel changes nothing', async () => {
    const { user, api } = setup();
    await user.click(await screen.findByRole('button', { name: 'Delete my account' }));
    const sheet = screen.getByRole('dialog', { name: 'Delete your account?' });
    expect(
      within(sheet).getByText(
        "Your phone number, address and alerts are removed and you're logged out. Shops keep their past order records, without your number.",
      ),
    ).toBeTruthy();
    await user.click(within(sheet).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(api.deleteAccount).not.toHaveBeenCalled();
  });

  it('deletes the account, then leaves logged out', async () => {
    const { user, api, onLoggedOut, client } = setup();
    await user.click(await screen.findByRole('button', { name: 'Delete my account' }));
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete account' }),
    );
    await waitFor(() => expect(onLoggedOut).toHaveBeenCalled());
    expect(api.deleteAccount).toHaveBeenCalled();
    expect(client.forgetDevice).toHaveBeenCalled();
  });

  it('says what to do when an open order blocks the delete', async () => {
    const deleteAccount = vi.fn(async () => {
      throw new ApiError(409, 'open_order', 'Finish or cancel your open order first.');
    });
    const { user, onLoggedOut } = setup({ deleteAccount });
    await user.click(await screen.findByRole('button', { name: 'Delete my account' }));
    const sheet = screen.getByRole('dialog');
    await user.click(within(sheet).getByRole('button', { name: 'Delete account' }));
    expect(await within(sheet).findByText('Finish or cancel your open order first.')).toBeTruthy();
    expect(onLoggedOut).not.toHaveBeenCalled();
  });
});
