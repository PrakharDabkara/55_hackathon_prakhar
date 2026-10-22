import { pino } from 'pino';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { testConfig } from '../testing/config.js';

// A database that must never be reached: every route here answers before it touches it.
const db = {
  query: async () => {
    throw new Error('no database in this test');
  },
} as unknown as Parameters<typeof createApp>[0]['db'];

const app = createApp({
  config: testConfig(),
  logger: pino({ level: 'silent' }),
  db,
  webDistDir: '/nonexistent',
});

const EVERY_RESPONSE = {
  'strict-transport-security': 'max-age=31536000',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
};

function expectHardened(headers: Record<string, string | undefined>) {
  for (const [name, value] of Object.entries(EVERY_RESPONSE)) expect(headers[name]).toBe(value);
  expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(headers['strict-transport-security']).not.toMatch(/preload|includeSubDomains/i);
  const policy = headers['permissions-policy'] ?? '';
  expect(policy).toContain('geolocation=(self)');
  expect(policy).toContain('camera=(self)');
  expect(policy).toContain('microphone=()');
  for (const feature of ['payment', 'usb', 'bluetooth', 'serial', 'accelerometer', 'fullscreen']) {
    expect(policy).toContain(`${feature}=()`);
  }
  // Nothing else is let in: every feature except the two is switched off.
  for (const part of policy.split(',').map((p) => p.trim())) {
    if (!/^(geolocation|camera)=\(self\)$/.test(part)) expect(part).toMatch(/^[a-z-]+=\(\)$/);
  }
}

describe('security headers on every response (SEC2)', () => {
  it('are on API errors: 401, 404 and 400', async () => {
    expectHardened((await request(app).get('/requests')).headers);
    expectHardened((await request(app).get('/no/such/route')).headers);
    expectHardened(
      (await request(app).post('/auth/otp/request').send('{not json').type('json')).headers,
    );
  });

  it('are on /health', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expectHardened(res.headers);
  });

  it('are on the public push config and on an event stream refusal', async () => {
    expectHardened((await request(app).get('/push/config')).headers);
    expectHardened((await request(app).get('/events')).headers);
  });

  it('are on a rate-limited 429 too', async () => {
    const limited = createApp({
      config: testConfig(),
      logger: pino({ level: 'silent' }),
      db,
      webDistDir: '/nonexistent',
      rateLimits: { apiPerIpPerMinute: 1 },
    });
    await request(limited).get('/no/such/route');
    const res = await request(limited).get('/no/such/route');
    expect(res.status).toBe(429);
    expectHardened(res.headers);
  });

  it('keep no-store on API answers, including the ones that ask for a login', async () => {
    for (const path of ['/requests', '/orders', '/lists/x', '/account', '/no/such/route']) {
      const res = await request(app).get(path);
      expect(res.headers['cache-control'], path).toMatch(/no-store/);
    }
  });

  it('sets the headers once, not twice', async () => {
    const res = await request(app).get('/requests');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
  });
});

describe('CORS and cookies (SEC2)', () => {
  it('sends no CORS header on a cross-origin call, so the browser blocks the read', async () => {
    const res = await request(app).get('/health').set('Origin', 'https://evil.example');
    expect(res.status).toBe(200);
    const names = Object.keys(res.headers).filter((h) => h.startsWith('access-control-'));
    expect(names).toEqual([]);
  });

  it('answers a preflight with no allow headers, so a cross-origin write never happens', async () => {
    const res = await request(app)
      .options('/requests')
      .set('Origin', 'https://evil.example')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'authorization,content-type');
    expect(Object.keys(res.headers).filter((h) => h.startsWith('access-control-'))).toEqual([]);
  });

  it('sends no CORS header on errors either', async () => {
    const res = await request(app)
      .get('/requests')
      .set('Origin', 'https://evil.example')
      .set('Authorization', 'Bearer nope');
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(Object.keys(res.headers).filter((h) => h.startsWith('access-control-'))).toEqual([]);
  });

  it('never sets a cookie, and a cookie alone logs nobody in (the token is the Authorization header, so CSRF cannot apply)', async () => {
    const res = await request(app)
      .get('/requests')
      .set('Cookie', 'token=abc; session=abc; Authorization=Bearer abc');
    expect(res.status).toBe(401);
    expect(res.headers['set-cookie']).toBeUndefined();
  });
});
