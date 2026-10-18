import type { Logger } from 'pino';
import type { PushPayload } from './payload.js';
import type { StoredSubscription } from './subscriptions.js';

export interface Vapid {
  publicKey: string;
  privateKey: string;
  subject: string;
}

/** The one call we use from the web-push library, so tests can stand in for the push service. */
export interface WebPushClient {
  sendNotification(
    subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
    payload: string,
    options: { vapidDetails: Vapid; TTL: number; urgency: 'high' | 'normal' },
  ): Promise<unknown>;
}

export interface PushStore {
  find(id: string): Promise<StoredSubscription | null>;
  remove(id: string): Promise<void>;
  markSuccess(id: string): Promise<void>;
}

export interface PushJob {
  subscriptionId: string;
  payload: PushPayload;
}

/**
 * sent: the push service took it. gone: the browser is gone (404/410), so the subscription was
 * deleted. rejected: refused for good (bad request or auth), no point retrying. skipped: the
 * subscription was removed while the job waited.
 */
export type DeliverResult = 'sent' | 'gone' | 'rejected' | 'skipped';

/** How long the push service may hold a push for a phone that is off: a ping is stale by then. */
const TTL_SECONDS = 10 * 60;

export interface PushSender {
  /** Throws on a failure worth retrying (429, 5xx, network); the queue retries. */
  deliver(job: PushJob): Promise<DeliverResult>;
}

export function createPushSender({
  store,
  webPush,
  vapid,
  logger,
}: {
  store: PushStore;
  webPush: WebPushClient;
  vapid: Vapid;
  logger: Logger;
}): PushSender {
  return {
    async deliver({ subscriptionId, payload }) {
      const sub = await store.find(subscriptionId);
      if (!sub) return 'skipped';
      try {
        await webPush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify(payload),
          { vapidDetails: vapid, TTL: TTL_SECONDS, urgency: 'high' },
        );
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        // Never log the endpoint, the keys or the payload: only which subscription and what status.
        if (status === 404 || status === 410) {
          await store.remove(sub.id);
          logger.info({ subscriptionId: sub.id, status }, 'push subscription gone, removed');
          return 'gone';
        }
        if (status !== undefined && status >= 400 && status < 500 && status !== 429) {
          logger.warn({ subscriptionId: sub.id, status }, 'push refused by the push service');
          return 'rejected';
        }
        logger.warn({ subscriptionId: sub.id, status }, 'push failed, will retry');
        throw err;
      }
      await store.markSuccess(sub.id);
      logger.debug({ subscriptionId: sub.id }, 'push sent');
      return 'sent';
    },
  };
}
