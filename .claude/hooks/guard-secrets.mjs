// PreToolUse (Read|Grep|Glob|Edit|Write|Bash): keeps Claude out of .env files and the holdout eval.
// File tools are checked by path fields only (so writing about the word is fine); Bash is checked
// by command text, which is a best-effort layer: `cat $(echo .e)nv` gets past it. The deny rules in
// .claude/settings.json are the second layer.
import { block, readInput } from './lib.mjs';

const HOOK = 'guard-secrets';
const PATH_FIELDS = ['file_path', 'path', 'pattern', 'glob', 'notebook_path'];

// `.env` at the start of a word or after a path separator, quote or `=`, plus whatever follows it
// in the same word (`.env.local`, `.env*`). Only `.env.example` is allowed.
const ENV_REF = /(?:^|[\s/\\'"=:`(<>])(\.env[^\s'"`;&|)<>]*)/g;

function mentionsEnv(text) {
  for (const m of text.matchAll(ENV_REF)) {
    if (m[1] !== '.env.example') return true;
  }
  return false;
}

const mentionsHoldout = (text) => /holdout/i.test(text);

const input = await readInput();
if (!input) block(HOOK, 'could not read the hook input, so the call is refused to be safe.');

const { tool_name: tool, tool_input: args = {} } = input;
const texts =
  tool === 'Bash'
    ? [String(args.command ?? '')]
    : ['Read', 'Grep', 'Glob', 'Edit', 'Write'].includes(tool)
      ? PATH_FIELDS.map((f) => args[f]).filter((v) => typeof v === 'string')
      : [];

for (const text of texts) {
  if (mentionsEnv(text)) {
    block(
      HOOK,
      'this touches a .env file. Secrets stay out of the session. Read .env.example for the names ' +
        'of the settings; if a real value is needed, ask the user.',
    );
  }
  if (mentionsHoldout(text)) {
    block(
      HOOK,
      'this touches a holdout eval file. The holdout is run by hand by the user and never read or ' +
        'tuned against. Use the dev set instead.',
    );
  }
}
process.exit(0);
