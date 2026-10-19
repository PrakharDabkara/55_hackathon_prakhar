import express, { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import type { Logger } from 'pino';
import type { Database } from '../../db/queryable.js';
import { ApiError, parse } from '../../http/errors.js';
import { authOf, createRequireAuth, requireRole } from '../identity/index.js';
import { logoUrl, readLogo, removeLogo, replaceLogo } from './logo.js';
import { isPhotoId, MAX_UPLOAD_BYTES, readPhotoFor, storePhoto } from './service.js';

const uploadQuery = z.object({
  role: z.enum(['request', 'answer']),
  errandId: z.uuid().optional(),
  label: z.string().trim().min(1).max(100).optional(),
});

/** The raw body of an upload, limited in size. */
const rawBody = express.raw({ type: () => true, limit: MAX_UPLOAD_BYTES });

/** The size limit as a clear error instead of a generic one. */
const tooLarge = (err: unknown, _req: Request, _res: Response, next: NextFunction) => {
  if ((err as { status?: number })?.status === 413)
    return next(new ApiError(413, 'photo_too_large', 'The picture is larger than 400 KB'));
  next(err);
};

export function photosRouter({
  db,
  logger,
  capMb,
}: {
  db: Database;
  logger: Logger;
  capMb: number;
}): Router {
  const router = Router();
  const requireAuth = createRequireAuth(db);

  router.post('/photos', requireAuth, rawBody, tooLarge, async (req: Request, res: Response) => {
    const { role, errandId, label } = parse(uploadQuery, req.query);
    const user = authOf(req).user;
    // A customer uploads pictures of what they want; a shop uploads pictures of what it has.
    if (user.role !== (role === 'request' ? 'seeker' : 'shop'))
      throw new ApiError(403, 'forbidden', 'This account cannot add this kind of photo');
    if ((errandId === undefined) !== (label === undefined) || (errandId && role !== 'request'))
      throw new ApiError(
        400,
        'invalid_request',
        'errandId and label go together, for request photos',
      );
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const stored = await storePhoto(
      { db, logger: req.log ?? logger, capBytes: Math.floor(capMb * 1024 * 1024) },
      {
        userId: user.id,
        role,
        body,
        ...(errandId && label && { errand: { id: errandId, label } }),
      },
    );
    res.status(201).json(stored);
  });

  // A shop's logo: the owner chose to publish it, so anyone may read it, signed in or not.
  router.post(
    '/shops/me/logo',
    requireAuth,
    requireRole('shop'),
    rawBody,
    tooLarge,
    async (req: Request, res: Response) => {
      const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      const id = await replaceLogo(
        { db, logger: req.log ?? logger, capBytes: Math.floor(capMb * 1024 * 1024) },
        authOf(req).user.id,
        body,
      );
      if (!id) throw new ApiError(404, 'not_found', 'You have not created a shop yet');
      res.status(201).json({ logoUrl: logoUrl(id) });
    },
  );

  router.delete('/shops/me/logo', requireAuth, requireRole('shop'), async (req, res) => {
    if (!(await removeLogo(db, authOf(req).user.id)))
      throw new ApiError(404, 'not_found', 'You have not created a shop yet');
    res.status(204).end();
  });

  router.get('/photos/:id', async (req, res, next) => {
    const id = String(req.params['id']);
    const logo = isPhotoId(id) ? await readLogo(db, id) : null;
    if (!logo) return next();
    res
      .status(200)
      .set({
        'Content-Type': logo.mime,
        // A new logo is a new id, so this one never changes: any cache may keep it.
        'Cache-Control': 'public, max-age=31536000, immutable',
        'X-Content-Type-Options': 'nosniff',
        'Content-Disposition': 'inline',
        'Content-Length': String(logo.data.length),
      })
      .send(logo.data);
  });

  router.get('/photos/:id', requireAuth, async (req, res) => {
    const photo = await readPhotoFor(db, authOf(req).user.id, String(req.params['id']));
    if (!photo) throw new ApiError(404, 'not_found', 'No such photo');
    res
      .status(200)
      .set({
        'Content-Type': photo.mime,
        // Only the browser of the person who asked may keep it; never a shared cache.
        'Cache-Control': 'private, max-age=3600',
        'X-Content-Type-Options': 'nosniff',
        'Content-Disposition': 'inline',
        'Content-Length': String(photo.data.length),
      })
      .send(photo.data);
  });

  return router;
}
