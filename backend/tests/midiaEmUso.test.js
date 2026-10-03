'use strict';

/** Arquivo usado por um envio que não terminou não sai do disco. */

const fs = require('fs');
const path = require('path');
const banco = require('./helpers/banco');
const { sql } = banco;
const { midiaEmUso } = require('../src/services/midiaEmUso');
const { deleteMedia } = require('../src/controllers/mediaController');
const { media, posts } = require('../src/repos');

const UPLOADS = path.resolve(__dirname, '../uploads');
const nome = `teste-em-uso-${Date.now()}.mp4`;

beforeEach(async () => { await banco.limpar(); fs.writeFileSync(path.join(UPLOADS, nome), 'x'); });
afterAll(async () => { fs.rmSync(path.join(UPLOADS, nome), { force: true }); await sql.end(); });

function chamar(id) {
  return new Promise(resolve => {
    const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { resolve({ status: this.statusCode, body: b }); } };
    deleteMedia({ user: { id: banco.DONO_ID }, params: { id } }, res);
  });
}

test('post pendente com o arquivo: recusa apagar e o arquivo fica', async () => {
  const item = await media.de(banco.DONO_ID).insert({ filename: nome, originalName: 'v.mp4', path: nome, url: `/uploads/${nome}`, mimeType: 'video/mp4', size: 1, type: 'video', folder: 'X' });
  await posts.de(banco.DONO_ID).insert({ media: nome, mediaType: 'video', postType: 'reel', status: 'pendente' });
  expect(await midiaEmUso(banco.DONO_ID, nome)).toBeTruthy();
  const r = await chamar(item.id);
  expect(r.status).toBe(409);
  expect(fs.existsSync(path.join(UPLOADS, nome))).toBe(true);
});

test('sem envio usando: apaga normalmente', async () => {
  const item = await media.de(banco.DONO_ID).insert({ filename: nome, originalName: 'v.mp4', path: nome, url: `/uploads/${nome}`, mimeType: 'video/mp4', size: 1, type: 'video', folder: 'X' });
  await posts.de(banco.DONO_ID).insert({ media: nome, mediaType: 'video', postType: 'reel', status: 'concluido' });
  const r = await chamar(item.id);
  expect(r.status).toBe(200);
  expect(fs.existsSync(path.join(UPLOADS, nome))).toBe(false);
});
