import fs from 'node:fs';
import { metadataSettingsSchema, type MetadataItem, type MetadataSettings } from '@mediaforge/shared';
import { describe, expect, it } from 'vitest';
import { classifyKey, isMuxerDefault, normalizeKey } from '../../src/media/metadata/categories';
import { compareMetadata, requestedFor, residualPatterns, searchableValue } from '../../src/media/metadata/compare';
import { cleanImage, imageItems, readImageBlocks } from '../../src/media/metadata/imageMeta';
import { fx, SENSITIVE } from '../helpers/fixtures';

const ALL_FALSE = { gps: false, dates: false, device: false, descriptive: false, software: false, custom: false, container: false, streams: false, embedded: false };
const meta = (remove: Partial<MetadataSettings['remove']> | 'all' | 'none'): MetadataSettings =>
  metadataSettingsSchema.parse({ remove: remove === 'all' ? {} : remove === 'none' ? ALL_FALSE : { ...ALL_FALSE, ...remove } });

let n = 0;
function item(category: MetadataItem['category'], value: string, over: Partial<MetadataItem> = {}): MetadataItem {
  n++;
  return {
    id: over.id ?? `t:${category}:${n}`,
    scope: 'container',
    location: 'Contêiner',
    key: `chave${n}`,
    value,
    category,
    sensitive: category !== 'technical',
    removable: category !== 'technical',
    ...over,
  };
}

describe('classifyKey', () => {
  const cases: Array<[string, Parameters<typeof classifyKey>[1], string, boolean]> = [
    // estruturais
    ['major_brand', 'format', 'technical', false],
    ['minor_version', 'format', 'technical', false],
    ['compatible_brands', 'format', 'technical', false],
    // localização primeiro (mesmo quando a chave também fala de data)
    ['location', 'format', 'gps', true],
    ['location-eng', 'format', 'gps', true],
    ['com.apple.quicktime.location.ISO6709', 'format', 'gps', true],
    ['com.apple.quicktime.location.date', 'format', 'gps', true],
    ['com.apple.quicktime.location.accuracy.horizontal', 'format', 'gps', true],
    ['©xyz', 'format', 'gps', true],
    ['GPSDateStamp', 'exif', 'gps', true],
    ['GPSTimeStamp', 'exif', 'gps', true],
    ['exif:GPSLatitude', 'xmp', 'gps', true],
    ['photoshop:City', 'xmp', 'gps', true],
    ['Iptc4xmpCore:CountryCode', 'xmp', 'gps', true],
    ['location', 'stream', 'gps', true],
    // datas
    ['creation_time', 'format', 'dates', true],
    ['creation_time', 'stream', 'dates', true],
    ['com.apple.quicktime.creationdate', 'format', 'dates', true],
    ['DateTimeOriginal', 'exif', 'dates', true],
    ['OffsetTimeOriginal', 'exif', 'dates', true],
    ['date', 'format', 'dates', true],
    ['©day', 'format', 'dates', true],
    ['xmp:ModifyDate', 'xmp', 'dates', true],
    ['photoshop:DateCreated', 'xmp', 'dates', true],
    // aparelho (técnicos de exposição não são sensíveis)
    ['com.apple.quicktime.make', 'format', 'device', true],
    ['com.apple.quicktime.model', 'format', 'device', true],
    ['Make', 'exif', 'device', true],
    ['tiff:Model', 'xmp', 'device', true],
    ['LensModel', 'exif', 'device', true],
    ['BodySerialNumber', 'exif', 'device', true],
    ['com.android.version', 'format', 'device', true],
    ['ExposureTime', 'exif', 'device', false],
    ['FNumber', 'exif', 'device', false],
    ['ISOSpeedRatings', 'exif', 'device', false],
    ['WhiteBalance', 'exif', 'device', false],
    // software
    ['encoder', 'format', 'software', true],
    ['encoder', 'stream', 'software', true],
    ['com.apple.quicktime.software', 'format', 'software', true],
    ['xmp:CreatorTool', 'xmp', 'software', true],
    ['Software', 'png', 'software', true],
    ['©swr', 'format', 'software', true],
    ['encoded_by', 'format', 'software', true],
    // descritivos
    ['comment', 'format', 'descriptive', true],
    ['title', 'format', 'descriptive', true],
    ['artist', 'format', 'descriptive', true],
    ['description', 'format', 'descriptive', true],
    ['copyright', 'format', 'descriptive', true],
    ['dc:creator', 'xmp', 'descriptive', true],
    ['Author', 'png', 'descriptive', true],
    // fluxos
    ['handler_name', 'stream', 'streams', false],
    ['language', 'stream', 'streams', false],
    ['vendor_id', 'stream', 'streams', false],
    ['timecode', 'stream', 'streams', false],
    ['qualquer_coisa', 'stream', 'streams', false],
    // proprietários e catálogo
    ['com.apple.quicktime.content.identifier', 'format', 'custom', true],
    ['org.exemplo.segredo', 'format', 'custom', true],
    ['track', 'format', 'container', false],
    ['compilation', 'format', 'container', false],
    ['chave_desconhecida', 'format', 'container', false],
    ['chave_desconhecida', 'other', 'custom', true],
    ['chave_desconhecida', 'exif', 'custom', true],
  ];
  for (const [key, scope, category, sensitive] of cases) {
    it(`${key} (${scope}) → ${category}${sensitive ? ' sensível' : ''}`, () => {
      expect(classifyKey(key, scope)).toEqual({ category, sensitive });
    });
  }

  it('normalizeKey: minúsculas, sem sufixo de idioma e sem espaços', () => {
    expect(normalizeKey('Title-eng')).toBe('title');
    expect(normalizeKey('LOCATION')).toBe('location');
    expect(normalizeKey('  Comment ')).toBe('comment');
    expect(normalizeKey('com.apple.quicktime.make')).toBe('com.apple.quicktime.make');
  });
});

describe('isMuxerDefault', () => {
  it('reconhece só os valores que o próprio FFmpeg grava', () => {
    for (const v of ['VideoHandler', 'SoundHandler', 'DataHandler', 'SubtitleHandler', '  VideoHandler ']) expect(isMuxerDefault('handler_name', v), v).toBe(true);
    expect(isMuxerDefault('HANDLER_NAME', 'VideoHandler')).toBe(true);
    expect(isMuxerDefault('handler_name', 'Core Media Video')).toBe(false);
    expect(isMuxerDefault('handler_name', 'GoPro AVC')).toBe(false);
    expect(isMuxerDefault('vendor_id', '[0][0][0][0]')).toBe(true);
    expect(isMuxerDefault('vendor_id', 'FFMP')).toBe(true);
    expect(isMuxerDefault('vendor_id', 'appl')).toBe(false);
    expect(isMuxerDefault('language', 'und')).toBe(true);
    expect(isMuxerDefault('language', 'por')).toBe(false);
    expect(isMuxerDefault('encoder', 'Lavf60.16.100')).toBe(false);
    expect(isMuxerDefault('comment', 'VideoHandler')).toBe(false);
  });
});

describe('searchableValue / requestedFor / residualPatterns', () => {
  it('só valores longos e textuais viram padrão de busca', () => {
    expect(searchableValue(item('device', 'Canon EOS R5'))).toBe('Canon EOS R5');
    expect(searchableValue(item('device', '  iPhone 14 Pro  '))).toBe('iPhone 14 Pro');
    expect(searchableValue(item('device', 'Canon'))).toBeNull(); // < 6
    expect(searchableValue(item('custom', '<34 bytes>'))).toBeNull();
    expect(searchableValue(item('gps', '23, 33'))).toBeNull(); // numérico curto
    expect(searchableValue(item('dates', '2023:07:14 10:22:33'))).toBe('2023:07:14 10:22:33'); // numérico longo
    expect(searchableValue(item('software', 'x'.repeat(300) + '…'))).toBeNull(); // truncado
    expect(searchableValue(item('embedded', 'x264 - core 164 r3108', { scope: 'bitstream' }))).toBeNull();
  });

  it('requestedFor ignora campos técnicos e ausência de configuração', () => {
    expect(requestedFor(item('technical', 'x'), meta('all'))).toBe(false);
    expect(requestedFor(item('gps', 'x'), null)).toBe(false);
    expect(requestedFor(item('gps', 'x'), meta({ gps: true }))).toBe(true);
    expect(requestedFor(item('device', 'x'), meta({ gps: true }))).toBe(false);
    expect(requestedFor(item('embedded', 'x'), meta('all'))).toBe(false); // SEI é opt-in
  });

  it('residualPatterns: só categorias pedidas, valores pesquisáveis, em UTF-8', () => {
    const before = [
      item('gps', '+37.7749-122.4194+010.000/', { id: 'gps1' }),
      item('device', 'iPhone 14 Pro', { id: 'dev1' }),
      item('device', 'Apple', { id: 'dev2' }),
      item('descriptive', 'Viagem secreta ao litoral — São Paulo', { id: 'desc1' }),
      item('technical', 'qt  qt  isom', { id: 'tech1' }),
      item('custom', '<120 bytes>', { id: 'cust1' }),
    ];
    const all = residualPatterns(before, meta('all'));
    expect(all.map((p) => p.itemId)).toEqual(['gps1', 'dev1', 'desc1']);
    expect(all.find((p) => p.itemId === 'desc1')!.pattern.equals(Buffer.from('Viagem secreta ao litoral — São Paulo', 'utf8'))).toBe(true);
    expect(residualPatterns(before, meta({ gps: true })).map((p) => p.itemId)).toEqual(['gps1']);
    expect(residualPatterns(before, meta('none'))).toEqual([]);
  });
});

describe('compareMetadata', () => {
  it('removido: pedido e ausente na saída, sem valor residual → comprovado', () => {
    const g = item('gps', '+37.7749-122.4194/');
    const r = compareMetadata([g], [], meta('all'), new Set());
    expect(r.removed).toEqual([{ ...g, how: 'ausente', requested: true }]);
    expect(r.unverified).toEqual([]);
    expect(r.verdict).toBe('comprovado');
  });

  it('substituído: valor original trocado pelo padrão técnico do muxer', () => {
    const h = item('streams', 'Core Media Video', { id: 'st:v:handler_name', scope: 'stream', key: 'handler_name' });
    const after = [{ ...h, value: 'VideoHandler', category: 'technical' as const, sensitive: false }];
    const r = compareMetadata([h], after, meta('all'), new Set());
    expect(r.removed).toHaveLength(1);
    expect(r.removed[0]).toMatchObject({ how: 'substituido', requested: true, value: 'Core Media Video', note: 'Agora: VideoHandler' });
    expect(r.added).toEqual([]);
    expect(r.verdict).toBe('comprovado');
  });

  it('não comprovado: campo some da inspeção mas o valor ainda está nos bytes', () => {
    const c = item('descriptive', 'Viagem secreta ao litoral');
    const r = compareMetadata([c], [], meta('all'), new Set([c.id]));
    expect(r.removed).toEqual([]);
    expect(r.unverified).toHaveLength(1);
    expect(r.unverified[0]!.reason).toMatch(/bytes/);
    expect(r.verdict).toBe('nao-comprovado');
  });

  it('não comprovado: campo ainda presente com o mesmo valor', () => {
    const c = item('device', 'iPhone 14 Pro');
    const r = compareMetadata([c], [{ ...c }], meta('all'), new Set());
    expect(r.unverified[0]!.reason).toMatch(/mesmo valor/);
    expect(r.verdict).toBe('nao-comprovado');
  });

  it('valor sensível trocado por OUTRO valor da mesma categoria não conta como removido', () => {
    // Pedido: remover GPS. A saída ainda tem coordenadas (outra formatação) — isso não é "substituído pelo muxer".
    const g = item('gps', '+37.7749-122.4194+010.000/', { id: 'fmt:location', key: 'location' });
    const after = [{ ...g, value: '+37.7749-122.4194/' }];
    const r = compareMetadata([g], after, meta('all'), new Set());
    expect(r.removed.map((x) => x.id), 'GPS ainda presente foi contado como removido').not.toContain('fmt:location');
    expect(r.verdict).not.toBe('comprovado');
  });

  it('preservado por escolha (mesmo valor ou regravado) e removido sem pedido', () => {
    const g = item('gps', 'Ubatuba-SP');
    const d = item('device', 'Canon EOS R5');
    const s = item('software', 'Lightroom');
    const r = compareMetadata([g, d, s], [{ ...g }, { ...d, value: 'Canon EOS R5 (regravado)' }], meta({ dates: true }), new Set());
    expect(r.preserved.map((p) => [p.id, p.reason])).toEqual([
      [g.id, 'Mantido por escolha'],
      [d.id, 'Mantido por escolha (valor regravado pelo processamento)'],
    ]);
    expect(r.preserved[1]!.value).toBe('Canon EOS R5 (regravado)');
    expect(r.removed).toEqual([{ ...s, how: 'ausente', requested: false }]);
    expect(r.verdict).toBe('nada-a-remover'); // pediu "datas", mas não havia datas
  });

  it('campos técnicos: presentes → preservados; ausentes → removidos sem pedido', () => {
    const t1 = item('technical', 'qt  ');
    const t2 = item('technical', '512');
    const r = compareMetadata([t1, t2], [{ ...t1 }], meta('all'), new Set());
    expect(r.preserved).toEqual([{ ...t1, reason: 'Campo técnico do formato' }]);
    expect(r.removed).toEqual([{ ...t2, how: 'ausente', requested: false }]);
    expect(r.verdict).toBe('nada-a-remover');
  });

  it('adicionados: campos novos na saída aparecem e geram nota quando sensíveis', () => {
    const enc = item('software', 'Lavf60.16.100', { id: 'fmt:encoder' });
    const r = compareMetadata([], [enc, item('technical', 'isom', { id: 'fmt:major_brand' })], meta('all'), new Set());
    expect(r.added.map((a) => a.id)).toEqual(['fmt:encoder', 'fmt:major_brand']);
    expect(r.notes.join(' ')).toMatch(/não existiam na entrada/);
    const tech = compareMetadata([], [item('technical', 'isom')], meta('all'), new Set());
    expect(tech.notes.join(' ')).not.toMatch(/não existiam na entrada/);
  });

  it('veredito parcial e notas de categorias mantidas', () => {
    const a = item('gps', 'Ubatuba-SP');
    const b = item('device', 'iPhone 14 Pro');
    const r = compareMetadata([a, b], [{ ...b }], meta({ gps: true, device: true }), new Set(), ['Nota extra do executor.']);
    expect(r.verdict).toBe('parcial');
    expect(r.notes).toContain('Nota extra do executor.');
    expect(r.notes.join(' ')).toMatch(/Categorias mantidas por escolha: Datas e horários/);
  });

  it('sem configuração ou sem nenhuma categoria → não solicitado', () => {
    const a = item('gps', 'Ubatuba-SP');
    expect(compareMetadata([a], [], null, new Set()).verdict).toBe('nao-solicitado');
    const none = compareMetadata([a], [{ ...a }], meta('none'), new Set());
    expect(none.verdict).toBe('nao-solicitado');
    expect(none.unverified).toEqual([]);
    expect(none.preserved).toHaveLength(1);
  });
});

describe('verificação de ponta a ponta com a limpeza real de imagem', () => {
  const photo = fs.readFileSync(fx('photo.jpg'));
  const before = imageItems(readImageBlocks(photo, 'jpeg'));
  const check = (out: Buffer, m: MetadataSettings) => {
    const after = imageItems(readImageBlocks(out, 'jpeg'));
    const patterns = residualPatterns(before, m);
    const residual = new Set(patterns.filter((p) => out.includes(p.pattern)).map((p) => p.itemId));
    return compareMetadata(before, after, m, residual);
  };

  it('limpeza total do JPEG: veredito comprovado, orientação preservada como campo técnico', () => {
    const m = meta('all');
    const r = check(cleanImage(photo, 'jpeg', m).buffer, m);
    expect(r.verdict).toBe('comprovado');
    expect(r.unverified).toEqual([]);
    expect(r.added).toEqual([]);
    const removedIds = r.removed.map((x) => x.id);
    expect(removedIds).toEqual(expect.arrayContaining(['exif:gps:2', 'exif:gps:4', 'exif:ifd0:272', 'xmp0:photoshop:City', 'jpeg:comment:0', 'trailing']));
    expect(r.preserved.map((p) => p.id)).toContain('exif:ifd0:274');
    // Tudo que não é técnico saiu
    expect(r.preserved.every((p) => p.category === 'technical')).toBe(true);
  });

  it('limpeza só de GPS: GPS comprovadamente removido, aparelho preservado por escolha', () => {
    const m = meta({ gps: true });
    const r = check(cleanImage(photo, 'jpeg', m).buffer, m);
    expect(r.verdict).toBe('comprovado');
    expect(r.removed.filter((x) => x.requested).map((x) => x.category).every((c) => c === 'gps')).toBe(true);
    expect(r.preserved.find((p) => p.id === 'exif:ifd0:272')).toMatchObject({ value: SENSITIVE.jpegModel, reason: 'Mantido por escolha' });
  });

  it('controle negativo: se a "limpeza" não fizer nada, o veredito denuncia', () => {
    const m = meta('all');
    const r = check(photo, m);
    expect(r.verdict).toBe('nao-comprovado');
    expect(r.unverified.length).toBe(before.filter((i) => requestedFor(i, m)).length);
  });

  it('a busca nos bytes pega o que a inspeção não vê (saída com metadados, mas lista vazia)', () => {
    const m = meta('all');
    const patterns = residualPatterns(before, m);
    const residual = new Set(patterns.filter((p) => photo.includes(p.pattern)).map((p) => p.itemId));
    const r = compareMetadata(before, [], m, residual);
    expect(r.verdict).not.toBe('comprovado');
    expect(r.unverified.map((u) => u.value)).toEqual(expect.arrayContaining([SENSITIVE.jpegModel, SENSITIVE.jpegXmpCity, SENSITIVE.jpegComment]));
  });
});
