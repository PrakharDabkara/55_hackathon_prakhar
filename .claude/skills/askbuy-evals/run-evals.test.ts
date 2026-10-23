// run-evals.sh against a stubbed `gh`: nothing here reaches GitHub, Google or a real eval.
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

const script = fileURLToPath(new URL('./run-evals.sh', import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), 'askbuy-runevals-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

// The stub logs every call to $STUB_LOG. `workflow run` prints a run URL with the next id
// (1001, 1002, ...), or no URL when STUB_NO_URL is set. `run view <id>` answers from STUB_STATES,
// a comma list of `status:conclusion` consumed one per view; the last entry repeats.
const stub = `#!/usr/bin/env bash
echo "$*" >> "$STUB_LOG"
if [ "$1 $2" = "workflow run" ]; then
  n=$(cat "$STUB_DIR/n" 2>/dev/null || echo 0); n=$((n+1)); echo $n > "$STUB_DIR/n"
  echo "dispatch $n" >> "$STUB_LOG"
  if [ -n "$STUB_NO_URL" ]; then echo "Created workflow_dispatch event for evals.yml at main"; exit 0; fi
  echo "https://github.com/acme/repo/actions/runs/$((1000+n))"
  exit 0
fi
if [ "$1 $2" = "run view" ]; then
  id="$3"
  v=$(cat "$STUB_DIR/v-$id" 2>/dev/null || echo 0); echo $((v+1)) > "$STUB_DIR/v-$id"
  IFS=',' read -r -a states <<< "\${STUB_STATES:-completed:success}"
  i=$v; [ "$i" -ge "\${#states[@]}" ] && i=$(( \${#states[@]} - 1 ))
  s="\${states[$i]}"; echo "view $id $s" >> "$STUB_LOG"
  echo "\${s%%:*} \${s#*:}"
  exit 0
fi
echo "unexpected gh call: $*" >&2; exit 9
`;

let dir: string;
let log: string;
beforeEach(() => {
  dir = mkdtempSync(join(scratch, 'case-'));
  log = join(dir, 'log');
  writeFileSync(log, '');
  writeFileSync(join(dir, 'gh'), stub);
  chmodSync(join(dir, 'gh'), 0o755);
});

function run(args: string[], env: Record<string, string> = {}) {
  const r = spawnSync('bash', [script, ...args], {
    encoding: 'utf8',
    timeout: 30_000,
    env: {
      ...process.env,
      GH_BIN: join(dir, 'gh'),
      STUB_DIR: dir,
      STUB_LOG: log,
      POLL_SECS: '0',
      ...env,
    },
  });
  const calls = readFileSync(log, 'utf8').trim().split('\n').filter(Boolean);
  return { code: r.status, out: r.stdout, err: r.stderr, calls };
}

describe('run-evals.sh', () => {
  it('takes the run id from the URL gh prints and watches exactly that run', () => {
    const r = run(['resolve']);
    expect(r.code).toBe(0);
    expect(r.calls.some((c) => c.startsWith('run view 1001 '))).toBe(true);
    expect(r.calls.some((c) => /run list|--latest|-L /.test(c))).toBe(false);
    expect(r.out).toMatch(/run 1001/);
    expect(r.out).toMatch(/resolve: success/);
  });

  it('dispatches the agent suite with the dev set and the fallback model by default', () => {
    const r = run(['agent']);
    expect(r.calls[0]).toBe('workflow run evals.yml -f suite=agent -f set=dev -f model=fallback');
  });

  it('fails clearly when gh prints no run id, and never looks for the latest run', () => {
    const r = run(['resolve'], { STUB_NO_URL: '1' });
    expect(r.code).toBe(4);
    expect(r.err).toMatch(/no run id/i);
    expect(r.calls.some((c) => c.startsWith('run '))).toBe(false);
  });

  it('waits until the run is completed', () => {
    const r = run(['resolve'], {
      STUB_STATES: 'queued:,in_progress:,in_progress:,completed:success',
    });
    expect(r.code).toBe(0);
    expect(r.calls.filter((c) => c.startsWith('view 1001'))).toHaveLength(4);
  });

  it('exits non-zero and prints the conclusion when the run fails', () => {
    const r = run(['resolve'], { STUB_STATES: 'in_progress:,completed:failure' });
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/resolve: failure/);
  });

  it('gives up after MAX_WAIT_SECS instead of polling forever', () => {
    const r = run(['resolve'], { STUB_STATES: 'in_progress:', MAX_WAIT_SECS: '0' });
    expect(r.code).toBe(5);
    expect(r.err).toMatch(/still running/i);
  });

  it('runs two evals one after another, never in parallel', () => {
    const r = run(['resolve', 'agent:dev:fallback'], {
      STUB_STATES: 'in_progress:,completed:success',
    });
    expect(r.code).toBe(0);
    const order = r.calls.filter((c) => /^(dispatch|view) /.test(c));
    expect(order).toEqual([
      'dispatch 1',
      'view 1001 in_progress:',
      'view 1001 completed:success',
      'dispatch 2',
      'view 1002 in_progress:',
      'view 1002 completed:success',
    ]);
  });

  it('stops the list at the first failure so a spent quota is not hit again', () => {
    const r = run(['resolve', 'agent'], { STUB_STATES: 'completed:failure' });
    expect(r.code).toBe(1);
    expect(r.calls.filter((c) => c === 'dispatch 2')).toHaveLength(0);
    expect(r.err).toMatch(/not starting the rest/i);
  });

  it('refuses the hand-run set and an unknown suite without calling gh', () => {
    for (const bad of ['agent:holdout', 'agent:holdout:fallback', 'nonsense']) {
      const r = run([bad]);
      expect(r.code).toBe(2);
      expect(r.calls).toHaveLength(0);
    }
  });

  it('prints usage with no arguments', () => {
    const r = run([]);
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/usage/i);
  });
});
