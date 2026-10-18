import { describe, expect, it } from 'vitest';
import { sniffImage } from './sniff.js';

const bytes = (...values: number[]) => Buffer.from(values);
const pad = (head: Buffer, length = 64) => Buffer.concat([head, Buffer.alloc(length)]);

describe('sniffImage: the type comes from the first bytes, never from what the client says', () => {
  it('recognises JPEG, PNG and WebP', () => {
    expect(sniffImage(pad(bytes(0xff, 0xd8, 0xff, 0xe0)))).toBe('jpeg');
    expect(sniffImage(pad(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)))).toBe('png');
    expect(
      sniffImage(pad(Buffer.concat([Buffer.from('RIFF'), bytes(0, 0, 0, 0), Buffer.from('WEBP')]))),
    ).toBe('webp');
  });

  it('refuses GIF, SVG, HTML, BMP, TIFF and AVIF', () => {
    expect(sniffImage(pad(Buffer.from('GIF89a')))).toBeNull();
    expect(sniffImage(pad(Buffer.from('GIF87a')))).toBeNull();
    expect(
      sniffImage(pad(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))),
    ).toBeNull();
    expect(sniffImage(pad(Buffer.from('<?xml version="1.0"?><svg/>')))).toBeNull();
    expect(sniffImage(pad(Buffer.from('<html><script>alert(1)</script>')))).toBeNull();
    expect(sniffImage(pad(Buffer.from('BM')))).toBeNull();
    expect(sniffImage(pad(Buffer.from('II*\0')))).toBeNull();
    expect(
      sniffImage(pad(Buffer.concat([bytes(0, 0, 0, 0x1c), Buffer.from('ftypavif')]))),
    ).toBeNull();
  });

  it('refuses RIFF that is not WebP (a WAV, an AVI)', () => {
    const riff = (kind: string) =>
      pad(Buffer.concat([Buffer.from('RIFF'), bytes(0, 0, 0, 0), Buffer.from(kind)]));
    expect(sniffImage(riff('WAVE'))).toBeNull();
    expect(sniffImage(riff('AVI '))).toBeNull();
  });

  it('refuses empty, tiny and truncated input without throwing', () => {
    expect(sniffImage(Buffer.alloc(0))).toBeNull();
    expect(sniffImage(bytes(0xff))).toBeNull();
    expect(sniffImage(bytes(0xff, 0xd8))).toBeNull();
    expect(sniffImage(bytes(0x89, 0x50, 0x4e))).toBeNull();
    expect(sniffImage(Buffer.from('RIFF'))).toBeNull();
  });

  it('does not trust a name or a claimed type: text called photo.jpg is still refused', () => {
    expect(sniffImage(Buffer.from('this is not a picture at all, just words'))).toBeNull();
  });
});
