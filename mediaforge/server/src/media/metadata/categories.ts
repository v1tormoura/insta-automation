import type { MetadataCategory } from '@mediaforge/shared';

export type ItemCategory = MetadataCategory | 'technical';

export interface Classification {
  category: ItemCategory;
  sensitive: boolean;
}

/** Normaliza chaves para comparação (minúsculas, sem sufixo de idioma "-eng"). */
export function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/-[a-z]{3}$/, '').trim();
}

/** Campos estruturais escritos por qualquer muxer MP4/MOV; não identificam origem. */
const STRUCTURAL_FORMAT_KEYS = new Set(['major_brand', 'minor_version', 'compatible_brands']);

/** Tags técnicas de fluxo. */
const STREAM_TECH_KEYS = new Set([
  'handler_name',
  'vendor_id',
  'language',
  'timecode',
  'rotate',
  'duration',
  'number_of_frames',
  'number_of_bytes',
  'bps',
  '_statistics_writing_app',
  '_statistics_writing_date_utc',
  '_statistics_tags',
]);

/** Tags "de catálogo" comuns em contêineres, sem dado pessoal direto. */
const CONTAINER_CATALOG_KEYS = new Set([
  'track',
  'disc',
  'compilation',
  'gapless_playback',
  'media_type',
  'hd_video',
  'episode_id',
  'episode_sort',
  'season_number',
  'show',
  'network',
  'grouping',
  'isrc',
  'itunsmpb',
  'itunnorm',
  'tmpo',
  'cpil',
  'pgap',
  'stik',
  'rtng',
  'purd',
]);

const RE_GPS = /(location|gps|iso6709|©xyz|\bxyz\b|latitude|longitude|altitude|coordinat|geotag|\bgeo\b|loci|city|country|sublocation|province|state\/province)/i;
const RE_DATES = /(creation_?time|creationdate|create_?date|date_?time|datetime|\bdate\b|\bday\b|©day|modif|timestamp|offsettime|subsectime|time_?created|date_?created|_utc)/i;
const RE_DEVICE =
  /(\bmake\b|model|manufacturer|camera|lens|serial|device|\bbody\b|owner|firmware|hostcomputer|android\.version|com\.android|com\.apple\.quicktime\.(make|model)|©mak|©mod|exposure|fnumber|aperture|\biso|focal|flash|whitebalance|metering|shutter|brightnessvalue|scenetype|sensing|digitalzoom|gaincontrol|makernote)/i;
const RE_SOFTWARE =
  /(software|encoder|encoded_by|encoding|writing_?app|writing_?lib|creatortool|creator_?tool|application|©swr|©too|processing|history|toolkit|libavformat|lavf|producer)/i;
const RE_DESCRIPTIVE =
  /(comment|description|title|artist|author|album|copyright|keyword|subject|caption|synopsis|genre|composer|publisher|rating|lyric|headline|by-?line|credit|\bsource\b|creator|rights|©cmt|©des|©nam|©art|©alb|©gen|xp(comment|title|author|keywords|subject)|imagedescription|usercomment|contact|instructions|label|notes?\b)/i;

/**
 * Classifica um campo de metadado pelo nome (e pelo escopo onde foi achado).
 * A ordem importa: localização primeiro (ex.: "com.apple.quicktime.location.date"
 * contém data, mas é dado de localização).
 */
export function classifyKey(key: string, scope: 'format' | 'stream' | 'exif' | 'xmp' | 'iptc' | 'png' | 'other'): Classification {
  const k = normalizeKey(key);
  if (scope === 'format' && STRUCTURAL_FORMAT_KEYS.has(k)) return { category: 'technical', sensitive: false };
  if (RE_GPS.test(k)) return { category: 'gps', sensitive: true };
  if (scope === 'stream' && STREAM_TECH_KEYS.has(k)) return { category: 'streams', sensitive: false };
  if (RE_DEVICE.test(k)) return { category: 'device', sensitive: !/(exposure|fnumber|aperture|\biso|focal|flash|whitebalance|metering|shutter|brightness|scene|sensing|zoom|gain)/i.test(k) };
  if (RE_SOFTWARE.test(k)) return { category: 'software', sensitive: true };
  if (RE_DATES.test(k)) return { category: 'dates', sensitive: true };
  if (RE_DESCRIPTIVE.test(k)) return { category: 'descriptive', sensitive: true };
  if (scope === 'format' && CONTAINER_CATALOG_KEYS.has(k)) return { category: 'container', sensitive: false };
  if (scope === 'stream') return { category: 'streams', sensitive: false };
  // Chaves em notação reversa de domínio (com.apple.*, com.android.*) são proprietárias.
  if (/^(com|org|net|io)\./.test(k)) return { category: 'custom', sensitive: true };
  if (scope === 'format') return { category: 'container', sensitive: false };
  return { category: 'custom', sensitive: true };
}

/** Valores padrão que os muxers do FFmpeg escrevem (não vêm do arquivo original). */
export function isMuxerDefault(key: string, value: string): boolean {
  const k = normalizeKey(key);
  const v = value.trim();
  if (k === 'handler_name') return ['VideoHandler', 'SoundHandler', 'DataHandler', 'SubtitleHandler'].includes(v);
  if (k === 'vendor_id') return v === '[0][0][0][0]' || v === 'FFMP';
  if (k === 'language') return v === 'und';
  return false;
}
