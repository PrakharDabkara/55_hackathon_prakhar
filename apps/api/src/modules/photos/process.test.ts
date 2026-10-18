import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { PhotoError, processPhoto } from './process.js';

const solid = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: { r: 200, g: 60, b: 40 } } });

/** A JPEG that carries a GPS position, a camera name and an orientation, as a phone makes them. */
const withGps = async (width: number, height: number, orientation = 1) =>
  solid(width, height)
    .jpeg()
    .withExif({
      IFD0: { Make: 'PhoneCo', Model: 'Secret 9', Orientation: String(orientation) },
      IFD3: {
        GPSLatitudeRef: 'N',
        GPSLatitude: '22/1 43/1 11/1',
        GPSLongitudeRef: 'E',
        GPSLongitude: '75/1 51/1 28/1',
      },
    })
    .toBuffer();

describe('processPhoto: the server re-encodes, never trusts the client', () => {
  it('the fixture really carries GPS (so the test below proves something)', async () => {
    const meta = await sharp(await withGps(800, 600)).metadata();
    expect(meta.exif).toBeDefined();
    expect(meta.exif?.toString('latin1')).toContain('PhoneCo');
  });

  it('a GPS-tagged JPEG comes out with no metadata at all', async () => {
    const input = await withGps(800, 600);
    const out = await processPhoto(input);
    const meta = await sharp(out.data).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.icc).toBeUndefined();
    expect(meta.xmp).toBeUndefined();
    expect(meta.iptc).toBeUndefined();
    const raw = out.data.toString('latin1');
    for (const leak of ['Exif', 'GPS', 'PhoneCo', 'Secret 9', 'http://ns.adobe.com'])
      expect(raw, leak).not.toContain(leak);
    expect(out.mime).toBe('image/jpeg');
    expect(meta.format).toBe('jpeg');
    expect(out.size).toBe(out.data.length);
  });

  it('keeps the picture the right way up: orientation is applied, then dropped', async () => {
    // Stored 800 x 600 with orientation 6 (rotate 90°): it is shown 600 x 800.
    const out = await processPhoto(await withGps(800, 600, 6));
    const meta = await sharp(out.data).metadata();
    expect(meta.orientation === undefined || meta.orientation === 1).toBe(true);
    expect(meta.width).toBe(600);
    expect(meta.height).toBe(800);
  });

  it('shrinks to at most 1024 px on the longest side and never enlarges', async () => {
    const big = await processPhoto(await solid(3000, 1500).jpeg().toBuffer());
    const bigMeta = await sharp(big.data).metadata();
    expect(bigMeta.width).toBe(1024);
    expect(bigMeta.height).toBe(512);
    const small = await processPhoto(await solid(300, 200).jpeg().toBuffer());
    const smallMeta = await sharp(small.data).metadata();
    expect([smallMeta.width, smallMeta.height]).toEqual([300, 200]);
  });

  it('accepts PNG and WebP and stores JPEG', async () => {
    for (const make of [solid(400, 300).png(), solid(400, 300).webp()]) {
      const out = await processPhoto(await make.toBuffer());
      expect(out.mime).toBe('image/jpeg');
      expect((await sharp(out.data).metadata()).format).toBe('jpeg');
    }
  });

  it('a transparent PNG gets a white background, not black', async () => {
    const png = await sharp({
      create: { width: 20, height: 20, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .png()
      .toBuffer();
    const out = await processPhoto(png);
    const { data } = await sharp(out.data).raw().toBuffer({ resolveWithObject: true });
    expect(data[0]).toBeGreaterThan(240);
  });

  it('refuses a GIF or SVG, and bytes that only look like an image', async () => {
    await expect(processPhoto(Buffer.from('GIF89a' + 'x'.repeat(100)))).rejects.toMatchObject({
      code: 'invalid_image',
    });
    await expect(
      processPhoto(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>')),
    ).rejects.toBeInstanceOf(PhotoError);
    const fake = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]);
    await expect(processPhoto(fake)).rejects.toMatchObject({ code: 'invalid_image' });
  });

  it('refuses an image that claims an enormous size (a decompression bomb)', async () => {
    const huge = await sharp({
      create: { width: 12000, height: 12000, channels: 3, background: '#fff' },
    })
      .png({ compressionLevel: 9 })
      .toBuffer();
    expect(huge.length).toBeLessThan(400 * 1024);
    await expect(processPhoto(huge)).rejects.toMatchObject({ code: 'invalid_image' });
  });
});
