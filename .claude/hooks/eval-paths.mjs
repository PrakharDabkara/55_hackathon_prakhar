// Which routes lead to the holdout eval cases, decided by PATH, not by the word alone. Pure
// functions (no process.exit) so hooks.test.ts can drive them; guard-secrets.mjs calls them.
//
// What is protected: a DATA file (json, jsonl, csv, ...) whose name has "holdout", or any file
// (but source code and docs) under a directory with "holdout" in its name, and a generated eval
// report (JSON in a reports folder) whose `set` is a holdout set. Code that merely carries
// the word in its name (a holdoutGate.ts) or in its text (set == 'holdout') is not data and stays
// editable.
//
// Best effort, like the Bash layer of guard-secrets: a script that builds the file name at run time
// gets past it. The deny rules in .claude/settings.json and CLAUDE.md are the other layers.
import {
  closeSync,
  existsSync,
  openSync,
  readdirSync,
  readSync,
  realpathSync,
  statSync,
} from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { parseCommand } from './lib.mjs';

const WORD = /holdout/i;
const DATA_EXT = /\.(jsonl?|ndjson|csv|tsv|txt|parquet|sqlite|db)$/i;
const CODE_EXT = /\.(m?[jt]sx?|c[jt]s|md|ya?ml|html?|css|sh|py|toml)$/i;

/** Is this path (not read, only looked at) a holdout data file or inside a holdout directory? */
export function isProtectedPath(p) {
  const segments = p.split(/[\\/]+/).filter(Boolean);
  const base = segments.at(-1) ?? '';
  if (segments.slice(0, -1).some((s) => WORD.test(s))) return !CODE_EXT.test(base);
  return WORD.test(base) && (DATA_EXT.test(base) || !/\.[A-Za-z0-9]+$/.test(base));
}

/** The path as it really is: relative to `cwd`, `~` expanded, symlinks followed when it exists. */
export function resolveFrom(cwd, p) {
  const expanded = p === '~' || p.startsWith('~/') ? path.join(homedir(), p.slice(1)) : p;
  const abs = path.resolve(cwd, expanded);
  try {
    return realpathSync(abs);
  } catch {
    return abs;
  }
}

/** Protected as written, or protected once symlinks are followed. */
const protectedHit = (abs, original) =>
  isProtectedPath(abs) || isProtectedPath(original) || isHoldoutReport(abs);

/**
 * A generated eval report from a holdout run, whatever the file is now called. Reports list every
 * case (`cases`, `wrong`, `results`, with the query or task text), and the runners write the set
 * name as the first key, so the first 2 kB of a .json file in a reports folder says which set it
 * is. The hook reads that head to decide; nothing of it is printed. Summaries (.md) hold only
 * aggregate numbers, and a report with no `set` (written before reports carried one) is not held back.
 */
export function isHoldoutReport(abs) {
  const folders = abs.split(/[\\/]+/).slice(0, -1);
  if (!/\.json$/i.test(abs) || !folders.some((s) => /report/i.test(s))) return false;
  let fd;
  try {
    fd = openSync(abs, 'r');
    const buf = Buffer.alloc(2048);
    const head = buf.toString('utf8', 0, readSync(fd, buf, 0, 2048, 0));
    return /"set"\s*:\s*"[^"]*holdout/i.test(head);
  } catch {
    return false;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.cache', 'coverage']);

/** Every protected file under `dir` (absolute paths). Skips dependency and build folders. */
export function protectedUnder(dir, limit = 20000) {
  const found = [];
  let seen = 0;
  const walk = (d) => {
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (++seen > limit) return;
      const full = path.join(d, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) walk(full);
      } else if (isProtectedPath(full) || isHoldoutReport(full)) found.push(full);
    }
  };
  walk(dir);
  return found;
}

/** A glob (`*.{ts,tsx}`, `**`, `?`, `[ab]`) as a RegExp over a whole name or relative path. */
export function globToRegExp(glob) {
  let re = '';
  let braces = 0;
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        i++;
        if (glob[i + 1] === '/') {
          i++;
          re += '(?:.*/)?';
        } else re += '.*';
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else if (c === '[') {
      const end = glob.indexOf(']', i + 1);
      if (end > i) {
        re += `[${glob.slice(i + 1, end).replace(/^!/, '^')}]`;
        i = end;
      } else re += '\\[';
    } else if (c === '{') {
      braces++;
      re += '(?:';
    } else if (c === '}' && braces > 0) {
      braces--;
      re += ')';
    } else if (c === ',' && braces > 0) re += '|';
    else re += c.replace(/[.+^$()|\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`, 'i');
}

/** Does a ripgrep-style glob (no slash: by file name at any depth) match this file under `root`? */
function globMatches(glob, file, root) {
  const rel = path.relative(root, file).split(path.sep).join('/');
  const target = glob.includes('/') ? rel : path.basename(file);
  return globToRegExp(glob.replace(/^\.?\//, '')).test(target);
}

const TYPE_EXT = {
  ts: ['ts', 'tsx', 'mts', 'cts'],
  js: ['js', 'jsx', 'mjs', 'cjs'],
  json: ['json', 'jsonl', 'ndjson'],
  md: ['md', 'markdown'],
  yaml: ['yaml', 'yml'],
  py: ['py'],
  sh: ['sh', 'bash'],
  css: ['css'],
  html: ['html', 'htm'],
  csv: ['csv'],
  txt: ['txt'],
};
const typeAllows = (type, file) => {
  const exts = TYPE_EXT[type];
  return !exts || exts.includes(path.extname(file).slice(1).toLowerCase());
};

/**
 * The protected files under `dir` that a search with these filters would still look at.
 * `include` / `exclude` are globs (a leading "!" in `include` means exclude), `type` an rg type.
 */
export function searchedProtected(dir, { include = [], exclude = [], type } = {}) {
  const inc = include.filter((g) => !g.startsWith('!'));
  const exc = [...exclude, ...include.filter((g) => g.startsWith('!')).map((g) => g.slice(1))];
  return protectedUnder(dir).filter((file) => {
    if (type && !typeAllows(type, file)) return false;
    if (inc.length > 0 && !inc.some((g) => globMatches(g, file, dir))) return false;
    return !exc.some((g) => globMatches(g, file, dir));
  });
}

const advice =
  'The holdout eval is run by hand by the user and never read or tuned against. Use the dev set ' +
  'instead; for a search, narrow it to a path or glob that leaves the holdout files out.';

const isDirectory = (abs) => {
  try {
    return existsSync(abs) && statSync(abs).isDirectory();
  } catch {
    return false;
  }
};

// ---------------------------------------------------------------------------------------------
// File tools: Read, Edit, Write, NotebookEdit, Grep, Glob
// ---------------------------------------------------------------------------------------------

/** The reason to refuse a file-tool call, or null. */
export function checkFileTool(tool, args, cwd) {
  const str = (v) => (typeof v === 'string' && v !== '' ? v : null);
  if (tool === 'Read' || tool === 'Edit' || tool === 'Write' || tool === 'NotebookEdit') {
    for (const field of ['file_path', 'notebook_path', 'path']) {
      const p = str(args[field]);
      if (p && protectedHit(resolveFrom(cwd, p), p))
        return `this touches a holdout data file (${path.basename(p)}). ${advice}`;
    }
    return null;
  }
  if (tool === 'Grep') {
    const given = str(args.path);
    const abs = given ? resolveFrom(cwd, given) : cwd;
    if (protectedHit(abs, given ?? '')) return `this searches holdout data (${given}). ${advice}`;
    if (isDirectory(abs)) {
      const include = (str(args.glob) ?? '').split(/[\s,]+(?![^{]*})/).filter(Boolean);
      const type = str(args.type);
      const hits = searchedProtected(abs, { include, ...(type && { type }) });
      if (hits.length > 0)
        return `this search would read holdout data (${path.relative(abs, hits[0])}). ${advice}`;
    }
    return null;
  }
  // Glob lists file names, never their contents, and the names are public (docs, CLAUDE.md).
  return null;
}

// ---------------------------------------------------------------------------------------------
// Bash
// ---------------------------------------------------------------------------------------------

/** Programs that never show a file's content, so naming a protected path to them is harmless. */
const NON_READING = new Set([
  'ls',
  'stat',
  'file',
  'wc',
  'du',
  'realpath',
  'readlink',
  'basename',
  'dirname',
  'test',
  '[',
  '[[',
  'touch',
  'rm',
  'mkdir',
  'chmod',
  'echo',
  'printf',
  'true',
  'false',
  'pwd',
  'tree',
]);
const PATTERN_FIRST = new Set(['grep', 'egrep', 'fgrep', 'rg', 'ag', 'ack']);
const GIT_READS = new Set([
  'show',
  'cat-file',
  'grep',
  'diff',
  'log',
  'blame',
  'archive',
  'checkout',
  'restore',
  'stash',
  'difftool',
  'format-patch',
  'diff-tree',
  'show-branch',
  'bundle',
  'annotate',
  'whatchanged',
]);
const WRAPPERS = new Set(['sudo', 'env', 'command', 'exec', 'nice', 'nohup', 'time', 'builtin']);
const GLOB_CHARS = /[*?[{]/;

/** A word with glob characters, expanded against the file system relative to `cwd`. */
function expandGlob(cwd, word) {
  if (!GLOB_CHARS.test(word)) return [word];
  const abs = path.isAbsolute(word) ? word : path.join(cwd, word);
  let current = ['/'];
  for (const seg of abs.split('/').filter(Boolean)) {
    const next = [];
    for (const base of current) {
      if (!GLOB_CHARS.test(seg)) {
        next.push(path.join(base, seg));
        continue;
      }
      let names = [];
      try {
        names = readdirSync(base);
      } catch {
        continue;
      }
      const re = globToRegExp(seg);
      for (const n of names)
        if (re.test(n) && (seg.startsWith('.') || !n.startsWith('.')))
          next.push(path.join(base, n));
    }
    current = next;
    if (current.length > 5000) break;
  }
  return current;
}

/** `$NAME` and `${NAME}` replaced by the NAME=value words seen earlier in the same command. */
const substitute = (word, vars) =>
  word.replace(/\$\{(\w+)\}|\$(\w+)/g, (m, a, b) => vars.get(a ?? b) ?? m);

/** Does this command read every file under a directory it is given? */
function readsRecursively(program, args, sub) {
  if (program === 'git') return sub === 'grep' || sub === 'archive';
  if (program === 'grep' || program === 'egrep' || program === 'fgrep')
    return args.some((a) => /^-[A-Za-z]*[rR]/.test(a) || /^--(dereference-)?recursive$/.test(a));
  if (program === 'cp' || program === 'rsync')
    return args.some((a) => /^-[A-Za-z]*[rRa]/.test(a) || a === '--recursive' || a === '--archive');
  if (program === 'find')
    return args.some((a) => /^-(exec|execdir|ok|okdir|fprint0?|fprintf|fls)$/.test(a));
  return ['rg', 'ag', 'ack', 'tar', 'zip', '7z'].includes(program);
}

/** The reason to refuse a Bash command, or null. */
export function checkBash(command, cwd) {
  // Running the holdout set is the user's job, whatever tool starts it.
  if (/(?:EVAL_SET|\bset|--set)(?:=|\s+)['"]?[\w,.:-]*holdout/i.test(command))
    return `this would run the holdout eval. ${advice}`;
  // A holdout data file named in the text, also inside a script or a heredoc.
  if (/[\w.*?{},-]*holdout[\w.*?{},-]*\.(?:jsonl?|ndjson|csv|tsv|txt)\b/i.test(command))
    return `this names a holdout data file. ${advice}`;

  // Names handed on to a command we cannot see (xargs, a read loop, $(...), `...`, <(...)).
  const hidden = /\bxargs\b|\bread\b|\$\(|`|<\(/.test(command);
  const vars = new Map();
  let dir = cwd;
  for (const words of parseCommand(command)) {
    while (words.length > 0 && /^[A-Za-z_]\w*=/.test(words[0])) {
      const [name, ...rest] = words.shift().split('=');
      vars.set(name, substitute(rest.join('='), vars));
    }
    if (words.length === 0) continue;
    const tokens = words.map((w) => substitute(w, vars));
    let at = 0;
    while (at < tokens.length && WRAPPERS.has(path.basename(tokens[at]))) at++;
    const program = path.basename(tokens[at] ?? '');
    let args = tokens.slice(at + 1);
    if (program === 'cd') {
      if (args[0]) dir = resolveFrom(dir, args[0]);
      continue;
    }

    let sub;
    if (program === 'git') {
      const i = args.findIndex((a) => !a.startsWith('-'));
      sub = args[i];
      if (!GIT_READS.has(sub ?? '')) continue; // add, commit, status, push, ls-files ...
      args = args.filter((_, j) => j !== i);
    }

    // Every word that can be a path: not an option, or the value of --opt=value, or the path
    // after the colon of rev:path.
    const candidates = [];
    for (const a of args) {
      const eq = a.startsWith('-') ? a.indexOf('=') : -1;
      if (a.startsWith('-') && eq < 0) continue;
      const value = eq > 0 ? a.slice(eq + 1) : a;
      candidates.push(value);
      if (program === 'git' && value.includes(':') && !value.startsWith(':'))
        candidates.push(value.slice(value.indexOf(':') + 1));
    }

    const recursive = readsRecursively(program, args, sub);
    // Filters that keep a recursive search away from the protected files.
    const include = [];
    const exclude = [];
    let type;
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      const next = args[i + 1];
      if ((a === '-g' || a === '--glob' || a === '--iglob') && next) include.push(next);
      else if (/^--i?glob=/.test(a)) include.push(a.slice(a.indexOf('=') + 1));
      else if ((a === '-t' || a === '--type') && next) type = next;
      else if (a.startsWith('--type=')) type = a.slice(7);
      else if (a.startsWith('--include=')) include.push(a.slice(10));
      else if (/^--exclude(-dir)?=/.test(a)) exclude.push(a.slice(a.indexOf('=') + 1));
    }

    // Where a recursive search looks: the paths it was given, else the working directory.
    const patternFirst =
      (PATTERN_FIRST.has(program) || sub === 'grep') &&
      !args.some((a) => a === '-e' || a === '--regexp' || a === '-f' || a === '--file');
    let roots = patternFirst ? candidates.slice(1) : [...candidates];
    if (recursive && roots.length === 0) roots = ['.'];

    for (const word of candidates) {
      for (const hit of expandGlob(dir, word)) {
        if (!protectedHit(resolveFrom(dir, hit), hit)) continue;
        if (NON_READING.has(program) && !hidden) continue;
        return `this reads a holdout data file (${path.basename(hit)}). ${advice}`;
      }
    }
    if (recursive) {
      for (const word of roots) {
        for (const hit of expandGlob(dir, word)) {
          const abs = resolveFrom(dir, hit);
          if (!isDirectory(abs)) continue;
          const hits = searchedProtected(abs, {
            include,
            exclude,
            ...(type && { type }),
          });
          if (hits.length > 0)
            return `this reads every file under ${path.relative(dir, abs) || '.'}, holdout data included. ${advice}`;
        }
      }
    }
  }
  return null;
}
