import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const dir = new URL('../.github/workflows/', import.meta.url);
const files = readdirSync(dir).filter((f) => /\.ya?ml$/.test(f));

// ADR-0060: a tag can be moved to other code; a commit SHA cannot. Every action is pinned to one,
// with its version in a comment so Dependabot-style updates stay readable.
describe('GitHub Actions are pinned to commit SHAs', () => {
  it.each(files)('%s: every `uses:` is owner/repo@<40 hex> # vN', (file) => {
    const uses = readFileSync(new URL(file, dir), 'utf8')
      .split('\n')
      .filter((line) => /^\s*(-\s+)?uses:/.test(line));
    expect(uses.length).toBeGreaterThan(0);
    for (const line of uses)
      expect(line, line).toMatch(/uses:\s+[\w.-]+\/[\w./-]+@[0-9a-f]{40}\s+#\s+v\d+/);
  });

  it('there are workflow files to check', () => {
    expect(files).toEqual(expect.arrayContaining(['ci.yml', 'evals.yml']));
  });
});
