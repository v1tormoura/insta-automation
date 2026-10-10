import fsp from 'node:fs/promises';
import type { AssetKind, MetadataInspection, MetadataItem } from '@mediaforge/shared';
import { readHead } from '../hashing';
import type { ProbeResult } from '../probe';
import { classifyKey, isMuxerDefault, normalizeKey, type ItemCategory } from './categories';
import { imageContainerOf, imageItems, readImageBlocks } from './imageMeta';
import { isKnownTopLevel, scanMp4Boxes, XMP_UUID } from './mp4boxes';

const MAX_IMAGE_BYTES = 256 * 1024 * 1024;

/** Assinaturas de encoders gravadas dentro do bitstream (SEI user data). */
export const BITSTREAM_SIGNATURES: Array<{ id: string; label: string; pattern: Buffer }> = [
  { id: 'sei:x264', label: 'x264 (parâmetros do encoder)', pattern: Buffer.from('x264 - core') },
  { id: 'sei:x265', label: 'x265 (parâmetros do encoder)', pattern: Buffer.from('x265 (build') },
  { id: 'sei:handbrake', label: 'HandBrake', pattern: Buffer.from('HandBrake') },
];

/** Átomos proprietários conhecidos em udta. */
const UDTA_ATOMS: Record<string, [string, ItemCategory]> = {
  GPMF: ['Telemetria GoPro (GPMF, inclui GPS)', 'gps'],
  FIRM: ['Firmware da câmera', 'device'],
  CAME: ['Identificador da câmera', 'device'],
  LENS: ['Lente', 'device'],
  MUID: ['Identificador único da mídia', 'custom'],
  HMMT: ['Marcações de destaque', 'custom'],
  BCID: ['Identificador de gravação', 'custom'],
  smta: ['Dados Samsung (smta)', 'custom'],
  SDLN: ['Dados Samsung (SDLN)', 'custom'],
  loci: ['Localização (loci)', 'gps'],
  XMP_: ['Pacote XMP', 'custom'],
  manu: ['Fabricante', 'device'],
  modl: ['Modelo', 'device'],
  meta: ['', 'custom'],
};

const STREAM_TYPE_LABEL: Record<string, string> = {
  video: 'vídeo',
  audio: 'áudio',
  subtitle: 'legenda',
  data: 'dados',
  attachment: 'anexo',
};

/**
 * Inspeciona todos os metadados que as ferramentas conseguem enxergar:
 * contêiner, fluxos, dados laterais, capítulos, fluxos extras, caixas
 * proprietárias e assinaturas no bitstream (vídeo) ou EXIF/XMP/IPTC/ICC,
 * comentários e blocos extras (imagem).
 */
export async function inspectMetadata(file: string, kind: AssetKind, ext: string, probe: ProbeResult): Promise<MetadataInspection> {
  const items: MetadataItem[] = [];
  const warnings: string[] = [];
  let orientation: number | null = null;

  const container = imageContainerOf(ext);
  if (kind === 'image' && container) {
    const stat = await fsp.stat(file);
    if (stat.size > MAX_IMAGE_BYTES) {
      warnings.push('Imagem grande demais para inspeção detalhada de metadados.');
    } else {
      try {
        const blocks = readImageBlocks(await fsp.readFile(file), container);
        items.push(...imageItems(blocks));
        warnings.push(...blocks.warnings);
        orientation = blocks.orientation;
      } catch (err) {
        warnings.push(`Estrutura da imagem não pôde ser lida: ${(err as Error).message}`);
      }
    }
    return { items: dedupe(items), warnings, orientation };
  }

  const raw = probe.raw;
  const info = probe.info;

  for (const [key, value] of Object.entries(raw.format?.tags ?? {})) {
    let c = classifyKey(key, 'format');
    if (isMuxerDefault(key, value)) c = { category: 'technical', sensitive: false };
    items.push({
      id: `fmt:${normalizeKey(key)}`,
      scope: 'container',
      location: 'Contêiner',
      key,
      value: String(value).slice(0, 300),
      category: c.category,
      sensitive: c.sensitive,
      removable: c.category !== 'technical',
      note: c.category === 'technical' ? 'Escrito por qualquer gravador do formato.' : undefined,
    });
  }

  for (const s of raw.streams ?? []) {
    const main = s.index === info.videoIndex ? 'v' : s.index === info.audioIndex ? 'a' : null;
    const prefix = main ? `st:${main}` : `st:x${s.index}`;
    const location = main
      ? `Fluxo de ${main === 'v' ? 'vídeo' : 'áudio'}`
      : `Fluxo #${s.index} (${STREAM_TYPE_LABEL[s.codec_type ?? ''] ?? s.codec_type ?? '?'})`;
    for (const [key, value] of Object.entries(s.tags ?? {})) {
      let c = classifyKey(key, 'stream');
      if (isMuxerDefault(key, value)) c = { category: 'technical', sensitive: false };
      items.push({
        id: `${prefix}:${normalizeKey(key)}`,
        scope: 'stream',
        location,
        key,
        value: String(value).slice(0, 300),
        category: c.category,
        sensitive: c.sensitive,
        removable: c.category !== 'technical',
      });
    }
    if (main) {
      for (const sd of s.side_data_list ?? []) {
        const type = String(sd.side_data_type ?? 'Dados laterais');
        const isMatrix = /display matrix/i.test(type);
        items.push({
          id: `sd:${main}:${type.toLowerCase().replace(/\s+/g, '-')}`,
          scope: 'side-data',
          location,
          key: isMatrix ? 'Matriz de exibição' : type,
          value: isMatrix ? `rotação ${sd.rotation ?? 0}°` : 'presente',
          category: 'technical',
          sensitive: false,
          removable: false,
          note: isMatrix ? 'Define a orientação de exibição; preservada.' : undefined,
        });
      }
    } else {
      const tag = (s.codec_tag_string ?? '').toLowerCase();
      let category: ItemCategory = 'streams';
      let label = `${STREAM_TYPE_LABEL[s.codec_type ?? ''] ?? 'fluxo'} ${s.codec_name ?? tag ?? ''}`.trim();
      let sensitive = false;
      if (s.disposition?.attached_pic) {
        category = 'custom';
        label = 'Capa/imagem embutida';
        sensitive = true;
      } else if (/gpmd|camm/.test(tag) || /gopro/i.test(s.tags?.handler_name ?? '')) {
        category = 'gps';
        label = 'Telemetria (pode conter GPS)';
        sensitive = true;
      } else if (tag === 'mebx') {
        category = 'custom';
        label = 'Metadados temporizados (Apple)';
        sensitive = true;
      } else if (s.codec_type === 'subtitle') {
        category = 'descriptive';
        label = `Legenda embutida (${s.codec_name ?? '?'})`;
        sensitive = true;
      }
      items.push({
        id: `xs:${s.index}`,
        scope: 'extra-stream',
        location: `Fluxo #${s.index}`,
        key: label,
        value: [s.codec_name, tag && tag !== '[0][0][0][0]' ? tag : null].filter(Boolean).join(' / ') || 'desconhecido',
        category,
        sensitive,
        removable: true,
        note: 'A saída inclui apenas um fluxo de vídeo e um de áudio.',
      });
    }
  }

  (raw.chapters ?? []).forEach((ch, i) => {
    items.push({
      id: `chap:${i}`,
      scope: 'chapter',
      location: 'Capítulos',
      key: `Capítulo ${i + 1}`,
      value: `${ch.tags?.title ?? 'sem título'} (${Number(ch.start_time ?? 0).toFixed(1)}s–${Number(ch.end_time ?? 0).toFixed(1)}s)`,
      category: 'container',
      sensitive: !!ch.tags?.title,
      removable: true,
    });
  });

  if (/mov|mp4|m4a|3gp/.test(info.container)) {
    try {
      const { boxes, warnings: w } = await scanMp4Boxes(file);
      warnings.push(...w);
      for (const b of boxes) {
        const parent = b.path.split('/').slice(-2, -1)[0] ?? '';
        if (b.type === 'uuid') {
          const isXmp = b.preview === XMP_UUID;
          items.push({
            id: `box:${b.path}:${b.preview ?? ''}`,
            scope: 'box',
            location: `Caixa ${b.path}`,
            key: isXmp ? 'Pacote XMP (uuid)' : 'Caixa uuid de fabricante',
            value: `<${b.size} bytes>`,
            category: 'custom',
            sensitive: true,
            removable: true,
          });
        } else if (parent === 'udta' && !b.type.startsWith('\xA9') && !['meta', 'hnti', 'name', 'tags', 'Xtra'].includes(b.type)) {
          const def = UDTA_ATOMS[b.type];
          items.push({
            id: `box:${b.path}`,
            scope: 'box',
            location: `Caixa ${b.path}`,
            key: def?.[0] || `Átomo ${b.type}`,
            value: b.preview ?? `<${b.size} bytes>`,
            category: def?.[1] ?? 'custom',
            sensitive: true,
            removable: true,
          });
        } else if (!b.path.includes('/') && !isKnownTopLevel(b.type)) {
          items.push({
            id: `box:${b.type}`,
            scope: 'box',
            location: 'Nível superior do arquivo',
            key: `Caixa desconhecida ${b.type}`,
            value: `<${b.size} bytes>`,
            category: 'custom',
            sensitive: true,
            removable: true,
          });
        }
      }
    } catch (err) {
      warnings.push(`Estrutura MP4/MOV não pôde ser percorrida: ${(err as Error).message}`);
    }
  }

  if (kind === 'video' && info.videoIndex !== null) {
    const head = await readHead(file).catch(() => Buffer.alloc(0));
    for (const sig of BITSTREAM_SIGNATURES) {
      const at = head.indexOf(sig.pattern);
      if (at < 0) continue;
      const value = head.toString('latin1', at, Math.min(head.length, at + 90)).replace(/[^\x20-\x7E]/g, ' ').trim() + '…';
      items.push({
        id: sig.id,
        scope: 'bitstream',
        location: 'Dentro do fluxo de vídeo (SEI)',
        key: sig.label,
        value,
        category: 'embedded',
        sensitive: false,
        removable: true,
        note: 'Removível sem recodificar com a opção "Dados no bitstream (SEI)".',
      });
    }
  }

  return { items: dedupe(items), warnings, orientation };
}

function dedupe(items: MetadataItem[]): MetadataItem[] {
  const seen = new Set<string>();
  return items.filter((i) => (seen.has(i.id) ? false : (seen.add(i.id), true)));
}
