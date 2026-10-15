import { describe, expect, it } from 'vitest';
import { parseCli } from './args.ts';

const ok = (argv: string[]) => {
  const r = parseCli(argv);
  if ('error' in r) throw new Error(r.error);
  return r;
};
const base = ['--target', 'https://km.example.com', '--admin-phone', '9876543210'];

describe('parseCli', () => {
  it('needs --target and --admin-phone', () => {
    expect(parseCli([])).toHaveProperty('error');
    expect(parseCli(['--target', 'https://x.test'])).toMatchObject({
      error: expect.stringMatching(/admin-phone/),
    });
    expect(parseCli(['--admin-phone', '9876543210'])).toMatchObject({
      error: expect.stringMatching(/target/),
    });
  });

  it('reads the options and applies defaults', () => {
    expect(ok(base)).toMatchObject({
      target: 'https://km.example.com',
      adminPhone: '9876543210',
      count: 100,
      speed: 1,
      seed: 1,
      radiusM: 3000,
      centre: { lat: 22.7196, lng: 75.8577 },
      reset: false,
    });
    const r = ok([
      ...base,
      '--count',
      '500',
      '--speed',
      '10',
      '--seed',
      '42',
      '--centre',
      '28.61,77.2',
      '--radius',
      '5000',
      '--reset',
    ]);
    expect(r).toMatchObject({
      count: 500,
      speed: 10,
      seed: 42,
      centre: { lat: 28.61, lng: 77.2 },
      radiusM: 5000,
      reset: true,
    });
  });

  it('drops a trailing slash from the target', () => {
    expect(ok(['--target', 'http://localhost:3000/', '--admin-phone', '9876543210']).target).toBe(
      'http://localhost:3000',
    );
  });

  it.each([
    ['a target that is not a URL', ['--target', 'nope']],
    ['count 0', ['--count', '0']],
    ['count 501', ['--count', '501']],
    ['a fractional count', ['--count', '2.5']],
    ['speed 0', ['--speed', '0']],
    ['a negative speed', ['--speed', '-3']],
    ['a text speed', ['--speed', 'fast']],
    ['a centre that is not lat,lng', ['--centre', '22.7']],
    ['a latitude out of range', ['--centre', '95,75']],
    ['an unknown option', ['--bogus', '1']],
  ])('refuses %s', (_name, extra) => {
    const argv =
      extra[0] === '--target' ? [...extra, '--admin-phone', '9876543210'] : [...base, ...extra];
    expect(parseCli(argv)).toHaveProperty('error');
  });
});
