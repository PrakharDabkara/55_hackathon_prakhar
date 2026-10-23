import { createHash } from 'node:crypto';
import sharp from 'sharp';

/**
 * A 5 by 7 pixel font, drawn as rectangles. The API image has no fonts installed, so SVG text would
 * come out blank; rectangles look the same everywhere.
 */
const GLYPHS: Record<string, string[]> = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01110', '10001', '10000', '10000', '10000', '10001', '01110'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  G: ['01110', '10001', '10000', '10111', '10001', '10001', '01111'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  J: ['00111', '00010', '00010', '00010', '00010', '10010', '01100'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  Q: ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  W: ['10001', '10001', '10001', '10101', '10101', '11011', '10001'],
  X: ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  Z: ['11111', '00001', '00010', '00100', '01000', '10000', '11111'],
  '?': ['01110', '10001', '00001', '00110', '00100', '00000', '00100'],
};

/** Calm, dark enough for white letters. */
const COLOURS = ['#1f5f4a', '#8a3b2a', '#2f4a7d', '#6b4a8e', '#8a6a12', '#2d6a73', '#7a2f4f'];

const SIDE = 512;
const CELL = 26;

/** Up to two initials, from the first two words that start with a letter; "?" if there are none. */
export function initialsOf(name: string): string {
  const letters = name
    .split(/\s+/)
    .map((word) => word.match(/\p{L}/u)?.[0]?.toUpperCase())
    .filter((c): c is string => c !== undefined && c in GLYPHS);
  return letters.slice(0, 2).join('') || '?';
}

/**
 * A square PNG with the shop's initials on a colour chosen by its name: the same name always draws
 * the same bytes. The name is only ever looked up in the glyph table, never put into the markup.
 * The result goes through the normal logo pipeline (processLogo), like a logo a shop uploads.
 */
export async function placeholderLogo(name: string): Promise<Buffer> {
  const initials = initialsOf(name);
  const hash = createHash('sha256').update(name).digest().readUInt8(0);
  const colour = COLOURS[hash % COLOURS.length] as string;
  const width = initials.length * 5 * CELL + (initials.length - 1) * CELL;
  const left = (SIDE - width) / 2;
  const top = (SIDE - 7 * CELL) / 2;
  const rects: string[] = [];
  [...initials].forEach((char, n) => {
    (GLYPHS[char] as string[]).forEach((row, y) => {
      [...row].forEach((bit, x) => {
        if (bit !== '1') return;
        const px = left + (n * 6 + x) * CELL;
        rects.push(`<rect x="${px}" y="${top + y * CELL}" width="${CELL}" height="${CELL}"/>`);
      });
    });
  });
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SIDE}" height="${SIDE}">` +
    `<rect width="${SIDE}" height="${SIDE}" fill="${colour}"/>` +
    `<g fill="#ffffff">${rects.join('')}</g></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}
