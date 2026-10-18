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
  return { push, ...renderApp(<NotifyToggle api={fakePush()} client={push} />) };
};

describe('the notification button', () => {
  it('offers "Notification chalu karein", and asks for nothing until it is tapped', async () => {
    const { push } = setup('off');
    expect(await screen.findByRole('button', { name: 'Notification chalu karein' })).toBeTruthy();
    expect(push.enable).not.toHaveBeenCalled();
  });

  it('turns notifications on with a tap, then offers to turn them off', async () => {
    const { push, user } = setup('off');
    await user.click(await screen.findByRole('button', { name: 'Notification chalu karein' }));
    expect(push.enable).toHaveBeenCalledOnce();
    await user.click(await screen.findByRole('button', { name: 'Notification band karein' }));
    expect(push.disable).toHaveBeenCalledOnce();
    expect(await screen.findByRole('button', { name: 'Notification chalu karein' })).toBeTruthy();
  });

  it('starts out showing "off" when notifications are already on', async () => {
    setup('on');
    expect(await screen.findByRole('button', { name: 'Notification band karein' })).toBeTruthy();
  });

  it('on an iPhone that has not installed the app, shows the hint and a button that cannot be pressed', async () => {
    const { push } = setup('ios_install');
    expect(await screen.findByText("Pehle 'Add to Home Screen' karein")).toBeTruthy();
    const button = screen.getByRole('button', { name: 'Notification chalu karein' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(push.enable).not.toHaveBeenCalled();
  });

  it('when the browser has blocked notifications, says where to allow them', async () => {
    setup('blocked');
    expect(await screen.findByText(/browser ki settings/i)).toBeTruthy();
  });

  it('says so when turning on did not work, and lets the person try again', async () => {
    const { user } = setup('off', { enable: vi.fn(async () => 'failed' as const) });
    await user.click(await screen.findByRole('button', { name: 'Notification chalu karein' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Notification chalu karein' })).toBeTruthy();
  });

  it('shows nothing where push cannot work or the server has it off', async () => {
    for (const status of ['unsupported', 'disabled'] as const) {
      const { container, unmount } = setup(status);
      await vi.waitFor(() => expect(container.querySelector('[data-notify]')).toBeNull());
      expect(screen.queryByRole('button')).toBeNull();
      unmount();
    }
  });

  it("quietly refreshes the server's copy of the subscription when it is already on", async () => {
    const { push } = setup('on');
    await screen.findByRole('button', { name: 'Notification band karein' });
    expect(push.resync).toHaveBeenCalledOnce();
  });

  it('speaks English when the language is English', async () => {
    const push = client('off');
    renderApp(<NotifyToggle api={fakePush()} client={push} />, 'en');
    expect(await screen.findByRole('button', { name: 'Turn on notifications' })).toBeTruthy();
  });
});
