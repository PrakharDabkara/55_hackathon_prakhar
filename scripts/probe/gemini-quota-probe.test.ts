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
const KEY = 'AIzaSyFakeKeyForTheTest0123456789abc';

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
const minute429 = {
  status: 429,
  headers: ['content-type: application/json', 'retry-after: 3'],
  body: {
    error: {
      code: 429,
      message: `You exceeded your current quota (key ${KEY}). Please retry in 3s.`,
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
};
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
    expect(files).toEqual(['gemini-429-per-day.json', 'gemini-429-per-minute.json']);
    const minute = JSON.parse(readFileSync(join(d, 'out', 'gemini-429-per-minute.json'), 'utf8'));
    expect(minute).toMatchObject({
      status: 429,
      observed: 'real',
      body: { error: { status: 'RESOURCE_EXHAUSTED' } },
    });
    expect(minute.headers).toContain('retry-after: 3');
    const day = readFileSync(join(d, 'out', 'gemini-429-per-day.json'), 'utf8');
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
    expect(readdirSync(join(d, 'out'))).toEqual(['gemini-400-INVALID_ARGUMENT.json']);
  });
});
