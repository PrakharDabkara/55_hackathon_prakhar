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
    options: {
      vapidDetails: Vapid;
      TTL: number;
      urgency: 'high' | 'normal';
      /** Socket timeout in milliseconds. */
      timeout?: number;
    },
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

/** The longest a push service may take. Past it the send fails (and is retried by the queue). */
export const PUSH_TIMEOUT_MS = 10_000;

export interface PushSender {
  /** Throws on a failure worth retrying (429, 5xx, network); the queue retries. */
  deliver(job: PushJob): Promise<DeliverResult>;
}

export function createPushSender({
  store,
  webPush,
  vapid,
  logger,
  timeoutMs = PUSH_TIMEOUT_MS,
}: {
  store: PushStore;
  webPush: WebPushClient;
  vapid: Vapid;
  logger: Logger;
  timeoutMs?: number;
}): PushSender {
  return {
    async deliver({ subscriptionId, payload }) {
      const sub = await store.find(subscriptionId);
      if (!sub) return 'skipped';
      let timer: NodeJS.Timeout | undefined;
      try {
        // web-push's own timeout is a socket idle timeout; this one is a hard stop, so a push
        // service that trickles bytes or hangs cannot hold a worker slot.
        const hardStop = new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(Object.assign(new Error('push timed out'), { timedOut: true })),
            timeoutMs,
          );
        });
        const send = webPush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify(payload),
          { vapidDetails: vapid, TTL: TTL_SECONDS, urgency: 'high', timeout: PUSH_TIMEOUT_MS },
        );
        send.catch(() => undefined); // a late failure after the hard stop is not unhandled
        await Promise.race([send, hardStop]);
      } catch (err) {
        if ((err as { timedOut?: boolean }).timedOut) {
          logger.warn({ subscriptionId: sub.id, timeout: true }, 'push timed out, will retry');
          throw err;
        }
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
      } finally {
        clearTimeout(timer);
      }
      await store.markSuccess(sub.id);
      logger.debug({ subscriptionId: sub.id }, 'push sent');
      return 'sent';
    },
  };
}
