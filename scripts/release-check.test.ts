import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const script = join(import.meta.dirname, 'release-check.sh');
const TOKEN = 'secret-token-'.padEnd(40, 'x');
const healthy = {
  ci: 'success',
  prs: '[]',
  codes: { '/health': '200', '/': '200', '/app/': '200' } as Record<string, string>,
  details: {
    autopilot: { on: true },
    queues: [{ name: 'a', failedLast24h: 0 }],
  } as unknown,
  detailsCode: '200',
  security: 0,
};

/** Runs release-check.sh with stand-ins for gh, curl and the security script. */
function run(
  over: Partial<typeof healthy> = {},
  env: Record<string, string> = {},
  base = 'https://kahanmilega-api.onrender.com',
) {
  const c = { ...healthy, ...over };
  const dir = mkdtempSync(join(tmpdir(), 'release-check-'));
  const stub = (name: string, body: string) => {
    writeFileSync(join(dir, name), `#!/usr/bin/env bash\n${body}\n`);
    chmodSync(join(dir, name), 0o755);
  };
  stub(
    'gh',
    `case "$*" in
  *"run list"*) echo '[{"status":"completed","conclusion":"${c.ci}"}]' ;;
  *"pr list"*) echo '${c.prs}' ;;
esac`,
  );
  stub(
    'curl',
    `case "$*" in
  *health/details*) cat >/dev/null; printf '%s\\n%s' '${JSON.stringify(c.details)}' '${c.detailsCode}' ;;
  *) for a in "$@"; do last="$a"; done
     case "$last" in
       */health) printf '${c.codes['/health']}' ;;
       */app/) printf '${c.codes['/app/']}' ;;
       *) printf '${c.codes['/']}' ;;
     esac ;;
esac`,
  );
  stub('sec', `exit ${c.security}`);
  const result = spawnSync('bash', [script, base], {
    env: {
      PATH: `${dir}:${process.env['PATH']}`,
      RELEASE_CHECK_SECURITY_SCRIPT: join(dir, 'sec'),
      ...env,
    },
    encoding: 'utf8',
  });
  return { ...result, out: `${result.stdout}${result.stderr}` };
}

describe('scripts/release-check.sh', () => {
  it('prints PASS for everything and exits 0 when the release is ready', () => {
    const r = run({}, { ADMIN_TOKEN: TOKEN });
    expect(r.status).toBe(0);
    expect(r.out.match(/^PASS/gm)).toHaveLength(9);
    expect(r.out).not.toContain('FAIL');
    expect(r.out).toContain('IP budget');
    expect(r.out).not.toContain(TOKEN);
  });

  it('fails when main CI is not green, a PR is open, or a page is down', () => {
    expect(run({ ci: 'failure' }, { ADMIN_TOKEN: TOKEN }).out).toMatch(/FAIL\s+main CI/);
    expect(run({ prs: '[{"number":7}]' }, { ADMIN_TOKEN: TOKEN }).out).toMatch(
      /FAIL\s+no open PRs/,
    );
    const down = run({ codes: { ...healthy.codes, '/app/': '503' } }, { ADMIN_TOKEN: TOKEN });
    expect(down.out).toMatch(/FAIL\s+live \/app\//);
    expect(down.status).toBe(1);
  });

  it('fails when the security script fails', () => {
    const r = run({ security: 1 }, { ADMIN_TOKEN: TOKEN });
    expect(r.out).toMatch(/FAIL\s+verify-live-security/);
    expect(r.status).toBe(1);
  });

  it('fails the details check when the autopilot is off or a job failed', () => {
    const off = run({ details: { autopilot: { on: false }, queues: [] } }, { ADMIN_TOKEN: TOKEN });
    expect(off.out).toMatch(/FAIL\s+\/admin\/health\/details/);
    const failed = run(
      { details: { autopilot: { on: true }, queues: [{ failedLast24h: 2 }] } },
      { ADMIN_TOKEN: TOKEN },
    );
    expect(failed.out).toMatch(/FAIL\s+\/admin\/health\/details/);
  });

  it('fails the details check without ADMIN_TOKEN, and when the server answers 404', () => {
    expect(run().out).toMatch(/FAIL\s+\/admin\/health\/details.*ADMIN_TOKEN/);
    expect(run({ detailsCode: '404' }, { ADMIN_TOKEN: TOKEN }).out).toMatch(
      /FAIL\s+\/admin\/health\/details.*404/,
    );
  });

  it.each([
    'http://localhost.evil.com',
    'http://localhost@evil.com',
    'http://127.0.0.1.evil.com',
    'https://evil.com@example.test',
    'http://example.test',
    'https://localhost.evil.com',
    'https://evil.com',
    'http://kahanmilega-api.onrender.com',
    'https://kahanmilega-api.onrender.com.evil.com',
  ])('refuses %s before sending the token anywhere', (base) => {
    const r = run({}, { ADMIN_TOKEN: TOKEN }, base);
    expect(r.status).toBe(2);
    expect(r.out).not.toContain('PASS');
  });

  it('accepts localhost with a port', () => {
    expect(run({}, { ADMIN_TOKEN: TOKEN }, 'http://localhost:3000').status).toBe(0);
  });
});
