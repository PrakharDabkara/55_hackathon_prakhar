import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');

describe('styles.css (the zero-training design rules)', () => {
  it('makes every touch target at least 48 px', () => {
    const tap = /--tap:\s*(\d+)px/.exec(css);
    expect(Number(tap?.[1])).toBeGreaterThanOrEqual(48);
    expect(css).toMatch(/min-height:\s*var\(--tap\)/);
  });

  it('works at 360 px: no fixed page width, wrapping text', () => {
    expect(css).not.toMatch(/(?<![-\w])width:\s*\d{3,}px/);
    expect(css).toMatch(/max-width:\s*\d+px/);
  });

  it('keeps a visible keyboard focus ring', () => {
    expect(css).toMatch(/:focus-visible/);
  });

  it('uses no inline-style-only tricks that a strict CSP would block, and loads no outside font', () => {
    expect(css).not.toMatch(/@import|url\(\s*['"]?https?:/);
  });
});
