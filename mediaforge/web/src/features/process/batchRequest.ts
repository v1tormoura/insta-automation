import type { AssetDTO, BatchRequest, ProcessingSettings } from '@mediaforge/shared';

/** Partes geradas pela divisão (mesma regra do servidor). */
export function partsFor(asset: AssetDTO, s: ProcessingSettings): number {
  if (asset.kind !== 'video' || s.mode === 'quick' || s.segmentation.mode === 'none' || !asset.durationSec) return 1;
  const start = s.trim.start ?? 0;
  const end = Math.min(s.trim.end ?? asset.durationSec, asset.durationSec);
  const len = end - start;
  if (len <= 0) return 1;
  if (s.segmentation.mode === 'count') return Math.max(1, Math.min(100, Math.round(s.segmentation.value)));
  return Math.ceil(len / Math.max(1, s.segmentation.value) - 1e-9);
}

export interface OutputCount {
  files: number;
  profiles: number;
  total: number;
  withParts: boolean;
}

export function countOutputs(assets: AssetDTO[], settingsFor: (id: string) => ProcessingSettings, profiles: string[]): OutputCount {
  const p = Math.max(1, profiles.length);
  let total = 0;
  let withParts = false;
  for (const a of assets) {
    const parts = partsFor(a, settingsFor(a.id));
    if (parts > 1) withParts = true;
    total += parts * p;
  }
  return { files: assets.length, profiles: p, total, withParts };
}

export function buildBatchRequest(
  assetIds: string[],
  scope: 'common' | 'individual',
  settings: ProcessingSettings,
  perAsset: Record<string, ProcessingSettings>,
  profiles: string[],
): BatchRequest {
  const own = scope === 'individual' ? Object.fromEntries(assetIds.filter((id) => perAsset[id]).map((id) => [id, perAsset[id]])) : undefined;
  return {
    assetIds,
    scope,
    settings,
    perAsset: own && Object.keys(own).length ? own : undefined,
    profiles,
  };
}
