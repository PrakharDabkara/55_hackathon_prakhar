// PreToolUse (Bash): main deploys to production, so nothing is pushed to it and nothing is committed
// on it, and git's own safety hooks are never skipped. Reads the command with a small quote-aware
// parser, so words inside a commit message do not count. Best-effort: `eval`, variables and
// $(...) are not expanded.
import { resolve } from 'node:path';
import { block, currentBranch, parseCommand, readInput } from './lib.mjs';

const HOOK = 'guard-git';
const PROTECTED = ['main', 'master'];

const input = await readInput();
if (!input) block(HOOK, 'could not read the hook input, so the call is refused to be safe.');
if (input.tool_name !== 'Bash') process.exit(0);

const cwd = input.cwd || process.cwd();
const fail = (message) => block(HOOK, message);

const pullRequestHint =
  'main deploys to production, so every change goes through a pull request: put the work on a ' +
  'branch (git switch -c fix/short-name), push that branch, then open a PR.';

/** The part of a refspec after the colon, without `+` and `refs/heads/`. */
function destination(refspec) {
  const dest = refspec.includes(':') ? refspec.slice(refspec.lastIndexOf(':') + 1) : refspec;
  return dest.replace(/^\+/, '').replace(/^refs\/heads\//, '');
}

function checkSimple(words, state) {
  if (words[0] === 'sudo' || words[0] === 'command' || words[0] === 'time') words = words.slice(1);
  // bash -c "git push origin main": look inside the string.
  if (/^(ba|z|da)?sh$/.test(words[0] ?? '')) {
    const i = words.indexOf('-c');
    if (i !== -1 && words[i + 1]) checkCommand(words[i + 1], state);
    return;
  }
  if (words[0] !== 'git') return;

  // Skip git's own options (-C dir, -c k=v, --no-pager) to find the subcommand.
  let dir = cwd;
  let i = 1;
  for (; i < words.length && words[i].startsWith('-'); i++) {
    if (words[i] === '-C') dir = resolve(dir, words[++i] ?? '.');
    else if (words[i] === '-c') i++;
  }
  const sub = words[i];
  const rest = words.slice(i + 1);

  if (rest.includes('--no-verify') || (sub === 'commit' && rest.includes('-n'))) {
    fail(
      '--no-verify skips the git hooks that protect main. Fix whatever the hook complains about ' +
        'instead. If it is stuck, stop and tell the user.',
    );
  }
  if (sub === 'checkout' || sub === 'switch') {
    state.switched = true;
    return;
  }

  const branch = state.switched ? '' : currentBranch(dir);
  if (sub === 'commit' && PROTECTED.includes(branch)) {
    fail(`you are on ${branch}, and nothing is committed there. Run git switch -c <branch> first.`);
  }
  if (sub !== 'push') return;

  if (rest.includes('--all') || rest.includes('--mirror')) {
    fail(`--all and --mirror push every branch, main included. ${pullRequestHint}`);
  }
  const positional = rest.filter((w) => !w.startsWith('-'));
  const refspecs = positional.slice(1); // the first one is the remote
  if (refspecs.length === 0) {
    if (PROTECTED.includes(branch)) fail(`this would push ${branch}. ${pullRequestHint}`);
    return;
  }
  for (const refspec of refspecs) {
    const dest = destination(refspec);
    if (PROTECTED.includes(dest) || (dest === 'HEAD' && PROTECTED.includes(branch))) {
      fail(`this pushes to ${dest === 'HEAD' ? branch : dest}. ${pullRequestHint}`);
    }
  }
}

function checkCommand(command, state) {
  for (const words of parseCommand(command)) checkSimple(words, state);
}

checkCommand(String(input.tool_input?.command ?? ''), { switched: false });
process.exit(0);
