import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  FEED_IMAGE_ASPECT,
  MAX_IMAGE_BYTES,
  PLANS,
  UPLOAD_MIME_TYPES,
  VIDEO_RULES,
  POST_TYPE_INFO,
  type MediaDTO,
  type MediaKind,
  type Paginated,
  type PlanId,
  type PostType,
} from '@nexora/shared';
import { fileTypeFromFile } from 'file-type';
import { Types } from 'mongoose';
import sharp from 'sharp';
import { AppError, badRequest, conflict, notFound, planLimit } from '../../lib/errors.js';
import { Post } from '../posts/post.model.js';
import { Media, type MediaDoc } from './media.model.js';
import { extractFrame, probeVideo } from './probe.js';
import { fileStorage, mediaPrefix } from './storage.js';

export function toMediaDTO(m: MediaDoc): MediaDTO {
  const id = m._id.toString();
  return {
    id,
    kind: m.kind,
    mimeType: m.mimeType,
    originalName: m.originalName,
    sizeBytes: m.sizeBytes,
    width: m.width ?? null,
    height: m.height ?? null,
    durationSeconds: m.durationSeconds ?? null,
    previewUrl: `/api/media/${id}/file`,
    thumbnailUrl: m.thumbnailKey ? `/api/media/${id}/file?variant=thumb` : m.kind === 'image' ? `/api/media/${id}/file` : null,
    createdAt: m.createdAt.toISOString(),
  };
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

function kindOf(mime: string): MediaKind | null {
  if (UPLOAD_MIME_TYPES.image.includes(mime)) return 'image';
  if (UPLOAD_MIME_TYPES.video.includes(mime)) return 'video';
  return null;
}

export const uploadTmpDir = () => join(tmpdir(), 'nexora-uploads');

export interface UploadedFile {
  path: string;
  originalname: string;
  size: number;
}

/**
 * Recebe o arquivo do upload e o deixa pronto para a Meta:
 *  - tipo detectado pelo conteúdo (nunca pela extensão ou header do cliente);
 *  - imagem normalizada para JPEG (único formato aceito), orientação EXIF
 *    aplicada, metadados removidos, largura máxima 1440 px;
 *  - vídeo lido com ffprobe (duração/resolução/codec) e miniatura extraída.
 */
export async function ingestUpload(userId: Types.ObjectId, plan: PlanId, file: UploadedFile): Promise<MediaDTO> {
  try {
    const detected = await fileTypeFromFile(file.path);
    const kind = detected ? kindOf(detected.mime) : null;
    if (!detected || !kind) throw badRequest('Formato não suportado. Envie JPEG, PNG, WebP, MP4 ou MOV.');

    const used = await Media.aggregate<{ total: number }>([
      { $match: { userId, deletedAt: null } },
      { $group: { _id: null, total: { $sum: '$sizeBytes' } } },
    ]);
    const limitBytes = PLANS[plan].storageMb * 1024 * 1024;
    if ((used[0]?.total ?? 0) + file.size > limitBytes) {
      throw planLimit(`A biblioteca atingiu o limite de ${PLANS[plan].storageMb} MB do seu plano. Remova mídias antigas.`);
    }

    const checksum = await sha256File(file.path);
    const duplicate = await Media.findOne({ userId, checksum, deletedAt: null }).lean();
    if (duplicate) return toMediaDTO(duplicate);

    const mediaId = new Types.ObjectId();
    const prefix = mediaPrefix(userId.toString(), mediaId.toString());
    const storage = fileStorage();
    const originalName = file.originalname.slice(0, 200) || 'arquivo';

    if (kind === 'image') {
      const key = join(prefix, 'original.jpg');
      const pipeline = sharp(file.path, { failOn: 'error' }).rotate().resize({ width: 1440, withoutEnlargement: true });
      let buffer = await pipeline.clone().jpeg({ quality: 90, mozjpeg: true }).toBuffer({ resolveWithObject: true });
      if (buffer.data.length > MAX_IMAGE_BYTES) {
        buffer = await pipeline.clone().jpeg({ quality: 75, mozjpeg: true }).toBuffer({ resolveWithObject: true });
      }
      if (buffer.data.length > MAX_IMAGE_BYTES) throw badRequest('Imagem grande demais mesmo após compressão (máximo 8 MB).');
      await storage.putBuffer(key, buffer.data);
      const thumbKey = join(prefix, 'thumb.webp');
      await storage.putBuffer(thumbKey, await sharp(buffer.data).resize({ width: 480, withoutEnlargement: true }).webp({ quality: 80 }).toBuffer());
      const doc = await Media.create({
        _id: mediaId,
        userId,
        kind,
        mimeType: 'image/jpeg',
        originalName,
        sizeBytes: buffer.data.length,
        width: buffer.info.width,
        height: buffer.info.height,
        storageKey: key,
        thumbnailKey: thumbKey,
        checksum,
      });
      return toMediaDTO(doc);
    }

    const ext = detected.mime === 'video/quicktime' ? 'mov' : 'mp4';
    const key = join(prefix, `original.${ext}`);
    const info = await probeVideo(file.path);
    await storage.putFile(key, file.path, { move: true });
    const thumbKey = join(prefix, 'thumb.jpg');
    const hasThumb = await extractFrame(storage.absolutePath(key), storage.absolutePath(thumbKey), 1).then(
      async (ok) => ok && (await storage.exists(thumbKey)),
    );
    const doc = await Media.create({
      _id: mediaId,
      userId,
      kind,
      mimeType: detected.mime,
      originalName,
      sizeBytes: (await stat(storage.absolutePath(key))).size,
      width: info?.width ?? null,
      height: info?.height ?? null,
      durationSeconds: info?.durationSeconds ?? null,
      videoCodec: info?.videoCodec ?? null,
      storageKey: key,
      thumbnailKey: hasThumb ? thumbKey : null,
      checksum,
    });
    return toMediaDTO(doc);
  } finally {
    await rm(file.path, { force: true });
  }
}

export async function listMedia(userId: Types.ObjectId, page: number, pageSize: number, kind?: MediaKind): Promise<Paginated<MediaDTO>> {
  const filter = { userId, deletedAt: null, ...(kind ? { kind } : {}) };
  const [items, total] = await Promise.all([
    Media.find(filter).sort({ createdAt: -1 }).skip((page - 1) * pageSize).limit(pageSize).lean(),
    Media.countDocuments(filter),
  ]);
  return { items: items.map(toMediaDTO), page, pageSize, total };
}

export async function getMediaOrThrow(userId: Types.ObjectId, mediaId: string): Promise<MediaDoc> {
  if (!Types.ObjectId.isValid(mediaId)) throw notFound('Mídia');
  const doc = await Media.findOne({ userId, _id: new Types.ObjectId(mediaId), deletedAt: null }).lean();
  if (!doc) throw notFound('Mídia');
  return doc;
}

export async function deleteMedia(userId: Types.ObjectId, mediaId: string): Promise<void> {
  const media = await getMediaOrThrow(userId, mediaId);
  const inUse = await Post.exists({
    userId,
    status: { $in: ['SCHEDULED', 'PUBLISHING'] },
    $or: [{ mediaIds: media._id }, { 'cover.mediaId': media._id }],
  });
  if (inUse) throw conflict('Esta mídia está em uma publicação pendente. Cancele a publicação antes de removê-la.');
  await Media.updateOne({ userId, _id: media._id }, { $set: { deletedAt: new Date() } });
  await fileStorage().removePrefix(mediaPrefix(userId.toString(), media._id.toString()));
}

/**
 * Confere se as mídias servem para o tipo de publicação, antes de entrar na
 * fila. Duração só é checada quando o ffprobe conseguiu medir.
 */
export function assertMediaFitsPost(type: PostType, media: MediaDoc[], cover: MediaDoc | null): void {
  const info = POST_TYPE_INFO[type];
  for (const m of media) {
    if (!info.acceptsKinds.includes(m.kind)) {
      throw badRequest(`${info.label} não aceita ${m.kind === 'video' ? 'vídeo' : 'imagem'} ("${m.originalName}").`);
    }
    if (m.kind === 'image' && (type === 'IMAGE' || type === 'CAROUSEL') && m.width && m.height) {
      const ratio = m.width / m.height;
      if (ratio < FEED_IMAGE_ASPECT.min - 0.01 || ratio > FEED_IMAGE_ASPECT.max + 0.01) {
        throw badRequest(`"${m.originalName}" tem proporção ${ratio.toFixed(2)}:1; o feed aceita de 4:5 (0.8) a 1.91:1.`);
      }
    }
    if (m.kind === 'video') {
      const rule = VIDEO_RULES[type === 'REEL' ? 'REEL' : type === 'STORY' ? 'STORY' : 'CAROUSEL'];
      if (m.sizeBytes > rule.maxBytes) throw badRequest(`"${m.originalName}" passa de ${Math.round(rule.maxBytes / 1048576)} MB.`);
      if (m.durationSeconds != null && (m.durationSeconds < rule.minSeconds || m.durationSeconds > rule.maxSeconds)) {
        throw badRequest(`"${m.originalName}" precisa ter entre ${rule.minSeconds}s e ${rule.maxSeconds}s para ${info.label}.`);
      }
    }
  }
  if (cover && cover.kind !== 'image') throw badRequest('A capa precisa ser uma imagem.');
}

export function assertKnownType(value: string): asserts value is PostType {
  if (!(value in POST_TYPE_INFO)) throw new AppError('VALIDATION_ERROR', 'Tipo de publicação inválido.', 400);
}
