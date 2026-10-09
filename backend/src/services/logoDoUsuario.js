'use strict';

/**
 * O logo da pessoa — um por usuário, em uploads/logos/<usuário>-<código>.png.
 *
 * Sempre guardado como PNG (convertido pelo ffmpeg, até 800px de largura):
 * mantém a transparência de quem enviou PNG/WEBP, e o filtro de logo
 * (marcaDagua.partesDoLogo) só precisa saber ler um formato.
 *
 * O caminho fica em `usuarios.preferencias.logo`. Quem desenha (Postar, Loop,
 * Variações) recebe o caminho daqui, pelo usuário logado — nunca da tela.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { FFMPEG_BIN } = require('./ffmpegBin');
const usuarios = require('../repos/usuario');

const UPLOADS = path.resolve(__dirname, '../../uploads');
const PASTA = path.join(UPLOADS, 'logos');
const VALIDO = /^logos\/[0-9a-f-]{36}-[0-9a-f]{8}\.png$/;

const absoluto = rel => path.join(UPLOADS, rel);

/** O logo atual (caminho relativo a uploads/), ou null. */
async function ler(usuarioId) {
  const u = await usuarios.porId(usuarioId);
  const rel = u?.preferencias?.logo;
  return typeof rel === 'string' && VALIDO.test(rel) && fs.existsSync(absoluto(rel)) ? rel : null;
}

/** Converte e grava o novo logo; o anterior é apagado. Devolve o caminho relativo. */
async function salvar(usuarioId, temporario) {
  fs.mkdirSync(PASTA, { recursive: true });
  const rel = `logos/${usuarioId}-${crypto.randomBytes(4).toString('hex')}.png`;
  await new Promise((resolve, reject) => {
    execFile(FFMPEG_BIN, ['-hide_banner', '-v', 'error', '-y', '-i', temporario,
      '-vf', "scale='min(iw,800)':-2", '-frames:v', '1', '-map_metadata', '-1', absoluto(rel)],
    { timeout: 30_000 }, err => (err ? reject(Object.assign(new Error('Não foi possível ler a imagem do logo.'), { invalido: true })) : resolve()));
  });
  const anterior = await ler(usuarioId);
  await usuarios.mesclar(usuarioId, 'preferencias', { logo: rel });
  if (anterior && anterior !== rel) fs.rmSync(absoluto(anterior), { force: true });
  return rel;
}

async function remover(usuarioId) {
  const anterior = await ler(usuarioId);
  await usuarios.mesclar(usuarioId, 'preferencias', { logo: null });
  if (anterior) fs.rmSync(absoluto(anterior), { force: true });
}

/**
 * A marca d'água do corpo (lerDoCorpo) com o logo do usuário resolvido.
 * Pediu logo e não tem logo enviado: segue só com o @ (ou nada).
 */
async function resolverNaMarca(marca, usuarioId) {
  if (!marca) return null;
  if (marca.logo) {
    marca.logoArquivo = (await ler(usuarioId)) || '';
    if (!marca.logoArquivo) marca.logo = false;
  }
  return marca.arroba || marca.logo ? marca : null;
}

module.exports = { ler, salvar, remover, resolverNaMarca, absoluto, PASTA };
