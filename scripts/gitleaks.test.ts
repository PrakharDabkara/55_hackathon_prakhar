import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const IMAGE = 'zricethezav/gitleaks:v8.18.4';
const config = join(import.meta.dirname, '..', '.gitleaks.toml');

const haveGitleaks = spawnSync('docker', ['image', 'inspect', IMAGE]).status === 0;

// Built from pieces, so that this file itself holds no complete key and a scan of the repo stays clean.
const body = ['Ab3dE5gH7jK9mN1pQ3sT', '5vX7zB9dF1hJ3kL5nP7r'];
const looksReal = `AQ.${body.join('')}`;
const saysFake = `AQ.FakeKeyForTheGitleaksTest${body[1]}`;
const classic = `AIza${['SyB3dE5gH7jK9mN1pQ3sT', '5vX7zB9dF1hJ3kL'].join('')}`;

const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

/** Scans one file with our config, in a throwaway directory (never the repo). */
function scan(content: string) {
  const dir = mkdtempSync(join(tmpdir(), 'leaks-'));
  dirs.push(dir);
  writeFileSync(join(dir, 'file.txt'), content);
  const r = spawnSync(
    'docker',
    [
      'run',
      '--rm',
      '-v',
      `${dir}:/scan:ro`,
      '-v',
      `${config}:/gitleaks.toml:ro`,
      IMAGE,
      'detect',
      '--no-git',
      '--source',
      '/scan',
      '-c',
      '/gitleaks.toml',
      '--redact',
      '-v',
      '--no-banner',
    ],
    { encoding: 'utf8' },
  );
  return { code: r.status, out: r.stdout + r.stderr };
}

describe.skipIf(!haveGitleaks)('.gitleaks.toml', () => {
  it('flags a real-looking AQ. key', () => {
    const r = scan(`GEMINI_API_KEY=${looksReal}\n`);
    expect(r.code).toBe(1);
    expect(r.out).toContain('gemini-api-key-aq');
    expect(r.out).not.toContain(body.join('')); // --redact: the key is not printed
  }, 60_000);

  it('still flags a classic AIza key (the default rules are kept)', () => {
    expect(scan(`key = "${classic}"\n`).code).toBe(1);
  }, 60_000);

  it('lets an AQ. key that says it is fake through', () => {
    expect(scan(`key = "${saysFake}"\n`).code).toBe(0);
  }, 60_000);

  it('does not let a real key through because the word "fake" is nearby', () => {
    const r = scan(`# this is not a fake key\nGEMINI_API_KEY=${looksReal} # fake\n`);
    expect(r.code).toBe(1);
    expect(r.out).toContain('gemini-api-key-aq');
  }, 60_000);

  it('ignores ordinary text', () => {
    expect(scan('AQ. is a prefix, AQ.short is not a key\n').code).toBe(0);
  }, 60_000);
});
