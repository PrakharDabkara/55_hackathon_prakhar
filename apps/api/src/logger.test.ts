import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createLogger } from './logger.js';

const capture = () => {
  const lines: string[] = [];
  const sink = new Writable({
    write(chunk, _enc, done) {
      lines.push(String(chunk));
      done();
    },
  });
  return { lines, logger: createLogger('trace', sink) };
};

describe('the logger (ADR-0060)', () => {
  it('writes JSON and keeps the plain fields', () => {
    const { lines, logger } = capture();
    logger.info({ requestId: 'r1', count: 3 }, 'hello');
    expect(JSON.parse(lines[0] as string)).toMatchObject({
      requestId: 'r1',
      count: 3,
      msg: 'hello',
    });
  });

  it.each([
    ['phone', '+919876543210'],
    ['token', 'tok-abcdefghijklmnopqrstuvwxyz'],
    ['otp', '482913'],
    ['addressText', 'Flat 4B, Sapna Apartments'],
    ['q', 'secret search words'],
    ['query', 'secret search words'],
    ['text', 'secret typed words'],
    ['task', 'secret errand words'],
    ['note', 'secret order note'],
    ['lat', 22.719655],
    ['lng', 75.857712],
  ])('redacts %s, at the top and one level down', (key, value) => {
    const { lines, logger } = capture();
    logger.info({ [key]: value }, 'a');
    logger.info({ body: { [key]: value } }, 'b');
    for (const line of lines) {
      expect(line).not.toContain(String(value));
      expect(line).toContain('[Redacted]');
    }
  });

  it('never writes the bearer token or a cookie from request headers', () => {
    const { lines, logger } = capture();
    logger.info({ req: { headers: { authorization: 'Bearer abc123', cookie: 'a=b' } } }, 'x');
    expect(lines[0]).not.toMatch(/abc123|a=b/);
  });

  it('writes an error without the database detail that quotes a value, and without a phone in its text', () => {
    const { lines, logger } = capture();
    const err = Object.assign(new Error('duplicate key for +919876543210 (a@b.in)'), {
      code: '23505',
      detail: 'Key (phone)=(+919876543210) already exists.',
      where: 'COPY users, line 1: "+919876543210"',
      parameters: ['+919876543210'],
    });
    logger.error({ err }, 'unhandled error');
    expect(lines[0]).not.toMatch(/9876543210|a@b\.in/);
    expect(JSON.parse(lines[0] as string).err).toMatchObject({ code: '23505', type: 'Error' });
  });

  // FAKE keys in the two formats Google issues (AIza + 35 characters, AQ. + 40 to 80).
  describe.each([
    ['AIza', `AIzaFakeKeyForTheLoggerTest${'x'.repeat(8)}`],
    ['AQ.', `AQ.FakeKeyForTheLoggerTest${'x'.repeat(30)}`],
  ])('a %s API key', (_format, key) => {
    it('is hidden in an error message and stack', () => {
      const { lines, logger } = capture();
      logger.error({ err: new Error(`quota exceeded for key ${key}`) }, 'AI call failed');
      expect(lines[0]).not.toContain(key);
      expect(lines[0]).toContain('[key]');
    });

    it('is hidden in a plain text field such as a reason', () => {
      const { lines, logger } = capture();
      logger.warn({ reason: `request to https://x.test?key=${key} failed` }, 'bad');
      expect(lines[0]).not.toContain(key.slice(4));
      expect(JSON.parse(lines[0] as string).reason).toContain('[key]');
    });
  });
});

// A-09 (round 3): the whole number, in the form the eye button shows it, is private in a log line.
describe('the full phone number shown by the eye button', () => {
  it.each(['+91 98765 43210', '98765 43210', '+919876543210', '9876543210'])(
    'is hidden as a %s inside a text field, an error message and under the phone key',
    (form) => {
      const { lines, logger } = capture();
      logger.warn({ reason: `lookup failed for ${form}` }, 'bad');
      logger.error({ err: new Error(`no user ${form}`) }, 'failed');
      logger.info({ phone: form }, 'revealed');
      for (const line of lines) {
        expect(line).not.toMatch(/98765\s?43210|9876543210/);
      }
    },
  );
});
