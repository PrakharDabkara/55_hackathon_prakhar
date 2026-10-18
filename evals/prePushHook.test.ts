import { spawnSync } from 'node:child_process';
import { accessSync, constants, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const hook = new URL('../.githooks/pre-push', import.meta.url).pathname;
const ZERO = '0000000000000000000000000000000000000000';
const SHA = '1234567890123456789012345678901234567890';

/** Runs the hook the way git does: the remote's name and URL as arguments, one line per ref on stdin. */
const push = (...lines: string[]) =>
  spawnSync('sh', [hook, 'origin', 'git@example.com:me/repo.git'], {
    input: lines.join('\n') + '\n',
    encoding: 'utf8',
  });
const line = (local: string, remote: string, localSha = SHA) =>
  `${local} ${localSha} ${remote} ${SHA}`;

describe('.githooks/pre-push: main deploys to production, so nothing is pushed to it', () => {
  it('is executable', () => {
    expect(() => accessSync(hook, constants.X_OK)).not.toThrow();
  });

  it('refuses a push to main and to master, with a message that says what to do instead', () => {
    for (const remote of ['refs/heads/main', 'refs/heads/master']) {
      const result = push(line('refs/heads/main', remote));
      expect(result.status, remote).toBe(1);
      expect(result.stderr).toMatch(/never push to (main|master)/i);
      expect(result.stderr).toMatch(/pull request/i);
      expect(result.stderr).toMatch(/git switch -c/);
    }
  });

  it('refuses it whatever the local branch is called (a feature branch pushed to main:)', () => {
    expect(push(line('refs/heads/fix/x', 'refs/heads/main')).status).toBe(1);
    expect(push(line('HEAD', 'refs/heads/main')).status).toBe(1);
  });

  it('refuses deleting main, and refuses when main is only one of several refs pushed', () => {
    expect(push(line('(delete)', 'refs/heads/main', ZERO)).status).toBe(1);
    expect(
      push(line('refs/heads/a', 'refs/heads/a'), line('refs/heads/b', 'refs/heads/main')).status,
    ).toBe(1);
  });

  it('lets a feature branch, a fix branch and tags through', () => {
    expect(push(line('refs/heads/feat/photos', 'refs/heads/feat/photos')).status).toBe(0);
    expect(push(line('refs/heads/fix/day15', 'refs/heads/fix/day15')).status).toBe(0);
    expect(push(line('refs/tags/v1', 'refs/tags/v1')).status).toBe(0);
    // Names that merely contain "main" are not main.
    expect(push(line('refs/heads/maintenance', 'refs/heads/maintenance')).status).toBe(0);
    expect(push(line('refs/heads/domain/x', 'refs/heads/domain/x')).status).toBe(0);
  });

  it('lets an empty push through (nothing to push)', () => {
    expect(spawnSync('sh', [hook, 'origin', 'url'], { input: '', encoding: 'utf8' }).status).toBe(
      0,
    );
  });
});

describe('the hook is switched on by npm install', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
    scripts: Record<string, string>;
  };

  it('has a prepare script that sets core.hooksPath, and does not fail outside a git checkout', () => {
    expect(pkg.scripts['prepare']).toContain('core.hooksPath .githooks');
    expect(pkg.scripts['prepare']).toMatch(/\|\|\s*true|;\s*true|exit 0/);
  });
});

describe('CLAUDE.md', () => {
  it('says never push to main and that every change goes through a pull request', () => {
    const text = readFileSync(new URL('../CLAUDE.md', import.meta.url), 'utf8');
    expect(text).toMatch(/never push to main/i);
    expect(text).toMatch(/every change goes through a (PR|pull request)/i);
    expect(text).toMatch(/git branch --show-current/);
  });
});
