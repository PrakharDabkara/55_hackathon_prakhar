import { pino } from 'pino';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from './app.js';
import { testConfig } from './testing/config.js';

const logger = pino({ level: 'silent' });

// A body that fails validation answers 400 before the database is touched, so 400 means "the IP
// limit let it through" and 429 means "the IP limit stopped it".
function build(overrides: Parameters<typeof testConfig>[0] = {}) {
  const db = { query: vi.fn(async () => ({ rows: [] })) };
  const config = testConfig({ otpIpLimits: { request: 3, verify: 3, inbox: 2 }, ...overrides });
  return { app: createApp({ config, logger, db: db as never }), db };
}

const verify = (app: ReturnType<typeof build>['app'], xff?: string) => {
  const req = request(app).post('/auth/otp/verify');
  return (xff ? req.set('X-Forwarded-For', xff) : req).send({});
};

describe('per-IP limits on sign-in', () => {
  it('stops /auth/otp/request, /auth/otp/verify and /dev/otp-inbox on their own budgets', async () => {
    const { app } = build({ otpIpLimits: { request: 2, verify: 3, inbox: 4 } });
    const statuses = async (send: () => Promise<{ status: number }>, n: number) => {
      const out: number[] = [];
      for (let i = 0; i < n; i++) out.push((await send()).status);
      return out;
    };
    expect(await statuses(() => request(app).post('/auth/otp/request').send({}), 3)).toEqual([
      400, 400, 429,
    ]);
    expect(await statuses(() => request(app).post('/auth/otp/verify').send({}), 4)).toEqual([
      400, 400, 400, 429,
    ]);
    expect(await statuses(() => request(app).get('/dev/otp-inbox'), 5)).toEqual([
      400, 400, 400, 400, 429,
    ]);
  });

  it('answers 429 with a Retry-After in seconds and the usual error body', async () => {
    const { app } = build();
    for (let i = 0; i < 3; i++) await verify(app);
    const blocked = await verify(app);
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('rate_limited');
    const retry = Number(blocked.headers['retry-after']);
    expect(retry).toBeGreaterThan(0);
    expect(retry).toBeLessThanOrEqual(600);
  });

  it('leaves the other routes alone', async () => {
    const { app } = build();
    for (let i = 0; i < 5; i++) await verify(app);
    expect((await request(app).get('/health')).status).toBe(200);
  });
});

describe('one budget per client, whichever way the address is written', () => {
  // The sign-in limit is 3 here; the 4th request from the same client must be the 429.
  const fourth = async (addresses: string[]) => {
    const { app } = build();
    const out: number[] = [];
    for (const xff of addresses) out.push((await verify(app, xff)).status);
    return out;
  };

  it('shares a budget between an IPv4 address and its IPv4-mapped IPv6 form', async () => {
    expect(
      await fourth(['203.0.113.9', '::ffff:203.0.113.9', '203.0.113.9', '::ffff:cb00:7109']),
    ).toEqual([400, 400, 400, 429]);
  });

  it('shares a budget across one IPv6 /64, as privacy addresses rotate inside it', async () => {
    expect(
      await fourth([
        '2001:db8:1:2::1',
        '2001:db8:1:2:aaaa:bbbb:cccc:dddd',
        '2001:db8:1:2:1111:2222:3333:4444',
        '2001:DB8:1:2:0:0:0:5',
      ]),
    ).toEqual([400, 400, 400, 429]);
  });

  it('gives a different /64 its own budget', async () => {
    const { app } = build();
    for (let i = 0; i < 3; i++) await verify(app, '2001:db8:1:2::1');
    expect((await verify(app, '2001:db8:1:2::1')).status).toBe(429);
    expect((await verify(app, '2001:db8:1:3::1')).status).toBe(400);
  });
});

describe('trust proxy (Render is one hop)', () => {
  it('sets Express to trust exactly one hop by default', () => {
    expect(build().app.get('trust proxy')).toBe(1);
  });

  it('uses the address the one trusted proxy appended: each client has its own budget', async () => {
    const { app } = build();
    for (let i = 0; i < 3; i++) expect((await verify(app, '203.0.113.7')).status).toBe(400);
    expect((await verify(app, '203.0.113.7')).status).toBe(429);
    expect((await verify(app, '203.0.113.8')).status).toBe(400);
  });

  it('is not bypassed by a spoofed extra hop on the left of X-Forwarded-For', async () => {
    const { app } = build();
    // The client writes whatever it likes to the left; the proxy appends the real address last.
    for (let i = 1; i <= 3; i++) {
      expect((await verify(app, `198.51.100.${i}, 203.0.113.7`)).status).toBe(400);
    }
    expect((await verify(app, '198.51.100.99, 203.0.113.7')).status).toBe(429);
    expect((await verify(app, '198.51.100.99, 198.51.100.98, 203.0.113.7')).status).toBe(429);
    // A different real address (the rightmost) is a different client.
    expect((await verify(app, '198.51.100.1, 203.0.113.8')).status).toBe(400);
  });

  it('ignores X-Forwarded-For entirely when no proxy is trusted', async () => {
    const { app } = build({ trustProxyHops: 0 });
    for (let i = 1; i <= 3; i++) {
      expect((await verify(app, `198.51.100.${i}`)).status).toBe(400);
    }
    expect((await verify(app, '198.51.100.200')).status).toBe(429);
  });
});

// The per-IP limit must count every code request and answer before anything else about the number
// (ADR-0058): a stranger's non-demo number, a demo number and a bad body all spend the same budget,
// so the request over the limit is always 429 with Retry-After, never 403 demo_mode or 400.
describe('POST /auth/otp/request: the IP limit comes before the demo check and validation', () => {
  const DEMO = '9000000101';
  const NON_DEMO = ['9876512345', '9876512346', '9876512347'];
  const ask = (app: ReturnType<typeof build>['app'], body: object, xff?: string) => {
    const req = request(app).post('/auth/otp/request');
    return (xff ? req.set('X-Forwarded-For', xff) : req).send(body);
  };
  const buildSimulated = () =>
    build({
      otpInboxOpen: false,
      demoPhones: [DEMO],
      otpIpLimits: { request: 3, verify: 3, inbox: 3 },
    });

  it('counts non-demo and invalid requests, then answers 429 whatever the number is', async () => {
    const { app, db } = buildSimulated();
    const first = await ask(app, { phone: NON_DEMO[0] });
    expect([first.status, first.body.error.code]).toEqual([403, 'demo_mode']);
    expect((await ask(app, {})).status).toBe(400);
    expect((await ask(app, { phone: NON_DEMO[1] })).status).toBe(403);

    for (const body of [{ phone: NON_DEMO[2] }, { phone: DEMO }, {}, { phone: 'nope' }]) {
      const over = await ask(app, body);
      expect(over.status).toBe(429);
      expect(over.body.error.code).toBe('rate_limited');
      expect(Number(over.headers['retry-after'])).toBeGreaterThan(0);
    }
    // Nothing past the limiter ran: no code row was read or written, not even for the demo number.
    expect(db.query).not.toHaveBeenCalled();
  });

  it('is not reset by a spoofed X-Forwarded-For on any of them', async () => {
    const { app } = buildSimulated();
    const real = '203.0.113.7';
    for (let i = 1; i <= 3; i++) {
      expect((await ask(app, { phone: NON_DEMO[0] }, `198.51.100.${i}, ${real}`)).status).toBe(403);
    }
    for (let i = 4; i <= 14; i++) {
      const over = await ask(app, { phone: NON_DEMO[i % 3] }, `198.51.100.${i}, ${real}`);
      expect(over.status).toBe(429);
      expect(over.headers['retry-after']).toBeDefined();
    }
  });
});
