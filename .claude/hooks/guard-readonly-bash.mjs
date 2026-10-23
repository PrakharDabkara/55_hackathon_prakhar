// PreToolUse (Bash), attached to the security-reviewer and eval-analyst subagents through their
// frontmatter `hooks`, so it runs only while one of them does. The `tools` field can only allow or
// deny Bash as a whole; this narrows it to read-only commands: git diff|log|show|status and
// gh pr diff|view (plus gh run view|download with --allow-run). Everything else is refused,
// including chained commands, redirects and substitutions. Allowlist, not blocklist.
import { block, parseCommand, readInput } from './lib.mjs';

const HOOK = 'guard-readonly-bash';
const allowRun = process.argv.includes('--allow-run');

const input = await readInput();
if (!input) block(HOOK, 'could not read the hook input, so the call is refused to be safe.');
if (input.tool_name !== 'Bash') process.exit(0);

const command = String(input.tool_input?.command ?? '');
const fail = (message) =>
  block(
    HOOK,
    `${message} This agent may only run: git diff|log|show|status, gh pr diff|view` +
      `${allowRun ? ', gh run view|download' : ''}.`,
  );

// Redirects, substitutions and expansions can write files or run something the parser cannot see.
if (/[><`$]/.test(command)) fail('redirects, substitutions and variables are not allowed.');

const GIT = new Set(['diff', 'log', 'show', 'status']);
// Flags that write a file or run a configured external program.
const UNSAFE_GIT_FLAG = /^--(output|ext-diff|textconv|open-files-in-pager|exec)(=|$)/;
// Plain filters for a pipe stage; flags and numbers only, so they cannot read a named file.
const FILTERS = new Set(['head', 'tail', 'wc', 'sort', 'uniq']);

function checkGit(words) {
  let i = 1;
  for (; i < words.length && words[i].startsWith('-'); i++) {
    if (words[i] === '--no-pager' || words[i] === '-P') continue;
    if (words[i] === '-C') {
      i++;
      continue;
    }
    fail(`git option ${words[i]} is not allowed.`);
  }
  const sub = words[i];
  if (!sub || !GIT.has(sub))
    fail(`git ${sub ?? ''} is not a read-only command.`.replace('  ', ' '));
  for (const w of words.slice(i + 1)) {
    if (UNSAFE_GIT_FLAG.test(w)) fail(`git flag ${w} writes a file or runs a program.`);
  }
}

function checkGh(words) {
  const [, group, action] = words;
  const ok =
    (group === 'pr' && (action === 'diff' || action === 'view')) ||
    (allowRun && group === 'run' && (action === 'view' || action === 'download'));
  if (!ok) fail(`gh ${group ?? ''} ${action ?? ''} is not a read-only command.`);
  if (words.some((w) => w === '--web' || w === '-w')) fail('opening a browser is not allowed.');
}

function checkFilter(words) {
  if (!words.slice(1).every((w) => w.startsWith('-') || /^\d+$/.test(w))) {
    fail(`${words[0]} may only filter piped output, not read files.`);
  }
}

const commands = parseCommand(command);
if (commands.length === 0) fail('empty command.');
for (const words of commands) {
  const head = words[0];
  if (head === 'git') checkGit(words);
  else if (head === 'gh') checkGh(words);
  else if (FILTERS.has(head)) checkFilter(words);
  else fail(`${head} is not allowed.`);
}
