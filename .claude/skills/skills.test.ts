// Every project skill must load: valid frontmatter, a name that matches its folder, a description
// that says when to use it, and (for the UI skill) paths so it only auto-loads for the web app.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const skillsDir = fileURLToPath(new URL('.', import.meta.url));
const folders = readdirSync(skillsDir).filter((f) => statSync(join(skillsDir, f)).isDirectory());

/** The tiny YAML subset we use: `key: value` lines and `key:` followed by `- item` lines. */
function frontmatter(text: string): Record<string, string | string[]> {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!m) throw new Error('no frontmatter block');
  const out: Record<string, string | string[]> = {};
  let list: string[] | null = null;
  for (const line of (m[1] ?? '').split('\n')) {
    const item = /^\s+-\s+(.*)$/.exec(line);
    if (item && list) {
      list.push((item[1] ?? '').trim().replace(/^['"]|['"]$/g, ''));
      continue;
    }
    const kv = /^([a-z][a-z-]*):\s*(.*)$/.exec(line);
    const key = kv?.[1];
    if (!kv || !key) throw new Error(`cannot parse frontmatter line: ${line}`);
    if (kv[2] === '') {
      list = [];
      out[key] = list;
    } else {
      list = null;
      out[key] = (kv[2] ?? '').trim();
    }
  }
  return out;
}

describe('project skills', () => {
  it('has the four skills', () => {
    expect([...folders].sort()).toEqual(['askbuy-adr', 'askbuy-evals', 'askbuy-pr', 'askbuy-ui']);
  });

  for (const folder of folders) {
    describe(folder, () => {
      const text = readFileSync(join(skillsDir, folder, 'SKILL.md'), 'utf8');
      const fm = frontmatter(text);

      it('name matches the folder', () => {
        expect(fm['name']).toBe(folder);
      });

      it('has a description under 1,000 characters that says when to use it', () => {
        const d = fm['description'];
        expect(typeof d).toBe('string');
        expect((d as string).length).toBeGreaterThan(40);
        expect((d as string).length).toBeLessThan(1000);
        expect(d).toMatch(/\buse (when|for|before|after)\b/i);
      });

      it('has a body after the frontmatter', () => {
        expect(text.replace(/^---\n[\s\S]*?\n---\n/, '').trim().length).toBeGreaterThan(200);
      });
    });
  }

  it('askbuy-ui has paths limited to the web app', () => {
    const fm = frontmatter(readFileSync(join(skillsDir, 'askbuy-ui', 'SKILL.md'), 'utf8'));
    expect(Array.isArray(fm['paths'])).toBe(true);
    expect((fm['paths'] as string[]).length).toBeGreaterThan(0);
    for (const p of fm['paths'] as string[]) expect(p.startsWith('apps/web/')).toBe(true);
  });

  it('only askbuy-ui sets paths (the others load on request)', () => {
    for (const folder of folders.filter((f) => f !== 'askbuy-ui')) {
      const fm = frontmatter(readFileSync(join(skillsDir, folder, 'SKILL.md'), 'utf8'));
      expect(fm['paths']).toBeUndefined();
    }
  });
});
