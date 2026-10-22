import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// CLAUDE.md: errors say what to do, and a screen reader hears them. An error line (the sh-alert and
// sh-error classes) is a live region the moment it appears, so each one carries role="alert".
const src = fileURLToPath(new URL('.', import.meta.url));

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx$/.test(path) && !/\.test\.tsx$/.test(path) ? [path] : [];
  });
}

describe('error lines', () => {
  it('are live regions (role="alert") wherever they are drawn', () => {
    const missing: string[] = [];
    for (const path of sources(src)) {
      const text = readFileSync(path, 'utf8');
      for (const tag of text.matchAll(
        /<(?:p|div|span)\b[^>]*className=(["'`{])[^>]*\bsh-(?:alert|error)\b[^>]*>/g,
      ))
        if (!/role=["'](?:alert|status)["']/.test(tag[0]))
          missing.push(`${path.replace(src, 'src/')}: ${tag[0]}`);
    }
    expect(missing).toEqual([]);
  });
});
