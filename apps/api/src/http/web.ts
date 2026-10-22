import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { Router, type RequestHandler } from 'express';
import type { Logger } from 'pino';

/** apps/web/dist, from both apps/api/src/http (tests, dev) and apps/api/dist/http (production). */
export const DEFAULT_WEB_DIST = fileURLToPath(new URL('../../../web/dist', import.meta.url));

/**
 * No inline script or style anywhere: the bundle is one same-origin script and one stylesheet.
 * Every `fetch` goes to this origin. The one outside origin is OpenStreetMap, for map tile images
 * only (ADR-0019). See ADR-0017 for what this does and does not protect.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: https://tile.openstreetmap.org",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

/**
 * The page's own policy, over the one every response gets (securityHeaders.ts). The two plain
 * headers are repeated so this router is safe to mount without that middleware.
 */
const pageHeaders: RequestHandler = (_req, res, next) => {
  res.setHeader('Content-Security-Policy', CONTENT_SECURITY_POLICY);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
};

/**
 * Serves the built web app under /app/: static files, and index.html for any client-side route.
 * Only GET and HEAD for a path without a file extension fall back to index.html, so a missing
 * script is a 404 and not a page of HTML, and POST /app/... is an ordinary 404.
 * If the app has not been built, /app/ answers 404 and the API is unaffected.
 * The static landing page (landing.html, ADR-0056) is served at "/" and nowhere else, under the
 * same headers; its scripts, styles and fonts live in /app/assets with the app's.
 */
export function webRouter({ distDir, logger }: { distDir: string; logger: Logger }): Router {
  const router = Router();
  const indexPath = path.join(distDir, 'index.html');
  const landingPath = path.join(distDir, 'landing.html');
  if (existsSync(landingPath)) {
    router.get('/', pageHeaders, (_req, res) => {
      res.sendFile(landingPath, { headers: { 'Cache-Control': 'public, max-age=300' } });
    });
  } else {
    logger.warn({ distDir }, 'landing page is not built; / will answer 404');
  }
  if (!existsSync(indexPath)) {
    logger.warn({ distDir }, 'web app is not built; /app/ will answer 404');
    return router;
  }

  router.use('/app', pageHeaders);

  // Without a trailing slash relative URLs would resolve against the wrong folder.
  router.use('/app', (req, res, next) => {
    if (req.path === '/' && !req.originalUrl.split('?')[0]?.endsWith('/')) {
      res.redirect(301, '/app/');
      return;
    }
    next();
  });

  router.use(
    '/app',
    express.static(distDir, {
      index: false,
      redirect: false,
      setHeaders(res, filePath) {
        // Vite names files in assets/ after their content, so they never change under one name.
        const hashed = filePath.includes(`${path.sep}assets${path.sep}`);
        // The service worker keeps its name across releases: phones must re-check it every time.
        const worker = path.basename(filePath) === 'sw.js';
        res.setHeader(
          'Cache-Control',
          hashed
            ? 'public, max-age=31536000, immutable'
            : worker
              ? 'no-cache'
              : 'public, max-age=3600',
        );
      },
    }),
  );

  router.use('/app', (req, res, next) => {
    const isPageLoad = req.method === 'GET' || req.method === 'HEAD';
    const lastSegment = req.path.split('/').pop() ?? '';
    if (!isPageLoad || lastSegment.includes('.')) {
      next();
      return;
    }
    res.sendFile(indexPath, { headers: { 'Cache-Control': 'no-cache' } });
  });

  return router;
}
