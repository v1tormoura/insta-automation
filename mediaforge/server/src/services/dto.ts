import type {
  AssetDetailDTO,
  AssetDTO,
  BatchDTO,
  HistoryEntryDTO,
  JobDTO,
  JobStatus,
  MediaInfo,
  MetadataInspection,
  SavedProfileDTO,
} from '@mediaforge/shared';
import type { AssetRow, BatchRow, HistoryRow, JobRow, ProfileRow, Repositories } from '../db/repositories';

export function parseJson<T>(s: string | null | undefined): T | null {
  if (!s) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

export function assetToDTO(row: AssetRow, repos: Repositories): AssetDTO {
  const info = parseJson<MediaInfo>(row.info_json);
  const meta = parseJson<MetadataInspection>(row.metadata_json);
  const byCategory: AssetDTO['metadataSummary']['byCategory'] = {};
  for (const i of meta?.items ?? []) byCategory[i.category] = (byCategory[i.category] ?? 0) + 1;
  const dupes =
    row.status === 'ready' ? repos.assetsByHash(row.session_id, row.sha256).filter((a) => a.id !== row.id).map((a) => a.id) : [];
  return {
    id: row.id,
    kind: row.kind,
    name: row.original_name,
    ext: row.ext,
    size: row.size,
    sha256: row.sha256,
    status: row.status,
    error: row.error,
    createdAt: row.created_at,
    container: row.container,
    durationSec: info?.durationSec ?? null,
    width: info?.displayWidth ?? null,
    height: info?.displayHeight ?? null,
    fps: info?.fps ?? null,
    videoCodec: info?.videoCodec ?? null,
    audioCodec: info?.audioCodec ?? null,
    hasAudio: info?.audioIndex !== null && info?.audioIndex !== undefined,
    bitrate: info?.bitrate ?? null,
    thumbnailUrl: row.thumb_name ? `/api/assets/${row.id}/thumbnail` : null,
    fileUrl: `/api/assets/${row.id}/file`,
    duplicateOf: dupes,
    metadataSummary: {
      total: meta?.items.length ?? 0,
      sensitive: meta?.items.filter((i) => i.sensitive).length ?? 0,
      byCategory,
    },
  };
}

export function assetToDetailDTO(row: AssetRow, repos: Repositories): AssetDetailDTO {
  return {
    ...assetToDTO(row, repos),
    info: parseJson<MediaInfo>(row.info_json),
    metadata: parseJson<MetadataInspection>(row.metadata_json),
  };
}

export function jobToDTO(row: JobRow, repos: Repositories, assetCache?: Map<string, AssetRow | undefined>): JobDTO {
  let asset = assetCache?.get(row.asset_id);
  if (!assetCache?.has(row.asset_id)) {
    asset = repos.assetById(row.asset_id);
    assetCache?.set(row.asset_id, asset);
  }
  const out = parseJson<MediaInfo>(row.output_info_json);
  const completed = row.status === 'completed' && row.output_file;
  return {
    id: row.id,
    batchId: row.batch_id,
    assetId: row.asset_id,
    assetName: asset?.original_name ?? '(arquivo removido)',
    assetKind: asset?.kind ?? 'video',
    label: row.label,
    mode: row.mode,
    profileName: row.profile_name,
    status: row.status,
    phase: row.phase,
    progress: row.progress,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    error: row.error,
    errorCode: row.error_code,
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    durationMs: row.duration_ms,
    validationStatus: row.validation_status,
    output: completed
      ? {
          name: row.output_name!,
          size: row.output_size ?? 0,
          sha256: row.output_sha256 ?? '',
          container: out?.container ?? null,
          videoCodec: out?.videoCodec ?? null,
          audioCodec: out?.audioCodec ?? null,
          width: out ? (out.streams.find((s) => s.index === out.videoIndex)?.width ?? null) : null,
          height: out ? (out.streams.find((s) => s.index === out.videoIndex)?.height ?? null) : null,
          durationSec: out?.durationSec ?? null,
          fps: out?.fps ?? null,
          hasAudio: out?.audioIndex !== null && out?.audioIndex !== undefined,
          kind: row.output_kind ?? 'video',
          thumbnailUrl: row.output_thumb ? `/api/jobs/${row.id}/thumbnail` : null,
          previewUrl: `/api/jobs/${row.id}/output`,
          downloadUrl: `/api/jobs/${row.id}/download`,
          reportUrl: `/api/jobs/${row.id}/report`,
        }
      : null,
  };
}

export function batchToDTO(row: BatchRow, repos: Repositories): BatchDTO {
  const counts: Record<JobStatus, number> & { total: number } = { queued: 0, running: 0, completed: 0, failed: 0, canceled: 0, total: 0 };
  let progressSum = 0;
  for (const c of repos.batchCounts(row.id)) {
    counts[c.status] = Number(c.n);
    counts.total += Number(c.n);
    progressSum += c.status === 'running' ? Number(c.p ?? 0) : c.status === 'queued' ? 0 : Number(c.n);
  }
  return {
    id: row.id,
    label: row.label,
    mode: row.mode,
    scope: row.scope,
    createdAt: row.created_at,
    counts,
    progress: counts.total ? progressSum / counts.total : 0,
  };
}

export function historyToDTO(row: HistoryRow): HistoryEntryDTO {
  return { id: row.id, type: row.type, level: row.level, message: row.message, createdAt: row.created_at };
}

export function profileToDTO(row: ProfileRow): SavedProfileDTO {
  return {
    id: row.id,
    name: row.name,
    mode: row.mode,
    settings: JSON.parse(row.settings_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
