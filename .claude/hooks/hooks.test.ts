// Pipes realistic hook JSON into each script and checks exit codes and messages.
// Nothing here reads a secret or a holdout file: the guards only see the JSON text.
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

const hooksDir = fileURLToPath(new URL('.', import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), 'askbuy-hooks-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

type Result = { code: number | null; stdout: string; stderr: string };

function run(
  script: string,
  input: unknown,
  opts: { env?: Record<string, string>; cwd?: string } = {},
): Result {
  const r = spawnSync(process.execPath, [join(hooksDir, script)], {
    input: typeof input === 'string' ? input : JSON.stringify(input),
    encoding: 'utf8',
    cwd: opts.cwd ?? scratch,
    env: { ...process.env, ...opts.env },
    timeout: 20_000,
  });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

function sh(cwd: string, cmd: string, args: string[]): void {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')}: ${r.stderr}`);
}

/** A throwaway git repo (no commits needed) sitting on the given branch. */
function repo(branch: string, files = 0): string {
  const dir = mkdtempSync(join(scratch, 'repo-'));
  sh(dir, 'git', ['init', '-q', '-b', branch]);
  for (let i = 0; i < files; i++) writeFileSync(join(dir, `f${i}.txt`), 'x');
  return dir;
}

/** A directory with executable stubs, to put first on PATH. */
function stubs(files: Record<string, string>): string {
  const dir = mkdtempSync(join(scratch, 'stubs-'));
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(join(dir, name), `#!/bin/sh\n${body}\n`);
    chmodSync(join(dir, name), 0o755);
  }
  return dir;
}

const tool = (tool_name: string, tool_input: Record<string, unknown>, cwd = scratch) => ({
  hook_event_name: 'PreToolUse',
  session_id: 's1',
  cwd,
  tool_name,
  tool_input,
});
const bash = (command: string, cwd = scratch) => tool('Bash', { command }, cwd);

describe('guard-secrets', () => {
  const guard = (input: unknown) => run('guard-secrets.mjs', input);
  const blocked = (input: unknown) => {
    const r = guard(input);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('guard-secrets');
    return r;
  };

  it('blocks reading .env and says what to read instead', () => {
    const r = blocked(tool('Read', { file_path: '/home/x/project/.env' }));
    expect(r.stderr).toContain('.env.example');
  });

  it('blocks .env.* variants and nested .env files', () => {
    blocked(tool('Read', { file_path: '/repo/apps/api/.env.local' }));
    blocked(tool('Read', { file_path: '.env.production' }));
    blocked(tool('Edit', { file_path: '/repo/.env', old_string: 'a', new_string: 'b' }));
    blocked(tool('Write', { file_path: '/repo/.env', content: 'A=1' }));
  });

  it('allows .env.example', () => {
    expect(guard(tool('Read', { file_path: '/repo/.env.example' })).code).toBe(0);
    expect(guard(tool('Edit', { file_path: '.env.example', old_string: 'a' })).code).toBe(0);
    expect(guard(bash('cat .env.example')).code).toBe(0);
  });

  describe('Gemini API keys (both formats)', () => {
    // Built from pieces so these are not real keys: the right shape, filler characters.
    const classic = `AIza${'x'.repeat(35)}`;
    const newer = `AQ.${'x'.repeat(53)}`;

    it.each([
      ['AIza', classic],
      ['AQ.', newer],
    ])('blocks a %s key typed into a command, written to a file or put in an edit', (_p, key) => {
      const r = blocked(bash(`curl -H "x-goog-api-key: ${key}" https://example.test`));
      expect(r.stderr).toContain('API key');
      blocked(tool('Write', { file_path: '/repo/notes.md', content: `key: ${key}` }));
      blocked(tool('Edit', { file_path: '/repo/a.ts', old_string: 'a', new_string: key }));
    });

    it('does not echo the key back in its reason', () => {
      expect(blocked(bash(`echo ${newer}`)).stderr).not.toContain(newer);
    });

    it.each([
      ['AIza', `AIza${'FakeKeyForTheTest'}${'x'.repeat(18)}`],
      ['AQ.', `AQ.${'FakeKeyForTheTest'}${'x'.repeat(36)}`],
    ])('lets a %s test value that says "fake" through', (_p, key) => {
      expect(guard(bash(`echo ${key}`)).code).toBe(0);
      expect(guard(tool('Write', { file_path: '/repo/t.ts', content: key })).code).toBe(0);
    });

    it('lets ordinary text and too-short look-alikes through, and does not check reads', () => {
      expect(guard(bash('echo AIza AQ. hello')).code).toBe(0);
      expect(guard(bash(`echo AQ.${'x'.repeat(10)}`)).code).toBe(0);
      expect(guard(tool('Read', { file_path: `/repo/${newer}.txt` })).code).toBe(0);
    });
  });

  it('blocks Grep and Glob aimed at .env', () => {
    blocked(tool('Grep', { pattern: 'KEY', path: '/repo/.env' }));
    blocked(tool('Grep', { pattern: 'KEY', glob: '**/.env*' }));
    blocked(tool('Glob', { pattern: '**/.env.local' }));
  });

  it('blocks Bash commands that mention .env', () => {
    blocked(bash('cat .env'));
    blocked(bash('grep DATABASE_URL apps/api/.env'));
    blocked(bash('source .env && echo $KEY'));
    blocked(bash('node --env-file=.env script.js'));
    blocked(bash('export $(cat .env | xargs)'));
    blocked(bash('cat ./.env.local'));
  });

  it('does not trip on ordinary text that contains "env"', () => {
    expect(guard(bash('npm test')).code).toBe(0);
    expect(guard(bash('grep -rn "process.env" apps')).code).toBe(0);
    expect(guard(bash('echo $NODE_ENV')).code).toBe(0);
    expect(guard(tool('Read', { file_path: '/repo/apps/api/src/env.ts' })).code).toBe(0);
  });

  it('blocks holdout paths and commands', () => {
    const r = blocked(tool('Read', { file_path: '/repo/evals/errand/holdout.json' }));
    expect(r.stderr).toContain('holdout');
    blocked(tool('Glob', { pattern: 'evals/**/*holdout*' }));
    blocked(tool('Grep', { pattern: 'x', path: '/repo/evals/holdout' }));
    blocked(bash('cat evals/errand/holdout.json'));
    blocked(bash('node evals/run.js --set Holdout'));
  });

  it('only looks at paths for file tools, so writing about the word is fine', () => {
    const r = guard(
      tool('Write', { file_path: '/repo/docs/x.md', content: 'the holdout runs by hand' }),
    );
    expect(r.code).toBe(0);
    expect(guard(tool('Read', { file_path: '/repo/evals/errand/dev.json' })).code).toBe(0);
  });

  it('ignores tools it does not cover', () => {
    expect(guard(tool('WebFetch', { url: 'https://example.com/.env' })).code).toBe(0);
  });

  it('fails closed on input it cannot parse', () => {
    const r = guard('not json');
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('guard-secrets');
  });
});

describe('guard-git', () => {
  const guard = (input: unknown) => run('guard-git.mjs', input);
  const blocked = (input: unknown) => {
    const r = guard(input);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('guard-git');
    return r;
  };
  const main = repo('main');
  const feature = repo('feat/x');

  it('blocks pushes that target main, including force and refspecs', () => {
    const r = blocked(bash('git push origin main', feature));
    expect(r.stderr).toContain('pull request');
    blocked(bash('git push origin HEAD:main', feature));
    blocked(bash('git push --force origin main', feature));
    blocked(bash('git push -f origin feat/x:main', feature));
    blocked(bash('git push origin +HEAD:refs/heads/main', feature));
    blocked(bash('git push origin master', feature));
    blocked(bash('git push --force-with-lease origin main', feature));
    blocked(bash('git push --all origin', feature));
  });

  it('blocks a bare push while on main, allows it on a feature branch', () => {
    blocked(bash('git push', main));
    blocked(bash('git push origin', main));
    expect(guard(bash('git push', feature)).code).toBe(0);
  });

  it('allows pushes of other branches', () => {
    expect(guard(bash('git push -u origin feat/x', feature)).code).toBe(0);
    expect(guard(bash('git push --force-with-lease origin feat/x', feature)).code).toBe(0);
    expect(guard(bash('git push origin HEAD', feature)).code).toBe(0);
    expect(guard(bash('git push origin feat/main-menu', feature)).code).toBe(0);
  });

  it('sees a push inside a chain or a nested shell', () => {
    blocked(bash('npm test && git push origin main', feature));
    blocked(bash('git status; git push origin main', feature));
    blocked(bash('bash -c "git push origin main"', feature));
    blocked(bash('git -C . push origin main', feature));
  });

  it('blocks --no-verify and commit -n, but not the words in a message', () => {
    const r = blocked(bash('git commit --no-verify -m "x"', feature));
    expect(r.stderr).toContain('--no-verify');
    blocked(bash('git push --no-verify origin feat/x', feature));
    blocked(bash('git commit -n -m x', feature));
    expect(guard(bash('git commit -m "docs: never use --no-verify"', feature)).code).toBe(0);
  });

  it('blocks git commit on main, allows it elsewhere', () => {
    const r = blocked(bash('git commit -m "feat: x"', main));
    expect(r.stderr).toContain('git switch -c');
    expect(guard(bash('git commit -m "feat: x"', feature)).code).toBe(0);
  });

  it('allows a commit on main when the same command switches branch first', () => {
    expect(guard(bash('git switch -c feat/y && git commit -m "feat: y"', main)).code).toBe(0);
  });

  it('leaves other commands and tools alone', () => {
    expect(guard(bash('npm test -- --passWithNoTests', main)).code).toBe(0);
    expect(guard(bash('git status', main)).code).toBe(0);
    expect(guard(bash('git log origin/main', main)).code).toBe(0);
    expect(guard(tool('Read', { file_path: '/repo/README.md' }, main)).code).toBe(0);
  });
});

describe('format', () => {
  const edit = (file_path: string) =>
    run('format.mjs', {
      hook_event_name: 'PostToolUse',
      cwd: scratch,
      tool_name: 'Edit',
      tool_input: { file_path },
    });

  it('runs Prettier on a .ts file', () => {
    const file = join(scratch, 'ugly.ts');
    writeFileSync(file, 'const   a  =  {b:1}\nexport {a}\n');
    const r = edit(file);
    expect(r.code).toBe(0);
    expect(r.stderr).toBe('');
    expect(readFileSync(file, 'utf8')).toBe('const a = { b: 1 };\nexport { a };\n');
  });

  it('skips a file Prettier does not handle', () => {
    const file = join(scratch, 'pic.png');
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff]);
    writeFileSync(file, bytes);
    const r = edit(file);
    expect(r.code).toBe(0);
    expect(r.stderr).toBe('');
    expect(readFileSync(file).equals(bytes)).toBe(true);
  });

  it('never fails the tool call: bad syntax and missing files still exit 0', () => {
    const file = join(scratch, 'broken.ts');
    writeFileSync(file, 'const = = ;\n');
    const r = edit(file);
    expect(r.code).toBe(0);
    expect(r.stderr).toContain('format');
    expect(readFileSync(file, 'utf8')).toBe('const = = ;\n');
    expect(edit(join(scratch, 'missing.ts')).code).toBe(0);
    expect(run('format.mjs', 'not json').code).toBe(0);
  });
});

describe('notify', () => {
  it('sends a desktop notification when Claude needs the user', () => {
    const log = join(scratch, 'notify-args.txt');
    const dir = stubs({ 'notify-send': `printf '%s\\n' "$@" > "${log}"` });
    const r = run(
      'notify.mjs',
      { hook_event_name: 'Notification', cwd: scratch, message: 'Claude needs your permission' },
      { env: { PATH: `${dir}:${process.env.PATH}` } },
    );
    expect(r.code).toBe(0);
    expect(readFileSync(log, 'utf8')).toContain('Claude needs your permission');
  });

  it('says it finished on Stop', () => {
    const log = join(scratch, 'notify-stop.txt');
    const dir = stubs({ 'notify-send': `printf '%s\\n' "$@" > "${log}"` });
    const r = run(
      'notify.mjs',
      { hook_event_name: 'Stop', cwd: scratch },
      { env: { PATH: `${dir}:${process.env.PATH}` } },
    );
    expect(r.code).toBe(0);
    expect(readFileSync(log, 'utf8').toLowerCase()).toContain('finished');
  });

  it('does nothing, quietly, when notify-send is missing', () => {
    const empty = stubs({});
    const r = run(
      'notify.mjs',
      { hook_event_name: 'Stop', cwd: scratch },
      { env: { PATH: empty } },
    );
    expect(r.code).toBe(0);
    expect(r.stderr).toBe('');
    expect(r.stdout).toBe('');
  });
});

describe('session-status', () => {
  const start = (cwd: string, ghBody: string, extra: Record<string, string> = {}) =>
    run(
      'session-status.mjs',
      { hook_event_name: 'SessionStart', cwd, source: 'startup' },
      { cwd, env: { PATH: `${stubs({ gh: ghBody })}:${process.env.PATH}`, ...extra } },
    );
  const lines = (r: Result) => r.stdout.trim().split('\n');

  it('prints three lines: branch and dirty files, open PRs, runner state', () => {
    const dir = repo('feat/x', 2);
    const r = start(
      dir,
      `case "$*" in
  *"pr list"*) echo '[{"number":1},{"number":2},{"number":3}]' ;;
  *in_progress*) echo '[{"databaseId":9}]' ;;
  *) echo '[]' ;;
esac`,
    );
    expect(r.code).toBe(0);
    const l = lines(r);
    expect(l).toHaveLength(3);
    expect(l[0]).toContain('feat/x');
    expect(l[0]).toContain('2 uncommitted');
    expect(l[1]).toContain('3');
    expect(l[2].toLowerCase()).toContain('busy');
  });

  it('says idle when nothing is running, and warns on main', () => {
    const r = start(repo('main'), `echo '[]'`);
    const l = lines(r);
    expect(l).toHaveLength(3);
    expect(l[0]).toContain('main');
    expect(l[0].toLowerCase()).toContain('switch');
    expect(l[1]).toContain('0');
    expect(l[2].toLowerCase()).toContain('idle');
  });

  it('tolerates gh being offline', () => {
    const r = start(repo('feat/x'), 'echo "network down" >&2; exit 1');
    expect(r.code).toBe(0);
    const l = lines(r);
    expect(l).toHaveLength(3);
    expect(l[1].toLowerCase()).toContain('unknown');
    expect(l[2].toLowerCase()).toContain('unknown');
  });

  it('gives up on a hanging gh instead of stalling the session', () => {
    const t0 = Date.now();
    const r = start(repo('feat/x'), 'sleep 20', { SESSION_STATUS_TIMEOUT_MS: '400' });
    expect(Date.now() - t0).toBeLessThan(5000);
    expect(r.code).toBe(0);
    expect(lines(r)).toHaveLength(3);
    expect(lines(r)[2].toLowerCase()).toContain('unknown');
  });
});
