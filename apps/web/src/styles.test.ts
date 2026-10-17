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

  it('lays link-buttons out as blocks, so a link under a button cannot overlap it', () => {
    expect(css).toMatch(/a\.btn\s*\{[^}]*display:\s*(?:inline-)?flex/);
    expect(css).toMatch(/\.screen-links\s*\{[^}]*margin-top/);
  });
});

describe('styles.css: the errand header at phone width', () => {
  it('puts the status chip under the title at 420 px and below, so a long chip cannot squeeze the title', () => {
    const phone = /@media\s*\(max-width:\s*420px\)\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';
    expect(phone).toMatch(/\.errand-head\s*\{[^}]*flex-direction:\s*column/);
    expect(css).toMatch(/\.errand-head\s*\{[^}]*display:\s*flex/);
  });
});
