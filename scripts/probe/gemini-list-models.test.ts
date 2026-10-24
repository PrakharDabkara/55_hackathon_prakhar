import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const list = join(import.meta.dirname, 'gemini-list-models.sh');
const KEY = `AQ.FakeKeyForTheListTest${'x'.repeat(30)}`;

const page = (models: object[], status = 200) => ({ status, body: { models } });
const model = (name: string, methods: string[], description = 'A model.') => ({
  name: `models/${name}`,
  version: '1',
  displayName: name,
  description,
  inputTokenLimit: 1000,
  outputTokenLimit: 100,
  supportedGenerationMethods: methods,
});

/** curl on PATH that answers ListModels with one canned body. */
function run(dir: string, answer: { status: number; body: unknown }) {
  const bin = join(dir, 'bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(dir, 'body'), JSON.stringify(answer.body));
  writeFileSync(
    join(bin, 'curl'),
    `#!/usr/bin/env bash
B=""
while [ $# -gt 0 ]; do case "$1" in -o) B="$2"; shift 2;; -K) cat >/dev/null; shift 2;; *) shift;; esac; done
cp "${dir}/body" "$B"; printf '%s' ${answer.status}
`,
  );
  chmodSync(join(bin, 'curl'), 0o755);
  return spawnSync('bash', [list], {
    encoding: 'utf8',
    input: '',
    env: {
      PATH: `${bin}:${process.env['PATH']}`,
      HOME: dir,
      GEMINI_PROBE_KEY: KEY,
      PROBE_OUT_DIR: join(dir, 'out'),
    },
  });
}

let dir = '';
afterEach(() => {
  if (dir) spawnSync('rm', ['-rf', dir]);
});
const fresh = () => (dir = mkdtempSync(join(tmpdir(), 'list-')));

describe('scripts/probe/gemini-list-models.sh', () => {
  it('lists generate and embed models, marks the ones our config names, and flags a retired one', () => {
    const d = fresh();
    const r = run(
      d,
      page([
        model('gemini-3.1-flash-lite', ['generateContent']),
        model('gemini-3.5-flash-lite', ['generateContent']),
        model('gemini-embedding-001', ['embedContent']),
        model('gemini-9.9-flash', ['generateContent']),
        model('gemini-old', ['generateContent'], 'Deprecated, use the new one.'),
        model('imagen-x', ['predict']),
      ]),
    );
    expect(r.stdout).toMatch(/IN USE\s+gemini-3\.1-flash-lite\s+G-/);
    expect(r.stdout).toMatch(/IN USE\s+gemini-embedding-001\s+-E/);
    expect(r.stdout).toMatch(/\s{7}gemini-9\.9-flash\s+G-/);
    expect(r.stdout).toMatch(/gemini-old.*says deprecated/);
    expect(r.stdout).not.toContain('imagen-x');
    expect(r.stdout).toContain('OK       gemini-3.1-flash-lite');
  });

  it('reports a config model that is missing from the list, and exits 1', () => {
    const d = fresh();
    const r = run(d, page([model('gemini-3.1-flash-lite', ['generateContent'])]));
    expect(r.stdout).toMatch(/MISSING\s+gemini-3\.5-flash-lite/);
    expect(r.stdout).toMatch(/MISSING\s+gemini-embedding-001/);
    expect(r.status).toBe(1);
  });

  it('saves a redacted copy with a timestamped name and never prints the key', () => {
    const d = fresh();
    const r = run(d, page([model('gemini-3.1-flash-lite', ['generateContent'], `see ${KEY}`)]));
    const files = readdirSync(join(d, 'out'));
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^models__list__\d{8}T\d{6}Z\.json$/);
    const saved = readFileSync(join(d, 'out', files[0] as string), 'utf8');
    expect(saved + r.stdout + r.stderr).not.toContain(KEY);
    expect(JSON.parse(saved)).toMatchObject({ kind: 'list', observed: 'real' });
  });

  it('stops with the error when Google refuses the key', () => {
    const d = fresh();
    const r = run(d, {
      status: 400,
      body: { error: { code: 400, status: 'INVALID_ARGUMENT', message: 'API key not valid.' } },
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('HTTP 400');
  });
});
