import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BRAND_NAME } from './brand.js';

// Static files cannot import BRAND_NAME, so this test keeps them to one source of truth: when the
// brand changes, change brand.ts and every file below fails until it follows.
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const files: Record<string, string> = {
  'index.html': '../index.html',
  'public/manifest.json': '../public/manifest.json',
  'public/sw.js': '../public/sw.js',
  'src/i18n/strings.ts': './i18n/strings.ts',
};

// "AskBuy", "Ask Buy", "askbuy" … but not a package scope or a path such as @askbuy/shared.
const BRAND_LIKE = /(?<![@\w/-])ask[\s_-]?buy(?![\w/-])/gi;
// The name before PR P: none of these files may still carry it.
const OLD_BRAND = /(?<![@\w/-])kahan[\s_-]?milega(?![\w/-])/gi;

describe('brand name', () => {
  it.each(Object.entries(files))('%s uses BRAND_NAME exactly', (_name, rel) => {
    const found = read(rel).match(BRAND_LIKE) ?? [];
    expect(found.length, 'the file should carry the brand at least once').toBeGreaterThan(0);
    for (const occurrence of found) expect(occurrence).toBe(BRAND_NAME);
  });

  it.each(Object.entries(files))('%s no longer carries the old name', (_name, rel) => {
    expect(read(rel).match(OLD_BRAND) ?? []).toEqual([]);
  });

  it('the brand is AskBuy', () => {
    expect(BRAND_NAME).toBe('AskBuy');
  });

  it('the app name in both languages is the brand name', async () => {
    const { en, hi } = await import('./i18n/strings.js');
    expect(en.appName).toBe(BRAND_NAME);
    expect(hi.appName).toBe(BRAND_NAME);
  });
});
