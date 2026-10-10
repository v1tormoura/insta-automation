import { metadataSettingsSchema, type MetadataSettings } from '@mediaforge/shared';
import { describe, expect, it } from 'vitest';
import { rebuildExif } from '../../src/media/metadata/imageMeta';
import {
  asciiEntry,
  buildTiff,
  byteEntry,
  decodeEntry,
  longEntry,
  orientationOf,
  orientationOnlyTiff,
  parseTiff,
  rationalEntry,
  shortEntry,
  TAG_MAKERNOTE,
  TAG_ORIENTATION,
  TiffParseError,
  undefinedEntry,
  type ByteOrder,
  type TiffData,
  type TiffEntry,
} from '../../src/media/metadata/tiff';

const ALL_FALSE = { gps: false, dates: false, device: false, descriptive: false, software: false, custom: false, container: false, streams: false, embedded: false };
const meta = (remove: Partial<MetadataSettings['remove']> | 'all' | 'none', extra: Partial<Omit<MetadataSettings, 'remove'>> = {}): MetadataSettings =>
  metadataSettingsSchema.parse({ remove: remove === 'all' ? {} : remove === 'none' ? ALL_FALSE : { ...ALL_FALSE, ...remove }, ...extra });

function sentinelTiff(order: ByteOrder, orientation = 6) {
  const ifd0: TiffEntry[] = [
    asciiEntry(0x010f, 'Canon'),
    asciiEntry(0x0110, 'Canon EOS R5'),
    asciiEntry(0x0131, 'Adobe Photoshop 25.0'),
    asciiEntry(0x0132, '2023:07:14 10:22:33'),
    asciiEntry(0x013b, 'Fulano de Tal'),
    rationalEntry(0x011a, [[72, 1]], order),
    rationalEntry(0x011b, [[72, 1]], order),
    shortEntry(0x0128, 2, order),
    shortEntry(TAG_ORIENTATION, orientation, order),
  ];
  const exif: TiffEntry[] = [
    asciiEntry(0x9003, '2023:07:14 10:22:33'),
    asciiEntry(0xa434, 'RF24-105mm F4 L IS USM'),
    asciiEntry(0xa431, '012345678901'),
    rationalEntry(0x829a, [[1, 250]], order),
    shortEntry(0x8827, 200, order),
    shortEntry(0xa001, 1, order),
    undefinedEntry(0x9286, Buffer.concat([Buffer.from('ASCII\0\0\0', 'latin1'), Buffer.from('Casa da praia')])),
    undefinedEntry(TAG_MAKERNOTE, Buffer.from('MAKERNOTE-PRIVADO-0001')),
  ];
  const gps: TiffEntry[] = [
    asciiEntry(0x0001, 'S'),
    rationalEntry(0x0002, [[23, 1], [33, 1], [1234, 100]], order),
    asciiEntry(0x0003, 'W'),
    rationalEntry(0x0004, [[46, 1], [38, 1], [5678, 100]], order),
    asciiEntry(0x001d, '2023:07:14'),
  ];
  const interop: TiffEntry[] = [asciiEntry(0x0001, 'R98')];
  return { ifd0, exif, gps, interop };
}

/** Acrescenta um IFD1 (miniatura JPEG) a um TIFF gerado por buildTiff. */
function withThumbnail(tiff: Buffer, thumb: Buffer): Buffer {
  const le = tiff.toString('latin1', 0, 2) === 'II';
  const u16 = (o: number) => (le ? tiff.readUInt16LE(o) : tiff.readUInt16BE(o));
  const ifd0 = le ? tiff.readUInt32LE(4) : tiff.readUInt32BE(4);
  const nextPtrAt = ifd0 + 2 + u16(ifd0) * 12;
  const ifd1At = tiff.length + (tiff.length % 2);
  const ifd1 = Buffer.alloc(2 + 3 * 12 + 4);
  const w16 = (b: Buffer, o: number, v: number) => (le ? b.writeUInt16LE(v, o) : b.writeUInt16BE(v, o));
  const w32 = (b: Buffer, o: number, v: number) => (le ? b.writeUInt32LE(v, o) : b.writeUInt32BE(v, o));
  const thumbAt = ifd1At + ifd1.length;
  w16(ifd1, 0, 3);
  const entry = (i: number, tag: number, type: number, val: number) => {
    w16(ifd1, 2 + i * 12, tag);
    w16(ifd1, 4 + i * 12, type);
    w32(ifd1, 6 + i * 12, 1);
    if (type === 3) w16(ifd1, 10 + i * 12, val);
    else w32(ifd1, 10 + i * 12, val);
  };
  entry(0, 0x0103, 3, 6); // Compression = JPEG
  entry(1, 0x0201, 4, thumbAt);
  entry(2, 0x0202, 4, thumb.length);
  const out = Buffer.concat([tiff, Buffer.alloc(ifd1At - tiff.length), ifd1, thumb]);
  w32(out, nextPtrAt, ifd1At);
  return out;
}

const sameEntries = (a: TiffEntry[], b: TiffEntry[]) => {
  const norm = (l: TiffEntry[]) => [...l].sort((x, y) => x.tag - y.tag).map((e) => ({ tag: e.tag, type: e.type, count: e.count, hex: e.value.toString('hex') }));
  expect(norm(a)).toEqual(norm(b));
};

describe('parseTiff / buildTiff — ida e volta', () => {
  for (const order of ['LE', 'BE'] as const) {
    it(`preserva todos os campos byte a byte (${order})`, () => {
      const src = sentinelTiff(order);
      // valores ímpares > 4 bytes (exigem preenchimento) e LONG múltiplo
      src.ifd0.push(longEntry(0x9999, [1, 2, 3], order), byteEntry(0x9998, [1, 2, 3, 4, 5]), undefinedEntry(0x9997, Buffer.from('abcde')));
      const tiff = buildTiff({ order, ...src });
      expect(tiff.toString('latin1', 0, 2)).toBe(order === 'LE' ? 'II' : 'MM');
      const t = parseTiff(tiff);
      expect(t.order).toBe(order);
      expect(t.warnings).toEqual([]);
      sameEntries(t.ifd0, src.ifd0);
      sameEntries(t.exif, src.exif);
      sameEntries(t.gps, src.gps);
      sameEntries(t.interop, src.interop);
      expect(t.ifd1).toEqual([]);
      expect(t.thumbnail).toBeNull();
      // Reescrever o que foi lido gera exatamente os mesmos bytes (determinístico).
      expect(buildTiff({ order, ifd0: t.ifd0, exif: t.exif, gps: t.gps, interop: t.interop }).equals(tiff)).toBe(true);
    });
  }

  it('não cria IFDs vazios nem ponteiros órfãos', () => {
    const tiff = buildTiff({ order: 'LE', ifd0: [asciiEntry(0x010f, 'X')] });
    const t = parseTiff(tiff);
    expect(t.ifd0.map((e) => e.tag)).toEqual([0x010f]);
    expect(t.exif).toEqual([]);
    expect(t.gps).toEqual([]);
    // Só IFD0 com 1 entrada: 8 + 2 + 12 + 4 = 26 bytes
    expect(tiff.length).toBe(26);
  });

  it('ponteiros de IFD fornecidos pelo chamador são ignorados (recalculados)', () => {
    const fake = longEntry(0x8769, 0xdeadbeef, 'BE');
    const tiff = buildTiff({ order: 'BE', ifd0: [fake, asciiEntry(0x010f, 'X')], exif: [asciiEntry(0x9003, '2020:01:01 00:00:00')] });
    const t = parseTiff(tiff);
    expect(t.warnings).toEqual([]);
    expect(t.exif.map((e) => e.tag)).toEqual([0x9003]);
  });

  it('lê a miniatura do IFD1', () => {
    const thumb = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.from('MINIATURA-ORIGINAL'), Buffer.from([0xff, 0xd9])]);
    const tiff = withThumbnail(buildTiff({ order: 'LE', ...sentinelTiff('LE') }), thumb);
    const t = parseTiff(tiff);
    expect(t.ifd1.length).toBe(3);
    expect(t.thumbnail?.equals(thumb)).toBe(true);
  });
});

describe('decodeEntry', () => {
  it('ASCII (com NUL final e NUL interno)', () => {
    expect(decodeEntry(asciiEntry(0x0110, 'Canon EOS R5'), 'LE')).toBe('Canon EOS R5');
    expect(decodeEntry({ tag: 0x010e, type: 2, count: 8, value: Buffer.from('ab\0cd\0\0\0') }, 'BE')).toBe('ab cd');
    expect(decodeEntry(asciiEntry(0x013b, 'José Ção'), 'BE')).toBe('José Ção');
  });

  it('SHORT/LONG/SSHORT/SLONG nas duas ordens de bytes', () => {
    for (const order of ['LE', 'BE'] as const) {
      expect(decodeEntry(shortEntry(0x0112, [1, 2, 65535], order), order)).toBe('1, 2, 65535');
      expect(decodeEntry(longEntry(0x9999, [70000, 4294967295], order), order)).toBe('70000, 4294967295');
      const ss = Buffer.alloc(4);
      if (order === 'LE') ss.writeInt16LE(-5, 0), ss.writeInt16LE(7, 2);
      else ss.writeInt16BE(-5, 0), ss.writeInt16BE(7, 2);
      expect(decodeEntry({ tag: 1, type: 8, count: 2, value: ss }, order)).toBe('-5, 7');
      const sl = Buffer.alloc(4);
      if (order === 'LE') sl.writeInt32LE(-123456);
      else sl.writeInt32BE(-123456);
      expect(decodeEntry({ tag: 1, type: 9, count: 1, value: sl }, order)).toBe('-123456');
    }
  });

  it('RATIONAL/SRATIONAL (inclusive denominador zero)', () => {
    for (const order of ['LE', 'BE'] as const) {
      expect(decodeEntry(rationalEntry(0x829a, [[1, 250]], order), order)).toBe('0.004');
      expect(decodeEntry(rationalEntry(0x0002, [[23, 1], [33, 1], [1234, 100]], order), order)).toBe('23, 33, 12.34');
      expect(decodeEntry(rationalEntry(0x0002, [[5, 0]], order), order)).toBe('5');
      const v = Buffer.alloc(8);
      if (order === 'LE') v.writeInt32LE(-1, 0), v.writeInt32LE(3, 4);
      else v.writeInt32BE(-1, 0), v.writeInt32BE(3, 4);
      expect(decodeEntry({ tag: 0x9204, type: 10, count: 1, value: v }, order)).toBe('-0.333333');
    }
  });

  it('FLOAT/DOUBLE', () => {
    const f = Buffer.alloc(4);
    f.writeFloatBE(1.5);
    expect(decodeEntry({ tag: 1, type: 11, count: 1, value: f }, 'BE')).toBe('1.5');
    const d = Buffer.alloc(8);
    d.writeDoubleLE(-2.25);
    expect(decodeEntry({ tag: 1, type: 12, count: 1, value: d }, 'LE')).toBe('-2.25');
  });

  it('UserComment ASCII e UNICODE (TIFF little-endian)', () => {
    const ascii = undefinedEntry(0x9286, Buffer.concat([Buffer.from('ASCII\0\0\0', 'latin1'), Buffer.from('Casa da praia\0')]));
    expect(decodeEntry(ascii, 'BE')).toBe('Casa da praia');
    const uni = undefinedEntry(0x9286, Buffer.concat([Buffer.from('UNICODE\0', 'latin1'), Buffer.from('Olá, praia', 'utf16le')]));
    expect(decodeEntry(uni, 'LE')).toBe('Olá, praia');
    const undef = undefinedEntry(0x9286, Buffer.concat([Buffer.alloc(8), Buffer.from('sem charset')]));
    expect(decodeEntry(undef, 'LE')).toBe('sem charset');
  });

  it('UserComment UNICODE em TIFF big-endian segue a ordem de bytes do arquivo', () => {
    // EXIF 2.3: o texto UNICODE usa a ordem de bytes do TIFF ("MM" = UCS-2 big-endian).
    const be = Buffer.from('Olá, praia', 'utf16le').swap16();
    const uni = undefinedEntry(0x9286, Buffer.concat([Buffer.from('UNICODE\0', 'latin1'), be]));
    expect(decodeEntry(uni, 'BE')).toBe('Olá, praia');
  });

  it('XP* (UTF-16LE) e UNDEFINED binário', () => {
    expect(decodeEntry({ tag: 0x9c9c, type: 1, count: 12, value: Buffer.from('Oi XP\0', 'utf16le') }, 'BE')).toBe('Oi XP');
    expect(decodeEntry(undefinedEntry(0x9000, Buffer.from('0232')), 'LE')).toBe('0232');
    expect(decodeEntry(undefinedEntry(0x927c, Buffer.from([0, 1, 2, 0xff, 0xfe, 3, 4, 5, 6])), 'LE')).toBe('<9 bytes>');
    expect(decodeEntry(undefinedEntry(0xc4a5, Buffer.alloc(100, 0x41)), 'LE')).toBe('<100 bytes>');
  });

  it('limita a quantidade de valores decodificados (contagem gigante não gera texto enorme)', () => {
    const many = shortEntry(0x1234, Array.from({ length: 500 }, (_, i) => i), 'LE');
    expect(decodeEntry(many, 'LE').split(', ').length).toBe(64);
  });
});

/** Monta um TIFF "à mão" (LE) com IFD0 em 8 e permite corromper campos. */
function handTiff(ifd0Entries: Array<[tag: number, type: number, count: number, valueOrOffset: number]>, extra = Buffer.alloc(0), nextIfd = 0): Buffer {
  const n = ifd0Entries.length;
  const head = Buffer.alloc(8 + 2 + n * 12 + 4);
  head.write('II', 0, 'latin1');
  head.writeUInt16LE(42, 2);
  head.writeUInt32LE(8, 4);
  head.writeUInt16LE(n, 8);
  ifd0Entries.forEach(([tag, type, count, v], i) => {
    const o = 10 + i * 12;
    head.writeUInt16LE(tag, o);
    head.writeUInt16LE(type, o + 2);
    head.writeUInt32LE(count, o + 4);
    head.writeUInt32LE(v >>> 0, o + 8);
  });
  head.writeUInt32LE(nextIfd, 10 + n * 12);
  return Buffer.concat([head, extra]);
}

describe('parseTiff — estruturas malformadas não travam nem lançam erros inesperados', () => {
  it('recusa cabeçalhos inválidos com TiffParseError', () => {
    expect(() => parseTiff(Buffer.alloc(4))).toThrow(TiffParseError);
    expect(() => parseTiff(Buffer.from('XX*\0\x08\0\0\0', 'latin1'))).toThrow(TiffParseError);
    expect(() => parseTiff(Buffer.from('II\x2b\0\x08\0\0\0', 'latin1'))).toThrow(TiffParseError);
    expect(() => parseTiff(Buffer.from('MM\0\x2b\0\0\0\x08', 'latin1'))).toThrow(TiffParseError);
  });

  it('ciclo EXIF → IFD0 e IFD1 → IFD0 é detectado e ignorado', () => {
    const t = parseTiff(handTiff([[0x010f, 2, 4, 0x00585858], [0x8769, 4, 1, 8]], Buffer.alloc(0), 8));
    expect(t.ifd0.map((e) => e.tag)).toEqual([0x010f]);
    expect(t.exif).toEqual([]);
    expect(t.ifd1).toEqual([]);
    expect(t.warnings.join(' ')).toMatch(/ciclo/);
  });

  it('GPS e EXIF apontando para o mesmo IFD: o segundo é ignorado com aviso', () => {
    // IFD extra em 8+2+24+4 = 38
    const sub = Buffer.alloc(2 + 12 + 4);
    sub.writeUInt16LE(1, 0);
    sub.writeUInt16LE(0x0001, 2);
    sub.writeUInt16LE(2, 4);
    sub.writeUInt32LE(2, 6);
    sub.write('S\0', 10, 'latin1');
    const t = parseTiff(handTiff([[0x8769, 4, 1, 38], [0x8825, 4, 1, 38]], sub));
    expect(t.exif.length + t.gps.length).toBe(1);
    expect(t.warnings.join(' ')).toMatch(/ciclo/);
  });

  it('IFD0 fora do arquivo, contagem absurda, valor fora do bloco e tipo desconhecido', () => {
    const outOfRange = Buffer.from('II\x2a\0\xff\xff\0\0', 'latin1');
    expect(parseTiff(outOfRange).warnings.join(' ')).toMatch(/fora dos limites/);

    const huge = handTiff([]);
    huge.writeUInt16LE(5000, 8);
    expect(parseTiff(huge).warnings.join(' ')).toMatch(/5000 entradas/);

    const t = parseTiff(handTiff([[0x010f, 2, 100, 0xfffffff0], [0x0110, 99, 1, 0], [0x0131, 2, 0x40000000, 30], [0x0132, 3, 1, 7]]));
    expect(t.ifd0.map((e) => e.tag)).toEqual([0x0132]);
    const w = t.warnings.join(' | ');
    expect(w).toMatch(/fora do bloco/);
    expect(w).toMatch(/tipo desconhecido/);
    expect(w).toMatch(/grande demais/);
  });

  it('qualquer truncamento de um TIFF válido só gera TiffParseError ou dados parciais', () => {
    const tiff = buildTiff({ order: 'BE', ...sentinelTiff('BE') });
    for (let len = 0; len <= tiff.length; len++) {
      try {
        const t = parseTiff(tiff.subarray(0, len));
        expect(Array.isArray(t.ifd0)).toBe(true);
      } catch (err) {
        expect(err, `comprimento ${len}`).toBeInstanceOf(TiffParseError);
      }
    }
  });

  it('fuzz: bytes corrompidos nunca travam nem lançam outro erro além de TiffParseError', () => {
    const tiff = buildTiff({ order: 'LE', ...sentinelTiff('LE') });
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const t0 = Date.now();
    for (let i = 0; i < 3000; i++) {
      const c = Buffer.from(tiff);
      const flips = 1 + Math.floor(rnd() * 8);
      for (let j = 0; j < flips; j++) c[4 + Math.floor(rnd() * (c.length - 4))] = Math.floor(rnd() * 256);
      try {
        parseTiff(c);
      } catch (err) {
        expect(err).toBeInstanceOf(TiffParseError);
      }
    }
    expect(Date.now() - t0).toBeLessThan(20_000);
  });

  it('entradas devolvidas pelo parser sempre podem ser decodificadas (valor truncado no fim do bloco)', () => {
    // IFD0 com 1 entrada SHORT cujo valor (embutido) foi cortado: o bloco termina logo após "count".
    const t = Buffer.alloc(18);
    t.write('II', 0, 'latin1');
    t.writeUInt16LE(42, 2);
    t.writeUInt32LE(8, 4);
    t.writeUInt16LE(1, 8);
    t.writeUInt16LE(0x0112, 10);
    t.writeUInt16LE(3, 12);
    t.writeUInt32LE(1, 14);
    const parsed = parseTiff(t);
    for (const e of parsed.ifd0) expect(() => decodeEntry(e, parsed.order), `tag 0x${e.tag.toString(16)}`).not.toThrow();
    // E o mesmo vale para todo truncamento de um TIFF real.
    const full = buildTiff({ order: 'LE', ...sentinelTiff('LE') });
    for (let len = 8; len <= full.length; len++) {
      let p: TiffData;
      try {
        p = parseTiff(full.subarray(0, len));
      } catch {
        continue;
      }
      for (const ifd of ['ifd0', 'exif', 'gps', 'interop'] as const)
        for (const e of p[ifd]) expect(() => decodeEntry(e, p.order), `len ${len} ${ifd} 0x${e.tag.toString(16)}`).not.toThrow();
    }
  });
});

describe('orientação', () => {
  it('orientationOnlyTiff gera EXIF mínimo com um único campo, nas duas ordens', () => {
    for (const order of ['LE', 'BE'] as const) {
      const buf = orientationOnlyTiff(6, order);
      expect(buf.length).toBe(26);
      const t = parseTiff(buf);
      expect(t.order).toBe(order);
      expect(t.ifd0.length).toBe(1);
      expect(t.ifd0[0]!.tag).toBe(TAG_ORIENTATION);
      expect(t.exif.length + t.gps.length + t.interop.length + t.ifd1.length).toBe(0);
      expect(orientationOf(t)).toBe(6);
    }
    expect(parseTiff(orientationOnlyTiff(8)).order).toBe('BE');
  });

  it('orientationOf ignora valores fora de 1–8 e campos sem valor', () => {
    expect(orientationOf(parseTiff(buildTiff({ order: 'LE', ifd0: [shortEntry(TAG_ORIENTATION, 9, 'LE')] })))).toBeNull();
    expect(orientationOf(parseTiff(buildTiff({ order: 'LE', ifd0: [shortEntry(TAG_ORIENTATION, 0, 'LE')] })))).toBeNull();
    expect(orientationOf(parseTiff(buildTiff({ order: 'LE', ifd0: [asciiEntry(0x010f, 'X')] })))).toBeNull();
  });
});

describe('rebuildExif (reescrita seletiva)', () => {
  const thumb = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.from('MINIATURA-ORIGINAL-SEM-CORTE'), Buffer.from([0xff, 0xd9])]);

  for (const order of ['LE', 'BE'] as const) {
    it(`remover só GPS mantém Make/Model byte a byte e descarta MakerNote e miniatura (${order})`, () => {
      const src = sentinelTiff(order);
      const t = parseTiff(withThumbnail(buildTiff({ order, ...src }), thumb));
      expect(t.thumbnail).not.toBeNull();
      const r = rebuildExif(t, meta({ gps: true }), { keepOrientation: true });
      expect(Buffer.isBuffer(r.tiff)).toBe(true);
      const out = r.tiff as Buffer;
      const o = parseTiff(out);
      expect(o.order).toBe(order);
      expect(o.gps).toEqual([]);
      expect(o.ifd1).toEqual([]);
      expect(o.thumbnail).toBeNull();
      expect(out.includes(Buffer.from('MINIATURA-ORIGINAL'))).toBe(false);
      expect(out.includes(Buffer.from('MAKERNOTE-PRIVADO'))).toBe(false);
      expect(o.exif.some((e) => e.tag === TAG_MAKERNOTE)).toBe(false);
      // Tudo o que não é GPS nem MakerNote continua idêntico
      sameEntries(o.ifd0, src.ifd0);
      sameEntries(o.exif, src.exif.filter((e) => e.tag !== TAG_MAKERNOTE));
      sameEntries(o.interop, src.interop);
      expect(r.notes.join(' ')).toMatch(/MakerNote/);
      expect(r.notes.join(' ')).toMatch(/Miniatura/);
    });

    it(`remover tudo deixa só a orientação quando ≠ 1 (${order})`, () => {
      const t = parseTiff(withThumbnail(buildTiff({ order, ...sentinelTiff(order, 6) }), thumb));
      const r = rebuildExif(t, meta('all'), { keepOrientation: true });
      const o = parseTiff(r.tiff as Buffer);
      expect(o.ifd0.map((e) => e.tag)).toEqual([TAG_ORIENTATION]);
      expect(orientationOf(o)).toBe(6);
      expect(o.exif.length + o.gps.length + o.interop.length + o.ifd1.length).toBe(0);
      for (const s of ['Canon', 'Fulano', 'Photoshop', '2023:07:14', 'MAKERNOTE', 'MINIATURA', 'Casa da praia', '0123456789'])
        expect((r.tiff as Buffer).includes(Buffer.from(s)), s).toBe(false);
    });
  }

  it('remover tudo com orientação 1 (ou sem orientação) remove o EXIF inteiro', () => {
    expect(rebuildExif(parseTiff(buildTiff({ order: 'BE', ...sentinelTiff('BE', 1) })), meta('all'), { keepOrientation: true }).tiff).toBeNull();
    const noOrient = sentinelTiff('LE');
    noOrient.ifd0 = noOrient.ifd0.filter((e) => e.tag !== TAG_ORIENTATION);
    expect(rebuildExif(parseTiff(buildTiff({ order: 'LE', ...noOrient })), meta('all'), { keepOrientation: true }).tiff).toBeNull();
  });

  it('remover tudo sem preservar orientação remove o EXIF inteiro mesmo com orientação 6', () => {
    const r = rebuildExif(parseTiff(buildTiff({ order: 'BE', ...sentinelTiff('BE', 6) })), meta('all'), { keepOrientation: false });
    expect(r.tiff).toBeNull();
  });

  it('nenhuma categoria selecionada mantém o bloco original (incluindo MakerNote e miniatura)', () => {
    const t = parseTiff(withThumbnail(buildTiff({ order: 'LE', ...sentinelTiff('LE') }), thumb));
    expect(rebuildExif(t, meta('none'), { keepOrientation: true }).tiff).toBe('unchanged');
  });

  it('remover só datas preserva GPS e aparelho; datas somem', () => {
    const t = parseTiff(buildTiff({ order: 'BE', ...sentinelTiff('BE') }));
    const o = parseTiff(rebuildExif(t, meta({ dates: true }), { keepOrientation: true }).tiff as Buffer);
    expect(o.ifd0.some((e) => e.tag === 0x0132)).toBe(false);
    expect(o.exif.some((e) => e.tag === 0x9003)).toBe(false);
    expect(o.ifd0.some((e) => e.tag === 0x0110)).toBe(true);
    expect(o.gps.length).toBe(5); // GPSDateStamp é dado de localização (categoria GPS)
  });

  it('miniatura (IFD1) é descartada quando "personalizados" é pedido, mesmo sem outros campos a remover', () => {
    const tiff = withThumbnail(buildTiff({ order: 'LE', ifd0: [asciiEntry(0x010f, 'Canon'), shortEntry(TAG_ORIENTATION, 1, 'LE')] }), thumb);
    const r = rebuildExif(parseTiff(tiff), meta({ custom: true }), { keepOrientation: true });
    expect(r.tiff).not.toBe('unchanged');
    const o = parseTiff(r.tiff as Buffer);
    expect(o.ifd1).toEqual([]);
    expect(o.ifd0.find((e) => e.tag === 0x010f)?.value.toString('latin1')).toBe('Canon\0');
  });

  it('campos de tipo não suportado (ex.: UTF-8 do EXIF 3.0, tipo 129) não sobrevivem a "remover tudo"', () => {
    // Artist gravado como UTF-8 (tipo 129, EXIF 3.0) — o parser ignora o campo; o bloco não pode ser mantido intacto.
    const artist = Buffer.from('Fulano de Tal UTF8\0', 'utf8');
    const tiff = handTiff(
      [
        [0x011a, 5, 1, 38], // XResolution → dados em 38
        [0x013b, 129, artist.length, 46], // Artist UTF-8 → dados em 46
      ],
      Buffer.concat([Buffer.from([72, 0, 0, 0, 1, 0, 0, 0]), artist]),
    );
    const t = parseTiff(tiff);
    expect(t.ifd0.map((e) => e.tag)).toEqual([0x011a]);
    const r = rebuildExif(t, meta('all'), { keepOrientation: true });
    const kept = r.tiff === 'unchanged' ? tiff : r.tiff;
    expect(kept === null || !kept.includes(Buffer.from('Fulano de Tal')), `decisão: ${r.tiff === 'unchanged' ? 'unchanged' : 'reescrito'}`).toBe(true);
  });
});
