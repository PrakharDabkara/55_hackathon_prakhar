import { describe, expect, it } from 'vitest';
import { generateVapidKeys, keysInstructions } from './vapidKeys.js';

describe('push:keys', () => {
  it('makes a P-256 key pair in the URL-safe base64 form browsers expect', () => {
    const keys = generateVapidKeys();
    expect(keys.publicKey).toMatch(/^[\w-]{87}$/);
    expect(keys.privateKey).toMatch(/^[\w-]{43}$/);
    expect(generateVapidKeys().privateKey).not.toBe(keys.privateKey);
  });

  it('prints the three names to set, the values, and where each goes', () => {
    const text = keysInstructions({ publicKey: 'PUB', privateKey: 'PRIV' });
    for (const name of ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT']) {
      expect(text).toContain(name);
    }
    expect(text).toContain('PUB');
    expect(text).toContain('PRIV');
    expect(text).toMatch(/never commit/i);
  });
});
