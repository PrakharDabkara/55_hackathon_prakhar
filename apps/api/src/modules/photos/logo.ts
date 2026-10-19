import sharp from 'sharp';
import type { Logger } from 'pino';
import { withTransaction, type Database, type Queryable } from '../../db/queryable.js';
import { ApiError } from '../../http/errors.js';
import { PhotoError } from './process.js';
import { MAX_UPLOAD_BYTES, storedBytes } from './service.js';
import { sniffImage } from './sniff.js';

/** A logo is a square this many pixels on a side. */
export const LOGO_SIDE_PX = 512;
const WEBP_QUALITY = 80;
const MAX_INPUT_PIXELS = 26_000_000;

export interface ProcessedLogo {
  data: Buffer;
  mime: 'image/webp';
  size: number;
}

/**
 * The same checks as every photo (magic bytes, pixel limit), then a centre-crop to a square and a
 * fresh webp. sharp keeps no EXIF, GPS, ICC or XMP unless asked, so none survives.
 */
export async function processLogo(input: Buffer): Promise<ProcessedLogo> {
  if (sniffImage(input) === null) throw new PhotoError('invalid_image', 'Not a JPEG, PNG or WebP');
  try {
    const data = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' })
      .rotate()
      .resize({ width: LOGO_SIDE_PX, height: LOGO_SIDE_PX, fit: 'cover', position: 'centre' })
      .webp({ quality: WEBP_QUALITY })
      .toBuffer();
    return { data, mime: 'image/webp', size: data.length };
  } catch {
    throw new PhotoError('invalid_image', 'The picture could not be read');
  }
}

/** The address a logo is read from. Public: the shop chose to publish it. */
export const logoUrl = (photoId: string | null): string | null =>
  photoId ? `/photos/${photoId}` : null;

/**
 * Stores the owner's logo and drops the previous one (row and bytes) in one transaction.
 * Returns null when the user has no shop.
 */
export async function replaceLogo(
  ctx: { db: Database; logger: Logger; capBytes: number },
  userId: string,
  body: Buffer,
): Promise<string | null> {
  const { db, logger } = ctx;
  if (body.length === 0) throw new ApiError(400, 'invalid_image', 'No picture was sent');
  if (body.length > MAX_UPLOAD_BYTES)
    throw new ApiError(413, 'photo_too_large', 'The picture is larger than 400 KB');
  const shop = await db.query<{ id: string }>(`SELECT id FROM shops WHERE owner_user_id = $1`, [
    userId,
  ]);
  const shopId = shop.rows[0]?.id;
  if (!shopId) return null;

  let processed: ProcessedLogo;
  try {
    processed = await processLogo(body);
  } catch (error) {
    if (error instanceof PhotoError) throw new ApiError(400, error.code, error.message);
    throw error;
  }

  return withTransaction(db, async (tx) => {
    // Deleted first, so the old logo's bytes do not count against the cap.
    await tx.query(`DELETE FROM photos WHERE shop_id = $1 AND role = 'logo'`, [shopId]);
    const before = await storedBytes(tx);
    if (before + processed.size > ctx.capBytes) {
      logger.warn(
        { event: 'photo_storage_full', totalBytes: before, capBytes: ctx.capBytes },
        'photo storage cap reached; upload refused',
      );
      throw new ApiError(503, 'photo_storage_full', 'Photos cannot be added right now');
    }
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO photos (owner_user_id, role, data, mime, size, shop_id)
       VALUES ($1, 'logo', $2, $3, $4, $5) RETURNING id`,
      [userId, processed.data, processed.mime, processed.size, shopId],
    );
    const id = (rows[0] as { id: string }).id;
    await tx.query(`UPDATE shops SET logo_photo_id = $2 WHERE id = $1`, [shopId, id]);
    logger.info(
      { event: 'logo_stored', photoBytes: processed.size, totalBytes: before + processed.size },
      'logo stored',
    );
    return id;
  });
}

/** Removes the owner's logo. True if the user has a shop (with or without a logo). */
export async function removeLogo(db: Queryable, userId: string): Promise<boolean> {
  const shop = await db.query<{ id: string }>(`SELECT id FROM shops WHERE owner_user_id = $1`, [
    userId,
  ]);
  const shopId = shop.rows[0]?.id;
  if (!shopId) return false;
  // shops.logo_photo_id goes back to NULL by itself (ON DELETE SET NULL).
  await db.query(`DELETE FROM photos WHERE shop_id = $1 AND role = 'logo'`, [shopId]);
  return true;
}

/** A logo's bytes, readable by anyone, or null. */
export async function readLogo(
  db: Queryable,
  photoId: string,
): Promise<{ data: Buffer; mime: string } | null> {
  const { rows } = await db.query<{ data: Buffer; mime: string }>(
    `SELECT data, mime FROM photos WHERE id = $1 AND role = 'logo'`,
    [photoId],
  );
  return rows[0] ?? null;
}
