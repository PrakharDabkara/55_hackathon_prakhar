import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const script = join(import.meta.dirname, 'demo.sh');
const TOKEN = 'secret-token-'.padEnd(40, 'x');

/** Runs demo.sh with a stand-in `curl` first on PATH, which logs its arguments and stdin. */
function run(args: string[], env: Record<string, string>, reply: { post: string }) {
  const dir = mkdtempSync(join(tmpdir(), 'demo-sh-'));
  const log = join(dir, 'curl.log');
  writeFileSync(
    join(dir, 'curl'),
    `#!/usr/bin/env bash
echo "ARGS: $*" >> "${log}"
case "$*" in
  *-K\\ -*) echo "STDIN: $(cat)" >> "${log}"; printf '%s' '${reply.post}' ;;
  *) printf '200' ;;
esac
`,
  );
  chmodSync(join(dir, 'curl'), 0o755);
  const result = spawnSync('bash', [script, ...args], {
    env: { PATH: `${dir}:${process.env['PATH']}`, ...env },
    encoding: 'utf8',
  });
  let calls = '';
  try {
    calls = readFileSync(log, 'utf8');
  } catch {
    // curl was never called
  }
  return { ...result, calls };
}

describe('scripts/demo.sh', () => {
  it('refuses an unknown command, and a missing ADMIN_TOKEN, before any call', () => {
    const noCommand = run(['wipe'], { ADMIN_TOKEN: TOKEN }, { post: '{}\n200' });
    expect(noCommand.status).toBe(2);
    expect(noCommand.calls).toBe('');
    const noToken = run(['seed'], {}, { post: '{}\n200' });
    expect(noToken.status).toBe(2);
    expect(noToken.stderr).toContain('ADMIN_TOKEN');
    expect(noToken.calls).toBe('');
  });

  it('refuses a plain-http remote URL and a token with odd characters, before any call', () => {
    const http = run(['seed', 'http://example.test'], { ADMIN_TOKEN: TOKEN }, { post: '{}\n200' });
    expect(http.status).toBe(2);
    expect(http.calls).toBe('');
    const odd = run(
      ['seed', 'https://example.test'],
      { ADMIN_TOKEN: 'a"b\nc' },
      { post: '{}\n200' },
    );
    expect(odd.status).toBe(2);
    expect(odd.calls).toBe('');
  });

  it('posts to /admin/demo/<command>, prints the counts, and keeps the token off the command line', () => {
    for (const cmd of ['seed', 'reset']) {
      const res = run(
        [cmd, 'https://example.test/'],
        { ADMIN_TOKEN: TOKEN },
        { post: '{"shops":5}\n200' },
      );
      expect(res.status).toBe(0);
      expect(res.stdout).toContain('{"shops":5}');
      expect(res.calls).toContain(`https://example.test/admin/demo/${cmd}`);
      expect(res.calls).toContain('-X POST');
      const argLines = res.calls.split('\n').filter((l) => l.startsWith('ARGS:'));
      for (const line of argLines) expect(line).not.toContain(TOKEN);
      expect(res.calls).toContain(`STDIN: header = "authorization: Bearer ${TOKEN}"`);
    }
  });

  it('fails with a clear message on 404 and on any other status, and never echoes the token', () => {
    const wrong = run(['seed'], { ADMIN_TOKEN: TOKEN }, { post: '{"error":{}}\n404' });
    expect(wrong.status).toBe(1);
    expect(wrong.stderr).toContain('did not accept ADMIN_TOKEN');
    const broken = run(['reset'], { ADMIN_TOKEN: TOKEN }, { post: 'x\n500' });
    expect(broken.status).toBe(1);
    expect(broken.stderr).toContain('HTTP 500');
    for (const r of [wrong, broken]) {
      expect(r.stdout + r.stderr).not.toContain(TOKEN);
    }
  });
});
