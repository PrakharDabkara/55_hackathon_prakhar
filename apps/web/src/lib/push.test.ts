import { describe, expect, it, vi } from 'vitest';
import { fakePush } from '../test/fakes.js';
import { createPushClient, urlBase64ToBytes, type PushEnv } from './push.js';

const SUB = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
  keys: { p256dh: 'p', auth: 'a' },
};

function env(overrides: Partial<PushEnv> = {}): PushEnv {
  return {
    supported: true,
    iosNeedsInstall: false,
    permission: vi.fn(() => 'default' as NotificationPermission),
    requestPermission: vi.fn(async () => 'granted' as NotificationPermission),
    getSubscription: vi.fn(async () => null),
    subscribe: vi.fn(async () => SUB),
    unsubscribe: vi.fn(async () => SUB.endpoint),
    ...overrides,
  };
}
const serverOn = () =>
  fakePush({ pushConfig: vi.fn(async () => ({ enabled: true as const, publicKey: 'BKEY' })) });

describe('the browser side of push', () => {
  describe('status', () => {
    it('is "off" on a supported browser that has not been asked', async () => {
      expect(await createPushClient(serverOn(), env()).status()).toBe('off');
    });
    it('is "unsupported" where the browser cannot do push', async () => {
      expect(await createPushClient(serverOn(), env({ supported: false })).status()).toBe(
        'unsupported',
      );
    });
    it('is "ios_install" on an iPhone until the app is added to the Home Screen', async () => {
      expect(await createPushClient(serverOn(), env({ iosNeedsInstall: true })).status()).toBe(
        'ios_install',
      );
    });
    it('is "disabled" when the server has no VAPID keys', async () => {
      expect(await createPushClient(fakePush(), env()).status()).toBe('disabled');
    });
    it('is "disabled" when the server cannot be reached: the button just is not offered', async () => {
      const api = fakePush({ pushConfig: vi.fn(async () => Promise.reject(new Error('offline'))) });
      expect(await createPushClient(api, env()).status()).toBe('disabled');
    });
    it('is "blocked" after the person said no in the browser', async () => {
      const e = env({ permission: vi.fn(() => 'denied' as NotificationPermission) });
      expect(await createPushClient(serverOn(), e).status()).toBe('blocked');
    });
    it('is "on" when there is permission and a subscription', async () => {
      const e = env({
        permission: vi.fn(() => 'granted' as NotificationPermission),
        getSubscription: vi.fn(async () => SUB),
      });
      expect(await createPushClient(serverOn(), e).status()).toBe('on');
    });
    it('never asks for permission just to find out', async () => {
      const e = env();
      await createPushClient(serverOn(), e).status();
      expect(e.requestPermission).not.toHaveBeenCalled();
      expect(e.subscribe).not.toHaveBeenCalled();
    });
  });

  describe('enable (only ever called from a tap)', () => {
    it('asks permission, subscribes with the server key and tells the server', async () => {
      const api = serverOn();
      const e = env();
      expect(await createPushClient(api, e).enable()).toBe('on');
      expect(e.requestPermission).toHaveBeenCalledOnce();
      expect(e.subscribe).toHaveBeenCalledWith('BKEY');
      expect(api.pushSubscribe).toHaveBeenCalledWith(SUB);
    });
    it('stops, and tells the server nothing, when permission is refused', async () => {
      const api = serverOn();
      const e = env({ requestPermission: vi.fn(async () => 'denied' as NotificationPermission) });
      expect(await createPushClient(api, e).enable()).toBe('blocked');
      expect(e.subscribe).not.toHaveBeenCalled();
      expect(api.pushSubscribe).not.toHaveBeenCalled();
    });
    it('does not ask at all on an iPhone that has not installed the app', async () => {
      const e = env({ iosNeedsInstall: true });
      expect(await createPushClient(serverOn(), e).enable()).toBe('ios_install');
      expect(e.requestPermission).not.toHaveBeenCalled();
    });
    it('reports a failure when the server or the push service refuses, and does not keep a half-made subscription', async () => {
      const api = serverOn();
      vi.mocked(api.pushSubscribe).mockRejectedValueOnce(new Error('500'));
      const e = env();
      expect(await createPushClient(api, e).enable()).toBe('failed');
      expect(e.unsubscribe).toHaveBeenCalled();
    });
  });

  describe('disable (the setting to turn it off)', () => {
    it('removes the browser subscription and tells the server which device', async () => {
      const api = serverOn();
      const e = env();
      await createPushClient(api, e).disable();
      expect(e.unsubscribe).toHaveBeenCalledOnce();
      expect(api.pushUnsubscribe).toHaveBeenCalledWith(SUB.endpoint);
    });
    it('does not fail when there was no subscription', async () => {
      const api = serverOn();
      const e = env({ unsubscribe: vi.fn(async () => null) });
      await createPushClient(api, e).disable();
      expect(api.pushUnsubscribe).not.toHaveBeenCalled();
    });
  });

  describe('resync', () => {
    it('tells the server about a subscription the browser already has, with no prompt', async () => {
      const api = serverOn();
      const e = env({
        permission: vi.fn(() => 'granted' as NotificationPermission),
        getSubscription: vi.fn(async () => SUB),
      });
      await createPushClient(api, e).resync();
      expect(api.pushSubscribe).toHaveBeenCalledWith(SUB);
      expect(e.requestPermission).not.toHaveBeenCalled();
    });
    it('does nothing without permission', async () => {
      const api = serverOn();
      await createPushClient(api, env()).resync();
      expect(api.pushSubscribe).not.toHaveBeenCalled();
    });
  });

  it('turns the server key into the bytes the browser wants', () => {
    expect(Array.from(urlBase64ToBytes('AQID_w'))).toEqual([1, 2, 3, 255]);
  });
});
