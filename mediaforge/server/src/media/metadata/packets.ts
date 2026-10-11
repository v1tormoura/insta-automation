import type { MetadataItem } from '@mediaforge/shared';
import { classifyKey } from './categories';

const clip = (v: string, n = 300) => (v.length > n ? v.slice(0, n) + '…' : v);

/** Pacotes maiores que isto são analisados só até este ponto (e marcados como incompletos). */
export const MAX_XMP_CHARS = 512 * 1024;
const MAX_XMP_KEYS = 300;

export interface XmpAnalysis {
  entries: Array<{ key: string; value: string }>;
  /** Falso se o pacote foi truncado, estava malformado ou excedeu limites: não dá para afirmar o que contém. */
  complete: boolean;
}

const LIST_CONTAINERS = new Set(['rdf:Seq', 'rdf:Bag', 'rdf:Alt', 'rdf:li', 'rdf:Description', 'rdf:RDF', 'x:xmpmeta']);

/**
 * Lê pares chave/valor de um pacote XMP com um tokenizador linear (cada
 * caractere é visitado uma vez — sem expressões com retrocesso). Entende
 * atributos com aspas simples ou duplas, CDATA, comentários, instruções de
 * processamento e listas rdf:Seq/Bag/Alt (valores atribuídos ao elemento pai).
 */
export function analyzeXmp(input: string): XmpAnalysis {
  let complete = input.length <= MAX_XMP_CHARS;
  const xml = complete ? input : input.slice(0, MAX_XMP_CHARS);
  const out = new Map<string, string>();
  const add = (k: string, raw: string) => {
    const value = decodeXml(raw).trim();
    if (!value) return;
    if (!out.has(k) && out.size >= MAX_XMP_KEYS) {
      complete = false;
      return;
    }
    const prev = out.get(k);
    if (prev === undefined) out.set(k, value);
    else if (prev.length < 4096) out.set(k, `${prev}; ${value}`);
  };
  const stack: Array<{ name: string; text: string; hasChild: boolean }> = [];
  const owner = () => {
    for (let i = stack.length - 1; i >= 0; i--) if (!LIST_CONTAINERS.has(stack[i]!.name)) return stack[i]!.name;
    return null;
  };
  const closeTop = () => {
    const el = stack.pop();
    if (!el || el.hasChild) return;
    const text = el.text;
    if (!text.trim()) return;
    if (el.name === 'rdf:li') {
      const o = owner();
      if (o) add(o, text);
    } else if (el.name.includes(':') && !el.name.startsWith('rdf:')) add(el.name, text);
  };

  let pos = 0;
  const n = xml.length;
  while (pos < n) {
    const lt = xml.indexOf('<', pos);
    const textEnd = lt === -1 ? n : lt;
    if (textEnd > pos && stack.length) stack[stack.length - 1]!.text += xml.slice(pos, textEnd);
    if (lt === -1) break;
    if (xml.startsWith('<!--', lt)) {
      const end = xml.indexOf('-->', lt + 4);
      if (end === -1) return finish(false);
      pos = end + 3;
      continue;
    }
    if (xml.startsWith('<![CDATA[', lt)) {
      const end = xml.indexOf(']]>', lt + 9);
      if (end === -1) return finish(false);
      // CDATA é texto literal: protegido da decodificação de entidades.
      if (stack.length) stack[stack.length - 1]!.text += xml.slice(lt + 9, end).replace(/&/g, '&amp;');
      pos = end + 3;
      continue;
    }
    if (xml.startsWith('<?', lt)) {
      const end = xml.indexOf('?>', lt + 2);
      if (end === -1) return finish(false);
      pos = end + 2;
      continue;
    }
    if (xml.startsWith('<!', lt)) {
      const end = xml.indexOf('>', lt + 2);
      if (end === -1) return finish(false);
      pos = end + 1;
      continue;
    }
    if (xml[lt + 1] === '/') {
      const end = xml.indexOf('>', lt + 2);
      if (end === -1) return finish(false);
      const name = xml.slice(lt + 2, end).trim();
      // Fecha até o elemento correspondente (tolera XML levemente malformado).
      let idx = -1;
      for (let i = stack.length - 1; i >= 0; i--) if (stack[i]!.name === name) {
        idx = i;
        break;
      }
      if (idx === -1) complete = false;
      else while (stack.length > idx) closeTop();
      pos = end + 1;
      continue;
    }
    // Abertura de elemento: varre até '>' fora de aspas, lendo os atributos.
    let i = lt + 1;
    while (i < n && !/[\s/>]/.test(xml[i]!)) i++;
    const name = xml.slice(lt + 1, i);
    if (!name) {
      complete = false;
      pos = lt + 1;
      continue;
    }
    const attrs: Array<[string, string]> = [];
    let selfClose = false;
    let closed = false;
    while (i < n) {
      const ch = xml[i]!;
      if (ch === '>') {
        closed = true;
        i++;
        break;
      }
      if (ch === '/' && xml[i + 1] === '>') {
        selfClose = true;
        closed = true;
        i += 2;
        break;
      }
      if (/\s/.test(ch)) {
        i++;
        continue;
      }
      let j = i;
      while (j < n && !/[\s=/>]/.test(xml[j]!)) j++;
      const attr = xml.slice(i, j);
      while (j < n && /\s/.test(xml[j]!)) j++;
      if (xml[j] !== '=') {
        i = Math.max(j, i + 1);
        continue;
      }
      j++;
      while (j < n && /\s/.test(xml[j]!)) j++;
      const q = xml[j];
      if (q !== '"' && q !== "'") {
        complete = false;
        i = j;
        continue;
      }
      const endQ = xml.indexOf(q, j + 1);
      if (endQ === -1) return finish(false);
      attrs.push([attr, xml.slice(j + 1, endQ)]);
      i = endQ + 1;
    }
    if (!closed) return finish(false);
    if (stack.length) stack[stack.length - 1]!.hasChild = true;
    for (const [k, v] of attrs) {
      if (k.startsWith('xmlns') || k.startsWith('rdf:') || k === 'xml:lang' || !k.includes(':')) continue;
      add(k, v);
    }
    if (!selfClose) stack.push({ name, text: '', hasChild: false });
    pos = i;
  }
  if (stack.length) complete = false;
  return finish(complete);

  function finish(ok: boolean): XmpAnalysis {
    return { entries: [...out.entries()].map(([key, value]) => ({ key, value: clip(value) })), complete: ok && complete };
  }
}

/** Compatibilidade: só os pares chave/valor. */
export function parseXmp(xml: string): Array<{ key: string; value: string }> {
  return analyzeXmp(xml).entries;
}

function decodeXml(s: string): string {
  const cp = (n: number, raw: string) => (Number.isInteger(n) && n > 0 && n <= 0x10ffff && (n < 0xd800 || n > 0xdfff) ? String.fromCodePoint(n) : raw);
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d{1,8});/g, (raw, d) => cp(Number(d), raw))
    .replace(/&#x([0-9a-f]{1,8});/gi, (raw, h) => cp(parseInt(h, 16), raw))
    .replace(/&amp;/g, '&');
}

export function xmpItems(xml: string, location: string, idPrefix: string): MetadataItem[] {
  const { entries, complete } = analyzeXmp(xml);
  const items = entries.map(({ key, value }) => {
    let c = classifyKey(key, 'xmp');
    const k = key.toLowerCase();
    if (/xmpmm:(documentid|instanceid|originaldocumentid|derivedfrom)/.test(k)) c = { category: 'custom', sensitive: true };
    if (/xmpmm:history|stevt:|x:xmptk/.test(k)) c = { category: 'software', sensitive: true };
    if (/^(tiff|exif):(xresolution|yresolution|resolutionunit|pixelxdimension|pixelydimension|colorspace|orientation)$/.test(k))
      c = { category: 'technical', sensitive: false };
    return {
      id: `${idPrefix}:${key}`,
      scope: 'xmp' as const,
      location,
      key,
      value,
      category: c.category,
      sensitive: c.sensitive,
      removable: true,
      note: 'O pacote XMP é removido por inteiro quando qualquer categoria contida nele é selecionada.',
    };
  });
  if (!complete) {
    items.push({
      id: `${idPrefix}:__incompleto`,
      scope: 'xmp' as const,
      location,
      key: 'Pacote XMP não totalmente interpretado',
      value: `<${xml.length} caracteres>`,
      category: 'custom',
      sensitive: true,
      removable: true,
      note: 'Grande demais ou malformado: o conteúdo pode incluir dados não listados; é removido quando qualquer categoria é selecionada.',
    });
  }
  return items;
}

/**
 * O pacote deve sair? Sim se contém alguma categoria pedida — ou se não pôde
 * ser interpretado por completo e há qualquer remoção pedida (na dúvida, remove).
 */
export function xmpShouldRemove(xml: string, remove: Record<string, boolean>): boolean {
  const anyRemoval = Object.values(remove).some(Boolean);
  if (!anyRemoval) return false;
  const items = xmpItems(xml, 'XMP', 'x');
  if (items.length === 0) return !!remove.custom;
  return items.some((i) => i.category !== 'technical' && remove[i.category]);
}

// ── IPTC (Photoshop APP13 / IIM) ───────────────────────────────────────────

const IPTC_DATASETS: Record<number, [string, ReturnType<typeof classifyKey>['category']]> = {
  5: ['ObjectName', 'descriptive'],
  25: ['Keywords', 'descriptive'],
  40: ['SpecialInstructions', 'descriptive'],
  55: ['DateCreated', 'dates'],
  60: ['TimeCreated', 'dates'],
  62: ['DigitalCreationDate', 'dates'],
  63: ['DigitalCreationTime', 'dates'],
  65: ['OriginatingProgram', 'software'],
  70: ['ProgramVersion', 'software'],
  80: ['By-line', 'descriptive'],
  85: ['By-lineTitle', 'descriptive'],
  90: ['City', 'gps'],
  92: ['Sub-location', 'gps'],
  95: ['Province-State', 'gps'],
  100: ['CountryCode', 'gps'],
  101: ['CountryName', 'gps'],
  103: ['TransmissionReference', 'custom'],
  105: ['Headline', 'descriptive'],
  110: ['Credit', 'descriptive'],
  115: ['Source', 'descriptive'],
  116: ['CopyrightNotice', 'descriptive'],
  118: ['Contact', 'descriptive'],
  120: ['Caption-Abstract', 'descriptive'],
  122: ['Writer-Editor', 'descriptive'],
};

const PS_RESOURCES: Record<number, string> = {
  0x0404: 'IPTC-NAA',
  0x0409: 'Miniatura (Photoshop 4)',
  0x040c: 'Miniatura (Photoshop 5)',
  0x0422: 'EXIF (Photoshop)',
  0x0424: 'XMP (Photoshop)',
  0x040f: 'Perfil ICC (Photoshop)',
  0x0425: 'Resumo IPTC (MD5)',
};

/** Lê recursos 8BIM de um segmento "Photoshop 3.0" e os registros IPTC dentro dele. */
export function photoshopItems(data: Buffer, location: string, idPrefix: string): MetadataItem[] {
  const items: MetadataItem[] = [];
  let p = data.indexOf('8BIM');
  let guard = 0;
  while (p >= 0 && p + 12 <= data.length && guard++ < 500) {
    if (data.toString('latin1', p, p + 4) !== '8BIM') break;
    const id = data.readUInt16BE(p + 4);
    const nameLen = data[p + 6]!;
    let q = p + 7 + nameLen;
    if ((nameLen + 1) % 2 === 1) q += 1;
    if (q + 4 > data.length) break;
    const size = data.readUInt32BE(q);
    const start = q + 4;
    const end = Math.min(data.length, start + size);
    const block = data.subarray(start, end);
    if (id === 0x0404) items.push(...iptcItems(block, location, idPrefix));
    else {
      const label = PS_RESOURCES[id] ?? `Recurso 0x${id.toString(16)}`;
      const cat = id === 0x040f ? 'technical' : 'custom';
      items.push({
        id: `${idPrefix}:8bim:${id}`,
        scope: 'iptc',
        location,
        key: label,
        value: `<${block.length} bytes>`,
        category: cat,
        sensitive: cat !== 'technical' && id !== 0x0425 && id < 0x0fa0,
        removable: true,
      });
    }
    p = end + (size % 2);
  }
  return items;
}

export function iptcItems(block: Buffer, location: string, idPrefix: string): MetadataItem[] {
  const out = new Map<string, MetadataItem>();
  let p = 0;
  while (p + 5 <= block.length) {
    if (block[p] !== 0x1c) {
      p++;
      continue;
    }
    const record = block[p + 1]!;
    const dataset = block[p + 2]!;
    const len = block.readUInt16BE(p + 3);
    if (len & 0x8000) break; // tamanho estendido: raro, interrompe com segurança
    const value = block.subarray(p + 5, p + 5 + len).toString('utf8').replace(/\0/g, '').trim();
    p += 5 + len;
    if (record !== 2 || dataset === 0) continue;
    const def = IPTC_DATASETS[dataset];
    const key = def?.[0] ?? `IPTC 2:${dataset}`;
    const category = def?.[1] ?? 'custom';
    const prev = out.get(key);
    out.set(key, {
      id: `${idPrefix}:iptc:${key}`,
      scope: 'iptc',
      location,
      key,
      value: clip(prev ? `${prev.value}; ${value}` : value),
      category,
      sensitive: true,
      removable: true,
    });
  }
  return [...out.values()];
}

// ── ICC ───────────────────────────────────────────────────────────────────

/** Descrição de um perfil ICC (tag "desc", tipos desc/mluc). */
export function iccDescription(icc: Buffer): string | null {
  try {
    if (icc.length < 132) return null;
    const count = icc.readUInt32BE(128);
    for (let i = 0; i < Math.min(count, 100); i++) {
      const o = 132 + i * 12;
      if (o + 12 > icc.length) break;
      const sig = icc.toString('latin1', o, o + 4);
      if (sig !== 'desc') continue;
      const off = icc.readUInt32BE(o + 4);
      const size = icc.readUInt32BE(o + 8);
      const tag = icc.subarray(off, off + size);
      const type = tag.toString('latin1', 0, 4);
      if (type === 'desc') {
        const n = tag.readUInt32BE(8);
        return tag.toString('latin1', 12, 12 + n).replace(/\0/g, '').trim();
      }
      if (type === 'mluc') {
        const recSize = tag.readUInt32BE(12);
        if (recSize < 12) return null;
        const len = tag.readUInt32BE(16 + 4);
        const strOff = tag.readUInt32BE(16 + 8);
        const raw = tag.subarray(strOff, strOff + len);
        const swapped = Buffer.from(raw);
        swapped.swap16();
        return swapped.toString('utf16le').replace(/\0/g, '').trim();
      }
    }
  } catch {
    return null;
  }
  return null;
}
