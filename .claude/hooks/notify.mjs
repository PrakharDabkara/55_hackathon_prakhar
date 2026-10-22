// Notification + Stop: a desktop notification when Claude Code needs the user or has finished.
// Uses notify-send when it exists and does nothing otherwise. Always exit 0.
import { spawnSync } from 'node:child_process';
import { basename } from 'node:path';
import { readInput } from './lib.mjs';

const input = (await readInput()) ?? {};
const project = basename(input.cwd || process.cwd());
const body =
  input.hook_event_name === 'Stop'
    ? 'Finished. Ready for your next message.'
    : String(input.message || 'Needs your attention.').slice(0, 200);

spawnSync('notify-send', ['--app-name=Claude Code', '--', `Claude Code · ${project}`, body], {
  stdio: 'ignore',
  timeout: 3000,
});
process.exit(0);
