// SessionStart: three lines of context so a session knows where it stands before it acts.
// Branch and uncommitted files, open PRs, and whether a GitHub Actions run is in progress (the
// runner is busy). The gh calls run together and are capped (4.5 s by default); offline is fine.
import { spawn, spawnSync } from 'node:child_process';
import { currentBranch, readInput } from './lib.mjs';

const input = (await readInput()) ?? {};
const cwd = input.cwd || process.cwd();
const limitMs = Number(process.env.SESSION_STATUS_TIMEOUT_MS) || 4500;

/** Runs gh and resolves to its parsed JSON, or null on any failure or when the time is up. */
function gh(args) {
  return new Promise((resolve) => {
    let out = '';
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(value);
    };
    const child = spawn('gh', args, { cwd, stdio: ['ignore', 'pipe', 'ignore'], detached: true });
    const timer = setTimeout(() => {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        // already gone
      }
      finish(null);
    }, limitMs);
    child.stdout.on('data', (chunk) => (out += chunk));
    child.on('error', () => finish(null));
    child.on('close', (code) => {
      try {
        finish(code === 0 ? JSON.parse(out) : null);
      } catch {
        finish(null);
      }
    });
  });
}

const [prs, running, queued] = await Promise.all([
  gh(['pr', 'list', '--state', 'open', '--json', 'number', '--limit', '100']),
  gh(['run', 'list', '--status', 'in_progress', '--json', 'databaseId', '--limit', '50']),
  gh(['run', 'list', '--status', 'queued', '--json', 'databaseId', '--limit', '50']),
]);

const branch = currentBranch(cwd);
const status = spawnSync('git', ['status', '--porcelain'], { cwd, encoding: 'utf8' });
const dirty = status.status === 0 ? status.stdout.split('\n').filter(Boolean).length : 0;

const lines = [];
if (!branch) {
  lines.push('Branch: none (detached HEAD or not a git repo).');
} else {
  const warn = branch === 'main' ? ' (on main: switch to a branch before committing)' : '';
  lines.push(
    `Branch: ${branch}${warn}, ${dirty} uncommitted file${dirty === 1 ? '' : 's'}. ` +
      'Check it has not changed under you before you commit.',
  );
}
lines.push(Array.isArray(prs) ? `Open PRs: ${prs.length}.` : 'Open PRs: unknown (gh offline).');
if (Array.isArray(running) && Array.isArray(queued)) {
  const detail = `${running.length} running, ${queued.length} queued`;
  lines.push(
    running.length + queued.length > 0
      ? `GitHub Actions: runner busy (${detail}).`
      : 'GitHub Actions: runner idle.',
  );
} else {
  lines.push('GitHub Actions: unknown (gh offline).');
}
process.stdout.write(lines.join('\n') + '\n');
process.exit(0);
