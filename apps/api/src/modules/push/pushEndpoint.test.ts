import { describe, expect, it } from 'vitest';
import { isPushEndpoint } from './router.js';

// The server later posts to the endpoint a client hands it: only the real push services pass.
describe('isPushEndpoint (SSRF guard)', () => {
  it.each([
    'https://fcm.googleapis.com/fcm/send/abc',
    'https://fcm.googleapis.com/wp/abc',
    'https://updates.push.services.mozilla.com/wpush/v2/abc',
    'https://a.b.push.services.mozilla.com/x',
    'https://db5p.notify.windows.com/?token=abc',
    'https://web.push.apple.com/abc',
    'https://api.push.apple.com/3/device/abc',
  ])('accepts %s', (url) => {
    expect(isPushEndpoint(url)).toBe(true);
  });

  it.each([
    // not https
    'http://fcm.googleapis.com/fcm/send/abc',
    'ftp://fcm.googleapis.com/x',
    // IPs and local names, in every spelling
    'https://127.0.0.1/x',
    'https://127.1/x',
    'https://2130706433/x',
    'https://0x7f000001/x',
    'https://10.0.0.5/x',
    'https://172.16.0.1/x',
    'https://192.168.1.1/x',
    'https://169.254.169.254/latest/meta-data',
    'https://[::1]/x',
    'https://[::ffff:127.0.0.1]/x',
    'https://[fd00::1]/x',
    'https://localhost/x',
    'https://localhost.localdomain/x',
    'https://internal/x',
    // other hosts, including other Google services and look-alikes
    'https://example.com/x',
    'https://storage.googleapis.com/bucket/x',
    'https://bucket.storage.googleapis.com/x',
    'https://www.googleapis.com/x',
    'https://googleapis.com/x',
    'https://fcm.googleapis.com.evil.example/x',
    'https://evilfcm.googleapis.com.example/x',
    'https://evil-push.services.mozilla.com/x',
    'https://push.services.mozilla.com/x',
    'https://notify.windows.com/x',
    'https://evilnotify.windows.com/x',
    'https://push.apple.com/x',
    'https://evilpush.apple.com/x',
    'https://fcm.googleapis.com@evil.example/x',
    'https://evil.example/fcm.googleapis.com',
    'https://fcm.googleapis.com./x',
    // credentials, odd ports, junk
    'https://user:pw@fcm.googleapis.com/x',
    'https://user@fcm.googleapis.com/x',
    'https://fcm.googleapis.com:8443/x',
    'https://fcm.googleapis.com:22/x',
    'not a url',
    '',
    '//fcm.googleapis.com/x',
    'javascript:alert(1)',
  ])('rejects %s', (url) => {
    expect(isPushEndpoint(url)).toBe(false);
  });
});
