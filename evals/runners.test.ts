import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const dir = new URL('../.github/workflows/', import.meta.url);
const workflows = readdirSync(dir)
  .filter((f) => /\.ya?ml$/.test(f))
  .map((f) => ({ file: f, yml: readFileSync(new URL(f, dir), 'utf8') }));

// GitHub's hosted minutes are used up and a $0 budget blocks hosted jobs: every job picks its
// runner from the RUNNER variable (self-hosted), with the same fallback expression, never a
// hosted label directly (docs/runbook.md, "Self-hosted runner").
describe('every workflow job chooses its runner from the RUNNER variable', () => {
  it('finds the workflows and their jobs', () => {
    expect(workflows.length).toBeGreaterThan(0);
    expect(workflows.flatMap((w) => w.yml.match(/^\s+runs-on:/gm) ?? []).length).toBeGreaterThan(3);
  });

  it.each(workflows)('$file: no job names a hosted runner directly', ({ yml }) => {
    const lines = yml.split('\n').filter((l) => /^\s+runs-on:/.test(l));
    for (const line of lines)
      expect(line.trim()).toBe("runs-on: ${{ vars.RUNNER || 'ubuntu-latest' }}");
  });

  it('has no ubuntu-latest outside that one expression', () => {
    for (const { file, yml } of workflows) {
      const stray = yml
        .split('\n')
        .filter(
          (l) =>
            l.includes('ubuntu-') &&
            !/^\s+runs-on: \$\{\{ vars\.RUNNER \|\| 'ubuntu-latest' \}\}$/.test(l),
        )
        .filter((l) => !l.trim().startsWith('#'));
      expect(stray, file).toEqual([]);
    }
  });
});

describe('the deploy job', () => {
  const ci = workflows.find((w) => w.file === 'ci.yml')?.yml ?? '';
  const deploy = /^ {2}deploy:\n((?: {4}.*\n|\n)+)/m.exec(ci)?.[1] ?? '';

  it('runs on the same runner as ci and e2e, in its own concurrency group, never cancelled', () => {
    expect(deploy).toContain("runs-on: ${{ vars.RUNNER || 'ubuntu-latest' }}");
    expect(deploy).toMatch(/group: deploy-production/);
    expect(deploy).toMatch(/cancel-in-progress: false/);
    expect(deploy).toMatch(/needs: \[ci, e2e\]/);
  });

  it('needs only node, npm and curl, and reads its secrets from the environment, never a .env file', () => {
    expect(deploy).not.toMatch(/\bpsql\b|docker/);
    expect(deploy).toContain('secrets.NEON_DIRECT_URL');
    expect(deploy).toContain('secrets.RENDER_DEPLOY_HOOK_URL');
    expect(deploy).not.toMatch(/--env-file=\.env\b/);
  });
});
