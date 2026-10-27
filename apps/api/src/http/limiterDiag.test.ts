import { Writable } from 'node:stream';
import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import { createKeyDiag } from './limiterDiag.js';

function capture() {
  const lines: Record<string, unknown>[] = [];
  const stream = new Writable({
    write(chunk, _enc, done) {
      lines.push(JSON.parse(String(chunk)));
      done();
    },
  });
  return { lines, log: pino({ level: 'info' }, stream) };
}

const req = (log: pino.Logger, xff?: string) =>
  ({ log, headers: xff === undefined ? {} : { 'x-forwarded-for': xff } }) as never;

describe('createKeyDiag', () => {
  it('logs the same hash for the same key and another hash for another key', () => {
    const { lines, log } = capture();
    const diag = createKeyDiag();
    diag(req(log), 'request', '203.0.113.7');
    diag(req(log), 'request', '203.0.113.7');
    diag(req(log), 'request', '203.0.113.8');
    expect(lines[0]?.keyHash).toBe(lines[1]?.keyHash);
    expect(lines[0]?.keyHash).not.toBe(lines[2]?.keyHash);
  });

  it('never writes the key, and the hash cannot be recomputed without the process salt', () => {
    const { lines, log } = capture();
    createKeyDiag()(req(log, '198.51.100.1, 203.0.113.7'), 'request', '203.0.113.7');
    const line = JSON.stringify(lines[0]);
    expect(line).not.toContain('203.0.113.7');
    expect(line).not.toContain('198.51.100.1');
    expect(lines[0]?.keyHash).toMatch(/^[0-9a-f]{8}$/);
    const other = capture();
    createKeyDiag()(req(other.log), 'request', '203.0.113.7');
    expect(other.lines[0]?.keyHash).not.toBe(lines[0]?.keyHash);
  });

  it('says which limiter, which family, and how many X-Forwarded-For entries (a count only)', () => {
    const { lines, log } = capture();
    const diag = createKeyDiag();
    diag(req(log, '198.51.100.1, 203.0.113.7'), 'request', '203.0.113.7');
    diag(req(log), 'verify', '2001:db8:1:2');
    expect(lines[0]).toMatchObject({ limiter: 'request', family: 'v4', xffEntries: 2 });
    expect(lines[1]).toMatchObject({ limiter: 'verify', family: 'v6', xffEntries: 0 });
  });
});
