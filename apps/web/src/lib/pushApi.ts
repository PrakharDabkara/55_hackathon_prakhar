import { createCaller, type ClientOptions } from './api.js';

/** What the browser hands over when someone subscribes (PushSubscription.toJSON). */
export interface PushSubscriptionBody {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export type PushConfig = { enabled: false } | { enabled: true; publicKey: string };

/** The push half of both apps (ADR-0034). */
export interface PushApi {
  pushConfig(): Promise<PushConfig>;
  pushSubscribe(subscription: PushSubscriptionBody): Promise<void>;
  pushUnsubscribe(endpoint: string): Promise<void>;
}

export function createPushApi(options: ClientOptions): PushApi {
  const call = createCaller(options);
  return {
    pushConfig: () => call<PushConfig>('GET', '/push/config'),
    async pushSubscribe(subscription) {
      await call('POST', '/push/subscribe', subscription);
    },
    async pushUnsubscribe(endpoint) {
      await call('POST', '/push/unsubscribe', { endpoint });
    },
  };
}
