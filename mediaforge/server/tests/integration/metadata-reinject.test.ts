import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chunkBytes, parsePng, rebuildPng, textChunk } from '../../src/media/metadata/png';
import { reinjectUdtaBoxes } from '../../src/media/metadata/mp4inject';
import { scanMp4Boxes } from '../../src/media/metadata/mp4boxes';
import { Client } from '../helpers/client';
import { fx } from '../helpers/fixtures';
import { startServer, type TestServer } from '../helpers/server';

/**
 * Regressões da reinserção de blocos mantidos por escolha (caixas udta de MP4/MOV
 * e chunks PNG): nada pode voltar com dados de categorias pedidas para remoção,
 * nada que dependa da linha do tempo ou dos bytes antigos da imagem, e a estrutura
 * do arquivo precisa continuar válida.
 */

const ALL = { gps: true, dates: true, device: true, descriptive: true, software: true, custom: true, container: true, streams: true };
const NONE = { gps: false, dates: false, device: false, descriptive: false, software: false, custom: false, container: false, streams: false };

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mf-reinject-'));
const ff = (args: string[]) => execFileSync('ffmpeg', ['-v', 'error', '-y', ...args], { stdio: 'pipe' });
const box = (type: string, payload: Buffer) => {
  const b = Buffer.alloc(8);
  b.writeUInt32BE(8 + payload.length, 0);
  b.write(type, 4, 'latin1');
  return Buffer.concat([b, payload]);
};

/** Acrescenta caixas dentro de moov/udta (cria a udta se faltar). Exige moov no fim do arquivo. */
async function addUdtaBoxes(file: string, children: Buffer[]) {
  const { boxes } = await scanMp4Boxes(file);
  const moov = boxes.find((b) => b.path === 'moov')!;
  const buf = fs.readFileSync(file);
  expect(moov.start + moov.size).toBe(buf.length);
  const moovBuf = Buffer.from(buf.subarray(moov.start));
  const udta = boxes.find((b) => b.path === 'moov/udta');
  let newMoov: Buffer;
  if (udta) {
    const rel = udta.start - moov.start;
    const newUdta = Buffer.concat([moovBuf.subarray(rel, rel + udta.size), ...children]);
    newUdta.writeUInt32BE(newUdta.length, 0);
    newMoov = Buffer.concat([moovBuf.subarray(0, rel), newUdta, moovBuf.subarray(rel + udta.size)]);
  } else newMoov = Buffer.concat([moovBuf, box('udta', Buffer.concat(children))]);
  newMoov.writeUInt32BE(newMoov.length, 0);
  fs.writeFileSync(file, Buffer.concat([buf.subarray(0, moov.start), newMoov]));
}

const XMP_GPS = `<?xpacket begin=""?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
<rdf:Description rdf:about="" xmlns:exif="http://ns.adobe.com/exif/1.0/" xmlns:xmp="http://ns.adobe.com/xap/1.0/"
 exif:GPSLatitude="40,41.352N" xmp:CreatorTool="Adobe Premiere Pro 2024.0" xmp:CreateDate="2024-03-01T10:00:00"/>
</rdf:RDF></x:xmpmeta><?xpacket end="w"?>`;

let srv: TestServer;
let c: Client;
beforeAll(async () => {
  srv = await startServer();
  c = new Client(srv.base);
});
afterAll(async () => {
  await srv?.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('caixas udta de MP4/MOV mantidas por escolha', () => {
  it('XMP_ com GPS, software e datas NÃO volta quando essas categorias foram pedidas (mesmo com "personalizados" mantidos)', async () => {
    const mov = path.join(dir, 'adobe.mov');
    ff(['-i', fx('plain.mp4'), '-c', 'copy', '-map_metadata', '-1', '-fflags', '+bitexact', mov]);
    await addUdtaBoxes(mov, [box('XMP_', Buffer.from(XMP_GPS, 'utf8'))]);
    expect(fs.readFileSync(mov).includes('GPSLatitude')).toBe(true);
    const [asset] = await c.importOk(mov);
    const [job] = await c.processOk(asset!.id, { mode: 'quick', metadata: { remove: { ...ALL, custom: false } } });
    const out = (await c.download(job!.output!.downloadUrl)).body;
    for (const s of ['GPSLatitude', 'Adobe Premiere Pro', 'CreateDate']) expect(out.includes(s), s).toBe(false);
    expect(job!.report!.warnings.join(' ')).toMatch(/XMP_ não reinserida/);
  });

  it('o mesmo XMP_ volta byte a byte quando nada sensível foi pedido', async () => {
    const mov = path.join(dir, 'adobe2.mov');
    ff(['-i', fx('plain.mp4'), '-c', 'copy', '-map_metadata', '-1', '-fflags', '+bitexact', mov]);
    await addUdtaBoxes(mov, [box('XMP_', Buffer.from(XMP_GPS, 'utf8'))]);
    const [asset] = await c.importOk(mov);
    const [job] = await c.processOk(asset!.id, { mode: 'quick', metadata: { remove: NONE } });
    const out = (await c.download(job!.output!.downloadUrl)).body;
    expect(out.includes(Buffer.from(XMP_GPS, 'utf8'))).toBe(true);
  });

  it('capítulos removidos a pedido não voltam pela caixa chpl', async () => {
    const meta = path.join(dir, 'ch.txt');
    fs.writeFileSync(meta, ';FFMETADATA1\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=0\nEND=1000\ntitle=Intro\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=1000\nEND=2000\ntitle=Part two\n');
    const mp4 = path.join(dir, 'chapters.mp4');
    ff(['-i', fx('plain.mp4'), '-i', meta, '-map', '0', '-map_chapters', '1', '-c', 'copy', mp4]);
    const [asset] = await c.importOk(mp4);
    const [job] = await c.processOk(asset!.id, { mode: 'quick', metadata: { remove: { ...NONE, container: true } } });
    const out = path.join(dir, 'chapters-out.mp4');
    fs.writeFileSync(out, (await c.download(job!.output!.downloadUrl)).body);
    const chapters = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_chapters', '-of', 'json', out], { encoding: 'utf8' })).chapters;
    expect(chapters).toEqual([]);
    expect((await scanMp4Boxes(out)).boxes.some((b) => b.type === 'chpl')).toBe(false);
  });

  it('caixa extra numa udta cujo último filho termina em zeros (trkn sem total): estrutura continua válida', async () => {
    const mp4 = path.join(dir, 'track.mp4');
    ff(['-i', fx('plain.mp4'), '-c', 'copy', '-metadata', 'title=Faixa', '-metadata', 'track=1', mp4]);
    await addUdtaBoxes(mp4, [box('smta', Buffer.from('dados-samsung-opacos', 'latin1'))]);
    const [asset] = await c.importOk(mp4);
    const [job] = await c.processOk(asset!.id, { mode: 'quick', metadata: { remove: NONE } });
    const out = path.join(dir, 'track-out.mp4');
    fs.writeFileSync(out, (await c.download(job!.output!.downloadUrl)).body);
    const { boxes, warnings } = await scanMp4Boxes(out);
    expect(warnings).toEqual([]);
    const udta = boxes.find((b) => b.path === 'moov/udta')!;
    const kids = boxes.filter((b) => b.path.startsWith('moov/udta/') && b.path.split('/').length === 3);
    expect(kids.map((k) => k.type)).toContain('smta');
    // Os filhos ocupam a udta inteira (com ou sem terminador de 4 bytes): nenhum tamanho quebrado.
    const used = kids.reduce((n, k) => n + k.size, 0);
    expect([udta.size - 8, udta.size - 12]).toContain(used);
    const tags = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format_tags', '-of', 'json', out], { encoding: 'utf8' })).format.tags;
    expect(tags).toMatchObject({ title: 'Faixa', track: '1' });
    expect(job!.report!.metadata.removed.filter((r) => r.id === 'box:moov/udta/smta')).toEqual([]);
  });

  it('falha ao criar o arquivo temporário vira erro comum (não derruba o processo)', async () => {
    const src = path.join(dir, 'loci-src.mp4');
    ff(['-i', fx('plain.mp4'), '-c', 'copy', '-map_metadata', '-1', src]);
    // loci (3GPP): versão/flags, idioma, nome, papel, longitude/latitude/altitude (16.16), corpo, notas.
    const fixed = (v: number) => {
      const b = Buffer.alloc(4);
      b.writeInt32BE(Math.round(v * 65536));
      return b;
    };
    const loci = Buffer.concat([Buffer.alloc(4), Buffer.from([0x15, 0xc7]), Buffer.from('Torre\0', 'latin1'), Buffer.from([0]), fixed(2.2945), fixed(48.8584), fixed(35), Buffer.from('earth\0\0', 'latin1')]);
    await addUdtaBoxes(src, [box('loci', loci)]);
    execFileSync('ffmpeg', ['-v', 'error', '-xerror', '-i', src, '-f', 'null', '-']);
    const out = path.join(dir, 'faststart.mp4');
    ff(['-i', fx('plain.mp4'), '-c', 'copy', '-map_metadata', '-1', '-movflags', '+faststart', out]);
    fs.writeFileSync(`${out}.udta`, 'ocupado');
    await expect(reinjectUdtaBoxes(src, out, ['loci'])).rejects.toMatchObject({ code: 'EEXIST' });
    // Sem o arquivo no caminho, a mesma chamada funciona e a saída continua decodificável.
    fs.rmSync(`${out}.udta`);
    const r = await reinjectUdtaBoxes(src, out, ['loci']);
    expect(r.inserted).toEqual(['loci']);
    execFileSync('ffmpeg', ['-v', 'error', '-xerror', '-i', out, '-f', 'null', '-']);
  });
});

describe('PNG recodificado: chunks reinseridos', () => {
  it('textos voltam; iDOT (não seguro para cópia, descreve o IDAT antigo) é descartado com aviso', async () => {
    const base = fs.readFileSync(fx('graphic.png'));
    const s = parsePng(base);
    const png = path.join(dir, 'idot.png');
    fs.writeFileSync(png, rebuildPng(base, s, () => true, [chunkBytes('iDOT', Buffer.alloc(28, 1)), textChunk('Comment', 'Mantido por escolha')]));
    const [asset] = await c.importOk(png);
    const [job] = await c.processOk(asset!.id, {
      mode: 'custom',
      geometry: { resolution: 'custom', width: 100, height: 50, keepAspect: false },
      metadata: { remove: NONE },
    });
    const out = (await c.download(job!.output!.downloadUrl)).body;
    const types = parsePng(out).chunks.map((x) => x.type);
    expect(types).toContain('tEXt');
    expect(types).not.toContain('iDOT');
    expect(job!.report!.warnings.join(' ')).toMatch(/iDOT não copiado/);
  });
});
