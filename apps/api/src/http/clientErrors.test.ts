import { Writable } from 'node:stream';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { createLogger } from '../logger.js';
import { testConfig } from '../testing/config.js';

function setup(scale = 1000) {
  const lines: Record<string, unknown>[] = [];
  const sink = new Writable({
    write(chunk, _enc, done) {
      lines.push(JSON.parse(String(chunk)) as Record<string, unknown>);
      done();
    },
  });
  const db = {
    query: async () => ({ rows: [] }),
  } as unknown as Parameters<typeof createApp>[0]['db'];
  const app = createApp({
    config: testConfig({ rateLimitScale: scale }),
    logger: createLogger('trace', sink),
    db,
    webDistDir: '/nonexistent',
  });
  return { app, lines };
}

const report = {
  message: 'x is not a function',
  stack: 'TypeError: x is not a function\n    at f (app.js:1:1)',
  route: '/app/shop/orders',
  appVersion: 'abc1234',
  requestId: '7F3A2C',
};

describe('POST /client-errors (O1)', () => {
  it('takes a report, answers 204 and logs it at warn with the request id of the report', async () => {
    const { app, lines } = setup();
    const res = await request(app).post('/client-errors').send(report);
    expect(res.status).toBe(204);
    const line = lines.find((l) => l['msg'] === 'client error');
    expect(line).toMatchObject({
      level: 40,
      route: '/app/shop/orders',
      appVersion: 'abc1234',
      clientRequestId: '7F3A2C',
      message: 'x is not a function',
    });
    expect(line?.['requestId']).toBe(res.headers['x-request-id']);
  });

  it('needs only a message', async () => {
    const { app } = setup();
    expect((await request(app).post('/client-errors').send({ message: 'm' })).status).toBe(204);
  });

  it.each([
    ['an unknown field (no PII can sneak in)', { ...report, phone: '9800000001' }],
    ['a user field', { ...report, userId: 'u1' }],
    ['no message', { route: '/x' }],
    ['a stack over 2 kb', { ...report, stack: 'x'.repeat(2049) }],
    ['a route that is not a path', { ...report, route: 'https://evil.example/x' }],
    ['an unsafe request id', { ...report, requestId: '<script>' }],
    ['a message that is not text', { ...report, message: { a: 1 } }],
  ])('refuses %s', async (_name, body) => {
    const { app, lines } = setup();
    const res = await request(app).post('/client-errors').send(body);
    expect(res.status).toBe(400);
    expect(lines.some((l) => l['msg'] === 'client error')).toBe(false);
  });

  it('cuts the query string off the route and scrubs phones and emails from the text', async () => {
    const { app, lines } = setup();
    await request(app)
      .post('/client-errors')
      .send({
        ...report,
        route: '/app/orders?phone=9800000001#x',
        message: 'failed for 9800000001 asha@example.com',
      });
    const line = lines.find((l) => l['msg'] === 'client error');
    expect(line?.['route']).toBe('/app/orders');
    expect(JSON.stringify(line)).not.toMatch(/9800000001|asha@example\.com/);
  });

  it('is limited per IP', async () => {
    const { app } = setup(1);
    const codes: number[] = [];
    for (let i = 0; i < 12; i++)
      codes.push((await request(app).post('/client-errors').send(report)).status);
    expect(codes.slice(0, 10).every((c) => c === 204)).toBe(true);
    expect(codes.slice(10)).toEqual([429, 429]);
  });
});
