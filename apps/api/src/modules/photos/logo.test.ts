import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { PhotoError } from './process.js';
import { LOGO_SIDE_PX, processLogo } from './logo.js';

const withGps = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: { r: 200, g: 60, b: 40 } } })
    .jpeg()
    .withMetadata({
      exif: {
        IFD0: { Make: 'PhoneCo' },
        IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '22/1 43/1 11/1' },
      },
    })
    .toBuffer();

describe('processLogo: a square webp the shop chose to publish', () => {
  it('centre-crops any shape to 512 x 512 webp', async () => {
    for (const [w, h] of [
      [800, 400],
      [300, 900],
      [64, 64],
    ] as const) {
      const out = await processLogo(await withGps(w, h));
      expect(out.mime).toBe('image/webp');
      expect(out.size).toBe(out.data.length);
      const meta = await sharp(out.data).metadata();
      expect([meta.format, meta.width, meta.height]).toEqual(['webp', LOGO_SIDE_PX, LOGO_SIDE_PX]);
    }
  });

  it('keeps the middle of the picture', async () => {
    // Left third red, middle third green, right third blue: the crop of a wide picture is green.
    const strip = await sharp({
      create: { width: 900, height: 300, channels: 3, background: { r: 0, g: 255, b: 0 } },
    })
      .composite([
        {
          input: { create: { width: 300, height: 300, channels: 3, background: '#ff0000' } },
          left: 0,
          top: 0,
        },
        {
          input: { create: { width: 300, height: 300, channels: 3, background: '#0000ff' } },
          left: 600,
          top: 0,
        },
      ])
      .png()
      .toBuffer();
    const { data, info } = await sharp((await processLogo(strip)).data)
      .raw()
      .toBuffer({ resolveWithObject: true });
    const at = (256 * info.width + 256) * info.channels;
    const px = data.subarray(at, at + 3);
    expect(px[1]).toBeGreaterThan(200);
    expect(px[0]).toBeLessThan(60);
  });

  it('strips every piece of metadata', async () => {
    const out = await processLogo(await withGps(640, 480));
    const meta = await sharp(out.data).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.icc).toBeUndefined();
    expect(meta.xmp).toBeUndefined();
    expect(out.data.toString('latin1')).not.toMatch(/GPS|PhoneCo/);
  });

  it('refuses what is not a JPEG, PNG or WebP', async () => {
    await expect(processLogo(Buffer.from('GIF89a' + 'x'.repeat(50)))).rejects.toBeInstanceOf(
      PhotoError,
    );
    await expect(
      processLogo(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')),
    ).rejects.toThrow();
  });
});
