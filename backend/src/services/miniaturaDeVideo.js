'use strict';

/**
 * A miniatura de um vídeo — o quadro que as telas mostram na grade.
 *
 * ── Por que ela precisou sair do loopController
 *
 * A função vivia dentro de `loopController.js`, e por isso só rodava no upload
 * feito pela tela de Loop. Vídeo que entrava pela Biblioteca ou pelo Postar
 * nunca ganhava miniatura — e a grade de seleção pede
 * `<arquivo>.thumb.jpg`, esconde a imagem quando ela dá 404 e deixa o cartão
 * VAZIO. Medido no servidor em 23/09/2026: 1.796 vídeos em `uploads/`, 290
 * miniaturas. Cinco de cada seis cartões apareciam pretos, com só o botão de
 * remover — exatamente o que se vê no celular ao escolher vinte mídias.
 *
 * ── O que ela faz
 *
 * Um quadro do segundo 1, cortado em 270×480 (a proporção do Reel). Do segundo
 * 1 e não do zero porque muitos vídeos abrem em preto ou num fade — e uma
 * grade de miniaturas pretas não ajuda a escolher nada. Se o vídeo for mais
 * curto que isso, tenta de novo sem o salto.
 *
 * Falha em silêncio de propósito: miniatura é conveniência. Um vídeo que o
 * ffmpeg não consegue ler ainda publica normalmente, e derrubar o upload por
 * causa da imagenzinha seria trocar o essencial pelo acessório.
 */

const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');

const LARGURA = 270;
const ALTURA = 480;
const TEMPO_LIMITE_MS = 30_000;

const EXT_VIDEO = /\.(mp4|mov|webm|avi|mkv|m4v)$/i;

/** É vídeo? A grade decide pelo nome, e aqui a regra é a mesma. */
function ehVideo(nome) {
  return EXT_VIDEO.test(String(nome || ''));
}

/** `reel.mp4` → `reel.thumb.jpg` — o nome que o frontend procura. */
function nomeDaMiniatura(arquivo) {
  return String(arquivo || '').replace(/\.[^.]+$/, '') + '.thumb.jpg';
}

/**
 * Gera a miniatura. Resolve sempre — `true` se o arquivo ficou lá.
 *
 * @param {string} entrada  caminho do vídeo
 * @param {string} saida    caminho do .thumb.jpg
 */
function gerarMiniatura(entrada, saida) {
  return new Promise(resolve => {
    const args = salto => [
      ...(salto ? ['-ss', '00:00:01'] : []),
      '-i', entrada,
      '-vf', `scale=${LARGURA}:${ALTURA}:force_original_aspect_ratio=increase,crop=${LARGURA}:${ALTURA}`,
      '-frames:v', '1', '-q:v', '3', '-y', saida,
    ];
    /* O MESMO ffmpeg do resto do motor (services/ffmpegBin.js): o binário do
       sistema, porque o `ffmpeg-static` vem sem drawtext. Usar 'ffmpeg' solto
       daria outro binário conforme o PATH do processo. */
    const { FFMPEG_BIN: bin } = require('./ffmpegBin');

    execFile(bin, args(true), { timeout: TEMPO_LIMITE_MS }, err => {
      if (!err) return resolve(fs.existsSync(saida));
      /* Vídeo com menos de 1 segundo: o salto cai depois do fim e o ffmpeg não
         escreve nada. Sem o salto, pega o primeiro quadro que existir. */
      execFile(bin, args(false), { timeout: TEMPO_LIMITE_MS }, () => resolve(fs.existsSync(saida)));
    });
  });
}

/**
 * Garante a miniatura de um arquivo dentro de `uploads/`.
 *
 * Não refaz o que já existe: é a diferença entre o upload voltar na hora e
 * esperar o ffmpeg abrir um arquivo de 40 MB de novo.
 *
 * @returns {Promise<string|null>} o NOME da miniatura, ou null
 */
async function garantirMiniatura(pastaUploads, arquivo) {
  if (!ehVideo(arquivo)) return null;
  const nome = nomeDaMiniatura(arquivo);
  const destino = path.join(pastaUploads, nome);
  if (fs.existsSync(destino)) return nome;
  const entrada = path.join(pastaUploads, arquivo);
  if (!fs.existsSync(entrada)) return null;
  const ok = await gerarMiniatura(entrada, destino);
  return ok ? nome : null;
}

module.exports = { gerarMiniatura, garantirMiniatura, nomeDaMiniatura, ehVideo, LARGURA, ALTURA };
