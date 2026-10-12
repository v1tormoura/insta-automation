import { applyExportProfile, computeSegments, rateValue, SegmentationError, type AssetDTO, type BatchRequest, type BuiltinProfile, type ProcessingSettings, type SavedProfileDTO } from '@mediaforge/shared';

/**
 * Partes geradas pela divisão — o mesmo algoritmo do servidor (grade de
 * quadros, resto curto somado à parte anterior). Divisão impossível → 0.
 */
export function partsFor(asset: AssetDTO, s: ProcessingSettings): number {
  if (asset.kind !== 'video') return 1;
  try {
    return computeSegments(asset.durationSec, rateValue(asset.frameRateExact ?? null), s)?.length ?? 1;
  } catch (err) {
    if (err instanceof SegmentationError) return 0;
    throw err;
  }
}

export interface OutputCount {
  files: number;
  profiles: number;
  total: number;
  withParts: boolean;
}

/** Catálogo de perfis conhecido pela interface (embutidos + salvos). */
export interface ProfileCatalog {
  exportProfiles: readonly Pick<BuiltinProfile, 'id' | 'patch'>[];
  saved: readonly Pick<SavedProfileDTO, 'id' | 'settings'>[];
}

/** Configurações que o servidor usará para um perfil (null se o perfil não existir mais). */
export function settingsForProfile(base: ProcessingSettings, profileId: string, catalog: ProfileCatalog | null): ProcessingSettings | null {
  if (!catalog) return null;
  if (profileId.startsWith('saved:')) return catalog.saved.find((p) => `saved:${p.id}` === profileId)?.settings ?? null;
  const p = catalog.exportProfiles.find((x) => x.id === profileId);
  return p ? applyExportProfile(base, p.patch).settings : null;
}

/** Remove perfis que não existem mais no catálogo (ex.: perfil salvo excluído em outra aba). */
export function knownProfiles(profiles: string[], catalog: ProfileCatalog): string[] {
  return profiles.filter((id) =>
    id.startsWith('saved:') ? catalog.saved.some((p) => `saved:${p.id}` === id) : catalog.exportProfiles.some((p) => p.id === id),
  );
}

/**
 * Quantidade de saídas como o servidor calcula: cada perfil usa as próprias
 * configurações (perfil salvo substitui as atuais; o embutido é mesclado) e a
 * divisão em partes vale por perfil.
 */
export function countOutputs(
  assets: AssetDTO[],
  settingsFor: (id: string) => ProcessingSettings,
  profiles: string[],
  catalog: ProfileCatalog | null,
): OutputCount {
  // Catálogo ainda carregando (ou indisponível): conta os perfis como estão, com
  // as configurações atuais — o lote enviado leva os mesmos ids.
  const active = catalog ? knownProfiles(profiles, catalog) : profiles;
  let total = 0;
  let withParts = false;
  for (const a of assets) {
    const base = settingsFor(a.id);
    const variants = active.length ? active.map((id) => settingsForProfile(base, id, catalog) ?? base) : [base];
    for (const s of variants) {
      const parts = partsFor(a, s);
      if (parts > 1) withParts = true;
      total += parts;
    }
  }
  return { files: assets.length, profiles: Math.max(1, active.length), total, withParts };
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
