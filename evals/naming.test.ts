import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The product is AskBuy (ADR-0051). The old name may survive only where renaming would break
// running users, data or deployment; docs/naming.md explains each case. Anything else fails here.
const root = fileURLToPath(new URL('..', import.meta.url));
const OLD_NAME = /kahan[\s_-]?milega/i;

// Files that are the record or that explain the rename.
const RECORD_FILES = [/^docs\/adr\//, /^docs\/journey\//, /^CHANGELOG\.md$/, /^docs\/naming\.md$/];
const THIS_FILE = 'evals/naming.test.ts';

// Lines that keep the old name on purpose.
const KEPT_LINES: RegExp[] = [
  /kahanmilega-api/, // Render service and its URL
  /kahanmilega-redis/, // Render Redis
  /kahanmilega:events/, // Redis pub/sub channel: renaming drops live events during a deploy
  /kahanmilega-evals/, // self-hosted runner eval cache: renaming forces a full re-embed
  /kahanmilega_(pgdata|redisdata)/, // existing local Docker volumes
  /POSTGRES_(USER|PASSWORD|DB)[:=]\s*kahanmilega/, // database and role names
  /DATABASE_URL.*kahanmilega/,
  /KAHANMILEGA_(API_URL|TOKEN_FILE)/, // old MCP env names, still read as a fallback
  /\.kahanmilega-login\.json/, // old MCP login file, migrated on first run
  /^\s*kahanmilega\/\s*$/, // BRIEF.md folder tree: the real local folder name
  /Hackathon_2026_55\/kahanmilega/, // the local folder path
  /github\.com\/[^/\s]+\/kahanmilega/, // the repository URL
];

const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
  .split('\0')
  .filter(Boolean)
  .filter((f) => f !== THIS_FILE && f !== 'package-lock.json')
  .filter((f) => !/\.(png|jpg|jpeg|webp|ico|woff2?)$/i.test(f))
  .filter((f) => !RECORD_FILES.some((re) => re.test(f)));

describe('the old product name', () => {
  it('survives only on the deliberate keep list', () => {
    const stray: string[] = [];
    for (const file of tracked) {
      readFileSync(`${root}/${file}`, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (!OLD_NAME.test(line)) return;
          if (KEPT_LINES.some((re) => re.test(line))) return;
          stray.push(`${file}:${i + 1}: ${line.trim().slice(0, 100)}`);
        });
    }
    expect(stray).toEqual([]);
  });

  it('is gone from every package name and workspace import', () => {
    const lock = readFileSync(`${root}/package-lock.json`, 'utf8');
    expect(lock).not.toMatch(/@kahanmilega\//);
  });
});
