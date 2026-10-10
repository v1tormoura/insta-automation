import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { exifSegment, parseJpeg, rebuildJpeg, segmentBytes } from '../../src/media/metadata/jpeg';
import { chunkBytes, parsePng, rebuildPng, textChunk } from '../../src/media/metadata/png';
import {
  asciiEntry,
  buildTiff,
  longEntry,
  rationalEntry,
  shortEntry,
  undefinedEntry,
  type ByteOrder,
} from '../../src/media/metadata/tiff';

/**
 * Mídias de teste geradas com o FFmpeg instalado (nada de arquivos binários no
 * repositório). Metadados sensíveis são injetados de propósito para provar a
 * remoção: GPS, aparelho, datas, software, comentários, XMP, dados após o EOI.
 */
export const FIXTURES = path.join(os.tmpdir(), 'mediaforge-fixtures-v3');
export const fx = (name: string) => path.join(FIXTURES, name);

const ff = (args: string[]) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'pipe' });

export const SENSITIVE = {
  videoModel: 'iPhone 14 Pro',
  videoIso6709: '+37.7749-122.4194+010.000/',
  videoComment: 'Viagem secreta ao litoral',
  jpegMake: 'Canon',
  jpegModel: 'Canon EOS R5',
  jpegSoftware: 'Adobe Photoshop 25.0',
  jpegDate: '2023:07:14 10:22:33',
  jpegArtist: 'Fulano de Tal',
  jpegLens: 'RF24-105mm F4 L IS USM',
  jpegSerial: '012345678901',
  jpegComment: 'Foto tirada na casa da praia',
  jpegXmpTool: 'Adobe Lightroom Classic 13.0',
  jpegXmpCity: 'Ubatuba-SP',
  jpegTrailer: 'SEFH-trailer-Galaxy-S23-serial-XYZ',
  pngSoftware: 'GIMP 2.10.36',
  pngComment: 'Rascunho confidencial do cliente',
  pngModel: 'Pixel 8 Pro',
};

export const SRT = '1\n00:00:00,000 --> 00:00:01,500\nLegenda própria, com vírgula\n\n2\n00:00:01,600 --> 00:00:02,800\nSegunda linha\n';

function exifTiff(order: ByteOrder, opts: { orientation?: number; withGps?: boolean; make?: string; model?: string } = {}) {
  const ifd0 = [
    asciiEntry(0x010f, opts.make ?? SENSITIVE.jpegMake),
    asciiEntry(0x0110, opts.model ?? SENSITIVE.jpegModel),
    asciiEntry(0x0131, SENSITIVE.jpegSoftware),
    asciiEntry(0x0132, SENSITIVE.jpegDate),
    asciiEntry(0x013b, SENSITIVE.jpegArtist),
    rationalEntry(0x011a, [[72, 1]], order),
    rationalEntry(0x011b, [[72, 1]], order),
    shortEntry(0x0128, 2, order),
  ];
  if (opts.orientation) ifd0.push(shortEntry(0x0112, opts.orientation, order));
  const exif = [
    asciiEntry(0x9003, SENSITIVE.jpegDate),
    asciiEntry(0xa434, SENSITIVE.jpegLens),
    asciiEntry(0xa431, SENSITIVE.jpegSerial),
    rationalEntry(0x829a, [[1, 250]], order),
    rationalEntry(0x829d, [[4, 1]], order),
    shortEntry(0x8827, 200, order),
    shortEntry(0xa001, 1, order),
    undefinedEntry(0x9286, Buffer.concat([Buffer.from('ASCII\0\0\0', 'latin1'), Buffer.from('Casa da praia')])),
    undefinedEntry(0x927c, Buffer.from('MAKERNOTE-PRIVADO-0001')),
  ];
  const gps = opts.withGps === false
    ? []
    : [
        asciiEntry(0x0001, 'S'),
        rationalEntry(0x0002, [[23, 1], [33, 1], [1234, 100]], order),
        asciiEntry(0x0003, 'W'),
        rationalEntry(0x0004, [[46, 1], [38, 1], [5678, 100]], order),
        rationalEntry(0x0006, [[760, 1]], order),
        longEntry(0x0005, 0, order),
      ];
  return buildTiff({ order, ifd0, exif, gps });
}

const XMP = `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="XMP Core 6.0.0">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/"
    xmp:CreatorTool="${SENSITIVE.jpegXmpTool}" xmp:CreateDate="2023-07-14T10:22:33" photoshop:City="${SENSITIVE.jpegXmpCity}"/>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;

function buildJpegWithMetadata(base: Buffer): Buffer {
  const s = parseJpeg(base);
  const insert = [
    exifSegment(exifTiff('BE', { orientation: 6 })),
    segmentBytes(0xe1, Buffer.concat([Buffer.from('http://ns.adobe.com/xap/1.0/\0', 'latin1'), Buffer.from(XMP, 'utf8')])),
    segmentBytes(0xfe, Buffer.from(SENSITIVE.jpegComment, 'utf8')),
  ];
  const rebuilt = rebuildJpeg(base, s, () => true, insert, false);
  return Buffer.concat([rebuilt, Buffer.from(SENSITIVE.jpegTrailer, 'latin1')]);
}

function buildPngWithMetadata(base: Buffer): Buffer {
  const s = parsePng(base);
  const time = Buffer.from([0x07, 0xe8, 1, 2, 3, 4, 5]);
  const itxt = Buffer.concat([Buffer.from('Author\0\0\0\0\0', 'latin1'), Buffer.from('Maria Souza', 'utf8')]);
  return rebuildPng(base, s, () => true, [
    textChunk('Software', SENSITIVE.pngSoftware),
    textChunk('Comment', SENSITIVE.pngComment),
    textChunk('Creation Time', '2024-01-02 03:04:05'),
    chunkBytes('iTXt', itxt),
    chunkBytes('tIME', time),
    chunkBytes('eXIf', exifTiff('LE', { make: 'Google', model: SENSITIVE.pngModel })),
  ]);
}

export async function buildFixtures(): Promise<void> {
  const marker = fx('.done');
  if (fs.existsSync(marker)) return;
  fs.rmSync(FIXTURES, { recursive: true, force: true });
  fs.mkdirSync(FIXTURES, { recursive: true });

  // Vídeo com metadados de iPhone (contêiner MOV)
  ff([
    '-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=25:d=3',
    '-f', 'lavfi', '-i', 'sine=f=440:d=3:sample_rate=48000',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '25', '-c:a', 'aac', '-shortest',
    '-movflags', 'use_metadata_tags',
    '-metadata', `location=${SENSITIVE.videoIso6709}`,
    '-metadata', `com.apple.quicktime.location.ISO6709=${SENSITIVE.videoIso6709}`,
    '-metadata', 'com.apple.quicktime.make=Apple',
    '-metadata', `com.apple.quicktime.model=${SENSITIVE.videoModel}`,
    '-metadata', 'com.apple.quicktime.software=17.1.2',
    '-metadata', 'creation_time=2024-05-01T10:00:00Z',
    '-metadata', `comment=${SENSITIVE.videoComment}`,
    '-metadata:s:v:0', 'handler_name=Core Media Video',
    '-metadata:s:a:0', 'language=por',
    fx('iphone.mov'),
  ]);
  // MP4 simples (com áudio) e sem áudio
  ff(['-f', 'lavfi', '-i', 'testsrc2=s=320x240:r=30:d=2', '-f', 'lavfi', '-i', 'sine=f=660:d=2:sample_rate=48000', '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '15', '-c:a', 'aac', '-shortest', fx('plain.mp4')]);
  ff(['-f', 'lavfi', '-i', 'testsrc2=s=320x240:r=30:d=2', '-c:v', 'libx264', '-preset', 'ultrafast', fx('noaudio.mp4')]);
  // Vídeo mais longo para cancelamento/concorrência
  ff(['-f', 'lavfi', '-i', 'testsrc2=s=1280x720:r=30:d=20', '-f', 'lavfi', '-i', 'sine=f=220:d=20', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-shortest', fx('long.mp4')]);
  // Rotação (matriz de exibição 90°)
  ff(['-display_rotation', '90', '-i', fx('plain.mp4'), '-c', 'copy', fx('rotated.mp4')]);
  // Cena auxiliar e trilha
  ff(['-f', 'lavfi', '-i', 'testsrc=s=640x480:r=25:d=2', '-c:v', 'libx264', '-preset', 'ultrafast', fx('scene.mp4')]);
  ff(['-f', 'lavfi', '-i', 'sine=f=330:d=4:sample_rate=44100', '-c:a', 'libmp3lame', fx('track.mp3')]);
  fs.writeFileSync(fx('legendas.srt'), SRT, 'utf8');

  // JPEG com EXIF (orientação 6), GPS, XMP, comentário e dados após o EOI
  ff(['-f', 'lavfi', '-i', 'testsrc2=s=400x300', '-frames:v', '1', '-q:v', '3', '-fflags', '+bitexact', '-flags:v', '+bitexact', fx('base.jpg')]);
  fs.writeFileSync(fx('photo.jpg'), buildJpegWithMetadata(fs.readFileSync(fx('base.jpg'))));
  // PNG com transparência e chunks de texto/EXIF/tIME
  ff(['-f', 'lavfi', '-i', 'testsrc2=s=200x100,format=rgba,colorchannelmixer=aa=0.6', '-frames:v', '1', '-fflags', '+bitexact', '-flags:v', '+bitexact', fx('base.png')]);
  fs.writeFileSync(fx('graphic.png'), buildPngWithMetadata(fs.readFileSync(fx('base.png'))));
  // Logotipo e WEBP
  ff(['-f', 'lavfi', '-i', 'color=c=red@0.5:s=120x60,format=rgba', '-frames:v', '1', fx('logo.png')]);
  ff(['-f', 'lavfi', '-i', 'testsrc2=s=300x200', '-frames:v', '1', '-c:v', 'libwebp', '-quality', '80', fx('image.webp')]);

  // Arquivos inválidos
  fs.writeFileSync(fx('fake.mp4'), 'isto não é um vídeo, só texto qualquer com tamanho suficiente\n'.repeat(4));
  fs.writeFileSync(fx('empty.mp4'), '');
  fs.writeFileSync(fx('program.mp4'), Buffer.concat([Buffer.from('MZ'), Buffer.alloc(512, 0x90)]));
  const good = fs.readFileSync(fx('plain.mp4'));
  const corrupt = Buffer.from(good);
  // Mantém o "ftyp" (parece MP4) mas destrói o restante: ffprobe precisa recusar.
  for (let i = 40; i < corrupt.length; i++) corrupt[i] = (i * 7919) & 0xff;
  fs.writeFileSync(fx('corrupt.mp4'), corrupt);

  fs.writeFileSync(marker, new Date().toISOString());
}
