import type { RequestHandler } from 'express';

/**
 * Every browser feature except the two the app uses (the customer's position, a photo from the
 * camera) is switched off for this origin and for anything it embeds.
 */
const DISABLED_FEATURES = [
  'accelerometer',
  'autoplay',
  'bluetooth',
  'display-capture',
  'encrypted-media',
  'fullscreen',
  'gyroscope',
  'hid',
  'idle-detection',
  'magnetometer',
  'midi',
  'payment',
  'picture-in-picture',
  'publickey-credentials-get',
  'screen-wake-lock',
  'serial',
  'usb',
  'xr-spatial-tracking',
];

export const PERMISSIONS_POLICY = [
  'geolocation=(self)',
  'camera=(self)',
  'microphone=()',
  ...DISABLED_FEATURES.map((f) => `${f}=()`),
].join(', ');

/**
 * Nothing in an API answer is a page, so nothing may load or frame it. The web app's own routes
 * replace this with the fuller policy in web.ts (ADR-0017).
 */
export const API_CONTENT_SECURITY_POLICY = "default-src 'none'; frame-ancestors 'none'";

/**
 * On every response, the API's included, from the first middleware: errors, 404s and 429s too.
 * `Cache-Control: no-store` is the default because nearly everything here is one person's data;
 * the routes that are meant to be cached (hashed assets, a shop logo) set their own, later.
 * No `preload` on HSTS: that is a promise about every subdomain, which is not ours to make.
 */
export const securityHeaders: RequestHandler = (_req, res, next) => {
  res.set({
    'Strict-Transport-Security': 'max-age=31536000',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': API_CONTENT_SECURITY_POLICY,
    'Permissions-Policy': PERMISSIONS_POLICY,
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Cache-Control': 'no-store',
  });
  next();
};
