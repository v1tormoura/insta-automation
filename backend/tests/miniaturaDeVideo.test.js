'use strict';

/**
 * A miniatura do vídeo.
 *
 * O que estes testes protegem: a regra de QUEM ganha miniatura (vídeo, não
 * imagem), o nome que o frontend procura, e o "não refaz o que já existe" —
 * era a diferença entre o upload voltar na hora e esperar o ffmpeg reabrir
 * cada arquivo de 40 MB.
 *
 * O que NÃO testam: o quadro em si. Isso é o ffmpeg, e dublá-lo provaria só
 * que o dublê funciona.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const { nomeDaMiniatura, ehVideo, garantirMiniatura } = require('../src/services/miniaturaDeVideo');

describe('quem ganha miniatura', () => {
  test('vídeo sim, imagem não', () => {
    for (const v of ['a.mp4', 'b.MOV', 'c.webm', 'd.avi', 'e.mkv', 'f.m4v']) expect(ehVideo(v)).toBe(true);
    for (const i of ['a.jpg', 'b.png', 'c.webp', 'd.gif', '', null]) expect(ehVideo(i)).toBe(false);
  });

  test('o nome é o que a grade do Postar procura', () => {
    expect(nomeDaMiniatura('reel.mp4')).toBe('reel.thumb.jpg');
    expect(nomeDaMiniatura('1790126428621-TODO.DIA_2097.mp4')).toBe('1790126428621-TODO.DIA_2097.thumb.jpg');
    expect(nomeDaMiniatura('sem-extensao')).toBe('sem-extensao.thumb.jpg');
  });
});

describe('garantirMiniatura', () => {
  let pasta;
  beforeEach(() => { pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'mini-')); });
  afterEach(() => { fs.rmSync(pasta, { recursive: true, force: true }); });

  test('imagem não gera nada', async () => {
    fs.writeFileSync(path.join(pasta, 'foto.jpg'), 'x');
    expect(await garantirMiniatura(pasta, 'foto.jpg')).toBeNull();
  });

  test('miniatura que JÁ existe é devolvida sem chamar o ffmpeg', async () => {
    /* Sem este atalho, um envio de 200 vídeos reabriria os 200 no ffmpeg a
       cada upload. O teste prova pelo tempo: reaproveitar é instantâneo. */
    fs.writeFileSync(path.join(pasta, 'reel.mp4'), 'x');
    fs.writeFileSync(path.join(pasta, 'reel.thumb.jpg'), 'ja-existe');
    const t0 = Date.now();
    expect(await garantirMiniatura(pasta, 'reel.mp4')).toBe('reel.thumb.jpg');
    expect(Date.now() - t0).toBeLessThan(200);
    expect(fs.readFileSync(path.join(pasta, 'reel.thumb.jpg'), 'utf8')).toBe('ja-existe');
  });

  test('arquivo que não existe devolve null, sem lançar', async () => {
    expect(await garantirMiniatura(pasta, 'sumiu.mp4')).toBeNull();
  });
});
