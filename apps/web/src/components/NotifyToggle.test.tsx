// @vitest-environment jsdom
import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { PushClient, PushStatus } from '../lib/push.js';
import { fakePush } from '../test/fakes.js';
import { renderApp } from '../test/render.js';
import { NotifyToggle } from './NotifyToggle.js';

function client(status: PushStatus, over: Partial<PushClient> = {}): PushClient {
  let current = status;
  return {
    status: vi.fn(async () => current),
    enable: vi.fn(async () => {
      current = 'on';
      return 'on' as const;
    }),
    disable: vi.fn(async () => {
      current = 'off';
    }),
    resync: vi.fn(async () => undefined),
    ...over,
  };
}
const setup = (status: PushStatus, over: Partial<PushClient> = {}) => {
  const push = client(status, over);
  return { push, ...renderApp(<NotifyToggle api={fakePush()} client={push} />, 'en') };
};

describe('the notifications switch', () => {
  it('is an off switch titled Notifications, and asks for nothing until it is tapped', async () => {
    const { push } = setup('off');
    const toggle = await screen.findByRole('switch', { name: 'Notifications' });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(push.enable).not.toHaveBeenCalled();
  });

  it('turns notifications on with a tap, then off again', async () => {
    const { push, user } = setup('off');
    await user.click(await screen.findByRole('switch', { name: 'Notifications' }));
    expect(push.enable).toHaveBeenCalledOnce();
    const on = await screen.findByRole('switch', { name: 'Notifications', checked: true });
    await user.click(on);
    expect(push.disable).toHaveBeenCalledOnce();
    expect(
      await screen.findByRole('switch', { name: 'Notifications', checked: false }),
    ).toBeTruthy();
  });

  it('starts out on when notifications are already on, and quietly resyncs', async () => {
    const { push } = setup('on');
    expect(
      await screen.findByRole('switch', { name: 'Notifications', checked: true }),
    ).toBeTruthy();
    expect(push.resync).toHaveBeenCalledOnce();
  });

  it('on an iPhone that has not installed the app, shows the hint and a switch that cannot be pressed', async () => {
    const { push } = setup('ios_install');
    expect(await screen.findByText("First tap Share, then 'Add to Home Screen'.")).toBeTruthy();
    const toggle = screen.getByRole('switch', { name: 'Notifications' }) as HTMLButtonElement;
    expect(toggle.disabled).toBe(true);
    expect(push.enable).not.toHaveBeenCalled();
  });

  it('when the browser has blocked notifications, says where to allow them', async () => {
    setup('blocked');
    expect(await screen.findByText(/browser settings/i)).toBeTruthy();
  });

  it('says so when turning on did not work, and stays off', async () => {
    const { user } = setup('off', { enable: vi.fn(async () => 'failed' as const) });
    await user.click(await screen.findByRole('switch', { name: 'Notifications' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('switch', { name: 'Notifications', checked: false })).toBeTruthy();
  });

  it('shows nothing where push cannot work or the server has it off', async () => {
    for (const status of ['unsupported', 'disabled'] as const) {
      const { container, unmount } = setup(status);
      await vi.waitFor(() => expect(container.querySelector('[data-notify]')).toBeNull());
      expect(screen.queryByRole('switch')).toBeNull();
      unmount();
    }
  });

  it('speaks Hindi on a Hindi screen', async () => {
    const push = client('off');
    renderApp(<NotifyToggle api={fakePush()} client={push} />, 'hi');
    expect(await screen.findByRole('switch', { name: 'Notification' })).toBeTruthy();
  });
});
