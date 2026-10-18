import { Router } from 'express';
import { z } from 'zod';
import type { Database } from '../../db/queryable.js';
import { ApiError, parse } from '../../http/errors.js';
import { authOf, createRequireAuth } from '../identity/index.js';
import { removeSubscriptionOf, saveSubscription } from './subscriptions.js';

/**
 * The push services of the four browser families. The server later posts to the endpoint a client
 * hands it, so anything else (a private address, a metadata service, another site) is refused.
 */
const PUSH_SERVICE_HOSTS = [
  /(^|\.)googleapis\.com$/, // Chrome, Edge, Brave, Opera: fcm.googleapis.com
  /(^|\.)push\.services\.mozilla\.com$/, // Firefox
  /(^|\.)push\.apple\.com$/, // Safari and the iPhone Home Screen app
  /(^|\.)notify\.windows\.com$/, // older Edge
];

export function isPushEndpoint(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  return (
    url.protocol === 'https:' &&
    !url.username &&
    !url.password &&
    (url.port === '' || url.port === '443') &&
    PUSH_SERVICE_HOSTS.some((re) => re.test(url.hostname))
  );
}

const endpoint = z
  .string()
  .max(2048)
  .refine(isPushEndpoint, 'must be an https address of a browser push service');

const subscribeBody = z.object({
  endpoint,
  keys: z.object({ p256dh: z.string().min(1).max(256), auth: z.string().min(1).max(256) }),
});
const unsubscribeBody = z.object({ endpoint: z.string().min(1).max(2048) });

export function pushRouter({
  db,
  vapidPublicKey,
}: {
  db: Database;
  /** Null: push is off, the app is told so and subscriptions are refused. */
  vapidPublicKey: string | null;
}): Router {
  const router = Router();
  const requireAuth = createRequireAuth(db);

  // The public key is public by design (the browser needs it to subscribe); the private one never leaves the server.
  router.get('/push/config', (_req, res) => {
    res.json(vapidPublicKey ? { enabled: true, publicKey: vapidPublicKey } : { enabled: false });
  });

  router.post('/push/subscribe', requireAuth, async (req, res) => {
    if (!vapidPublicKey)
      throw new ApiError(503, 'push_disabled', 'Notifications are not switched on');
    const body = parse(subscribeBody, req.body);
    await saveSubscription(db, authOf(req).user.id, {
      endpoint: body.endpoint,
      p256dh: body.keys.p256dh,
      auth: body.keys.auth,
    });
    req.log.info('push device subscribed');
    res.status(204).end();
  });

  router.post('/push/unsubscribe', requireAuth, async (req, res) => {
    const body = parse(unsubscribeBody, req.body);
    await removeSubscriptionOf(db, authOf(req).user.id, body.endpoint);
    req.log.info('push device unsubscribed');
    res.status(204).end();
  });

  return router;
}
