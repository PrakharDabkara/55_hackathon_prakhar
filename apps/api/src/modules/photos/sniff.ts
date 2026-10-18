export type ImageKind = 'jpeg' | 'png' | 'webp';

const starts = (buffer: Buffer, bytes: number[], at = 0) =>
  buffer.length >= at + bytes.length && bytes.every((b, i) => buffer[at + i] === b);

/**
 * What kind of picture these bytes are, from their first bytes (the "magic bytes"), or null. The
 * client's file name and content type are never used. Only JPEG, PNG and WebP: no SVG (it can
 * carry script), no GIF, no formats we would have to trust a parser for.
 */
export function sniffImage(buffer: Buffer): ImageKind | null {
  if (starts(buffer, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (starts(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  // WebP: "RIFF", four size bytes, "WEBP". Other RIFF files (WAV, AVI) are not pictures.
  if (starts(buffer, [0x52, 0x49, 0x46, 0x46]) && starts(buffer, [0x57, 0x45, 0x42, 0x50], 8))
    return 'webp';
  return null;
}
