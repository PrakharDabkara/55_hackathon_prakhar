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
const shopCss = [
  ...cssFiles(join(src, 'shop')),
  ...cssFiles(join(src, 'ui')),
  ...cssFiles(join(src, 'customer')),
].map((path) => ({
  path: path.replace(src, 'src'),
  text: readFileSync(path, 'utf8'),
}));

const light = /:root\s*\{([\s\S]*?)\n\}/.exec(tokens)?.[1] ?? '';
const dark =
  /prefers-color-scheme:\s*dark\)\s*\{\s*:root:not\(\[data-theme='light'\]\)\s*\{([\s\S]*?)\n\s*\}/.exec(
    tokens,
  )?.[1] ?? '';
const darkChosen = /:root\[data-theme='dark'\]\s*\{([\s\S]*?)\n\}/.exec(tokens)?.[1] ?? '';

describe('tokens.css', () => {
  it('has the same dark values for a dark phone and for a person who chose Dark', () => {
    const pairs = (block: string) =>
      [...block.matchAll(/(--[\w-]+|color-scheme):\s*([^;]+);/g)].map((m) => `${m[1]}: ${m[2]}`);
    expect(pairs(darkChosen).length).toBeGreaterThan(10);
    expect(pairs(darkChosen)).toEqual(pairs(dark));
  });

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
      '--focus-on-paper',
      '--focus-on-dark',
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

  // The focus mark is 2 px beside the control, so it is judged against the surface behind it
  // (WCAG 1.4.11: 3:1). Dark values replace the light ones, as they do in the browser.
  describe('focus colours', () => {
    const value = (block: string, name: string) =>
      new RegExp(`${name}:\\s*([^;]+);`).exec(block)?.[1]?.trim() ?? '';
    const resolve = (block: string, name: string): string => {
      let found = value(block, name) || value(light, name);
      const ref = /^var\((--[\w-]+)\)$/.exec(found);
      if (ref?.[1]) found = resolve(block, ref[1]);
      return found;
    };
    const channel = (hex: string, i: number) => {
      const v = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    const luminance = (hex: string) =>
      0.2126 * channel(hex, 0) + 0.7152 * channel(hex, 1) + 0.0722 * channel(hex, 2);
    const ratio = (a: string, b: string) => {
      const [hi = 0, lo = 0] = [luminance(a), luminance(b)].sort((x, y) => y - x);
      return (hi + 0.05) / (lo + 0.05);
    };
    const pairs: [string, string][] = [
      ['--focus', '--bg'],
      ['--focus', '--surface'],
      ['--focus', '--surface-sunk'],
      ['--focus', '--brand-soft'],
      ['--focus-on-paper', '--paper'],
      ['--focus-on-paper', '--marigold'],
      ['--focus-on-dark', '--panel-dark'],
    ];
    for (const [theme, block] of [
      ['light', ''],
      ['dark', darkChosen],
    ] as const)
      it.each(pairs)(`${theme}: %s on %s is at least 3:1`, (mark, surface) => {
        const colour = resolve(block, mark);
        const behind = resolve(block, surface);
        expect(colour, mark).toMatch(/^#[0-9a-f]{6}$/i);
        expect(behind, surface).toMatch(/^#[0-9a-f]{6}$/i);
        expect(ratio(colour, behind)).toBeGreaterThanOrEqual(3);
      });
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
    for (const [whole, amount, unit] of times) {
      const ms = Number(amount) * (unit === 's' ? 1000 : 1);
      // The one-off shutter after a shop logs in (A-08) may take up to 900 ms; it is skippable.
      if (whole.includes('sh-shutter-up')) {
        expect(ms).toBeLessThanOrEqual(900);
        continue;
      }
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

  // PR O: one background everywhere, so no seam shows around the app (either theme, either app).
  it('paints html, body and the app root with --bg and no margin, in both apps', () => {
    const all = shopCss.map((f) => f.text).join('\n');
    const page = /html,\s*body,\s*#root\s*\{([^}]*)\}/.exec(all)?.[1] ?? '';
    expect(page).toMatch(/margin:\s*0/);
    expect(page).toMatch(/background:\s*var\(--bg\)/);
    for (const root of ['.km-app', '.cu-app']) {
      const rule = new RegExp(`(?:^|\\n)\\${root}\\s*\\{([^}]*)\\}`).exec(all)?.[1] ?? '';
      expect(rule, root).toMatch(/background:\s*var\(--bg\)/);
      expect(rule, root).toMatch(/min-height:\s*100dvh/);
    }
    for (const column of ['.sh-column', '.cu-column']) {
      const rule = new RegExp(`\\${column}\\s*\\{([^}]*)\\}`).exec(all)?.[1] ?? '';
      expect(rule, column).toMatch(/background:\s*var\(--bg\)/);
      expect(rule, column).not.toMatch(/border|outline|box-shadow/);
    }
  });

  it('draws focus in the brand colour: the ring on keyboard focus, one 2 px border on text inputs', () => {
    expect(light).toMatch(/--focus:\s*var\(--brand\)/);
    expect(dark).toMatch(/--focus:\s*var\(--brand\)/);
    const all = shopCss.map((f) => f.text).join('\n');
    expect(all).not.toMatch(/:focus\s*\{[^}]*outline:\s*2px/);
    for (const box of ['.sh-input-wrap:focus-within', '.cu-find__box:focus-within']) {
      const rule = new RegExp(`\\${box}\\s*\\{([^}]*)\\}`).exec(all)?.[1] ?? '';
      expect(rule, box).toMatch(/border-color:\s*var\(--focus\)/);
      expect(rule, box).not.toMatch(/outline:\s*2px/);
    }
  });

  it('fits the customer slip to its content and keeps the meta clear of the stamp', () => {
    const all = shopCss.map((f) => f.text).join('\n');
    const ruled = /\.cu-parchi div\.sh-parchi__ruled\s*\{([^}]*)\}/.exec(all)?.[1] ?? '';
    expect(ruled).toMatch(/min-height:\s*0/);
    const row = /\.cu-parchi \.sh-parchi__meta\s*\{([^}]*)\}/.exec(all)?.[1] ?? '';
    expect(row).toMatch(/flex-wrap:\s*wrap/);
    const meta = /\.cu-parchi__meta\s*\{([^}]*)\}/.exec(all)?.[1] ?? '';
    expect(meta).toMatch(/min-width:\s*0/);
    expect(meta).toMatch(/flex:\s*1/);
  });

  it('hangs the closed sign still: no animation, no movement', () => {
    const all = shopCss.map((f) => f.text).join('\n');
    expect(all).toMatch(/\.sh-closed-sign/);
    const rules = [...all.matchAll(/[^{}]*\.sh-closed-sign[^{]*\{([^}]*)\}/g)]
      .map((m) => m[1])
      .join('\n');
    expect(rules).not.toMatch(/animation|transition/);
    expect(all).not.toMatch(/\.sh-blank/);
  });

  it('writes the reply card meta in sentence case', () => {
    const all = shopCss.map((f) => f.text).join('\n');
    const meta = /\.cu-reply \.sh-caption\s*\{([^}]*)\}/.exec(all)?.[1] ?? '';
    expect(meta).toMatch(/text-transform:\s*none/);
    expect(meta).toMatch(/letter-spacing:\s*0/);
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
      const parchi = (shopCss.find((f) => f.path.endsWith('parchi.css'))?.text ?? '').replace(
        /\/\*[\s\S]*?\*\//g,
        '',
      );
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
