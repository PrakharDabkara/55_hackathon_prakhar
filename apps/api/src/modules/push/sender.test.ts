import { pino } from 'pino';
import { describe, expect, it, vi } from 'vitest';
import { createPushSender, type PushStore, type WebPushClient } from './sender.js';

const logger = pino({ level: 'silent' });
const vapid = { publicKey: 'pub', privateKey: 'priv', subject: 'mailto:ops@example.com' };
const payload = {
  title: 'New request: atta · under 1 km',
  body: 'Open the shop to answer',
  tag: 'shop-requests',
  renotify: true,
  url: '/app/shop',
};
const sub = {
  id: 'sub-1',
  userId: 'u1',
  endpoint: 'https://fcm.googleapis.com/x',
  p256dh: 'k',
  auth: 'a',
};

function setup(sendNotification: WebPushClient['sendNotification']) {
  const store: PushStore = {
    find: vi.fn(async () => sub),
    remove: vi.fn(async () => undefined),
    markSuccess: vi.fn(async () => undefined),
  };
  const sender = createPushSender({ store, webPush: { sendNotification }, vapid, logger });
  return { store, sender };
}
const failure = (statusCode: number) =>
  Object.assign(new Error(`push ${statusCode}`), { statusCode });

describe('sending one push', () => {
  it('sends the payload to the subscription, signed with our VAPID details, and notes the success', async () => {
    const send = vi.fn(async () => ({ statusCode: 201 }));
    const { store, sender } = setup(send);
    expect(await sender.deliver({ subscriptionId: 'sub-1', payload })).toBe('sent');
    expect(send).toHaveBeenCalledOnce();
    const [target, body, options] = send.mock.calls[0] as unknown as [
      { endpoint: string; keys: { p256dh: string; auth: string } },
      string,
      { vapidDetails: typeof vapid; TTL: number },
    ];
    expect(target).toEqual({ endpoint: sub.endpoint, keys: { p256dh: 'k', auth: 'a' } });
    expect(JSON.parse(body)).toEqual(payload);
    expect(options.vapidDetails).toEqual(vapid);
    expect(options.TTL).toBeGreaterThan(0);
    expect(store.markSuccess).toHaveBeenCalledWith('sub-1');
  });

  for (const status of [404, 410]) {
    it(`deletes the subscription when the push service says ${status} (the device is gone)`, async () => {
      const { store, sender } = setup(vi.fn(async () => Promise.reject(failure(status))));
      expect(await sender.deliver({ subscriptionId: 'sub-1', payload })).toBe('gone');
      expect(store.remove).toHaveBeenCalledWith('sub-1');
      expect(store.markSuccess).not.toHaveBeenCalled();
    });
  }

  it('throws on a 429, a 5xx or a network error, so the queue retries, and keeps the subscription', async () => {
    for (const error of [failure(429), failure(503), new Error('ECONNRESET')]) {
      const { store, sender } = setup(vi.fn(async () => Promise.reject(error)));
      await expect(sender.deliver({ subscriptionId: 'sub-1', payload })).rejects.toThrow();
      expect(store.remove).not.toHaveBeenCalled();
    }
  });

  it('does not retry a push the service refuses for good (400, 401, 403, 413)', async () => {
    for (const status of [400, 401, 403, 413]) {
      const { store, sender } = setup(vi.fn(async () => Promise.reject(failure(status))));
      expect(await sender.deliver({ subscriptionId: 'sub-1', payload })).toBe('rejected');
      expect(store.remove).not.toHaveBeenCalled();
    }
  });

  it('skips a subscription that was removed while the job waited', async () => {
    const send = vi.fn();
    const { store, sender } = setup(send);
    vi.mocked(store.find).mockResolvedValueOnce(null);
    expect(await sender.deliver({ subscriptionId: 'sub-1', payload })).toBe('skipped');
    expect(send).not.toHaveBeenCalled();
  });

  it('never logs the endpoint, the keys or the payload', async () => {
    const lines: string[] = [];
    const spy = pino({ level: 'debug' }, { write: (line: string) => void lines.push(line) });
    const store: PushStore = {
      find: async () => sub,
      remove: async () => undefined,
      markSuccess: async () => undefined,
    };
    for (const sendNotification of [
      async () => ({ statusCode: 201 }),
      async () => Promise.reject(failure(410)),
    ]) {
      await createPushSender({ store, webPush: { sendNotification }, vapid, logger: spy }).deliver({
        subscriptionId: 'sub-1',
        payload,
      });
    }
    const all = lines.join('\n');
    expect(all).not.toContain('fcm.googleapis.com');
    expect(all).not.toContain('atta');
  });
});

describe('a push service that hangs (R2)', () => {
  const warn = vi.fn();
  const logging = { warn, info: vi.fn(), debug: vi.fn() } as unknown as Parameters<
    typeof createPushSender
  >[0]['logger'];
  const hanging = () => new Promise<never>(() => undefined);

  it('asks web-push for a 10 s socket timeout', async () => {
    const send = vi.fn<WebPushClient['sendNotification']>(async () => ({ statusCode: 201 }));
    const { sender } = setup(send);
    await sender.deliver({ subscriptionId: 'sub-1', payload });
    const options = send.mock.calls[0]?.[2] as { timeout?: number };
    expect(options.timeout).toBe(10_000);
  });

  it('gives up at the time limit, logs it, throws so the queue counts a failure, and keeps the subscription', async () => {
    const store: PushStore = {
      find: vi.fn(async () => sub),
      remove: vi.fn(async () => undefined),
      markSuccess: vi.fn(async () => undefined),
    };
    const sender = createPushSender({
      store,
      webPush: { sendNotification: hanging },
      vapid,
      logger: logging,
      timeoutMs: 30,
    });
    const started = Date.now();
    await expect(sender.deliver({ subscriptionId: 'sub-1', payload })).rejects.toThrow(/timed out/);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ subscriptionId: 'sub-1', timeout: true }),
      expect.stringMatching(/timed out/),
    );
    expect(store.remove).not.toHaveBeenCalled();
    expect(store.markSuccess).not.toHaveBeenCalled();
  });

  it('a socket timeout reported by web-push is the same failure', async () => {
    const { sender } = setup(vi.fn(async () => Promise.reject(new Error('Socket timeout'))));
    await expect(sender.deliver({ subscriptionId: 'sub-1', payload })).rejects.toThrow();
  });
});
