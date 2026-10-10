import type {
  AssetDetailDTO,
  AssetDTO,
  BatchDTO,
  BatchRequest,
  BuiltinProfile,
  HistoryEntryDTO,
  JobDTO,
  JobReport,
  METADATA_PRESETS,
  OperationRecord,
  PlanResponse,
  ProcessingSettings,
  SavedProfileDTO,
  SessionDTO,
  SystemInfoDTO,
} from '@mediaforge/shared';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** Lista legível de detalhes (mensagens de validação por arquivo etc.). */
  get detailLines(): string[] {
    const d = this.details;
    if (!Array.isArray(d)) return [];
    return d.map((x) =>
      typeof x === 'string' ? x : x && typeof x === 'object' && 'message' in x ? `${(x as { assetName?: string }).assetName ? `${(x as { assetName: string }).assetName}: ` : ''}${(x as { message: string }).message}` : JSON.stringify(x),
    );
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string; details?: unknown } } | null)?.error;
    throw new ApiError(res.status, err?.code ?? 'http-error', err?.message ?? `Erro HTTP ${res.status}`, err?.details);
  }
  return data as T;
}

export interface UploadResultItem {
  name: string;
  ok: boolean;
  asset?: AssetDTO;
  error?: string;
}

/** Envio com progresso (fetch não informa progresso de upload). */
export function uploadFile(file: File, onProgress: (fraction: number) => void, signal?: AbortSignal): Promise<UploadResultItem> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/assets');
    xhr.withCredentials = true;
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      let data: { results?: UploadResultItem[]; error?: { code?: string; message?: string } } | null = null;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        /* resposta não-JSON */
      }
      if (xhr.status >= 200 && xhr.status < 300 && data?.results?.[0]) resolve(data.results[0]);
      else reject(new ApiError(xhr.status, data?.error?.code ?? 'upload-failed', data?.error?.message ?? `Falha no envio (HTTP ${xhr.status})`));
    };
    xhr.onerror = () => reject(new ApiError(0, 'network', 'Falha de rede durante o envio.'));
    xhr.onabort = () => reject(new ApiError(0, 'aborted', 'Envio cancelado.'));
    signal?.addEventListener('abort', () => xhr.abort(), { once: true });
    const form = new FormData();
    form.append('file', file, file.name);
    xhr.send(form);
  });
}

export interface PreviewResult {
  url: string;
  kind: 'video' | 'image';
  width: number | null;
  height: number | null;
  durationSec: number | null;
  operations: OperationRecord[];
  warnings: string[];
  skipped: Array<{ label: string; reason: string }>;
}

export interface Presets {
  exportProfiles: BuiltinProfile[];
  editorialPresets: BuiltinProfile[];
  metadataPresets: typeof METADATA_PRESETS;
}

export type JobDetail = JobDTO & { report: JobReport | null; logTail: string | null };

export const api = {
  session: () => request<SessionDTO>('GET', '/api/session'),
  newSession: () => request<SessionDTO>('DELETE', '/api/session'),
  login: (accessKey: string) => request<SessionDTO>('POST', '/api/session', { accessKey }),
  system: () => request<SystemInfoDTO>('GET', '/api/system'),
  setConcurrency: (value: number) => request<SystemInfoDTO['queue']>('PUT', '/api/system/concurrency', { value }),
  presets: () => request<Presets>('GET', '/api/presets'),
  history: () => request<HistoryEntryDTO[]>('GET', '/api/history'),

  assets: () => request<AssetDTO[]>('GET', '/api/assets'),
  asset: (id: string) => request<AssetDetailDTO>('GET', `/api/assets/${id}`),
  deleteAsset: (id: string) => request<{ ok: true }>('DELETE', `/api/assets/${id}`),

  plan: (body: BatchRequest) => request<PlanResponse>('POST', '/api/plan', body),
  createBatch: (body: BatchRequest) => request<{ batch: BatchDTO; jobs: JobDTO[] }>('POST', '/api/batches', body),
  batches: () => request<BatchDTO[]>('GET', '/api/batches'),
  cancelBatch: (id: string) => request<{ canceled: number }>('POST', `/api/batches/${id}/cancel`),
  retryBatch: (id: string) => request<{ retried: number }>('POST', `/api/batches/${id}/retry`),

  jobs: () => request<JobDTO[]>('GET', '/api/jobs'),
  job: (id: string) => request<JobDetail>('GET', `/api/jobs/${id}`),
  cancelJob: (id: string) => request<{ ok: true }>('POST', `/api/jobs/${id}/cancel`),
  retryJob: (id: string) => request<{ ok: true }>('POST', `/api/jobs/${id}/retry`),
  deleteJob: (id: string) => request<{ ok: true }>('DELETE', `/api/jobs/${id}`),
  cancelPending: () => request<{ canceled: number }>('POST', '/api/jobs/cancel-pending'),
  clearFinished: (includeCompleted: boolean) => request<{ removed: number }>('POST', '/api/jobs/clear-finished', { includeCompleted }),

  prepareExport: (jobIds: string[] | null) =>
    request<{ id: string; url: string; count: number; totalBytes: number }>('POST', '/api/exports', { jobIds }),
  preview: (assetId: string, settings: ProcessingSettings, offset = 0, container: 'mp4' | 'webm' = 'mp4') =>
    request<PreviewResult>('POST', '/api/preview', { assetId, settings, offset, container }),

  profiles: () => request<SavedProfileDTO[]>('GET', '/api/profiles'),
  saveProfile: (name: string, settings: ProcessingSettings) => request<SavedProfileDTO>('POST', '/api/profiles', { name, settings }),
  updateProfile: (id: string, name: string, settings: ProcessingSettings) =>
    request<SavedProfileDTO>('PUT', `/api/profiles/${id}`, { name, settings }),
  deleteProfile: (id: string) => request<{ ok: true }>('DELETE', `/api/profiles/${id}`),
};

/** O navegador reproduz H.264/AAC em MP4? (Chromium sem codecs proprietários não.) */
export function supportsH264(): boolean {
  try {
    const v = document.createElement('video');
    return v.canPlayType('video/mp4; codecs="avc1.640028, mp4a.40.2"') !== '';
  } catch {
    return true;
  }
}

/** Dispara o download do navegador para uma URL da API (mesma origem, com cookie). */
export function triggerDownload(url: string) {
  const a = document.createElement('a');
  a.href = url;
  a.rel = 'noopener';
  a.download = '';
  document.body.appendChild(a);
  a.click();
  a.remove();
}
