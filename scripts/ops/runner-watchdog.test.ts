import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const script = join(import.meta.dirname, 'runner-watchdog.sh');
const NOW = 1_800_000_000;
const SERVICE = 'actions.runner.test.service';

const runner = (status: string, busy: boolean) =>
  JSON.stringify({ runners: [{ name: 'laptop', status, busy }] });
/** A queued run created `minutes` ago. */
const queued = (...minutes: number[]) =>
  JSON.stringify(
    minutes.map((m) => ({
      createdAt: new Date((NOW - m * 60) * 1000).toISOString().replace('.000Z', 'Z'),
    })),
  );

/** Runs the watchdog with stand-ins for gh and sudo first on PATH. */
function setup(runners: string, runs: string) {
  const dir = mkdtempSync(join(tmpdir(), 'watchdog-'));
  const stub = (name: string, body: string) => {
    writeFileSync(join(dir, name), `#!/usr/bin/env bash\n${body}\n`);
    chmodSync(join(dir, name), 0o755);
  };
  const calls = join(dir, 'sudo.log');
  writeFileSync(join(dir, 'runners.json'), runners);
  writeFileSync(join(dir, 'runs.json'), runs);
  stub('gh', `case "$1" in api) cat "${dir}/runners.json" ;; run) cat "${dir}/runs.json" ;; esac`);
  stub('sudo', `echo "$*" >> "${calls}"`);
  const run = (now = NOW) =>
    spawnSync('bash', [script], {
      env: {
        PATH: `${dir}:${process.env['PATH']}`,
        WATCHDOG_LOG: join(dir, 'watchdog.log'),
        WATCHDOG_STATE: join(dir, 'last-restart'),
        WATCHDOG_NOW: String(now),
        WATCHDOG_REPO: 'o/r',
        RUNNER_SERVICE: SERVICE,
      },
      encoding: 'utf8',
    });
  const restarts = () => (existsSync(calls) ? readFileSync(calls, 'utf8').trim().split('\n') : []);
  const logFile = join(dir, 'watchdog.log');
  const log = () => (existsSync(logFile) ? readFileSync(logFile, 'utf8') : '');
  return { run, restarts, log };
}

describe('scripts/ops/runner-watchdog.sh', () => {
  it('restarts the exact runner service when a run waited over 10 minutes and the runner is idle', () => {
    const w = setup(runner('online', false), queued(11));
    expect(w.run().status).toBe(0);
    expect(w.restarts()).toEqual([`-n systemctl restart ${SERVICE}`]);
    expect(w.log()).toContain('restart');
  });

  it('does nothing when the oldest queued run is 10 minutes old or less', () => {
    const w = setup(runner('online', false), queued(10, 2));
    w.run();
    expect(w.restarts()).toEqual([]);
    expect(w.log()).not.toContain('restart');
  });

  it('does nothing when the runner is busy', () => {
    const w = setup(runner('online', true), queued(40));
    w.run();
    expect(w.restarts()).toEqual([]);
  });

  it('does nothing when nothing is queued', () => {
    const w = setup(runner('online', false), '[]');
    w.run();
    expect(w.restarts()).toEqual([]);
  });

  it('does nothing when the runner is offline (a restart cannot fix a laptop that is off)', () => {
    const w = setup(runner('offline', false), queued(40));
    w.run();
    expect(w.restarts()).toEqual([]);
  });

  it('never restarts twice within 30 minutes, then may again', () => {
    const w = setup(runner('online', false), queued(45));
    w.run(NOW);
    w.run(NOW + 29 * 60);
    expect(w.restarts()).toHaveLength(1);
    expect(w.log()).toContain('skip');
    w.run(NOW + 31 * 60);
    expect(w.restarts()).toHaveLength(2);
  });

  it('logs and exits quietly when gh fails', () => {
    const w = setup('', '');
    const r = w.run();
    expect(r.status).toBe(0);
    expect(w.restarts()).toEqual([]);
  });
});
