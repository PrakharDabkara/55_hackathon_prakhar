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

  it('says what the round-1 copy says', () => {
    for (const line of [
      'Buy from the shops you trust, right around the corner.', // L-05
      'Ask once. Nearby shops reply with their price and stock.',
      'compare the prices from every nearby shop and pick the best', // L-10
      'no walking to ten shops',
      'An AI agent that plans your errand', // L-06
      'party supplies for Sunday',
      'the fewest shops and the shortest route',
      'nothing is ordered until you choose',
      'Never guesses prices',
      'No catalogue. No inventory sheet.', // L-01
      'Your stock list builds itself as you answer requests and sell.',
      'Get your shop online in a few easy steps', // L-08
      'Log in with your phone number',
      'Put your shop on the map',
      'Answer from the counter',
      'Lists, packed right',
      'Try it now',
      '© 2026 Prakhar Dabkara', // L-04
    ])
      expect(text, line).toContain(line);
  });

  it('drops what the round-1 test asked to drop', () => {
    expect(text).not.toContain('Lift your shutter'); // L-05
    expect(text).not.toContain('Customers stay private'); // L-07
    expect(text).not.toContain('Open your shop in three steps'); // L-08
    expect(text).not.toContain('Prakhar Kirana'); // L-02
    expect(text).not.toMatch(/hackathon/i); // L-04
    expect(text).not.toMatch(/javitri|masala|maida|mirchi|biryani|kirana/i); // L-11
  });

  it('uses cheap everyday items with rupee prices (L-11)', () => {
    expect(text).toMatch(/AA batteries/);
    expect(text).toMatch(/₹\d+/);
    expect(text).toContain('Sharma General Store');
  });

  it('is buyer-first: hero, buyers, AI agent, then the shop sections (follow-up)', () => {
    const at = (id: string) => html.indexOf(`id="${id}"`);
    expect(at('buyers')).toBeGreaterThan(html.indexOf('lp-hero'));
    expect(at('buyers')).toBeLessThan(at('ai'));
    expect(at('ai')).toBeLessThan(at('why'));
    expect(at('why')).toBeLessThan(at('how'));
    expect(at('how')).toBeLessThan(at('try'));
  });

  it('shows the buyer view in the hero, not the shop app', () => {
    const hero = html.slice(html.indexOf('lp-hero'), html.indexOf('id="buyers"'));
    expect(hero).toContain('lp-replies');
    expect(hero).toContain('Bottle brush');
    expect(hero).not.toMatch(/Send answer|Your price|New request nearby/);
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
