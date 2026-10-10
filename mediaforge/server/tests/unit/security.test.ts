import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { isRejection, sniffBuffer, sniffFile } from '../../src/media/signature';
import { contentDisposition, newId, outputStem, sanitizeDisplayName, slug } from '../../src/security/filenames';
import { isInside, PathEscapeError, resolveInside } from '../../src/security/paths';
import { fx } from '../helpers/fixtures';

/** Caracteres que nunca podem sobrar num nome exibido/baixado. */
const FORBIDDEN = /[\u0000-\u001F\u007F-\u009F<>:"/\\|?*\u202E\u202D]/;
const RESERVED_STEM = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;

/** Gerador pseudoaleatório determinístico (mulberry32) para fuzz reproduzível. */
function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('sanitizeDisplayName', () => {
  it('remove diretórios de caminhos Unix, relativos e Windows (só sobra o último componente)', () => {
    expect(sanitizeDisplayName('../../etc/passwd')).toBe('passwd');
    expect(sanitizeDisplayName('/var/www/../../root/.ssh/id_rsa')).toBe('id_rsa');
    expect(sanitizeDisplayName('..\\..\\Windows\\System32\\cmd.exe')).toBe('cmd.exe');
    expect(sanitizeDisplayName('C:\\Users\\fulano\\Desktop\\Férias.MOV')).toBe('Férias.MOV');
    expect(sanitizeDisplayName('\\\\servidor\\compartilhado\\video.mp4')).toBe('video.mp4');
    expect(sanitizeDisplayName('pasta/sub\\misto/arquivo final.jpg')).toBe('arquivo final.jpg');
  });

  it('caminho com quebra de linha no meio não sobrevive como separador', () => {
    // O regex de diretórios não cruza \n; mesmo assim nenhuma barra pode sobrar.
    const out = sanitizeDisplayName('legit\n../../etc/passwd');
    expect(out).not.toMatch(FORBIDDEN);
    expect(out).not.toContain('/');
    expect(out).not.toContain('..' + '/');
  });

  it('remove caracteres de controle C0/C1, NUL e DEL', () => {
    expect(sanitizeDisplayName('vi\u0000de\u0007o\r\n\t.mp4')).toBe('video.mp4');
    expect(sanitizeDisplayName('a\u007Fb\u0085c\u009Bd.png')).toBe('abcd.png');
    expect(sanitizeDisplayName('\u001b[31mvermelho\u001b[0m.jpg')).toBe('[31mvermelho[0m.jpg');
  });

  it('remove sobrescritas de direção (U+202E RTL override, U+202D, U+200E, U+200F) que disfarçam a extensão', () => {
    const spoof = 'foto\u202Egpj.exe';
    const out = sanitizeDisplayName(spoof);
    expect(out).toBe('fotogpj.exe');
    expect(out.endsWith('.exe')).toBe(true); // a extensão real fica visível
    expect(sanitizeDisplayName('a\u202Db\u200Ec\u200Fd.txt')).toBe('abcd.txt');
  });

  it('substitui caracteres proibidos em nomes de arquivo por "_"', () => {
    expect(sanitizeDisplayName('a<b>c:d"e|f?g*h.mp4')).toBe('a_b_c_d_e_f_g_h.mp4');
  });

  it('nomes reservados do Windows viram o nome de reserva', () => {
    for (const n of ['CON', 'con', 'PRN.txt', 'aux.mp4', 'NUL.jpg', 'Nul', 'COM1.mov', 'com9', 'LPT1.png', 'lpt9.webp']) {
      expect(sanitizeDisplayName(n), n).toBe('arquivo');
    }
    expect(sanitizeDisplayName('NUL.mp4', 'midia')).toBe('midia');
    // Não são reservados:
    expect(sanitizeDisplayName('CONSOLE.mp4')).toBe('CONSOLE.mp4');
    expect(sanitizeDisplayName('nullo.jpg')).toBe('nullo.jpg');
  });

  it('nome reservado seguido de extensão dupla (NUL.tar.gz) também é reservado no Windows', () => {
    // Documentação da Microsoft: "NUL.txt and NUL.tar.gz are both equivalent to NUL".
    for (const n of ['NUL.tar.gz', 'con.backup.mp4', 'COM1.final.mov']) {
      const out = sanitizeDisplayName(n);
      expect(out.split('.')[0], `${n} → ${out}`).not.toMatch(RESERVED_STEM);
    }
  });

  it('pontos iniciais e pontos/espaços finais são removidos; vazio vira o nome de reserva', () => {
    expect(sanitizeDisplayName('.htaccess')).toBe('htaccess');
    expect(sanitizeDisplayName('...hidden.mp4')).toBe('hidden.mp4');
    expect(sanitizeDisplayName('video.mp4. . .')).toBe('video.mp4');
    expect(sanitizeDisplayName('..')).toBe('arquivo');
    expect(sanitizeDisplayName('.')).toBe('arquivo');
    expect(sanitizeDisplayName('   ')).toBe('arquivo');
    expect(sanitizeDisplayName('')).toBe('arquivo');
    expect(sanitizeDisplayName(undefined as unknown as string)).toBe('arquivo');
    expect(sanitizeDisplayName(null as unknown as string, 'x')).toBe('x');
    expect(sanitizeDisplayName('/')).toBe('arquivo');
    expect(sanitizeDisplayName('\u0000\u0001')).toBe('arquivo');
  });

  it('normaliza para NFC', () => {
    const decomposed = 'cafe\u0301.jpg';
    const out = sanitizeDisplayName(decomposed);
    expect(out).toBe('caf\u00e9.jpg');
    expect(out.length).toBe(8);
  });

  it('nomes longos são limitados a 180 caracteres preservando a extensão', () => {
    const out = sanitizeDisplayName('a'.repeat(300) + '.mp4');
    expect(out.length).toBe(180);
    expect(out.endsWith('.mp4')).toBe(true);
    const noExt = sanitizeDisplayName('b'.repeat(500));
    expect(noExt.length).toBe(180);
    // Extensão "longa demais" (> 10) não é tratada como extensão
    const weird = sanitizeDisplayName('c'.repeat(250) + '.extensaoenorme');
    expect(weird.length).toBe(180);
  });

  it('truncamento de nome longo com emojis não quebra pares substitutos (UTF-16 bem formado)', () => {
    // 1 + 100 emojis (200 unidades) + ".mp4": o corte em 176 cai no meio de um par.
    const out = sanitizeDisplayName('a' + '😀'.repeat(100) + '.mp4');
    expect(out.length).toBeLessThanOrEqual(180);
    expect(out.isWellFormed()).toBe(true);
    expect(() => encodeURIComponent(out)).not.toThrow();
  });

  it('truncamento não deixa o nome terminar em espaço ou ponto (regra aplicada antes do corte)', () => {
    const out = sanitizeDisplayName('a'.repeat(179) + ' ' + 'b'.repeat(40));
    expect(out.length).toBeLessThanOrEqual(180);
    expect(out).not.toMatch(/[. ]$/);
    const out2 = sanitizeDisplayName('a'.repeat(170) + '.'.repeat(5) + ' '.repeat(5) + 'x'.repeat(30));
    expect(out2).not.toMatch(/[. ]$/);
  });

  it('fuzz: nenhuma entrada hostil produz separadores, controles, prefixo "." ou nome reservado', () => {
    const rnd = prng(20260410);
    const alphabet = [
      '/', '\\', '.', '..', ' ', '\u0000', '\n', '\r', '\t', '\u007F', '\u0085', '\u202E', '\u202D', '\u200E', '<', '>', ':', '"',
      '|', '?', '*', 'a', 'Z', '9', 'é', 'ç', 'CON', 'nul', 'LPT1', '.mp4', '%2e%2e', '~', '$', '"', "'", ';', '`',
    ];
    for (let i = 0; i < 3000; i++) {
      const len = 1 + Math.floor(rnd() * 30);
      let s = '';
      for (let j = 0; j < len; j++) s += alphabet[Math.floor(rnd() * alphabet.length)];
      const out = sanitizeDisplayName(s);
      expect(out.length, JSON.stringify(s)).toBeGreaterThan(0);
      expect(out.length).toBeLessThanOrEqual(180);
      expect(out, JSON.stringify(s)).not.toMatch(FORBIDDEN);
      expect(out.startsWith('.'), JSON.stringify(s)).toBe(false);
      expect(out, JSON.stringify(s)).not.toMatch(/[. ]$/);
      expect(out.replace(/\.[^.]*$/, ''), JSON.stringify(s)).not.toMatch(RESERVED_STEM);
      // Resultado estável: limpar de novo não muda nada relevante (sem barra/controle novos).
      expect(sanitizeDisplayName(out)).not.toMatch(FORBIDDEN);
    }
  });
});

describe('outputStem', () => {
  it('produz base compacta sem extensão, espaços nem símbolos', () => {
    expect(outputStem('Minhas Férias 2024!.MOV')).toBe('Minhas_Férias_2024');
    expect(outputStem('../../x   y.mp4')).toBe('x_y');
    expect(outputStem('a<b>c.jpg')).toBe('a_b_c');
    expect(outputStem('video.final.v2.mp4')).toBe('video.final.v2');
    expect(outputStem('🎉🎉.mp4')).toBe('midia');
    expect(outputStem('CON.mp4')).toBe('arquivo');
    expect(outputStem('')).toBe('arquivo');
  });

  it('limita a 80 caracteres e só usa letras, números, "_", "-" e "."', () => {
    const out = outputStem('palavra '.repeat(40) + '.mp4');
    expect(out.length).toBeLessThanOrEqual(80);
    expect(out).toMatch(/^[\p{L}\p{N}_\-.]+$/u);
    expect(out).not.toMatch(/__/);
  });

  it('corte em 80 não quebra letras fora do BMP (ex.: CJK Ext. B / letras matemáticas)', () => {
    // '𠀀' (U+20000) é \p{L} e ocupa 2 unidades UTF-16: o corte em 80 cai no meio de um par.
    const out = outputStem('x' + '𠀀'.repeat(60) + '.mp4');
    expect(out.isWellFormed()).toBe(true);
    const out2 = outputStem('y' + '𝐀'.repeat(60));
    expect(out2.isWellFormed()).toBe(true);
  });
});

describe('slug', () => {
  it('gera fragmento ASCII minúsculo com hífens', () => {
    expect(slug('Instagram Reels 9:16 (1080p)')).toBe('instagram-reels-9-16-1080p');
    expect(slug('Vídeo — Versão Ágil, Ação!')).toBe('video-versao-agil-acao');
    expect(slug('  --já--  ')).toBe('ja');
    expect(slug('***')).toBe('saida');
    expect(slug('')).toBe('saida');
    expect(slug('../../etc/passwd')).toBe('etc-passwd');
  });

  it('nunca passa de 40 caracteres nem termina/começa com hífen', () => {
    const cases = ['a'.repeat(39) + ' b', 'x'.repeat(100), 'palavra longa '.repeat(10), '9:16 '.repeat(20)];
    for (const c of cases) {
      const s = slug(c);
      expect(s.length, c).toBeLessThanOrEqual(40);
      expect(s, c).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });
});

describe('contentDisposition', () => {
  const HEADER = /^(attachment|inline); filename="([\x20-\x21\x23-\x3A\x3C-\x5B\x5D-\x7E]*)"; filename\*=UTF-8''([A-Za-z0-9%!._~-]+)$/;

  it('nome ASCII simples', () => {
    expect(contentDisposition('attachment', 'video.mp4')).toBe(`attachment; filename="video.mp4"; filename*=UTF-8''video.mp4`);
    expect(contentDisposition('inline', 'foto.jpg')).toBe(`inline; filename="foto.jpg"; filename*=UTF-8''foto.jpg`);
  });

  it('nome UTF-8: reserva ASCII sem acentos e filename* com percent-encoding que decodifica para o nome limpo', () => {
    const name = 'Férias São João (final)*.mp4';
    const h = contentDisposition('attachment', name);
    const m = h.match(HEADER);
    expect(m, h).not.toBeNull();
    expect(m![2]).toBe('Ferias Sao Joao (final)_.mp4');
    expect(decodeURIComponent(m![3]!)).toBe(sanitizeDisplayName(name));
    expect(m![3]).toContain('%C3%A9'); // é
    expect(m![3]).toContain('%28'); // ( codificado (RFC 5987 não permite parênteses crus)
  });

  it('não permite injeção de cabeçalho nem parâmetros extras', () => {
    const evil = 'a"; filename="evil.exe\r\nSet-Cookie: sid=1;\\x.mp4';
    const h = contentDisposition('attachment', evil);
    expect(h).not.toMatch(/[\r\n\0]/);
    // A estrutura inteira casa com o padrão: um único parâmetro filename (entre aspas, sem aspas internas)
    // e um único filename* — o texto "filename=" que sobra fica inofensivo dentro das aspas.
    expect(h).toMatch(HEADER);
    expect(h.match(/; filename=/g)!.length).toBe(1);
    expect(h.match(/filename\*=/g)!.length).toBe(1);
    expect(/^[\x20-\x7E]*$/.test(h)).toBe(true);
  });

  it('caminhos e nomes reservados também são limpos no cabeçalho', () => {
    expect(contentDisposition('attachment', '../../etc/passwd')).toBe(`attachment; filename="passwd"; filename*=UTF-8''passwd`);
    expect(contentDisposition('attachment', 'CON.mp4')).toMatch(/filename="arquivo"/);
  });

  it('nome longo com emojis não derruba o cabeçalho (URIError)', () => {
    const name = 'a' + '😀'.repeat(100) + '.mp4';
    let h = '';
    expect(() => (h = contentDisposition('attachment', name))).not.toThrow();
    expect(h).toMatch(HEADER);
  });

  it('fuzz: qualquer nome curto gera cabeçalho bem formado e só ASCII', () => {
    const rnd = prng(7);
    const pool = ['a', 'Z', 'é', 'ü', '中', '😀', '"', '\\', ';', ',', "'", '%', '(', ')', '*', ' ', '\r', '\n', '\u202E', '/', ':', '='];
    for (let i = 0; i < 1500; i++) {
      let s = '';
      const len = 1 + Math.floor(rnd() * 20);
      for (let j = 0; j < len; j++) s += pool[Math.floor(rnd() * pool.length)];
      const h = contentDisposition('attachment', s + '.mp4');
      expect(h, JSON.stringify(s)).toMatch(HEADER);
      const enc = h.match(HEADER)![3]!;
      expect(decodeURIComponent(enc)).toBe(sanitizeDisplayName(s + '.mp4'));
    }
  });
});

describe('resolveInside / isInside', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'mf-unit-paths-'));
  afterAll(() => fs.rmSync(base, { recursive: true, force: true }));

  it('junta partes simples dentro do diretório base', () => {
    expect(resolveInside(base, 'a')).toBe(path.join(base, 'a'));
    expect(resolveInside(base, 'sessao', 'arquivo.mp4')).toBe(path.join(base, 'sessao', 'arquivo.mp4'));
    expect(resolveInside(base + '/', 'x')).toBe(path.join(base, 'x'));
    expect(resolveInside(base, newId())).toMatch(new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/[A-Za-z0-9_-]{16}$`));
  });

  it('recusa "..", ".", vazio, separadores, NUL e caminhos absolutos', () => {
    const bad = ['..', '.', '', 'a/b', '../x', '..\\x', 'a\\b', 'x\u0000y', '/etc/passwd', 'C:\\Windows', '\\\\srv\\share', 'a/../../b'];
    for (const p of bad) {
      expect(() => resolveInside(base, p), JSON.stringify(p)).toThrow(PathEscapeError);
      expect(() => resolveInside(base, 'ok', p), JSON.stringify(p)).toThrow(PathEscapeError);
    }
  });

  it('recusa resolver para o próprio diretório base', () => {
    expect(() => resolveInside(base)).toThrow(PathEscapeError);
  });

  it('isInside detecta escapes com "..", prefixo irmão e caminhos absolutos', () => {
    expect(isInside(base, base)).toBe(true);
    expect(isInside(base, path.join(base, 'x', 'y'))).toBe(true);
    expect(isInside(base, `${base}/x/../y`)).toBe(true);
    expect(isInside(base, `${base}/..`)).toBe(false);
    expect(isInside(base, `${base}/../x`)).toBe(false);
    expect(isInside(base, `${base}/a/../../x`)).toBe(false);
    expect(isInside(base, base + '2')).toBe(false); // diretório irmão com mesmo prefixo
    expect(isInside(base, base + '-evil/x')).toBe(false);
    expect(isInside(base, '/etc/passwd')).toBe(false);
    expect(isInside(base, path.dirname(base))).toBe(false);
  });

  it('isInside aceita nomes legítimos que apenas começam com ".." (ex.: "..config")', () => {
    // path.relative devolve "..config" — não é escape, é um arquivo dentro da base.
    expect(isInside(base, path.join(base, '..config'))).toBe(true);
    expect(isInside(base, path.join(base, '...'))).toBe(true);
  });
});

// ── Assinaturas de conteúdo ───────────────────────────────────────────────

const b = (...parts: Array<string | number[] | Buffer>) =>
  Buffer.concat(parts.map((p) => (typeof p === 'string' ? Buffer.from(p, 'latin1') : Buffer.isBuffer(p) ? p : Buffer.from(p))));
const u32be = (n: number) => {
  const x = Buffer.alloc(4);
  x.writeUInt32BE(n);
  return x;
};
const u32le = (n: number) => {
  const x = Buffer.alloc(4);
  x.writeUInt32LE(n);
  return x;
};
const ftyp = (brand: string) => b(u32be(24), 'ftyp', brand, u32be(0), brand, 'isom', Buffer.alloc(16));
const ebml = (doctype: string) => b([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0x82, 0x88], doctype, Buffer.alloc(40));

describe('sniffBuffer', () => {
  const cases: Array<[string, Buffer, string, string, string]> = [
    ['JPEG', b([0xff, 0xd8, 0xff, 0xe0, 0, 16], 'JFIF\0', Buffer.alloc(20)), 'jpeg', 'image', 'jpg'],
    ['PNG', b([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], u32be(13), 'IHDR', Buffer.alloc(17)), 'png', 'image', 'png'],
    ['WEBP', b('RIFF', u32le(100), 'WEBPVP8 ', Buffer.alloc(20)), 'webp', 'image', 'webp'],
    ['GIF87a', b('GIF87a', Buffer.alloc(20)), 'gif', 'image', 'gif'],
    ['GIF89a', b('GIF89a', Buffer.alloc(20)), 'gif', 'image', 'gif'],
    ['MP4 isom', ftyp('isom'), 'mp4', 'video', 'mp4'],
    ['MP4 mp42', ftyp('mp42'), 'mp4', 'video', 'mp4'],
    ['MOV ftyp qt', ftyp('qt  '), 'mov', 'video', 'mov'],
    ['MOV sem ftyp (wide)', b(u32be(8), 'wide', u32be(100), 'mdat', Buffer.alloc(20)), 'mov', 'video', 'mov'],
    ['MOV sem ftyp (moov)', b(u32be(100), 'moov', Buffer.alloc(20)), 'mov', 'video', 'mov'],
    ['HEIC', ftyp('heic'), 'heif', 'image', 'heic'],
    ['HEIF mif1', ftyp('mif1'), 'heif', 'image', 'heic'],
    ['AVIF', ftyp('avif'), 'heif', 'image', 'avif'],
    ['M4A', ftyp('M4A '), 'm4a', 'audio', 'm4a'],
    ['3GP', ftyp('3gp4'), '3gp', 'video', '3gp'],
    ['MKV', ebml('matroska'), 'mkv', 'video', 'mkv'],
    ['WebM', ebml('webm'), 'webm', 'video', 'webm'],
    ['AVI', b('RIFF', u32le(100), 'AVI LIST', Buffer.alloc(20)), 'avi', 'video', 'avi'],
    ['WAV', b('RIFF', u32le(100), 'WAVEfmt ', Buffer.alloc(20)), 'wav', 'audio', 'wav'],
    ['MP3 ID3', b('ID3', [4, 0, 0, 0, 0, 0, 0], Buffer.alloc(20)), 'mp3', 'audio', 'mp3'],
    ['MP3 frame', b([0xff, 0xfb, 0x90, 0x64], Buffer.alloc(20)), 'mp3', 'audio', 'mp3'],
    ['AAC ADTS', b([0xff, 0xf1, 0x50, 0x80], Buffer.alloc(20)), 'aac', 'audio', 'aac'],
    ['OGG', b('OggS', Buffer.alloc(20)), 'ogg', 'audio', 'ogg'],
    ['FLAC', b('fLaC', Buffer.alloc(20)), 'flac', 'audio', 'flac'],
    ['SRT', Buffer.from('1\n00:00:00,000 --> 00:00:01,500\nOlá\n', 'utf8'), 'srt', 'subtitle', 'srt'],
    ['SRT com BOM e CRLF', Buffer.from('\uFEFF1\r\n00:00:01.000 --> 00:00:02.000\r\nX\r\n', 'utf8'), 'srt', 'subtitle', 'srt'],
  ];
  for (const [label, buf, format, family, ext] of cases) {
    it(`reconhece ${label}`, () => {
      const r = sniffBuffer(buf);
      expect(r && !isRejection(r) ? { format: r.format, family: r.family, ext: r.ext } : r).toEqual({ format, family, ext });
    });
  }

  const rejected: Array<[string, Buffer]> = [
    ['executável Windows (MZ)', b('MZ', [0x90, 0, 3, 0], Buffer.alloc(64))],
    ['MZ seguido de bytes de JPEG (poliglota)', b('MZ', [0xff, 0xd8, 0xff, 0xe0], Buffer.alloc(32))],
    ['executável ELF', b([0x7f], 'ELF', [2, 1, 1], Buffer.alloc(32))],
    ['ZIP/Office', b('PK', [3, 4], Buffer.alloc(32))],
    ['PDF', b('%PDF-1.7\n', Buffer.alloc(32))],
    ['script com shebang', Buffer.from('#!/bin/sh\nrm -rf /\n')],
    ['vazio', Buffer.alloc(0)],
    ['3 bytes', Buffer.from([0xff, 0xd8, 0xff])],
  ];
  for (const [label, buf] of rejected) {
    it(`recusa ${label}`, () => {
      const r = sniffBuffer(buf);
      expect(r).not.toBeNull();
      expect(isRejection(r)).toBe(true);
      expect((r as { reason: string }).reason.length).toBeGreaterThan(5);
    });
  }

  it('conteúdo desconhecido (texto, HTML, SVG) não é aceito como mídia', () => {
    for (const s of ['isto é só texto qualquer\n', '<!doctype html><script>alert(1)</script>', '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>', '{"json":true}']) {
      expect(sniffBuffer(Buffer.from(s)), s).toBeNull();
    }
  });

  it('decide pelo conteúdo, não pelo nome: arquivos reais das fixtures', async () => {
    const expectFmt = async (name: string, format: string) => {
      const r = await sniffFile(fx(name));
      expect(r && !isRejection(r) ? r.format : r, name).toBe(format);
    };
    await expectFmt('photo.jpg', 'jpeg');
    await expectFmt('graphic.png', 'png');
    await expectFmt('logo.png', 'png');
    await expectFmt('image.webp', 'webp');
    await expectFmt('plain.mp4', 'mp4');
    await expectFmt('iphone.mov', 'mov');
    await expectFmt('scene.mp4', 'mp4');
    await expectFmt('track.mp3', 'mp3');
    await expectFmt('legendas.srt', 'srt');
    // "corrupt.mp4" só tem cabeçalho válido: o sniff aceita (o ffprobe é que recusa depois).
    await expectFmt('corrupt.mp4', 'mp4');
    expect(await sniffFile(fx('fake.mp4'))).toBeNull();
    expect(isRejection(await sniffFile(fx('program.mp4')))).toBe(true);
    expect(isRejection(await sniffFile(fx('empty.mp4')))).toBe(true);
  });
});
