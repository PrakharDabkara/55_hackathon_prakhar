import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// PR P: the AskBuy mark as icons: the PWA icons, a maskable one and the favicon, generated once
// from the same drawing by apps/web/scripts/make-icons.ts and committed.
const file = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
const pngSize = (rel: string) => {
  const bytes = readFileSync(file(rel));
  expect(bytes.subarray(1, 4).toString()).toBe('PNG');
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
};

describe('AskBuy icons', () => {
  it('has the 192, 512 and maskable 512 PNGs at their sizes', () => {
    expect(pngSize('../public/icon-192.png')).toEqual([192, 192]);
    expect(pngSize('../public/icon-512.png')).toEqual([512, 512]);
    expect(pngSize('../public/icon-maskable-512.png')).toEqual([512, 512]);
  });

  it('has an SVG favicon that is the same mark and says nothing of the old name', () => {
    expect(existsSync(file('../public/favicon.svg'))).toBe(true);
    const svg = readFileSync(file('../public/favicon.svg'), 'utf8');
    expect(svg).toMatch(/<svg/);
    expect(svg).not.toMatch(/kahan/i);
  });

  it('lists them in the manifest, the maskable one on its own', () => {
    const manifest = JSON.parse(readFileSync(file('../public/manifest.json'), 'utf8')) as {
      name: string;
      short_name: string;
      icons: { src: string; sizes: string; purpose: string }[];
    };
    expect(manifest.name).toBe('AskBuy');
    expect(manifest.short_name).toBe('AskBuy');
    const bySrc = Object.fromEntries(manifest.icons.map((i) => [i.src, i]));
    expect(bySrc['icon-192.png']?.purpose).toBe('any');
    expect(bySrc['icon-512.png']?.purpose).toBe('any');
    expect(bySrc['icon-maskable-512.png']).toMatchObject({ sizes: '512x512', purpose: 'maskable' });
  });

  it('links the SVG favicon first, with the PNG as a fallback', () => {
    const html = readFileSync(file('../index.html'), 'utf8');
    expect(html).toMatch(/<link rel="icon" type="image\/svg\+xml" href="\/favicon\.svg"/);
    expect(html).toMatch(/<link rel="icon" type="image\/png" href="\/icon-192\.png"/);
    expect(html).toMatch(/<title>AskBuy<\/title>/);
  });
});
