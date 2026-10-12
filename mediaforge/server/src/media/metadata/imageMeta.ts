import type { MetadataItem, MetadataSettings } from '@mediaforge/shared';
import { classifyKey, type ItemCategory } from './categories';
import { exifTagInfo } from './exifTags';
import { assembleIcc, exifSegment, iccSegments, JPEG_SIGNATURES, parseJpeg, rebuildJpeg, segmentType } from './jpeg';
import { iccDescription, iptcItems, photoshopItems, xmpItems, xmpShouldRemove } from './packets';
import { chunkBytes, decodeIccp, decodeTextChunk, iccpChunk, parsePng, PNG_IMAGE_CHUNKS, rebuildPng, type PngText } from './png';
import {
  buildTiff,
  decodeEntry,
  orientationOf,
  orientationOnlyTiff,
  parseTiff,
  TAG_MAKERNOTE,
  TAG_ORIENTATION,
  type IfdName,
  type TiffData,
  type TiffEntry,
} from './tiff';
import { parseWebp, rebuildWebp, webpExifTiff } from './webp';

export type ImageContainer = 'jpeg' | 'png' | 'webp';

interface OtherBlock {
  id: string;
  label: string;
  size: number;
  category: ItemCategory;
  sensitive: boolean;
}

interface RawProfile {
  keyword: string;
  kind: 'exif' | 'xmp' | 'iptc' | 'other';
  tiff: TiffData | null;
  xmp: string | null;
  iptc: Buffer | null;
}

export interface ImageBlocks {
  format: ImageContainer;
  exif: TiffData | null;
  /** Blocos EXIF além do primeiro (JPEG/PNG/WEBP podem ter vários): nunca ignorados. */
  extraExif: Array<TiffData | null>;
  /** Perfis brutos do ImageMagick em PNG ("Raw profile type exif/xmp/iptc"). */
  rawProfiles: RawProfile[];
  xmp: string[];
  photoshop: Buffer[];
  icc: Buffer | null;
  comments: string[];
  pngTexts: PngText[];
  pngTime: string | null;
  others: OtherBlock[];
  trailingBytes: number;
  orientation: number | null;
  warnings: string[];
}

export function imageContainerOf(ext: string): ImageContainer | null {
  const e = ext.toLowerCase();
  if (e === 'jpg' || e === 'jpeg') return 'jpeg';
  if (e === 'png') return 'png';
  if (e === 'webp') return 'webp';
  return null;
}

function tryTiff(data: Buffer, warnings: string[]): TiffData | null {
  try {
    const t = parseTiff(data);
    warnings.push(...t.warnings);
    return t;
  } catch (err) {
    warnings.push(`Bloco EXIF ilegível: ${(err as Error).message}`);
    return null;
  }
}

const APP_NAMES: Record<number, string> = { 0xec: 'APP12 (Ducky)', 0xe3: 'APP3', 0xe4: 'APP4', 0xe5: 'APP5', 0xe6: 'APP6', 0xe7: 'APP7', 0xe8: 'APP8', 0xe9: 'APP9', 0xea: 'APP10', 0xeb: 'APP11', 0xef: 'APP15' };

/**
 * "Raw profile type exif|xmp|iptc" (ImageMagick): o perfil vem em hexadecimal
 * dentro de um chunk de texto: "\n<tipo>\n   <tamanho>\n<hex…>".
 */
function decodeRawProfile(text: string): Buffer | null {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 3) return null;
  const hex = lines.slice(2).join('').replace(/[^0-9a-fA-F]/g, '');
  if (hex.length < 2) return null;
  return Buffer.from(hex.length % 2 ? hex.slice(0, -1) : hex, 'hex');
}

function rawProfile(t: PngText, warnings: string[]): RawProfile | null {
  const m = t.keyword.toLowerCase().match(/^raw profile type (\w+)/);
  if (!m) return null;
  const type = m[1]!;
  const data = decodeRawProfile(t.text);
  const base: RawProfile = { keyword: t.keyword, kind: 'other', tiff: null, xmp: null, iptc: null };
  if (!data) return base;
  if (type === 'exif' || type === 'app1') {
    const tiffData = data.subarray(0, 6).toString('latin1') === 'Exif\0\0' ? data.subarray(6) : data;
    return { ...base, kind: 'exif', tiff: tryTiff(Buffer.from(tiffData), warnings) };
  }
  if (type === 'xmp') return { ...base, kind: 'xmp', xmp: data.toString('utf8') };
  if (type === 'iptc' || type === '8bim') return { ...base, kind: 'iptc', iptc: data };
  return base;
}

export function readImageBlocks(buf: Buffer, format: ImageContainer): ImageBlocks {
  const b: ImageBlocks = {
    format,
    exif: null,
    extraExif: [],
    rawProfiles: [],
    xmp: [],
    photoshop: [],
    icc: null,
    comments: [],
    pngTexts: [],
    pngTime: null,
    others: [],
    trailingBytes: 0,
    orientation: null,
    warnings: [],
  };
  let exifSeen = 0;
  const addExif = (data: Buffer) => {
    const parsed = tryTiff(data, b.warnings);
    if (exifSeen++ === 0) b.exif = parsed;
    else b.extraExif.push(parsed);
  };
  if (format === 'jpeg') {
    const s = parseJpeg(buf);
    const iccParts: Buffer[] = [];
    s.items.forEach((item, i) => {
      if (item.kind !== 'segment') return;
      const t = segmentType(item);
      if (t === 'exif') addExif(item.payload.subarray(6));
      else if (t === 'xmp') b.xmp.push(item.payload.subarray(JPEG_SIGNATURES.xmp.length).toString('utf8'));
      else if (t === 'xmp-ext') b.others.push({ id: `jpeg:xmp-ext:${i}`, label: 'XMP estendido', size: item.payload.length, category: 'custom', sensitive: true });
      else if (t === 'icc') iccParts.push(item.payload);
      else if (t === 'photoshop') b.photoshop.push(item.payload.subarray(JPEG_SIGNATURES.photoshop.length));
      else if (t === 'comment') b.comments.push(item.payload.toString('utf8').replace(/\0/g, '').trim());
      else if (t === 'jfxx') b.others.push({ id: 'jpeg:jfxx', label: 'Miniatura JFXX', size: item.payload.length, category: 'custom', sensitive: true });
      else if (t === 'mpf') b.others.push({ id: 'jpeg:mpf', label: 'MPF (imagens múltiplas)', size: item.payload.length, category: 'custom', sensitive: false });
      else if (t === 'app-other')
        b.others.push({
          id: `jpeg:app:${item.marker.toString(16)}`,
          label: APP_NAMES[item.marker] ?? `APP${item.marker - 0xe0}`,
          size: item.payload.length,
          category: 'custom',
          sensitive: true,
        });
    });
    b.icc = assembleIcc(iccParts);
    b.trailingBytes = s.trailing.length;
  } else if (format === 'png') {
    const s = parsePng(buf);
    for (const c of s.chunks) {
      if (c.type === 'eXIf') addExif(c.data);
      else if (c.type === 'tEXt' || c.type === 'zTXt' || c.type === 'iTXt') {
        const t = decodeTextChunk(c);
        if (t?.keyword === 'XML:com.adobe.xmp') b.xmp.push(t.text);
        else if (t) {
          b.pngTexts.push(t);
          const raw = rawProfile(t, b.warnings);
          if (raw) b.rawProfiles.push(raw);
        } else b.warnings.push(`Chunk ${c.type} ilegível.`);
      } else if (c.type === 'iCCP') b.icc = decodeIccp(c);
      else if (c.type === 'tIME' && c.data.length >= 7) {
        const d = c.data;
        b.pngTime = `${d.readUInt16BE(0)}-${String(d[2]).padStart(2, '0')}-${String(d[3]).padStart(2, '0')} ${String(d[4]).padStart(2, '0')}:${String(d[5]).padStart(2, '0')}:${String(d[6]).padStart(2, '0')}`;
      } else if (!PNG_IMAGE_CHUNKS.has(c.type))
        b.others.push({ id: `png:chunk:${c.type}`, label: `Chunk ${c.type}`, size: c.data.length, category: 'custom', sensitive: true });
    }
    b.trailingBytes = s.trailing.length;
  } else {
    for (const c of parseWebp(buf)) {
      if (c.fourcc === 'EXIF') addExif(webpExifTiff(c.data));
      else if (c.fourcc === 'XMP ') b.xmp.push(c.data.toString('utf8'));
      else if (c.fourcc === 'ICCP') b.icc = Buffer.from(c.data);
      else if (!['VP8 ', 'VP8L', 'VP8X', 'ALPH', 'ANIM', 'ANMF'].includes(c.fourcc))
        b.others.push({ id: `webp:chunk:${c.fourcc.trim()}`, label: `Chunk ${c.fourcc.trim()}`, size: c.data.length, category: 'custom', sensitive: true });
    }
  }
  b.orientation = b.exif ? orientationOf(b.exif) : null;
  return b;
}

type MainIfd = 'ifd0' | 'exif' | 'gps' | 'interop';
const IFDS: MainIfd[] = ['ifd0', 'exif', 'gps', 'interop'];
const IFD_LABEL: Record<IfdName, string> = { ifd0: 'EXIF IFD0', exif: 'EXIF', gps: 'EXIF GPS', interop: 'EXIF Interop', ifd1: 'EXIF miniatura' };

function pngTextCategory(keyword: string): { category: ItemCategory; sensitive: boolean } {
  const k = keyword.toLowerCase();
  if (k.startsWith('raw profile type')) return { category: 'custom', sensitive: true };
  if (k === 'creation time' || k === 'date:create' || k === 'date:modify' || k === 'date:timestamp') return { category: 'dates', sensitive: true };
  return classifyKey(keyword, 'png');
}

/** Lista todos os campos de metadados encontrados nos blocos da imagem. */
export function imageItems(b: ImageBlocks): MetadataItem[] {
  const items: MetadataItem[] = [];
  const pushExif = (t: TiffData, prefix: string, suffix: string) => {
    for (const ifd of IFDS) {
      for (const e of t[ifd]) {
        const info = exifTagInfo(ifd, e.tag);
        items.push({
          id: `${prefix}:${ifd}:${e.tag}`,
          scope: 'exif',
          location: IFD_LABEL[ifd] + suffix,
          key: info.name,
          value: decodeEntry(e, t.order).slice(0, 300),
          category: info.category,
          sensitive: info.sensitive,
          removable: true,
          note: e.tag === TAG_ORIENTATION && !suffix ? 'Necessário para exibir a imagem na posição correta.' : undefined,
        });
      }
    }
    if (t.ifd1.length)
      items.push({
        id: `${prefix}:ifd1`,
        scope: 'exif',
        location: IFD_LABEL.ifd1 + suffix,
        key: 'Miniatura embutida',
        value: t.thumbnail ? `<${t.thumbnail.length} bytes>` : `${t.ifd1.length} campos`,
        category: 'custom',
        sensitive: true,
        removable: true,
        note: 'Pode mostrar a imagem original antes de cortes.',
      });
    if (t.skipped > 0)
      items.push({
        id: `${prefix}:nao-interpretados`,
        scope: 'exif',
        location: 'EXIF' + suffix,
        key: 'Campos não interpretados',
        value: `${t.skipped} campo(s)`,
        category: 'custom',
        sensitive: true,
        removable: true,
        note: 'Tipo desconhecido, truncados ou grandes demais; descartados quando o EXIF é reescrito.',
      });
  };
  if (b.exif) pushExif(b.exif, 'exif', '');
  b.extraExif.forEach((t, n) => {
    if (t) pushExif(t, `exif${n + 2}`, ` (bloco extra ${n + 2})`);
    else
      items.push({ id: `exif${n + 2}:ilegivel`, scope: 'exif', location: `EXIF (bloco extra ${n + 2})`, key: 'Bloco EXIF ilegível', value: '<ilegível>', category: 'custom', sensitive: true, removable: true });
  });
  b.rawProfiles.forEach((r, n) => {
    const loc = ` (PNG "${r.keyword}")`;
    if (r.kind === 'exif' && r.tiff) pushExif(r.tiff, `rawexif${n}`, loc);
    if (r.kind === 'xmp' && r.xmp) items.push(...xmpItems(r.xmp, `XMP${loc}`, `rawxmp${n}`));
    if (r.kind === 'iptc' && r.iptc) items.push(...(r.iptc.indexOf('8BIM') >= 0 ? photoshopItems(r.iptc, `IPTC${loc}`, `rawiptc${n}`) : iptcItems(r.iptc, `IPTC${loc}`, `rawiptc${n}`)));
  });
  b.xmp.forEach((x, i) => items.push(...xmpItems(x, 'XMP', `xmp${i}`)));
  b.photoshop.forEach((p, i) => items.push(...photoshopItems(p, 'Photoshop/IPTC', `ps${i}`)));
  if (b.icc)
    items.push({
      id: 'icc',
      scope: 'icc',
      location: 'Perfil de cor',
      key: 'Perfil ICC',
      value: iccDescription(b.icc) ?? `<${b.icc.length} bytes>`,
      category: 'technical',
      sensitive: false,
      removable: true,
      note: 'Define como as cores são exibidas.',
    });
  b.comments.forEach((c, i) =>
    items.push({ id: `jpeg:comment:${i}`, scope: 'jpeg-segment', location: 'Segmento COM', key: 'Comentário', value: c.slice(0, 300), category: 'descriptive', sensitive: true, removable: true }),
  );
  for (const t of b.pngTexts) {
    const c = pngTextCategory(t.keyword);
    items.push({ id: `png:text:${t.keyword}`, scope: 'png-chunk', location: `Chunk ${t.type}`, key: t.keyword, value: t.text.slice(0, 300), ...c, removable: true });
  }
  if (b.pngTime)
    items.push({ id: 'png:tIME', scope: 'png-chunk', location: 'Chunk tIME', key: 'Última modificação', value: b.pngTime, category: 'dates', sensitive: true, removable: true });
  for (const o of b.others)
    items.push({
      id: o.id,
      scope: b.format === 'jpeg' ? 'jpeg-segment' : b.format === 'png' ? 'png-chunk' : 'webp-chunk',
      location: 'Estrutura do arquivo',
      key: o.label,
      value: `<${o.size} bytes>`,
      category: o.category,
      sensitive: o.sensitive,
      removable: true,
    });
  if (b.trailingBytes > 0)
    items.push({
      id: 'trailing',
      scope: b.format === 'jpeg' ? 'jpeg-segment' : 'png-chunk',
      location: 'Após o fim da imagem',
      key: 'Dados extras',
      value: `<${b.trailingBytes} bytes>`,
      category: 'custom',
      sensitive: true,
      removable: true,
      note: 'Podem conter imagens secundárias, mapas de profundidade ou dados do aparelho.',
    });
  return items;
}

export interface ExifRebuild {
  /** TIFF reescrito, `null` para remover o EXIF, `'unchanged'` para manter o original. */
  tiff: Buffer | null | 'unchanged';
  notes: string[];
}

/**
 * Decide o EXIF de saída. Campos de categorias selecionadas são removidos;
 * o restante é preservado byte a byte. A miniatura (IFD1) e o MakerNote só
 * permanecem se o bloco inteiro for mantido (offsets internos não são portáveis).
 */
export function rebuildExif(t: TiffData, meta: MetadataSettings, opts: { keepOrientation: boolean }): ExifRebuild {
  const notes: string[] = [];
  const keepEntry = (ifd: IfdName, e: TiffEntry) => {
    if (e.tag === TAG_ORIENTATION && ifd === 'ifd0') return opts.keepOrientation;
    const info = exifTagInfo(ifd, e.tag);
    return info.category === 'technical' ? true : !meta.remove[info.category];
  };
  const kept = Object.fromEntries(IFDS.map((ifd) => [ifd, t[ifd].filter((e) => keepEntry(ifd, e))])) as Record<
    'ifd0' | 'exif' | 'gps' | 'interop',
    TiffEntry[]
  >;
  const removedCount = IFDS.reduce((s, ifd) => s + t[ifd].length - kept[ifd].length, 0);
  const thumbKept = !meta.remove.custom;
  const anyRequested = Object.values(meta.remove).some(Boolean);
  // Campos que o leitor não entendeu podem conter qualquer coisa: com remoção pedida, reescreve só o que foi entendido.
  const opaque = t.skipped > 0 && anyRequested;
  if (removedCount === 0 && (t.ifd1.length === 0 || thumbKept) && !opaque) return { tiff: 'unchanged', notes };
  if (opaque) notes.push(`${t.skipped} campo(s) EXIF não interpretado(s) descartado(s).`);

  if (kept.exif.some((e) => e.tag === TAG_MAKERNOTE)) {
    kept.exif = kept.exif.filter((e) => e.tag !== TAG_MAKERNOTE);
    notes.push('MakerNote removido: contém deslocamentos internos que não sobrevivem à reescrita do EXIF.');
  }
  if (t.ifd1.length) notes.push('Miniatura EXIF removida (não é portável na reescrita).');

  const meaningful = IFDS.some((ifd) =>
    kept[ifd].some((e) => {
      const info = exifTagInfo(ifd, e.tag);
      return info.category !== 'technical';
    }),
  );
  const orientationEntry = kept.ifd0.find((e) => e.tag === TAG_ORIENTATION);
  const orientation = orientationOf(t);
  if (!meaningful) {
    if (orientationEntry && orientation && orientation !== 1) {
      notes.push('EXIF reduzido a um único campo: orientação.');
      return { tiff: orientationOnlyTiff(orientation, t.order), notes };
    }
    notes.push('EXIF removido por completo.');
    return { tiff: null, notes };
  }
  const total = IFDS.reduce((s, ifd) => s + kept[ifd].length, 0);
  notes.push(`EXIF reescrito mantendo ${total} campo(s).`);
  return { tiff: buildTiff({ order: t.order, ...kept }), notes };
}

function xmpRemovable(xml: string, meta: MetadataSettings): boolean {
  return xmpShouldRemove(xml, meta.remove);
}

/** Perfil bruto do ImageMagick sai se contiver categoria pedida, ou se não pôde ser lido e há remoção pedida. */
function rawProfileRemovable(t: PngText, meta: MetadataSettings): boolean {
  const any = Object.values(meta.remove).some(Boolean);
  const raw = rawProfile(t, []);
  if (!raw || raw.kind === 'other') return meta.remove.custom;
  if (raw.kind === 'xmp') return raw.xmp ? xmpShouldRemove(raw.xmp, meta.remove) : any;
  if (raw.kind === 'iptc') {
    if (!raw.iptc) return any;
    const items = raw.iptc.indexOf('8BIM') >= 0 ? photoshopItems(raw.iptc, 'IPTC', 'r') : iptcItems(raw.iptc, 'IPTC', 'r');
    return items.length === 0 ? any : items.some((i) => i.category !== 'technical' && meta.remove[i.category]);
  }
  const tiff = raw.tiff;
  if (!tiff) return any;
  if (tiff.skipped > 0 && any) return true;
  if (tiff.ifd1.length && meta.remove.custom) return true;
  return IFDS.some((ifd) =>
    tiff[ifd].some((e) => {
      const info = exifTagInfo(ifd, e.tag);
      return info.category !== 'technical' && meta.remove[info.category];
    }),
  );
}

function photoshopRemovable(data: Buffer, meta: MetadataSettings): boolean {
  const items = photoshopItems(data, 'IPTC', 'p');
  if (items.length === 0) return meta.remove.custom;
  return items.some((i) => i.category !== 'technical' && meta.remove[i.category]);
}

export interface CleanResult {
  buffer: Buffer;
  actions: string[];
  warnings: string[];
}

/**
 * Limpeza sem perdas: remove/reescreve só os blocos de metadados. Os dados
 * comprimidos da imagem são copiados sem alteração.
 */
export function cleanImage(buf: Buffer, format: ImageContainer, meta: MetadataSettings): CleanResult {
  const actions: string[] = [];
  const warnings: string[] = [];
  const keepIcc = meta.preserveColorProfile;
  const anyRemoval = Object.values(meta.remove).some(Boolean);
  let extraExifRemoved = 0;
  /** Blocos EXIF além do primeiro: mantidos só se nenhuma categoria for removida. */
  const keepExtraExif = () => {
    if (anyRemoval) extraExifRemoved++;
    return !anyRemoval;
  };
  const extraNote = () => {
    if (extraExifRemoved) actions.push(`${extraExifRemoved} bloco(s) EXIF adicional(is) removido(s).`);
  };
  const exifDecision = (data: Buffer | null) => {
    if (!data) return null;
    let t: TiffData;
    try {
      t = parseTiff(data);
    } catch {
      if (meta.remove.custom || meta.remove.device || meta.remove.gps) {
        actions.push('Bloco EXIF ilegível removido.');
        return { tiff: null, notes: [] } as ExifRebuild;
      }
      return { tiff: 'unchanged', notes: [] } as ExifRebuild;
    }
    const r = rebuildExif(t, meta, { keepOrientation: meta.preserveOrientation });
    if (!meta.preserveOrientation && orientationOf(t) && orientationOf(t) !== 1)
      warnings.push('A orientação EXIF foi removida a pedido; a imagem pode aparecer girada.');
    actions.push(...r.notes);
    return r;
  };

  if (format === 'jpeg') {
    const s = parseJpeg(buf);
    const exifItem = s.items.find((i) => i.kind === 'segment' && segmentType(i) === 'exif');
    const decision = exifDecision(exifItem && exifItem.kind === 'segment' ? exifItem.payload.subarray(6) : null);
    const insert: Buffer[] = [];
    if (decision && decision.tiff && decision.tiff !== 'unchanged') insert.push(exifSegment(decision.tiff));
    let removedComments = 0;
    const out = rebuildJpeg(
      buf,
      s,
      (item, type) => {
        if (item.kind !== 'segment') return true;
        switch (type) {
          case 'jfif':
          case 'adobe':
          case 'image':
            return true;
          case 'exif':
            return item === exifItem ? decision?.tiff === 'unchanged' : keepExtraExif();
          case 'xmp': {
            const keep = !xmpRemovable(item.payload.subarray(JPEG_SIGNATURES.xmp.length).toString('utf8'), meta);
            if (!keep) actions.push('Pacote XMP removido.');
            return keep;
          }
          case 'xmp-ext':
            return !meta.remove.custom && !meta.remove.software;
          case 'icc':
            if (!keepIcc) actions.push('Perfil ICC removido (a pedido).');
            return keepIcc;
          case 'photoshop': {
            const keep = !photoshopRemovable(item.payload.subarray(JPEG_SIGNATURES.photoshop.length), meta);
            if (!keep) actions.push('Bloco Photoshop/IPTC removido.');
            return keep;
          }
          case 'comment':
            if (meta.remove.descriptive) removedComments++;
            return !meta.remove.descriptive;
          case 'jfxx':
          case 'mpf':
          case 'app-other':
            if (meta.remove.custom) actions.push(`Segmento ${type === 'jfxx' ? 'JFXX' : type === 'mpf' ? 'MPF' : 'APP'} removido.`);
            return !meta.remove.custom;
        }
      },
      insert,
      !meta.remove.custom,
    );
    if (removedComments) actions.push(`${removedComments} comentário(s) COM removido(s).`);
    extraNote();
    if (meta.remove.custom && s.trailing.length) actions.push(`Dados após o fim da imagem removidos (${s.trailing.length} bytes).`);
    return { buffer: out, actions: [...new Set(actions)], warnings };
  }

  if (format === 'png') {
    const s = parsePng(buf);
    const exifChunk = s.chunks.find((c) => c.type === 'eXIf');
    const decision = exifDecision(exifChunk?.data ?? null);
    const insert: Buffer[] = [];
    if (decision && decision.tiff && decision.tiff !== 'unchanged') insert.push(chunkBytes('eXIf', decision.tiff));
    const out = rebuildPng(buf, s, (c) => {
      if (c.type === 'eXIf') return c === exifChunk ? decision?.tiff === 'unchanged' : keepExtraExif();
      if (c.type === 'iCCP') {
        if (!keepIcc) actions.push('Perfil ICC removido (a pedido).');
        return keepIcc;
      }
      if (c.type === 'tIME') {
        if (meta.remove.dates) actions.push('Data de modificação (tIME) removida.');
        return !meta.remove.dates;
      }
      if (c.type === 'tEXt' || c.type === 'zTXt' || c.type === 'iTXt') {
        const t = decodeTextChunk(c);
        if (!t) return !meta.remove.custom;
        if (t.keyword === 'XML:com.adobe.xmp') {
          const keep = !xmpRemovable(t.text, meta);
          if (!keep) actions.push('Pacote XMP removido.');
          return keep;
        }
        if (/^raw profile type /i.test(t.keyword)) {
          const keep = !rawProfileRemovable(t, meta);
          if (!keep) actions.push(`Perfil bruto PNG "${t.keyword}" removido.`);
          return keep;
        }
        const cat = pngTextCategory(t.keyword);
        const keep = cat.category === 'technical' || !meta.remove[cat.category];
        if (!keep) actions.push(`Texto PNG "${t.keyword}" removido.`);
        return keep;
      }
      if (meta.remove.custom) actions.push(`Chunk ${c.type} removido.`);
      return !meta.remove.custom;
    }, insert);
    extraNote();
    const withTrailing = !meta.remove.custom && s.trailing.length ? Buffer.concat([out, s.trailing]) : out;
    if (meta.remove.custom && s.trailing.length) actions.push(`Dados após o IEND removidos (${s.trailing.length} bytes).`);
    return { buffer: withTrailing, actions: [...new Set(actions)], warnings };
  }

  const chunks = parseWebp(buf);
  const exifChunk = chunks.find((c) => c.fourcc === 'EXIF');
  const decision = exifDecision(exifChunk ? webpExifTiff(exifChunk.data) : null);
  const working = chunks.map((c) =>
    c === exifChunk && decision && decision.tiff && decision.tiff !== 'unchanged' ? { fourcc: 'EXIF', data: decision.tiff, first: true } : { ...c, first: c === exifChunk },
  );
  const out = rebuildWebp(working, (c) => {
    if (c.fourcc === 'EXIF') return (c as { first?: boolean }).first ? decision?.tiff !== null : keepExtraExif();
    if (c.fourcc === 'XMP ') {
      const keep = !xmpRemovable(c.data.toString('utf8'), meta);
      if (!keep) actions.push('Pacote XMP removido.');
      return keep;
    }
    if (c.fourcc === 'ICCP') return keepIcc;
    return !meta.remove.custom;
  });
  extraNote();
  return { buffer: out, actions: [...new Set(actions)], warnings };
}

/**
 * Reinsere EXIF/ICC preservados numa imagem recém-codificada pelo FFmpeg
 * (que não grava metadados). WEBP simples não comporta inserção sem
 * reestruturar o arquivo; nesse caso nada é inserido e um aviso é emitido.
 */
export function injectImageMetadata(
  buf: Buffer,
  format: ImageContainer,
  data: { exif: Buffer | null; icc: Buffer | null; pngChunks?: Buffer[] },
): CleanResult {
  const actions: string[] = [];
  const warnings: string[] = [];
  const extra = format === 'png' ? data.pngChunks ?? [] : [];
  if (!data.exif && !data.icc && extra.length === 0) return { buffer: buf, actions, warnings };
  if (format === 'jpeg') {
    const s = parseJpeg(buf);
    const insert: Buffer[] = [];
    if (data.exif) insert.push(exifSegment(data.exif));
    if (data.icc) insert.push(...iccSegments(data.icc));
    const out = rebuildJpeg(buf, s, (_i, t) => t !== 'exif' && t !== 'icc', insert, false);
    if (data.exif) actions.push('Campos EXIF preservados reinseridos.');
    if (data.icc) actions.push('Perfil ICC preservado reinserido.');
    return { buffer: out, actions, warnings };
  }
  if (format === 'png') {
    const s = parsePng(buf);
    const insert: Buffer[] = [];
    if (data.icc) insert.push(iccpChunk(data.icc));
    if (data.exif) insert.push(chunkBytes('eXIf', data.exif));
    insert.push(...extra);
    // Com iCCP reinserido, o sRGB gerado pelo codificador conflitaria (a especificação PNG proíbe os dois).
    const out = rebuildPng(buf, s, (c) => c.type !== 'eXIf' && c.type !== 'iCCP', insert, data.icc ? new Set(['sRGB']) : undefined);
    if (data.exif) actions.push('Campos EXIF preservados reinseridos.');
    if (data.icc) actions.push('Perfil ICC preservado reinserido.');
    if (extra.length) actions.push(`${extra.length} bloco(s) PNG preservado(s) (textos, data e chunks seguros para cópia) reinserido(s) byte a byte.`);
    return { buffer: out, actions, warnings };
  }
  warnings.push('Saída WEBP: metadados preservados não foram reinseridos (o codificador gera WEBP simples).');
  return { buffer: buf, actions, warnings };
}
