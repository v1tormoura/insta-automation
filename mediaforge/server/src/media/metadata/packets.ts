import type { MetadataItem } from '@mediaforge/shared';
import { classifyKey } from './categories';

const clip = (v: string, n = 300) => (v.length > n ? v.slice(0, n) + '…' : v);

/**
 * Extrai pares chave/valor de um pacote XMP (XML). Não é um parser XML
 * completo: lê atributos e elementos simples de rdf:Description e listas
 * rdf:Seq/Bag/Alt, o suficiente para identificar o que o pacote contém.
 */
export function parseXmp(xml: string): Array<{ key: string; value: string }> {
  const out = new Map<string, string>();
  const add = (k: string, v: string) => {
    const value = decodeXml(v).trim();
    if (!value) return;
    out.set(k, out.has(k) ? `${out.get(k)}; ${value}` : value);
  };
  // Listas rdf:Seq / rdf:Bag / rdf:Alt dentro de um elemento
  const listRe = /<([\w-]+:[\w-]+)(?:\s[^>]*)?>\s*<rdf:(?:Seq|Bag|Alt)[^>]*>([\s\S]*?)<\/rdf:(?:Seq|Bag|Alt)>\s*<\/\1>/g;
  let m: RegExpExecArray | null;
  const consumed: Array<[number, number]> = [];
  while ((m = listRe.exec(xml))) {
    const key = m[1]!;
    const items = [...m[2]!.matchAll(/<rdf:li(?:\s[^>]*)?>([^<]*)<\/rdf:li>/g)].map((x) => x[1]!);
    const nested = [...m[2]!.matchAll(/([\w-]+:[\w-]+)="([^"]*)"/g)].map((x) => `${x[1]}=${x[2]}`);
    add(key, [...items, ...nested].join('; '));
    consumed.push([m.index, m.index + m[0].length]);
  }
  const rest = consumed.reduceRight((s, [a, b]) => s.slice(0, a) + s.slice(b), xml);
  // Elementos simples <ns:Key>valor</ns:Key>
  for (const x of rest.matchAll(/<([\w-]+:[\w-]+)(?:\s[^>]*)?>([^<]+)<\/\1>/g)) {
    if (!x[1]!.startsWith('rdf:')) add(x[1]!, x[2]!);
  }
  // Atributos ns:Key="valor" (exceto declarações de namespace e rdf)
  for (const x of rest.matchAll(/\s([\w-]+:[\w-]+)="([^"]*)"/g)) {
    const k = x[1]!;
    if (k.startsWith('xmlns:') || k.startsWith('rdf:') || k === 'xml:lang') continue;
    add(k, x[2]!);
  }
  return [...out.entries()].slice(0, 300).map(([key, value]) => ({ key, value: clip(value) }));
}

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, '&');
}

export function xmpItems(xml: string, location: string, idPrefix: string): MetadataItem[] {
  return parseXmp(xml).map(({ key, value }) => {
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
