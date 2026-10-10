import { createHash } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { AssetKind, MediaInfo, MetadataInspection } from '@mediaforge/shared';
import type { AppContext } from '../context';
import type { AssetRow } from '../db/repositories';
import { inspectMetadata } from '../media/metadata/inspect';
import { probeFile, ProbeError, type ProbeResult } from '../media/probe';
import { runProcess } from '../media/process';
import { isRejection, sniffFile, type SniffResult } from '../media/signature';
import { makeThumbnail } from '../media/thumbnails';
import { newId, sanitizeDisplayName } from '../security/filenames';
import { assetToDTO } from './dto';

export class ImportError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'ImportError';
  }
}

export interface ImportOutcome {
  asset: AssetRow;
}

const MAX_SUBTITLE_BYTES = 2 * 1024 * 1024;

/**
 * Importação: grava em área temporária calculando SHA-256 em streaming,
 * identifica o tipo pelo conteúdo, inspeciona com FFprobe, aplica limites,
 * testa a decodificação (miniatura) e só então move para "uploads".
 * Arquivos recusados ficam registrados como inválidos (sem os bytes), para
 * o usuário ver o motivo.
 */
export class ImportService {
  constructor(private ctx: AppContext) {}

  async importStream(sessionId: string, stream: Readable & { truncated?: boolean }, originalName: string): Promise<ImportOutcome> {
    const { repos, storage, config } = this.ctx;
    const displayName = sanitizeDisplayName(originalName);
    const id = newId();
    const now = Date.now();

    const recordInvalid = (message: string, size = 0, sha256 = ''): ImportOutcome => {
      const row: AssetRow = {
        id,
        session_id: sessionId,
        kind: 'video',
        original_name: displayName,
        stored_name: null,
        ext: (displayName.split('.').pop() ?? '').toLowerCase().slice(0, 10),
        size,
        sha256,
        container: null,
        info_json: null,
        metadata_json: null,
        thumb_name: null,
        status: 'invalid',
        error: message,
        created_at: now,
      };
      repos.insertAsset(row);
      this.ctx.history.add(sessionId, 'import', 'warning', `Arquivo recusado: ${displayName} — ${message}`);
      this.ctx.events.publish(sessionId, { type: 'asset', asset: assetToDTO(row, repos) });
      return { asset: row };
    };

    if (repos.countAssets(sessionId) >= config.limits.maxAssetsPerSession) {
      stream.resume();
      throw new ImportError(`Limite de ${config.limits.maxAssetsPerSession} arquivos por sessão atingido.`, 'limit');
    }

    await storage.ensureSession(sessionId);
    const stage = storage.file(sessionId, 'tmp', `upload-${id}`);
    const hash = createHash('sha256');
    let size = 0;
    const meter = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        hash.update(chunk);
        size += chunk.length;
        cb(null, chunk);
      },
    });

    try {
      await pipeline(stream, meter, fs.createWriteStream(stage, { flags: 'wx' }));
    } catch (err) {
      await fsp.rm(stage, { force: true });
      throw new ImportError(`Falha ao receber o arquivo: ${(err as Error).message}`, 'upload');
    }
    const sha256 = hash.digest('hex');
    const cleanup = () => fsp.rm(stage, { force: true });

    if (stream.truncated) {
      await cleanup();
      return recordInvalid(`Excede o limite de ${config.limits.maxUploadMb} MB por arquivo.`, size);
    }
    if (size === 0) {
      await cleanup();
      return recordInvalid('Arquivo vazio.', 0);
    }

    try {
      const sniff = await sniffFile(stage);
      if (isRejection(sniff)) return (await cleanup(), recordInvalid(sniff.reason, size, sha256));
      if (!sniff) return (await cleanup(), recordInvalid('Conteúdo não reconhecido como vídeo, imagem, áudio ou legenda suportados.', size, sha256));

      const warnings: string[] = [];
      const declaredExt = (displayName.includes('.') ? displayName.split('.').pop() ?? '' : '').toLowerCase();
      const equivalent: Record<string, string[]> = { jpg: ['jpg', 'jpeg', 'jpe', 'jfif'], tif: ['tif', 'tiff'], mp4: ['mp4', 'm4v'], mpg: ['mpg', 'mpeg'] };
      if (declaredExt && !(equivalent[sniff.ext] ?? [sniff.ext]).includes(declaredExt)) {
        warnings.push(`A extensão .${declaredExt} não corresponde ao conteúdo real (${sniff.label}); o arquivo foi tratado como ${sniff.label}.`);
      }

      let probe: ProbeResult;
      try {
        probe = await probeFile(this.ctx.tools, stage);
      } catch (err) {
        await cleanup();
        const msg = err instanceof ProbeError ? err.message : String(err);
        if (sniff.format === 'heif')
          return recordInvalid('HEIC/AVIF não é suportado pela versão do FFmpeg instalada. Converta para JPG/PNG antes de importar.', size, sha256);
        return recordInvalid(msg, size, sha256);
      }
      const info = probe.info;
      const kind = this.classify(sniff, info);
      if (!kind) return (await cleanup(), recordInvalid('Nenhum fluxo de vídeo, imagem ou áudio decodificável encontrado.', size, sha256));

      const limitError = this.checkLimits(kind, info);
      if (limitError) return (await cleanup(), recordInvalid(limitError, size, sha256));

      const storedName = `${id}.${sniff.ext}`;
      const thumbName = `${id}.jpg`;
      let metadata: MetadataInspection = { items: [], warnings: [], orientation: null };
      if (kind === 'video' || kind === 'image' || kind === 'audio') {
        metadata = await inspectMetadata(stage, kind, sniff.ext, probe);
      }
      metadata.warnings.unshift(...warnings);

      let thumb: string | null = null;
      if (kind === 'video' || kind === 'image') {
        try {
          await makeThumbnail(this.ctx.tools, stage, storage.file(sessionId, 'thumbs', thumbName), info, { orientation: metadata.orientation });
          thumb = thumbName;
        } catch (err) {
          await cleanup();
          return recordInvalid(`Não foi possível decodificar a mídia (arquivo corrompido ou codec sem suporte). ${(err as Error).message}`.slice(0, 400), size, sha256);
        }
      } else if (kind === 'audio') {
        const r = await runProcess(this.ctx.tools.ffmpeg.path, ['-hide_banner', '-nostdin', '-v', 'error', '-t', '3', '-i', stage, '-map', `0:${info.audioIndex}`, '-f', 'null', '-'], { timeoutMs: 60_000 });
        if (r.code !== 0) return (await cleanup(), recordInvalid('Não foi possível decodificar o áudio.', size, sha256));
      } else if (kind === 'subtitle') {
        const err = await this.validateSubtitle(stage, size);
        if (err) return (await cleanup(), recordInvalid(err, size, sha256));
      }

      await fsp.rename(stage, storage.file(sessionId, 'uploads', storedName));
      const row: AssetRow = {
        id,
        session_id: sessionId,
        kind,
        original_name: displayName,
        stored_name: storedName,
        ext: sniff.ext,
        size,
        sha256,
        container: sniff.label,
        info_json: JSON.stringify(info),
        metadata_json: JSON.stringify(metadata),
        thumb_name: thumb,
        status: 'ready',
        error: null,
        created_at: now,
      };
      repos.insertAsset(row);
      const dupes = repos.assetsByHash(sessionId, sha256).filter((a) => a.id !== id);
      this.ctx.history.add(
        sessionId,
        'import',
        dupes.length ? 'warning' : 'success',
        `Importado: ${displayName} (${sniff.label})${dupes.length ? ' — idêntico (SHA-256) a ' + dupes.map((d) => d.original_name).join(', ') : ''}`,
      );
      this.ctx.log.info({ assetId: id, kind, size }, 'arquivo importado');
      this.ctx.events.publish(sessionId, { type: 'asset', asset: assetToDTO(row, repos) });
      return { asset: row };
    } catch (err) {
      await cleanup();
      throw err;
    }
  }

  private classify(sniff: SniffResult, info: MediaInfo): AssetKind | null {
    if (sniff.family === 'subtitle') return 'subtitle';
    if (sniff.family === 'image') {
      if (info.videoIndex === null) return null;
      if (sniff.format === 'gif' && (info.durationSec ?? 0) > 0.15 && (info.frames ?? 2) > 1) return 'video';
      return 'image';
    }
    if (sniff.family === 'audio') return info.audioIndex !== null ? 'audio' : null;
    if (info.videoIndex !== null) return 'video';
    if (info.audioIndex !== null) return 'audio';
    return null;
  }

  private checkLimits(kind: AssetKind, info: MediaInfo): string | null {
    const l = this.ctx.config.limits;
    if ((kind === 'video' || kind === 'audio') && (info.durationSec ?? 0) > l.maxDurationSec) {
      return `Duração de ${Math.round(info.durationSec ?? 0)} s excede o limite de ${l.maxDurationSec} s.`;
    }
    const w = info.displayWidth ?? 0;
    const h = info.displayHeight ?? 0;
    if (w > l.maxResolution || h > l.maxResolution) return `Resolução ${w}×${h} excede o limite de ${l.maxResolution} px.`;
    if ((kind === 'video' || kind === 'image') && (w < 2 || h < 2)) return 'Dimensões de imagem inválidas.';
    return null;
  }

  private async validateSubtitle(file: string, size: number): Promise<string | null> {
    if (size > MAX_SUBTITLE_BYTES) return 'Legenda grande demais (máx. 2 MB).';
    const text = (await fsp.readFile(file)).toString('utf8');
    if (text.includes('�')) return 'Legenda precisa estar em UTF-8.';
    const blocks = text.replace(/^﻿/, '').trim().split(/\r?\n\s*\r?\n/);
    const timing = /^\s*\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}\s*-->\s*\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}/m;
    const valid = blocks.filter((b) => timing.test(b));
    if (valid.length === 0) return 'Nenhuma entrada de legenda válida (formato SRT).';
    return null;
  }
}
