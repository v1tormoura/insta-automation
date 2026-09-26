import { mkdirSync } from 'node:fs';
import { MAX_UPLOAD_BYTES, MEDIA_KINDS, paginationSchema } from '@nexora/shared';
import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import { Types } from 'mongoose';
import { z } from 'zod';
import { auth } from '../../http/middleware/auth.js';
import { parse } from '../../http/validate.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { Media } from './media.model.js';
import { deleteMedia, getMediaOrThrow, ingestUpload, listMedia, toMediaDTO, uploadTmpDir } from './media.service.js';
import { verifyMediaSignature } from './publicUrl.js';
import { fileStorage } from './storage.js';

function upload() {
  const dir = uploadTmpDir();
  mkdirSync(dir, { recursive: true });
  return multer({ dest: dir, limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } });
}

// A biblioteca é uma grade de miniaturas: páginas maiores que as listas comuns.
const listQuery = paginationSchema.extend({
  pageSize: z.coerce.number().int().min(1).max(200).default(60),
  kind: z.enum(MEDIA_KINDS).optional(),
});

function sendVariant(res: Response, key: string | null | undefined, mime: string) {
  if (!key) throw notFound('Arquivo');
  res.type(key.endsWith('.webp') ? 'image/webp' : key.endsWith('.jpg') ? 'image/jpeg' : mime);
  res.sendFile(fileStorage().absolutePath(key), { dotfiles: 'deny' });
}

/** Rotas autenticadas da biblioteca: /api/media */
export function mediaRoutes(): Router {
  const router = Router();
  const uploader = upload();

  router.get('/', async (req, res) => {
    const { page, pageSize, kind } = parse(listQuery, req.query);
    res.json(await listMedia(auth(req).userId, page, pageSize, kind));
  });

  router.post('/', uploader.single('file'), async (req: Request, res: Response) => {
    if (!req.file) throw badRequest('Envie um arquivo no campo "file".');
    const { userId, user } = auth(req);
    const media = await ingestUpload(userId, user.plan, req.file);
    res.status(201).json({ media });
  });

  router.get('/:id', async (req, res) => {
    res.json({ media: toMediaDTO(await getMediaOrThrow(auth(req).userId, req.params.id)) });
  });

  router.get('/:id/file', async (req, res) => {
    const media = await getMediaOrThrow(auth(req).userId, req.params.id);
    res.set('Cache-Control', 'private, max-age=3600');
    sendVariant(res, req.query.variant === 'thumb' ? media.thumbnailKey : media.storageKey, media.mimeType);
  });

  router.delete('/:id', async (req, res) => {
    await deleteMedia(auth(req).userId, req.params.id);
    res.status(204).end();
  });

  return router;
}

/** Rota pública e assinada, consumida pelos servidores da Meta: /public/media */
export function publicMediaRoutes(): Router {
  const router = Router();
  router.get('/:mediaId/:variant/:expires/:sig/:filename', async (req, res) => {
    const { mediaId, variant, expires, sig } = req.params;
    if (!Types.ObjectId.isValid(mediaId) || !verifyMediaSignature(mediaId, variant, expires, sig)) throw notFound('Arquivo');
    const media = await Media.findOne({ _id: new Types.ObjectId(mediaId), deletedAt: null })
      .setOptions({ crossTenant: true })
      .lean();
    if (!media) throw notFound('Arquivo');
    res.set('Cache-Control', 'public, max-age=300');
    sendVariant(res, variant === 'thumb' ? media.thumbnailKey : media.storageKey, media.mimeType);
  });
  return router;
}
