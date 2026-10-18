import sharp from 'sharp';
import { sniffImage } from './sniff.js';

/** The longest side after processing. The app also resizes before upload; the server never trusts that. */
export const MAX_SIDE_PX = 1024;
const JPEG_QUALITY = 78;
/** A 400 KB file can still declare a huge picture: refuse to decode more than this many pixels. */
const MAX_INPUT_PIXELS = 26_000_000;

export class PhotoError extends Error {
  constructor(
    readonly code: 'invalid_image',
    message: string,
  ) {
    super(message);
  }
}

export interface ProcessedPhoto {
  data: Buffer;
  mime: 'image/jpeg';
  size: number;
}

/**
 * Checks the magic bytes, decodes, turns the picture the right way up from its orientation tag, and
 * writes a fresh JPEG: sharp keeps no EXIF, GPS, ICC, XMP or IPTC unless asked, so nothing the
 * phone wrote survives. Throws PhotoError (invalid_image) for anything it cannot read.
 */
export async function processPhoto(input: Buffer): Promise<ProcessedPhoto> {
  if (sniffImage(input) === null) throw new PhotoError('invalid_image', 'Not a JPEG, PNG or WebP');
  try {
    const data = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' })
      .rotate()
      .resize({ width: MAX_SIDE_PX, height: MAX_SIDE_PX, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
      .toBuffer();
    return { data, mime: 'image/jpeg', size: data.length };
  } catch {
    throw new PhotoError('invalid_image', 'The picture could not be read');
  }
}
