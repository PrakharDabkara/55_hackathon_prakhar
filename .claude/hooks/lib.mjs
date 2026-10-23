// Shared helpers for the Claude Code hooks. Plain Node, no dependencies, so they run anywhere.
// A PreToolUse hook gets the tool call as JSON on stdin; exit 2 blocks it and stderr is shown to
// Claude as the reason. Any other exit code lets the call through.
import { spawnSync } from 'node:child_process';

export function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => (data += chunk));
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', () => resolve(data));
  });
}

/** Parsed hook input, or null when stdin is not a JSON object. */
export async function readInput() {
  try {
    const parsed = JSON.parse(await readStdin());
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/** Refuses the tool call: the message goes to Claude on stderr, exit code 2. */
export function block(hook, message) {
  process.stderr.write(`Blocked by ${hook}: ${message}\n`);
  process.exit(2);
}

/** Current branch of the repo at `dir` ('' when detached, not a repo, or git is missing). */
export function currentBranch(dir) {
  const r = spawnSync('git', ['branch', '--show-current'], { cwd: dir, encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : '';
}

/**
 * Splits a shell command into simple commands, each a list of words. Quotes and backslashes are
 * honoured, so text inside "..." stays one word and `;` or `&&` inside it does not split. This is a
 * best-effort reading of the command, not a shell: $(...) and variables are not expanded.
 */
export function parseCommand(command) {
  const commands = [];
  let words = [];
  let word = '';
  let inWord = false;
  let quote = null;
  const endWord = () => {
    if (inWord) words.push(word);
    word = '';
    inWord = false;
  };
  const endCommand = () => {
    endWord();
    if (words.length > 0) commands.push(words);
    words = [];
  };
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (quote) {
      if (c === quote) quote = null;
      else if (c === '\\' && quote === '"' && i + 1 < command.length) word += command[++i];
      else word += c;
    } else if (c === "'" || c === '"') {
      quote = c;
      inWord = true;
    } else if (c === '\\' && i + 1 < command.length) {
      word += command[++i];
      inWord = true;
    } else if (c === ';' || c === '|' || c === '&' || c === '\n' || c === '(' || c === ')') {
      endCommand();
    } else if (c === ' ' || c === '\t') {
      endWord();
    } else {
      word += c;
      inWord = true;
    }
  }
  endCommand();
  return commands;
}
