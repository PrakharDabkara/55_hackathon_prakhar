import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// jsdom cannot lay anything out, so these read the rules themselves; the Playwright screenshots
// of the changed screens are the other half of the proof.
const read = (rel: string) => readFileSync(join(process.cwd(), 'apps/web/src', rel), 'utf8');
const ui = read('ui/ui.css');
const screens = read('shop/screens/screens.css');

/** The declarations of the first rule whose selector list is exactly `selector`. */
function rule(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`, 'm').exec(css);
  if (!match) throw new Error(`no rule for ${selector}`);
  return match[1] ?? '';
}

describe('logo previews never overflow (S-03)', () => {
  it('fills the preview circle by position, whatever shape the picture is', () => {
    const img = rule(screens, '.sh-logopick__img');
    expect(img).toMatch(/position:\s*absolute/);
    expect(img).toMatch(/inset:\s*0/);
    expect(img).toMatch(/width:\s*100%/);
    expect(img).toMatch(/height:\s*100%/);
    expect(img).toMatch(/object-fit:\s*cover/);
  });

  it('keeps every logo a clipped square circle', () => {
    const logo = rule(ui, '.sh-logo');
    expect(logo).toMatch(/object-fit:\s*cover/);
    expect(logo).toMatch(/overflow:\s*hidden/);
    expect(logo).toMatch(/aspect-ratio:\s*1/);
  });
});

describe('the "I deliver" row (S-04)', () => {
  const row = rule(ui, '.sh-switch');

  it('has no tap highlight, and room between the label and the edge', () => {
    expect(row).toMatch(/-webkit-tap-highlight-color:\s*transparent/);
    expect(row).toMatch(/padding(?:-inline)?:\s*0 var\(--space-/);
  });

  it('never turns the keyboard outline off', () => {
    expect(row).not.toMatch(/outline:\s*(none|0)/);
    expect(ui).not.toMatch(/\.sh-switch:focus(?:-visible)?\s*\{[^}]*outline:\s*(none|0)/);
    expect(ui).toMatch(/\.km-app :focus-visible\s*\{[^}]*outline:\s*2px solid var\(--focus\)/);
  });
});

describe('a map stays under menus and sheets (X-02)', () => {
  it('is its own stacking context, so Leaflet panes cannot climb over a drawer', () => {
    const map = rule(ui, '.km-app .leaflet-container');
    expect(map).toMatch(/isolation:\s*isolate/);
    expect(map).toMatch(/z-index:\s*0/);
  });
});
