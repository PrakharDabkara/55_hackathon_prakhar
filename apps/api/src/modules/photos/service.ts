import type { Logger } from 'pino';
import type { Queryable } from '../../db/queryable.js';
import { ApiError } from '../../http/errors.js';
import { PhotoError, processPhoto } from './process.js';

/** Photos one user may add in 24 hours (ADR-0030). */
export const PHOTOS_PER_USER_PER_DAY = 10;
/** The largest upload, in bytes: checked on the raw body before anything is decoded. */
export const MAX_UPLOAD_BYTES = 400 * 1024;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isPhotoId = (value: unknown): value is string =>
  typeof value === 'string' && UUID.test(value);

/** Total photo bytes now stored. */
export async function storedBytes(db: Queryable): Promise<number> {
  const { rows } = await db.query<{ n: string }>(`SELECT coalesce(sum(size), 0) AS n FROM photos`);
  return Number(rows[0]?.n ?? 0);
}

export interface UploadInput {
  userId: string;
  role: 'request' | 'answer';
  body: Buffer;
  /** A checklist item of an errand of this user the photo is for ("Photo jodein"). */
  errand?: { id: string; label: string } | undefined;
}

/**
 * Stores one photo: limits first (cheap), then the server's own re-encode, then the storage cap.
 * Returns what the client may know. The bytes never come back in this answer.
 */
export async function storePhoto(
  ctx: { db: Queryable; logger: Logger; capBytes: number },
  input: UploadInput,
): Promise<{ id: string; mime: 'image/jpeg'; size: number }> {
  const { db, logger } = ctx;
  if (input.body.length === 0) throw new ApiError(400, 'invalid_image', 'No picture was sent');
  if (input.body.length > MAX_UPLOAD_BYTES)
    throw new ApiError(413, 'photo_too_large', 'The picture is larger than 400 KB');

  const recent = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM photos
      WHERE owner_user_id = $1 AND created_at > now() - interval '24 hours'`,
    [input.userId],
  );
  if ((recent.rows[0]?.n ?? 0) >= PHOTOS_PER_USER_PER_DAY)
    throw new ApiError(429, 'photo_limit', 'You can add 10 photos a day');

  let processed;
  try {
    processed = await processPhoto(input.body);
  } catch (error) {
    if (error instanceof PhotoError) throw new ApiError(400, error.code, error.message);
    throw error;
  }

  const before = await storedBytes(db);
  if (before + processed.size > ctx.capBytes) {
    logger.warn(
      { event: 'photo_storage_full', totalBytes: before, capBytes: ctx.capBytes },
      'photo storage cap reached; upload refused',
    );
    throw new ApiError(503, 'photo_storage_full', 'Photos cannot be added right now');
  }

  if (input.errand) {
    const mine = await db.query(`SELECT 1 FROM errands WHERE id = $1 AND user_id = $2`, [
      input.errand.id,
      input.userId,
    ]);
    if (mine.rowCount === 0) throw new ApiError(404, 'not_found', 'No such errand');
  }
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO photos (owner_user_id, role, data, mime, size, errand_id, errand_label)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [
      input.userId,
      input.role,
      processed.data,
      processed.mime,
      processed.size,
      input.errand?.id ?? null,
      input.errand?.label ?? null,
    ],
  );
  // The size and the running total, never who or what.
  logger.info(
    { event: 'photo_stored', photoBytes: processed.size, totalBytes: before + processed.size },
    'photo stored',
  );
  return { id: (rows[0] as { id: string }).id, mime: processed.mime, size: processed.size };
}

/**
 * The photo's bytes if this user may see them, else null (and the route says 404, so existence is
 * not leaked). A customer photo: its owner and the shops the request went to. A shop photo: that
 * shop's owner and the customer who asked. A photo not attached to anything: its owner alone.
 */
export async function readPhotoFor(
  db: Queryable,
  userId: string,
  photoId: string,
): Promise<{ data: Buffer; mime: string } | null> {
  if (!isPhotoId(photoId)) return null;
  const { rows } = await db.query<{ data: Buffer; mime: string; allowed: boolean }>(
    `SELECT p.data, p.mime,
            (p.owner_user_id = $2
             OR (p.role = 'request' AND p.request_id IS NOT NULL AND EXISTS (
                   SELECT 1 FROM pings g JOIN shops s ON s.id = g.shop_id
                    WHERE g.request_id = p.request_id AND s.owner_user_id = $2))
             OR (p.role = 'answer' AND p.ping_id IS NOT NULL AND EXISTS (
                   SELECT 1 FROM pings g JOIN requests r ON r.id = g.request_id
                    WHERE g.id = p.ping_id AND r.user_id = $2))
            ) AS allowed
       FROM photos p WHERE p.id = $1`,
    [photoId, userId],
  );
  const row = rows[0];
  return row?.allowed ? { data: row.data, mime: row.mime } : null;
}

/** Attaches the customer's own unused photo to a request; the caller's transaction rolls back on an error. */
export async function attachRequestPhoto(
  db: Queryable,
  userId: string,
  photoId: string,
  requestId: string,
): Promise<void> {
  if (!isPhotoId(photoId)) throw new ApiError(404, 'photo_not_found', 'No such photo');
  const done = await db.query(
    `UPDATE photos SET request_id = $3
      WHERE id = $1 AND owner_user_id = $2 AND role = 'request' AND request_id IS NULL
      RETURNING id`,
    [photoId, userId, requestId],
  );
  if (done.rowCount === 1) return;
  const mine = await db.query(
    `SELECT 1 FROM photos WHERE id = $1 AND owner_user_id = $2 AND role = 'request'`,
    [photoId, userId],
  );
  if (mine.rowCount === 1) throw new ApiError(409, 'photo_taken', 'This photo is already used');
  throw new ApiError(404, 'photo_not_found', 'No such photo');
}

/** Attaches the shop owner's own unused photo to the ping it is answering (a yes). */
export async function attachAnswerPhoto(
  db: Queryable,
  userId: string,
  photoId: string,
  pingId: string,
): Promise<void> {
  if (!isPhotoId(photoId)) throw new ApiError(404, 'photo_not_found', 'No such photo');
  const done = await db.query(
    `UPDATE photos SET ping_id = $3
      WHERE id = $1 AND owner_user_id = $2 AND role = 'answer' AND ping_id IS NULL
      RETURNING id`,
    [photoId, userId, pingId],
  );
  if (done.rowCount === 1) return;
  const mine = await db.query(
    `SELECT 1 FROM photos WHERE id = $1 AND owner_user_id = $2 AND role = 'answer'`,
    [photoId, userId],
  );
  if (mine.rowCount === 1) throw new ApiError(409, 'photo_taken', 'This photo is already used');
  throw new ApiError(404, 'photo_not_found', 'No such photo');
}

/**
 * The errand agent opened the request for one of its checklist items: the photo the customer gave
 * that item (matched by its words, ignoring case and spacing) follows it. At most one photo.
 */
export async function linkErrandPhoto(
  db: Queryable,
  errandId: string,
  label: string,
  requestId: string,
): Promise<boolean> {
  const done = await db.query(
    `UPDATE photos SET request_id = $3
      WHERE id = (
        SELECT id FROM photos
         WHERE errand_id = $1 AND request_id IS NULL
           AND lower(regexp_replace(trim(errand_label), '\\s+', ' ', 'g'))
             = lower(regexp_replace(trim($2), '\\s+', ' ', 'g'))
         ORDER BY created_at LIMIT 1)
      RETURNING id`,
    [errandId, label, requestId],
  );
  return done.rowCount === 1;
}
