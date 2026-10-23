import { Writable } from 'node:stream';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { createLogger } from '../logger.js';
import { testConfig } from '../testing/config.js';

const SECRET_DETAIL = 'Key (phone)=(+919800000000) already exists';

function setup(failure: Error) {
  const lines: Record<string, unknown>[] = [];
  const sink = new Writable({
    write(chunk, _enc, done) {
      lines.push(JSON.parse(String(chunk)) as Record<string, unknown>);
      done();
    },
  });
  const db = {
    query: async () => {
      throw failure;
    },
  } as unknown as Parameters<typeof createApp>[0]['db'];
  const app = createApp({
    config: testConfig({ nodeEnv: 'production' }),
    logger: createLogger('trace', sink),
    db,
    webDistDir: '/nonexistent',
  });
  return { app, lines };
}

const verify = { phone: '9800000001', code: '123456', role: 'seeker' };

describe('the request id (O1)', () => {
  it('flows through the response header, every log line and the error body', async () => {
    const { app, lines } = setup(new Error('boom'));
    const res = await request(app)
      .post('/auth/otp/verify')
      .set('X-Request-Id', 'ab12CD')
      .send(verify);
    expect(res.headers['x-request-id']).toBe('ab12CD');
    expect(res.body.error).toMatchObject({ code: 'internal', requestId: 'ab12CD' });
    const mine = lines.filter((l) => l['requestId'] === 'ab12CD');
    expect(mine.length).toBeGreaterThanOrEqual(2); // the error line and the request-completed line
    expect(mine.some((l) => l['msg'] === 'unhandled error')).toBe(true);
  });

  it('makes a short id when the caller sent none, and gives the same one everywhere', async () => {
    const { app, lines } = setup(new Error('boom'));
    const res = await request(app).post('/auth/otp/verify').send(verify);
    const id = res.headers['x-request-id'] as string;
    expect(id).toMatch(/^[0-9A-F]{6}$/);
    expect(res.body.error.requestId).toBe(id);
    expect(lines.find((l) => l['msg'] === 'unhandled error')?.['requestId']).toBe(id);
  });

  it('carries the id on a 404 and a validation error too', async () => {
    const { app } = setup(new Error('boom'));
    const missing = await request(app).get('/nope');
    expect(missing.body.error.requestId).toBe(missing.headers['x-request-id']);
    const bad = await request(app).post('/auth/otp/verify').send({ phone: 'x' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.requestId).toBe(bad.headers['x-request-id']);
  });
});

describe('an unexpected database error (O1)', () => {
  const dbError = Object.assign(new Error(`duplicate key value ${SECRET_DETAIL}`), {
    name: 'DatabaseError',
    code: '23505',
    constraint: 'users_phone_key',
    detail: SECRET_DETAIL,
    where: 'SQL statement "INSERT ... VALUES ($1)"',
    parameters: ['+919800000000'],
  });

  it('answers {code, requestId} with no internals', async () => {
    const { app } = setup(dbError);
    const res = await request(app).post('/auth/otp/verify').send(verify);
    expect(res.status).toBe(500);
    expect(Object.keys(res.body.error).sort()).toEqual(['code', 'message', 'requestId']);
    expect(res.text).not.toMatch(/23505|users_phone_key|919800000000|duplicate|INSERT/);
  });

  it('logs the class, SQLSTATE and constraint at error level, and never the parameters', async () => {
    const { app, lines } = setup(dbError);
    const res = await request(app).post('/auth/otp/verify').send(verify);
    const line = lines.find((l) => l['msg'] === 'unhandled error');
    expect(line).toMatchObject({
      level: 50,
      requestId: res.headers['x-request-id'],
      errorClass: 'DatabaseError',
      sqlState: '23505',
      constraint: 'users_phone_key',
    });
    expect(JSON.stringify(lines)).not.toMatch(/919800000000|INSERT|parameters/);
  });
});
