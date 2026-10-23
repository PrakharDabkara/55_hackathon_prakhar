// Every project subagent must load: a name that matches its file, a description that says when to use
// it, and an explicit tool list that never includes Edit or Write (our agents are read-only).
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const agentsDir = fileURLToPath(new URL('.', import.meta.url));
const files = readdirSync(agentsDir).filter((f) => f.endsWith('.md'));

/** The tiny YAML subset we use: single-line `key: value`. */
function frontmatter(text: string): Record<string, string> {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!m) throw new Error('no frontmatter block');
  const out: Record<string, string> = {};
  for (const line of (m[1] ?? '').split('\n')) {
    const kv = /^([a-z][a-z-]*):\s*(.*)$/.exec(line);
    const key = kv?.[1];
    if (!kv || !key) throw new Error(`cannot parse frontmatter line: ${line}`);
    out[key] = (kv[2] ?? '').trim();
  }
  return out;
}

describe('project subagents', () => {
  it('has the expected agents', () => {
    expect([...files].sort()).toEqual([
      'eval-analyst.md',
      'flake-hunter.md',
      'security-reviewer.md',
    ]);
  });

  for (const file of files) {
    describe(file, () => {
      const text = readFileSync(join(agentsDir, file), 'utf8');
      const fm = frontmatter(text);
      const tools = (fm['tools'] ?? '')
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);

      it('name matches the file', () => {
        expect(fm['name']).toBe(file.replace(/\.md$/, ''));
      });

      it('has a description', () => {
        expect((fm['description'] ?? '').length).toBeGreaterThan(40);
      });

      it('lists its tools, never Edit, Write or NotebookEdit', () => {
        expect(tools.length).toBeGreaterThan(0);
        for (const banned of ['Edit', 'Write', 'NotebookEdit']) expect(tools).not.toContain(banned);
      });

      it('has a body after the frontmatter', () => {
        expect(text.replace(/^---\n[\s\S]*?\n---\n/, '').trim().length).toBeGreaterThan(200);
      });
    });
  }
});
