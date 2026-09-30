'use strict';

/** Importar da própria conta: lista pela API oficial e grava na Biblioteca. */

const fs = require('fs');
const path = require('path');
const banco = require('./helpers/banco');
const { sql } = banco;
const imp = require('../src/services/importarDoInstagram');

const conta = { id: 'c1', username: 'loja', igUserId: '1784', accessToken: 'T' };
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const gerados = [];

beforeEach(async () => {
  await banco.limpar();
  global.fetch = jest.fn(async url => {
    const u = String(url);
    const json = corpo => ({ ok: true, status: 200, text: async () => JSON.stringify(corpo), arrayBuffer: async () => JPEG });
    if (u.startsWith('https://cdn.test/')) return { ok: true, status: 200, arrayBuffer: async () => JPEG };
    if (u.includes('/1784/media')) return json({
      data: [
        { id: 'A', media_type: 'IMAGE', media_url: 'https://cdn.test/a.jpg', timestamp: '2026-09-20T10:00:00+0000', caption: 'oi' },
        { id: 'B', media_type: 'CAROUSEL_ALBUM', children: { data: [{ id: 'b1', media_type: 'IMAGE', media_url: 'https://cdn.test/b1.jpg' }, { id: 'b2', media_type: 'IMAGE', media_url: 'https://cdn.test/b2.jpg' }] } },
      ],
      paging: { cursors: { after: 'CUR' }, next: 'https://graph/next' },
    });
    if (u.includes('/A?')) return json({ id: 'A', media_type: 'IMAGE', media_url: 'https://cdn.test/a.jpg' });
    if (u.includes('/B?')) return json({ id: 'B', media_type: 'CAROUSEL_ALBUM', children: { data: [{ id: 'b1', media_type: 'IMAGE', media_url: 'https://cdn.test/b1.jpg' }, { id: 'b2', media_type: 'IMAGE', media_url: 'https://cdn.test/b2.jpg' }] } });
    return { ok: false, status: 404, text: async () => '{"error":{"message":"x"}}' };
  });
});
afterAll(async () => {
  for (const g of gerados) fs.rmSync(path.resolve(__dirname, '../uploads', g), { force: true });
  await sql.end();
});

test('lista as publicações da conta, com o cursor da próxima página', async () => {
  const r = await imp.listar(conta);
  expect(r.depois).toBe('CUR');
  expect(r.itens.map(i => [i.id, i.tipo, i.itens])).toEqual([['A', 'IMAGE', 1], ['B', 'CAROUSEL_ALBUM', 2]]);
  expect(String(global.fetch.mock.calls[0][0])).toContain('/1784/media');
});

test('importa foto e carrossel (um arquivo por item) para a Biblioteca', async () => {
  const progresso = [];
  const r = await imp.importar({ usuarioId: banco.DONO_ID, conta, ids: ['A', 'B'], pasta: 'Minhas', aoProgredir: p => progresso.push(p) });
  gerados.push(...r.importados.map(m => m.filename));
  expect(r.erros).toEqual([]);
  expect(r.importados).toHaveLength(3);
  expect(r.importados.every(m => m.folder === 'Minhas' && m.type === 'image')).toBe(true);
  const [{ n }] = await sql`select count(*)::int as n from media where usuario_id = ${banco.DONO_ID}`;
  expect(n).toBe(3);
  expect(progresso.at(-1)).toMatchObject({ feitas: 2, total: 2, importados: 3 });
});

test('sem token: recusa', async () => {
  await expect(imp.listar({ username: 'x' })).rejects.toThrow('não está conectada');
});

test('escala pelo menor lado, sem ampliar', () => {
  expect(imp.escala(720)).toBe("scale='if(gt(iw,ih),-2,min(iw,720))':'if(gt(iw,ih),min(ih,720),-2)'");
});
