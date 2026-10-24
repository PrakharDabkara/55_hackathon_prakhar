import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const probe = join(import.meta.dirname, 'gemini-quota-probe.sh');
// Fake keys in the two formats Google issues: AIza + 35 characters, and AQ. + 40 to 80.
const KEY = 'AIzaSyFakeKeyForTheTest0123456789abcdef';
const AQ_KEY = 'AQ.FakeKeyForTheTestOnly0123456789abcdefghijklmnopqr';

/** A stand-in for curl on PATH: replays a script of (status, body) answers and counts the calls. */
function fakeCurl(dir: string, answers: { status: number; body: unknown; headers?: string[] }[]) {
  const bin = join(dir, 'bin');
  const state = join(dir, 'state');
  spawnSync('mkdir', ['-p', bin, state]);
  answers.forEach((a, i) => {
    writeFileSync(join(state, `${i + 1}.status`), String(a.status));
    writeFileSync(join(state, `${i + 1}.body`), JSON.stringify(a.body));
    writeFileSync(
      join(state, `${i + 1}.headers`),
      (a.headers ?? ['content-type: application/json']).join('\r\n') + '\r\n',
    );
  });
  const script = `#!/usr/bin/env bash
H=""; B=""
while [ $# -gt 0 ]; do
  case "$1" in -D) H="$2"; shift 2;; -o) B="$2"; shift 2;; -K) cat >/dev/null; shift 2;; *) shift;; esac
done
n=$(cat "${state}/count" 2>/dev/null || echo 0); n=$((n+1)); echo $n >"${state}/count"
[ -f "${state}/$n.status" ] || n=$(ls "${state}"/*.status | wc -l)
cp "${state}/$n.headers" "$H"; cp "${state}/$n.body" "$B"
cat "${state}/$n.status"
`;
  writeFileSync(join(bin, 'curl'), script);
  chmodSync(join(bin, 'curl'), 0o755);
  return { bin, calls: () => Number(readFileSync(join(state, 'count'), 'utf8')) };
}

function run(args: string[], dir: string, bin: string, env: Record<string, string> = {}) {
  return spawnSync('bash', [probe, ...args], {
    encoding: 'utf8',
    input: '',
    env: {
      PATH: `${bin}:${process.env['PATH']}`,
      HOME: dir,
      GEMINI_PROBE_KEY: KEY,
      PROBE_OUT_DIR: join(dir, 'out'),
      PROBE_SLEEP: 'true',
      ...env,
    },
  });
}

const ok = { status: 200, body: { candidates: [{ content: { parts: [{ text: 'ok' }] } }] } };
const minute429For = (key: string) => ({
  status: 429,
  headers: ['content-type: application/json', 'retry-after: 3'],
  body: {
    error: {
      code: 429,
      message: `You exceeded your current quota (key ${key}). Please retry in 3s.`,
      status: 'RESOURCE_EXHAUSTED',
      details: [
        {
          '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
          violations: [{ quotaId: 'GenerateRequestsPerMinutePerProjectPerModel-FreeTier' }],
        },
        { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '3s' },
      ],
    },
  },
});
const minute429 = minute429For(KEY);
const day429 = {
  status: 429,
  body: {
    error: {
      code: 429,
      message: 'You exceeded your current quota. See projects/123456789012/quotas',
      status: 'RESOURCE_EXHAUSTED',
      details: [
        {
          '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
          violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }],
        },
      ],
    },
  },
};

/** The fixture a run wrote for `kind`: <model>__<kind>__<timestamp>.json. */
const saved = (d: string, kind: string) => {
  const found = readdirSync(join(d, 'out')).filter((f) => f.includes(`__${kind}__`));
  expect(found).toHaveLength(1);
  return join(d, 'out', found[0] as string);
};

let dir = '';
afterEach(() => {
  if (dir) spawnSync('rm', ['-rf', dir]);
});
const fresh = () => (dir = mkdtempSync(join(tmpdir(), 'probe-')));

describe('scripts/probe/gemini-quota-probe.sh', () => {
  it.each(['gemini-3.1-flash-lite', 'gemini-3.5-flash-lite', 'gemini-embedding-001'])(
    'refuses %s, which the deployment or the evals use, before any call or key',
    (model) => {
      const d = fresh();
      const curl = fakeCurl(d, [ok]);
      const r = run([model], d, curl.bin, { GEMINI_PROBE_KEY: '' });
      expect(r.status).toBe(2);
      expect(r.stderr).toContain('refused');
      expect(existsSync(join(d, 'state', 'count'))).toBe(false);
    },
  );

  it('refuses a model name with odd characters', () => {
    const d = fresh();
    const r = run(['x;rm -rf'], d, fakeCurl(d, [ok]).bin);
    expect(r.status).toBe(2);
  });

  it.each([
    ['too short', 'AIzaSyShort'],
    ['an AQ. key that is too short', 'AQ.tooShort'],
    ['an AQ. key that is too long', `AQ.${'a'.repeat(90)}`],
    ['a key with a bad character', `AQ.${'a'.repeat(50)};rm`],
    ['an unknown prefix', `XY.${'a'.repeat(50)}`],
  ])('refuses %s', (_name, key) => {
    const d = fresh();
    const curl = fakeCurl(d, [ok]);
    expect(run(['gemini-2.5-flash-lite'], d, curl.bin, { GEMINI_PROBE_KEY: key }).status).toBe(2);
    expect(existsSync(join(d, 'state', 'count'))).toBe(false);
  });

  it.each([
    ['AIza', KEY],
    ['AQ.', AQ_KEY],
  ])('accepts a %s key, and never prints or saves it', (_prefix, key) => {
    const d = fresh();
    const curl = fakeCurl(d, [minute429For(key), day429]);
    const r = run(['gemini-2.5-flash-lite'], d, curl.bin, { GEMINI_PROBE_KEY: key });
    expect(r.status).toBe(0);
    expect(curl.calls()).toBe(2);
    const everything =
      r.stdout +
      r.stderr +
      readdirSync(join(d, 'out'))
        .map((f) => readFileSync(join(d, 'out', f), 'utf8'))
        .join('');
    expect(everything).not.toContain(key);
    expect(everything).toContain('[key]');
  });

  it('hides a key-shaped string in either format even when it is not the key in use', () => {
    const d = fresh();
    const other = minute429For(AQ_KEY);
    const r = run(['gemini-2.5-flash-lite'], d, fakeCurl(d, [other, day429]).bin);
    const text = readFileSync(saved(d, '429-per-minute'), 'utf8');
    expect(r.stdout + text).not.toMatch(/AQ\.[\w-]{10,}/);
    expect(r.stdout + text).not.toMatch(/AIza[\w-]{10,}/);
  });

  it('refuses a value that is not shaped like a key', () => {
    const d = fresh();
    const r = run(['gemini-2.5-flash-lite'], d, fakeCurl(d, [ok]).bin, {
      GEMINI_PROBE_KEY: 'a b;c',
    });
    expect(r.status).toBe(2);
  });

  it('catches a per-minute 429, then a per-day 429, saves both redacted and stops at the daily one', () => {
    const d = fresh();
    const curl = fakeCurl(d, [ok, ok, minute429, ok, day429, ok]);
    const r = run(['gemini-2.5-flash-lite'], d, curl.bin);
    expect(r.status).toBe(0);
    expect(curl.calls()).toBe(5); // stopped at the first daily 429: the sixth answer is never asked for
    expect(r.stdout).toContain('daily 429 reached');
    const files = readdirSync(join(d, 'out')).sort();
    expect(files).toHaveLength(2);
    expect(files.every((f) => f.startsWith('gemini-2.5-flash-lite__'))).toBe(true);
    expect(files.some((f) => /__429-per-day__\d{8}T\d{6}Z\.json$/.test(f))).toBe(true);
    expect(files.some((f) => /__429-per-minute__\d{8}T\d{6}Z\.json$/.test(f))).toBe(true);
    const minute = JSON.parse(readFileSync(saved(d, '429-per-minute'), 'utf8'));
    expect(minute).toMatchObject({
      status: 429,
      observed: 'real',
      body: { error: { status: 'RESOURCE_EXHAUSTED' } },
    });
    expect(minute.headers).toContain('retry-after: 3');
    const day = readFileSync(saved(d, '429-per-day'), 'utf8');
    expect(day).toContain('projects/[project]');
    expect(day).not.toContain('123456789012');
  });

  it('never prints or saves the key', () => {
    const d = fresh();
    const r = run(['gemini-2.5-flash-lite'], d, fakeCurl(d, [minute429, day429]).bin);
    const everything =
      r.stdout +
      r.stderr +
      readdirSync(join(d, 'out'))
        .map((f) => readFileSync(join(d, 'out', f), 'utf8'))
        .join('');
    expect(everything).not.toContain(KEY);
    expect(everything).not.toMatch(/AIza[\w-]{10,}/);
    expect(everything).not.toMatch(/AQ\.[\w-]{10,}/);
    expect(everything).toContain('[key]');
  });

  it('says so when no 429 ever comes, and stops after 25 calls', () => {
    const d = fresh();
    const curl = fakeCurl(d, [ok]);
    const r = run(['gemini-2.5-flash-lite'], d, curl.bin);
    expect(curl.calls()).toBe(25);
    expect(r.stdout).toContain('No 429 at all');
    expect(existsSync(join(d, 'out')) && readdirSync(join(d, 'out'))).toEqual([]);
  });

  it('stops at once on an error that retrying cannot clear (a bad key)', () => {
    const d = fresh();
    const curl = fakeCurl(d, [
      {
        status: 400,
        body: { error: { code: 400, status: 'INVALID_ARGUMENT', message: 'API key not valid.' } },
      },
    ]);
    run(['gemini-2.5-flash-lite'], d, curl.bin);
    expect(curl.calls()).toBe(1);
    expect(readdirSync(join(d, 'out'))).toHaveLength(1);
    expect(saved(d, '400-INVALID_ARGUMENT')).toContain('__400-INVALID_ARGUMENT__');
  });
});

describe('fixtures are never overwritten', () => {
  it("a second run keeps the first run's file and writes its own", () => {
    const d = fresh();
    const answers = [minute429, day429];
    run(['gemini-2.5-flash-lite'], d, fakeCurl(d, answers).bin);
    const first = readdirSync(join(d, 'out')).sort();
    spawnSync('rm', ['-rf', join(d, 'state')]);
    run(['gemini-2.5-flash-lite'], d, fakeCurl(d, answers).bin);
    const second = readdirSync(join(d, 'out'));
    expect(second).toHaveLength(first.length * 2);
    for (const f of first) expect(second).toContain(f);
  });
});

describe('a model no one may spend', () => {
  it('has no default: running without a model is a usage error', () => {
    const d = fresh();
    const r = run([], d, fakeCurl(d, [ok]).bin);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('usage');
  });
});
