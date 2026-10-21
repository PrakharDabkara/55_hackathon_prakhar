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
    expect(html).toMatch(/<title>AskBuy: lift your shutter online<\/title>/);
    expect(html).toMatch(/<meta\s+name="description"\s+content="People nearby are asking/);
    expect(html).toMatch(/<meta property="og:title" content="AskBuy: lift your shutter online"/);
    expect(html).toMatch(/<meta\s+property="og:description"/);
    expect(html).toMatch(/<meta\s+property="og:image"\s+content="[^"]*icon-512\.png"/);
    expect(html).toMatch(/<meta name="theme-color"/);
    expect(html).toMatch(/<link rel="manifest"/);
    expect(html).toMatch(/<link rel="icon" type="image\/svg\+xml"/);
  });

  it('says what the brief says', () => {
    for (const line of [
      'Lift your shutter online in a minute.',
      'Log in with your phone number',
      'Enter your number and a one-time code. No password, no long form.',
      'Put your shop on the map',
      'Answer from the counter',
      'No catalogue to build',
      'Lists, packed right',
      'Ask the shops nearby, then buy.',
      'AI that asks before it acts',
      'Never guesses prices',
      'Try it now',
      'built for a hackathon, October 2026',
    ])
      expect(text, line).toContain(line);
  });

  it('keeps the privacy claims to what the code does', () => {
    expect(text).toContain("never the customer's number");
    expect(text).toContain('a first name only if they type one');
    expect(text).not.toMatch(/by SMS/);
  });

  it('has no script but the theme file, no inline style, no handler', () => {
    const scripts = [...html.matchAll(/<script\b[^>]*>/g)].map((m) => m[0]);
    for (const s of scripts) expect(s).toMatch(/src="\/app\/theme-init\.js"/);
    expect(html).not.toMatch(/<style\b/);
    expect(html).not.toMatch(/\sstyle=/);
    expect(html).not.toMatch(/\son[a-z]+=/);
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
