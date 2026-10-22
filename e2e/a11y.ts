import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';

// One scan for every screen: axe, plus the three rules axe does not check (CLAUDE.md, UI rules):
// the focus ring has 3:1 contrast against what is behind it, no tap target is under 44 px, and the
// page does not scroll sideways. Each returns lines to put in a failure message; [] is clean.

/** Serious and critical axe findings, one line each. */
export async function axeProblems(page: Page): Promise<string[]> {
  const scan = await new AxeBuilder({ page }).analyze();
  return scan.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}

export interface RuleOptions {
  /** Smallest tap target, in px. CLAUDE.md: 48 px wanted, 44 px absolute floor. */
  minTarget?: number;
  /** Smallest contrast of the focus mark against what is behind it. */
  minFocusContrast?: number;
}

/** Runs in the page: returns problem lines. Kept in one function so Playwright can serialise it. */
function inPage({ minTarget, minFocusContrast }: Required<RuleOptions>): string[] {
  const problems: string[] = [];
  const parse = (value: string): [number, number, number, number] | null => {
    const m = /^rgba?\(([^)]+)\)$/.exec(value.trim());
    if (!m) return null;
    const parts = (m[1] ?? '')
      .split(/[ ,/]+/)
      .filter(Boolean)
      .map(Number);
    if (parts.length < 3 || parts.some(Number.isNaN)) return null;
    return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0, parts[3] ?? 1];
  };
  const lum = ([r, g, b]: number[]) => {
    const f = (c: number) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(r ?? 0) + 0.7152 * f(g ?? 0) + 0.0722 * f(b ?? 0);
  };
  const contrast = (a: number[], b: number[]) => {
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
    return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
  };
  /** The colour behind an element: the nearest ancestor with a solid background. */
  const behind = (el: Element): number[] => {
    for (let node = el.parentElement; node; node = node.parentElement) {
      const c = parse(getComputedStyle(node).backgroundColor);
      if (c && c[3] >= 0.95) return c;
    }
    return parse(getComputedStyle(document.documentElement).backgroundColor) ?? [255, 255, 255, 1];
  };
  const name = (el: Element) => {
    const label = el.getAttribute('aria-label') || (el.textContent ?? '').trim().slice(0, 24);
    const cls = typeof el.className === 'string' ? el.className.split(' ')[0] : '';
    return `${el.tagName.toLowerCase()}${cls ? '.' + cls : ''}${label ? ` "${label}"` : ''}`;
  };
  const shown = (el: Element) => {
    const box = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return (
      box.width > 0 &&
      box.height > 0 &&
      style.visibility !== 'hidden' &&
      style.display !== 'none' &&
      !el.closest('[inert], [aria-hidden="true"]')
    );
  };

  const selector =
    'a[href], button, input:not([type="hidden"]), select, textarea, summary, [role="button"], [role="switch"], [role="tab"], [role="radio"], [role="checkbox"], [tabindex]';
  const controls = [...document.querySelectorAll(selector)].filter(
    (el) => shown(el) && !(el as HTMLInputElement).disabled,
  );

  // 1. Tap targets. A link inside a line of text is exempt (WCAG 2.5.8); a control wrapped in a
  //    label is measured by the label, which is what a finger hits.
  for (const el of controls) {
    if (el.getAttribute('tabindex') === '-1' && !/^(a|button|input)$/i.test(el.tagName)) continue;
    const style = getComputedStyle(el);
    if (el.tagName === 'A' && style.display === 'inline') continue;
    const target = (el instanceof HTMLInputElement ? el.closest('label') : null) ?? el;
    const box = target.getBoundingClientRect();
    // Leaflet's own markers and attribution are not ours to size.
    if (el.closest('.leaflet-control-attribution')) continue;
    if (Math.min(box.width, box.height) < minTarget - 0.5)
      problems.push(
        `target ${Math.round(box.width)}x${Math.round(box.height)} px: ${name(target)}`,
      );
  }

  // 2. Focus ring. Focus each tabbable control and read what the browser would draw.
  const previous = document.activeElement as HTMLElement | null;
  const [scrollX, scrollY] = [window.scrollX, window.scrollY];
  const mark = (node: Element) => {
    const style = getComputedStyle(node);
    return {
      outline: style.outlineStyle + style.outlineWidth + style.outlineColor,
      border: style.borderTopColor,
      shadow: style.boxShadow,
    };
  };
  for (const el of controls) {
    if (!(el instanceof HTMLElement) || el.tabIndex < 0) continue;
    // The control, or a wrapper up to three levels out, draws the mark (an input in a field whose
    // border changes on :focus-within).
    const chain: Element[] = [el];
    for (let up = el.parentElement; up && chain.length < 4; up = up.parentElement) chain.push(up);
    const unfocused = chain.map(mark);
    el.focus({ focusVisible: true, preventScroll: true } as FocusOptions);
    let ring: number[] | null = null;
    let drawer: Element = el;
    chain.some((node, i) => {
      const was = unfocused[i];
      const now = mark(node);
      const style = getComputedStyle(node);
      let colour: string | null = null;
      if (
        style.outlineStyle !== 'none' &&
        parseFloat(style.outlineWidth) > 0 &&
        now.outline !== was?.outline
      )
        colour = style.outlineColor;
      else if (now.border !== was?.border) colour = style.borderTopColor;
      else if (now.shadow !== 'none' && now.shadow !== was?.shadow)
        colour = /rgba?\([^)]+\)/.exec(now.shadow)?.[0] ?? null;
      const parsed = colour ? parse(colour) : null;
      if (parsed) {
        ring = parsed;
        drawer = node;
      }
      return parsed !== null;
    });
    if (!ring) {
      const box = el.getBoundingClientRect();
      const quiet = box.width <= 1 || getComputedStyle(el).opacity === '0';
      if (!quiet) problems.push(`no focus mark: ${name(el)}`);
      continue;
    }
    // A ring drawn inside the control (negative offset) sits on the control's own background.
    const own = parse(getComputedStyle(drawer).backgroundColor);
    const inside = parseFloat(getComputedStyle(drawer).outlineOffset) < 0 && own && own[3] >= 0.95;
    const ratio = contrast(ring, inside && own ? own : behind(drawer));
    if (ratio < minFocusContrast)
      problems.push(`focus ring ${ratio.toFixed(2)}:1 (needs ${minFocusContrast}:1): ${name(el)}`);
  }
  if (previous && previous !== document.body) previous.focus();
  else (document.activeElement as HTMLElement | null)?.blur();
  window.scrollTo(scrollX, scrollY);

  // 3. Reduced motion: when the person asked for less, nothing moves (a fade is fine).
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    for (const animation of document.getAnimations()) {
      if (animation.playState !== 'running') continue;
      const frames = (animation.effect as KeyframeEffect | null)?.getKeyframes() ?? [];
      const moves = frames.some((f) => f['transform'] && f['transform'] !== 'none');
      const target = (animation.effect as KeyframeEffect | null)?.target;
      if (moves) problems.push(`moves with reduced motion: ${target ? name(target) : 'animation'}`);
    }
  }

  // 4. Sideways scroll.
  const over = document.documentElement.scrollWidth - document.documentElement.clientWidth;
  if (over > 0) problems.push(`scrolls sideways by ${over} px`);
  return [...new Set(problems)];
}

/** Tap size, focus ring contrast and sideways scroll. */
export function ruleProblems(page: Page, options: RuleOptions = {}): Promise<string[]> {
  return page.evaluate(inPage, { minTarget: 44, minFocusContrast: 3, ...options });
}

/** Everything: the lines to show when a screen breaks a rule, [] when it is clean. */
export async function screenProblems(page: Page): Promise<string[]> {
  return [...(await axeProblems(page)), ...(await ruleProblems(page))];
}
