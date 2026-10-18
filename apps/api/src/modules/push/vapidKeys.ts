import webpush from 'web-push';

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

/** A fresh P-256 key pair in the URL-safe base64 form browsers and the push services expect. */
export function generateVapidKeys(): VapidKeys {
  return webpush.generateVAPIDKeys();
}

/** What `npm run push:keys` prints: the values and where each one goes. Names first, values second. */
export function keysInstructions(keys: VapidKeys): string {
  return `VAPID keys for Web Push (ADR-0034). Never commit these.

Set all three on Render (Environment) and, to try push locally, in your own .env:

  VAPID_PUBLIC_KEY=${keys.publicKey}
  VAPID_PRIVATE_KEY=${keys.privateKey}
  VAPID_SUBJECT=mailto:you@example.com

VAPID_PRIVATE_KEY is a secret: keep it out of the repo, chat and logs.
VAPID_SUBJECT is an email the push services can reach you on (mailto:...).
Changing the public key later cancels every existing subscription: people tap the button again.
`;
}
