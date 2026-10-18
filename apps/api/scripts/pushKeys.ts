// Makes a VAPID key pair for Web Push and prints it, with the three variables to set (ADR-0034).
// Run it yourself in your own terminal: `npm run push:keys`. The output holds a private key, so
// it is meant for you, Render's environment page and nothing else.
import { generateVapidKeys, keysInstructions } from '../src/modules/push/vapidKeys.ts';

process.stdout.write(keysInstructions(generateVapidKeys()));
