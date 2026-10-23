import express from 'express';
import { pino } from 'pino';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { testConfig } from '../testing/config.js';
import { ApiError, errorHandler, notFound } from './errors.js';

const SECRET = 'password=hunter2 host=10.1.2.3 at /srv/app/dist/secret.js:12:5';

function boom(thrown: unknown, status?: number) {
  const app = express();
  app.use(express.json({ limit: '10b' }));
  app.get('/boom', () => {
    throw thrown;
  });
  app.get('/rejects', async () => {
    throw thrown;
  });
  app.get('/status', (_req, _res, next) => next(Object.assign(new Error(SECRET), { status })));
  app.post('/body', (_req, res) => void res.json({}));
  app.use(notFound);
  app.use(errorHandler(pino({ level: 'silent' })));
  return app;
}

/** Every error body is {"error":{"code","message"}} and carries nothing from inside. */
function expectClean(res: request.Response, status: number, code: string) {
  expect(res.status).toBe(status);
  expect(res.headers['content-type']).toMatch(/application\/json/);
  // requestId is the ref the person quotes; it is there when the app logs the request (O1).
  expect(res.body).toEqual({
    error: {
      code,
      message: expect.any(String),
      ...(res.body.error?.requestId && { requestId: expect.any(String) }),
    },
  });
  const text = res.text;
  expect(text).not.toMatch(/hunter2|10\.1\.2\.3|secret\.js|\bat .*:\d+:\d+|stack|node_modules/);
  expect(text).not.toContain('Error:');
}

describe('error bodies (SEC2)', () => {
  it('hides the message and stack of an unexpected error', async () => {
    const res = await request(boom(new Error(SECRET))).get('/boom');
    expectClean(res, 500, 'internal');
    expect(res.body.error.message).toBe('Something went wrong');
  });

  it('hides a rejected promise, a string and an object', async () => {
    for (const thrown of [new Error(SECRET), SECRET, { message: SECRET, stack: SECRET }]) {
      expectClean(await request(boom(thrown)).get('/rejects'), 500, 'internal');
    }
  });

  it('hides a database error (code, detail and hint stay inside)', async () => {
    const dbError = Object.assign(new Error('duplicate key value violates unique constraint'), {
      code: '23505',
      detail: `Key (phone)=(+919800000000) already exists. ${SECRET}`,
      constraint: 'users_phone_key',
    });
    const res = await request(boom(dbError)).get('/boom');
    expectClean(res, 500, 'internal');
    expect(res.text).not.toMatch(/23505|users_phone_key|919800000000|violates/);
  });

  it('does not echo the message of a library error with a 5xx status', async () => {
    expectClean(await request(boom(null, 503)).get('/status'), 500, 'internal');
  });

  it('turns a client-error status from a library into a short fixed message', async () => {
    expectClean(await request(boom(null, 400)).get('/status'), 400, 'invalid_request');
    expectClean(await request(boom(null, 413)).get('/status'), 413, 'payload_too_large');
  });

  it('answers broken or oversized JSON with the same shape and no parser detail', async () => {
    const app = boom(null);
    expectClean(
      await request(app).post('/body').set('Content-Type', 'application/json').send('{"a":'),
      400,
      'invalid_request',
    );
    expectClean(
      await request(app)
        .post('/body')
        .set('Content-Type', 'application/json')
        .send(JSON.stringify({ a: 'x'.repeat(100) })),
      413,
      'payload_too_large',
    );
  });

  it('answers an unknown route with a coded 404', async () => {
    expectClean(await request(boom(null)).get('/nope'), 404, 'not_found');
  });

  it('keeps an ApiError as it is, with its own code and message', async () => {
    const res = await request(
      boom(new ApiError(409, 'shop_exists', 'You already have a shop')),
    ).get('/boom');
    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      error: { code: 'shop_exists', message: 'You already have a shop' },
    });
  });
});

describe('error bodies through the real app, in production mode (SEC2)', () => {
  const failingDb = {
    query: async () => {
      throw Object.assign(new Error(`connect ECONNREFUSED 10.1.2.3:5432 ${SECRET}`), {
        code: 'ECONNREFUSED',
      });
    },
  } as unknown as Parameters<typeof createApp>[0]['db'];
  const app = createApp({
    config: testConfig({ nodeEnv: 'production' }),
    logger: pino({ level: 'silent' }),
    db: failingDb,
    webDistDir: '/nonexistent',
  });

  it('a database failure is a bare 500', async () => {
    const res = await request(app).post('/auth/otp/verify').send({
      phone: '9800000001',
      code: '123456',
      role: 'seeker',
    });
    expectClean(res, 500, 'internal');
    expect(res.text).not.toMatch(/ECONNREFUSED|5432/);
  });

  it('a bad token with the database down is still a plain 500, never a stack', async () => {
    const res = await request(app).get('/requests').set('Authorization', 'Bearer abc');
    expectClean(res, 500, 'internal');
  });

  it('validation errors name fields, never values', async () => {
    const res = await request(app)
      .post('/auth/otp/verify')
      .send({ phone: '9800000001', code: 'my-secret-code-value', role: 'seeker' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('invalid_request');
    expect(res.text).not.toContain('my-secret-code-value');
    expect(Object.keys(res.body)).toEqual(['error']);
    expect(Object.keys(res.body.error).sort()).toEqual(['code', 'message', 'requestId']);
  });
});
