/**
 * Draws the AskBuy mark into the files a browser needs and commits nothing else: run it once when
 * the mark changes (`npm run icons`), then commit the results.
 *
 *   apps/web/public/favicon.svg            the rounded mark
 *   apps/web/public/icon-192.png           PWA icon, "any"
 *   apps/web/public/icon-512.png           PWA icon, "any"
 *   apps/web/public/icon-maskable-512.png  PWA icon, "maskable": full square, mark inside the safe zone
 *
 * The shapes come from src/ui/brandMarkGeometry.ts, the same file the BrandMark component uses. The
 * colours are the light-theme tokens of src/design/tokens.css, written out because a PNG has no CSS.
 * Chromium (already installed for the browser tests) rasterises the SVG: no new dependency.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import {
  MARK_HOLE,
  MARK_LINES,
  MARK_PAPER,
  MARK_PIN,
  MARK_RADIUS,
  MARK_SIZE,
  MARK_SLATS,
} from '../src/ui/brandMarkGeometry.ts';

const COLORS = { brand: '#0d5a43', paper: '#fbf5e6', ink: '#1c2a52', marigold: '#f2a516' };

/** The mark as a standalone SVG. `inset` scales the drawing inside the square (the maskable safe zone). */
function svg({ rounded, inset }: { rounded: boolean; inset: number }): string {
  const scale = 1 - inset * 2;
  const shift = (MARK_SIZE * inset).toFixed(3);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${MARK_SIZE} ${MARK_SIZE}" width="${MARK_SIZE}" height="${MARK_SIZE}">
  <rect width="${MARK_SIZE}" height="${MARK_SIZE}" rx="${rounded ? MARK_RADIUS : 0}" fill="${COLORS.brand}"/>
  <g transform="translate(${shift} ${shift}) scale(${scale})">
    <path d="${MARK_PAPER}" fill="${COLORS.paper}"/>
    ${MARK_LINES.map((d) => `<path d="${d}" fill="none" stroke="${COLORS.ink}" stroke-width="2.4" stroke-linecap="round"/>`).join('\n    ')}
    ${MARK_SLATS.map((d) => `<path d="${d}" fill="none" stroke="${COLORS.ink}" stroke-width="1.3" stroke-linecap="round" opacity="0.55"/>`).join('\n    ')}
    <path d="${MARK_PIN}" fill="${COLORS.marigold}" stroke="${COLORS.brand}" stroke-width="1.5" stroke-linejoin="round"/>
    <circle cx="${MARK_HOLE.cx}" cy="${MARK_HOLE.cy}" r="${MARK_HOLE.r}" fill="${COLORS.brand}"/>
  </g>
</svg>
`;
}

const out = (name: string) => fileURLToPath(new URL(`../public/${name}`, import.meta.url));
mkdirSync(fileURLToPath(new URL('../public/', import.meta.url)), { recursive: true });

writeFileSync(out('favicon.svg'), svg({ rounded: true, inset: 0 }));

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const png = async (name: string, size: number, mark: string) => {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      `<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${mark}`,
    );
    await page.screenshot({ path: out(name), omitBackground: true });
    console.log(`wrote ${name} (${size}x${size})`);
  };
  await png('icon-192.png', 192, svg({ rounded: true, inset: 0 }));
  await png('icon-512.png', 512, svg({ rounded: true, inset: 0 }));
  // Maskable: the system crops to a circle or squircle, so the drawing stays inside the middle 80%.
  await png('icon-maskable-512.png', 512, svg({ rounded: false, inset: 0.12 }));
} finally {
  await browser.close();
}
console.log('wrote favicon.svg');
