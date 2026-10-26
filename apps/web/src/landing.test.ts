import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// PR T (ADR-0056): the landing page is plain HTML and CSS. These tests pin its copy, its anchors
// and what it must never carry. The browser-level checks are in e2e/landing.spec.ts.
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const html = read('../landing.html');
const text = html
  .replace(/<(script|style)[\s\S]*?<\/\1>/g, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&amp;/g, '&')
  .replace(/&rsquo;|&#39;/g, "'")
  .replace(/&middot;/g, '·')
  .replace(/\s+/g, ' ');

describe('landing.html', () => {
  it('has the head the brief asks for', () => {
    expect(html).toMatch(/<title>AskBuy: buy from the shops you trust, nearby<\/title>/);
    expect(html).toMatch(/<meta\s+name="description"\s+content="Ask once/);
    expect(html).toMatch(/<meta property="og:title" content="AskBuy: buy from the shops you trust/);
    expect(html).toMatch(/<meta\s+property="og:description"/);
    expect(html).toMatch(/<meta\s+property="og:image"\s+content="[^"]*icon-512\.png"/);
    expect(html).toMatch(/<meta name="theme-color"/);
    expect(html).toMatch(/<link rel="manifest"/);
    expect(html).toMatch(/<link rel="icon" type="image\/svg\+xml"/);
  });

  it('says what the round-1b copy says', () => {
    for (const line of [
      "Let's lift your shutter online!",
      'Nearby buyers send what they need. You reply with your price.',
      'No catalogue and no inventory sheet needed.',
      'Buy from the shops you trust, right around the corner.',
      'Ask once. Nearby shops reply with their price and stock.',
      'compare the prices from every nearby shop and pick the best',
      'no walking to ten shops',
      'An AI agent that plans your errand',
      'party supplies for Sunday',
      'the fewest shops and the shortest route',
      'nothing is ordered until you choose',
      'Never guesses prices',
      'No catalogue. No inventory sheet. Your stock list builds itself as you answer requests and sell.',
      'Get your shop online in a few easy steps',
      'Log in with your phone number',
      'Put your shop on the map',
      'Answer from the counter',
      'Lists, packed right',
      'Try it now',
      '© 2026 Prakhar Dabkara',
    ])
      expect(text, line).toContain(line);
  });

  it('drops what the rounds asked to drop', () => {
    expect(text).not.toContain('Lift your shutter online in a minute');
    expect(text).not.toContain('Customers stay private');
    expect(text).not.toContain('Open your shop in three steps');
    expect(text).not.toContain('Prakhar Kirana');
    expect(text).not.toMatch(/hackathon/i);
    expect(text).not.toMatch(/javitri|masala|maida|mirchi|biryani|kirana/i);
  });

  it('uses cheap everyday items with rupee prices', () => {
    expect(text).toMatch(/AA batteries/);
    expect(text).toMatch(/Bottle brush/i);
    expect(text).toMatch(/₹\d+/);
    expect(text).toContain('Sharma General Store');
  });

  it('is shop-first: shop hero, steps, why, then the buyer sections, AI, try (round 1b)', () => {
    const at = (id: string) => html.indexOf(`id="${id}"`);
    expect(html.indexOf('lp-hero')).toBeLessThan(at('how'));
    expect(at('how')).toBeLessThan(at('why'));
    expect(at('why')).toBeLessThan(at('buyers'));
    expect(at('buyers')).toBeLessThan(at('compare'));
    expect(at('compare')).toBeLessThan(at('ai'));
    expect(at('ai')).toBeLessThan(at('try'));
  });

  it('orders the header links For shops, For buyers, Demo and skips to the shop content', () => {
    const nav = html.slice(html.indexOf('<nav'), html.indexOf('</nav>'));
    const links = [...nav.matchAll(/<a href="([^"]+)">([^<]+)<\/a>/g)].map((m) => [m[2], m[1]]);
    expect(links).toEqual([
      ['For shops', '#how'],
      ['For buyers', '#buyers'],
      ['Demo', '#try'],
    ]);
    expect(html).toContain('class="lp-skip" href="#how"');
  });

  it('shows the shop phone in the hero and the buyer view below the shop sections', () => {
    const hero = html.slice(html.indexOf('lp-hero'), html.indexOf('id="how"'));
    expect(hero).toContain('<h1>');
    expect(hero).toContain('lp-phone');
    expect(hero).toContain('Open your shop');
    expect(hero).not.toContain('lp-replies');
    const buyers = html.slice(html.indexOf('id="buyers"'), html.indexOf('id="compare"'));
    expect(buyers).toContain('lp-replies');
    expect(buyers).toContain('Bottle brush');
    expect(buyers).toContain('Find something');
    expect(buyers).not.toContain('<h1>');
  });

  it('keeps the privacy claims to what the code does, in the buyer section', () => {
    const buyers = text.slice(text.indexOf('Compare every shop'), text.indexOf('An AI agent'));
    expect(buyers).toContain('never your number');
    expect(buyers).toContain('a first name only if you type one');
    expect(text).not.toMatch(/by SMS/);
  });

  it('has a theme toggle and only same-origin script files, no inline script or style', () => {
    const scripts = [...html.matchAll(/<script\b[^>]*>/g)].map((m) => m[0]);
    expect(scripts.length).toBe(2);
    for (const s of scripts) expect(s).toMatch(/src="\/app\/(theme-init|landing-theme)\.js"/);
    expect(html).toContain('/app/landing-theme.js');
    expect(html).toMatch(/<button[^>]*class="lp-theme"[^>]*aria-pressed=/);
    expect(html).not.toMatch(/<script>[\s\S]*?<\/script>/);
    expect(html).not.toMatch(/<style\b/);
    expect(html).not.toMatch(/\sstyle=/);
    expect(html).not.toMatch(/\son[a-z]+=/);
  });

  it('keeps the theme script safe when storage is blocked', () => {
    const js = read('../public/landing-theme.js');
    expect(js).toContain('localStorage');
    expect(js).toMatch(/try\s*{[\s\S]*localStorage[\s\S]*}\s*catch/);
    expect(js).toContain("'km-theme'");
  });

  it('has no phone number, code or credential', () => {
    expect(text).not.toMatch(/\d{10}/);
    expect(text).not.toMatch(/(?<!\d)\d{6}(?!\d)/);
    expect(text).not.toMatch(/otp-inbox|password:|demo (login|credentials)/i);
  });

  it('links every in-page anchor to an id', () => {
    const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
    const hrefs = [...html.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]);
    expect(hrefs.length).toBeGreaterThan(2);
    for (const h of hrefs) expect(ids.has(h), h).toBe(true);
  });

  it('uses no hex colour outside tokens', () => {
    expect(read('./landing/landing.css')).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});

describe('landing.css: the header button (round 3, L-15)', () => {
  const css = read('./landing/landing.css');
  const rule = (selector: string) => {
    const i = css.indexOf(`${selector} {`);
    return i < 0 ? '' : css.slice(i, css.indexOf('}', i));
  };

  it('is smaller than the wordmark: 14 to 15 px text and compact padding', () => {
    const cta = rule('.lp-header__cta');
    const size = /font:\s*\d+\s+(\d+)px/.exec(cta)?.[1];
    expect(Number(size)).toBeGreaterThanOrEqual(14);
    expect(Number(size)).toBeLessThanOrEqual(15);
    expect(cta).toMatch(/padding:\s*[45]px 1[0-4]px/);
  });

  it('uses the short label at every width and keeps the accessible name', () => {
    const cta = html.slice(html.indexOf('lp-header__cta'), html.indexOf('</header>'));
    expect(cta).toContain('aria-label="Open your shop"');
    expect(cta).toContain('>Your shop<');
    expect(cta).not.toContain('>Open your shop<');
    expect(css).not.toContain('lp-cta__full');
  });

  it('keeps the 44 px tap area on touch with an invisible extension, not a bigger button', () => {
    const coarse = css.slice(css.indexOf('@media (pointer: coarse)'));
    expect(coarse).toContain('.lp-header__cta::after');
    expect(coarse.slice(0, coarse.indexOf('}', coarse.indexOf('::after')))).not.toMatch(
      /min-height:\s*var\(--tap\)/,
    );
  });
});
