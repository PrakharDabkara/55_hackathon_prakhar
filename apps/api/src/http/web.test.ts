import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pino } from 'pino';
import request from 'supertest';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { testConfig } from '../testing/config.js';

const LANDING = `<!doctype html><html><head><title>AskBuy: lift your shutter online</title></head><body><h1>Landing</h1></body></html>`;
const INDEX = `<!doctype html><html><head><title>Shop</title></head><body><div id="root"></div><script type="module" src="/app/assets/index-abc123.js"></script></body></html>`;

describe('the web app served under /app/', () => {
  let app: ReturnType<typeof createApp>;
  let emptyApp: ReturnType<typeof createApp>;

  beforeAll(() => {
    const root = mkdtempSync(path.join(tmpdir(), 'km-web-'));
    const dist = path.join(root, 'dist');
    mkdirSync(path.join(dist, 'assets'), { recursive: true });
    writeFileSync(path.join(dist, 'index.html'), INDEX);
    writeFileSync(path.join(dist, 'assets', 'index-abc123.js'), 'console.log("shop");');
    writeFileSync(path.join(dist, 'landing.html'), LANDING);
    writeFileSync(path.join(dist, 'manifest.json'), '{"name":"AskBuy"}');
    writeFileSync(path.join(dist, 'sw.js'), 'self.addEventListener("push", () => {});');
    writeFileSync(path.join(root, 'secret.txt'), 'top secret');

    const db = { query: vi.fn(async () => ({ rows: [{ ok: 1 }] })) };
    const logger = pino({ level: 'silent' });
    const deps = { config: testConfig(), logger, db: db as never };
    app = createApp({ ...deps, webDistDir: dist });
    emptyApp = createApp({ ...deps, webDistDir: path.join(root, 'not-built') });
  });

  describe('GET /app/shop and other client routes', () => {
    it('returns index.html with a strict Content-Security-Policy', async () => {
      const res = await request(app).get('/app/shop');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/html/);
      expect(res.text).toBe(INDEX);

      const csp = res.headers['content-security-policy'] ?? '';
      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain("script-src 'self'");
      expect(csp).toContain("object-src 'none'");
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).toContain("base-uri 'none'");
      expect(csp).not.toContain('unsafe-inline');
      expect(csp).not.toContain('unsafe-eval');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['cache-control']).toBe('no-cache');
    });

    it('lets the map load tiles from OpenStreetMap and nothing else, scripts stay same-origin only', async () => {
      const csp = (await request(app).get('/app/')).headers['content-security-policy'] ?? '';
      const directive = (name: string) =>
        csp
          .split(';')
          .map((d) => d.trim())
          .find((d) => d.startsWith(`${name} `))
          ?.split(/\s+/)
          .slice(1);
      expect(directive('img-src')).toEqual(["'self'", 'data:', 'https://tile.openstreetmap.org']);
      expect(directive('script-src')).toEqual(["'self'"]);
      expect(directive('style-src')).toEqual(["'self'"]);
      expect(directive('connect-src')).toEqual(["'self'"]);
      expect(csp).not.toMatch(/\*|https?:\/\/(?!tile\.openstreetmap\.org)/);
    });

    it('falls back to index.html for any deeper client route, and for /app/', async () => {
      for (const url of ['/app/shop/anything/deep', '/app/', '/app/seeker']) {
        const res = await request(app).get(url);
        expect(res.status, url).toBe(200);
        expect(res.text, url).toBe(INDEX);
      }
    });

    it('redirects /app to /app/', async () => {
      const res = await request(app).get('/app');
      expect(res.status).toBe(301);
      expect(res.headers['location']).toBe('/app/');
    });
  });

  describe('the landing page at / (ADR-0056)', () => {
    it('serves landing.html with the same strict CSP and a short cache', async () => {
      const res = await request(app).get('/');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/html/);
      expect(res.text).toBe(LANDING);
      const csp = res.headers['content-security-policy'] ?? '';
      expect(csp).toContain("script-src 'self'");
      expect(csp).toContain("style-src 'self'");
      expect(csp).not.toContain('unsafe-inline');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['cache-control']).toBe('public, max-age=300');
    });

    it('answers HEAD too, and does not answer other methods or paths with the page', async () => {
      expect((await request(app).head('/')).status).toBe(200);
      const post = await request(app).post('/').send({});
      expect(post.status).toBe(404);
      expect(post.body.error.code).toBe('not_found');
      expect((await request(app).get('/landing.html')).status).toBe(404);
    });

    it('leaves /health and /app/ as they were', async () => {
      expect((await request(app).get('/health')).status).toBe(200);
      expect((await request(app).get('/app/')).text).toBe(INDEX);
    });

    it('answers 404 at / when the landing page is not built', async () => {
      const res = await request(emptyApp).get('/');
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('not_found');
    });
  });

  describe('static files', () => {
    it('serves hashed assets with a long cache life and the CSP', async () => {
      const res = await request(app).get('/app/assets/index-abc123.js');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/javascript/);
      expect(res.text).toBe('console.log("shop");');
      expect(res.headers['cache-control']).toContain('immutable');
      expect(res.headers['content-security-policy']).toContain("default-src 'self'");
    });

    it('serves the manifest', async () => {
      const res = await request(app).get('/app/manifest.json');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ name: 'AskBuy' });
    });

    it('does not answer a missing file with index.html', async () => {
      const res = await request(app).get('/app/assets/nope.js');
      expect(res.status).toBe(404);
      expect(res.text).not.toContain('<div id="root">');
    });

    it('does not leave the dist folder', async () => {
      for (const url of [
        '/app/..%2fsecret.txt',
        '/app/%2e%2e/secret.txt',
        '/app/assets/..%2f..%2fsecret.txt',
      ]) {
        const res = await request(app).get(url);
        expect(res.text, url).not.toContain('top secret');
      }
    });
  });

  describe('the fallback is for page loads only', () => {
    it('answers non-GET requests under /app/ as ordinary 404s in the API error format', async () => {
      const res = await request(app).post('/app/shop').send({});
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('not_found');
    });
  });

  describe('the API is unaffected', () => {
    it('serves API routes where they were, without the page CSP', async () => {
      const health = await request(app).get('/health');
      expect(health.status).toBe(200);
      expect(health.body.status).toBe('ok');
      expect(health.headers['content-security-policy']).toBeUndefined();

      const bad = await request(app).post('/auth/otp/request').send({ phone: '123' });
      expect(bad.status).toBe(400);
      expect(bad.body.error.code).toBe('invalid_request');

      const missing = await request(app).get('/nope');
      expect(missing.status).toBe(404);
      expect(missing.body.error.code).toBe('not_found');
      expect(missing.headers['content-security-policy']).toBeUndefined();
    });
  });

  describe('when the web app has not been built', () => {
    it('answers /app/ with a 404 and keeps the API working', async () => {
      const page = await request(emptyApp).get('/app/shop');
      expect(page.status).toBe(404);
      expect((await request(emptyApp).get('/health')).status).toBe(200);
    });
  });

  describe('the service worker', () => {
    it('is served as JavaScript that browsers re-check every time, so a fix reaches phones at once', async () => {
      const res = await request(app).get('/app/sw.js');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/javascript/);
      expect(res.headers['cache-control']).toBe('no-cache');
    });
  });
});
