import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// The UI rules in CLAUDE.md that a stylesheet can break, checked where they are written.
const here = fileURLToPath(new URL('.', import.meta.url));
const src = join(here, '..');
const tokens = readFileSync(join(here, 'tokens.css'), 'utf8');

function cssFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return cssFiles(path);
    return path.endsWith('.css') ? [path] : [];
  });
}
const shopCss = cssFiles(join(src, 'shop')).map((path) => ({
  path: path.replace(src, 'src'),
  text: readFileSync(path, 'utf8'),
}));

describe('tokens.css', () => {
  const light = /\.shop-app\s*\{([\s\S]*?)\n\}/.exec(tokens)?.[1] ?? '';
  const dark =
    /prefers-color-scheme:\s*dark\)\s*\{\s*\.shop-app\s*\{([\s\S]*?)\n\s*\}/.exec(tokens)?.[1] ??
    '';
  const names = (block: string) => [...block.matchAll(/(--[\w-]+):/g)].map((m) => m[1]);

  it('has the colour, space, radius and type tokens the rules name', () => {
    for (const name of [
      '--bg',
      '--surface',
      '--surface-sunk',
      '--line',
      '--ink',
      '--ink-muted',
      '--brand',
      '--brand-soft',
      '--on-brand',
      '--marigold',
      '--on-marigold',
      '--paper',
      '--paper-edge',
      '--paper-ink',
      '--paper-ink-muted',
      '--stamp-yes',
      '--stamp-no',
      '--stamp-delivery',
      '--danger',
      '--danger-soft',
      '--focus',
      '--space-1',
      '--space-12',
      '--tap',
      '--r-sm',
      '--r-md',
      '--r-lg',
      '--r-pill',
      '--shadow-slip',
      '--shadow-sheet',
      '--font-ui',
      '--font-hand',
    ])
      expect(names(light), name).toContain(name);
  });

  it('has a dark value for every colour that changes, and the paper stays light', () => {
    for (const name of [
      '--bg',
      '--surface',
      '--ink',
      '--brand',
      '--marigold',
      '--danger',
      '--focus',
    ])
      expect(names(dark), name).toContain(name);
    for (const name of [
      '--paper-ink',
      '--stamp-yes',
      '--stamp-no',
      '--stamp-delivery',
      '--on-marigold',
    ])
      expect(names(dark), name).not.toContain(name);
  });

  it('makes the tap target 48 px', () => {
    expect(/--tap:\s*(\d+)px/.exec(light)?.[1]).toBe('48');
  });
});

describe('the shop stylesheets', () => {
  it('exist', () => expect(shopCss.length).toBeGreaterThan(0));

  it.each(shopCss)('$path: no hex colours, no @import, no outside urls', ({ text }) => {
    expect(text).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(text).not.toMatch(/@import|url\(\s*['"]?https?:/);
  });

  it.each(shopCss)('$path: motion stays at 200 ms or less', ({ text }) => {
    const times = [...text.matchAll(/(?:transition|animation)[^;{]*?(\d*\.?\d+)(ms|s)\b/g)];
    for (const [, amount, unit] of times) {
      const ms = Number(amount) * (unit === 's' ? 1000 : 1);
      // The skeleton shimmer is a loop, not a transition of movement the eye has to wait for.
      if (ms > 200) expect(text).toMatch(/sh-skeleton[\s\S]*?animation:\s*sh-shimmer/);
    }
    expect(text).not.toMatch(/--motion:\s*(?!1[0-9]{2}ms|\d{1,2}ms)/);
  });

  it('keeps a 2 px focus ring, 48 px targets and a reduced-motion rule', () => {
    const all = shopCss.map((f) => f.text).join('\n');
    expect(all).toMatch(
      /:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--focus\)[^}]*outline-offset:\s*2px/,
    );
    expect(all).toMatch(/min-height:\s*var\(--tap\)/);
    expect(all).toMatch(/prefers-reduced-motion:\s*reduce/);
  });

  it('never uses marigold as a text colour', () => {
    const all = shopCss.map((f) => f.text).join('\n');
    expect(all).not.toMatch(/(?<![-\w])color:\s*var\(--marigold\)/);
  });

  it('lays the page out as a centred column of at most 480 px, never a fixed page width', () => {
    const all = shopCss.map((f) => f.text).join('\n');
    const column = /\.sh-column\s*\{([^}]*)\}/.exec(all)?.[1] ?? '';
    expect(column).toMatch(/max-width:\s*480px/);
    expect(column).toMatch(/margin:\s*0 auto/);
    expect(column).not.toMatch(/(?<![-\w])width:/);
    expect(all).not.toMatch(/(?<![-\w])min-width:\s*\d{3,}px/);
  });

  describe('the parchi and the home layout', () => {
    const all = () => shopCss.map((f) => f.text).join('\n');
    const rule = (selector: string) =>
      new RegExp(`${selector.replace(/[.]/g, '\\.')}\\s*\\{([^}]*)\\}`).exec(all())?.[1] ?? '';

    it('draws the ruled lines only on the handwritten block, every 34 px, not on the whole slip', () => {
      expect(rule('.sh-parchi__ruled')).toMatch(/repeating-linear-gradient/);
      expect(rule('.sh-parchi__ruled')).toMatch(/33px/);
      expect(rule('.sh-parchi__body')).not.toMatch(/repeating-linear-gradient/);
    });

    it('makes Decline neutral: a paper edge border and paper ink text, no green', () => {
      const neutral = rule('.sh-btn--neutral');
      expect(neutral).toMatch(/var\(--paper-edge\)/);
      expect(neutral).toMatch(/var\(--paper-ink\)/);
      expect(neutral).not.toMatch(/--brand/);
    });

    it('pins the strip to the bottom of the screen, above the safe area', () => {
      const strip = rule('.sh-strip');
      expect(strip).toMatch(/position:\s*sticky/);
      expect(strip).toMatch(/bottom:\s*0/);
      expect(strip).toMatch(/env\(safe-area-inset-bottom/);
    });

    it('caps the height of a slip so the deck never needs a page scroll', () => {
      expect(rule('.sh-parchi__paper')).toMatch(/max-height:\s*calc\(100dvh/);
    });

    it('gives the header switch a round knob', () => {
      expect(rule('.sh-pill__knob')).toMatch(/border-radius:\s*var\(--r-pill\)/);
    });

    it('draws everything on the paper with paper-locked tokens, since the paper stays light in dark mode', () => {
      const parchi = shopCss.find((f) => f.path.endsWith('parchi.css'))?.text ?? '';
      const onPaper =
        /^(?:\.sh-parchi|\.sh-ring|\.sh-photo|\.sh-delivery-stamp|\.sh-peek|div\.sh-parchi)/;
      // Tokens that change with the theme: on light paper they would turn pale or dark.
      const themed =
        /var\(--(?:brand|brand-soft|danger|danger-soft|ink|ink-muted|line|surface|surface-sunk|bg|on-brand)\)/;
      const rules = [...parchi.matchAll(/([^{}]+)\{([^}]*)\}/g)].map((m) => ({
        selector: (m[1] ?? '').trim(),
        body: m[2] ?? '',
      }));
      const bad = rules
        .filter((r) => r.selector.split(',').some((sel) => onPaper.test(sel.trim())))
        .filter((r) => themed.test(r.body))
        .map((r) => r.selector);
      expect(bad).toEqual([]);
    });

    it('colours the time ring with the stamp colours: green normally, red under two minutes', () => {
      expect(rule('.sh-ring')).toMatch(/var\(--stamp-yes\)/);
      expect(rule('.sh-ring--urgent')).toMatch(/var\(--stamp-no\)/);
    });
  });
});
