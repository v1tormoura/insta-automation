'use strict';

/**
 * Biblioteca de mídia — upload e listagem, contra o banco.
 *
 * O que estes testes protegem: o upload aceitava só o campo 'media' e respondia
 * 200 com zero arquivos criados quando o nome era outro — foi assim que o
 * upload do wizard de campanha "não funcionava" sem erro nenhum na tela. E a
 * busca precisa tratar a entrada como texto, senão um '%' ou '(' digitado
 * vira padrão e a busca mente.
 */

const banco = require('./helpers/banco');
const { getMedia, uploadMedia, deleteMedia, createFolder, deleteFolder } = require('../src/controllers/mediaController');
const USER = { id: require('./helpers/banco').DONO_ID, papel: 'admin' };

function resposta() {
  const r = { statusCode: 200, corpo: null };
  r.status = c => { r.statusCode = c; return r; };
  r.json = b => { r.corpo = b; return r; };
  return r;
}
const arquivo = (nome, mimetype, extra = {}) => ({ fieldname: 'x', filename: nome, originalname: nome, path: `/x/${nome}`, mimetype, size: 1, ...extra });
const listar = async query => { const res = resposta(); await getMedia({ user: USER,  query }, res); return res.corpo; };

beforeEach(() => banco.limpar());

describe('uploadMedia', () => {
  test('aceita arquivo enviado com qualquer nome de campo', async () => {
    const res = resposta();
    await uploadMedia({ user: USER,  files: [
      arquivo('a.mp4', 'video/mp4', { fieldname: 'files' }),
      arquivo('b.jpg', 'image/jpeg', { fieldname: 'media' }),
      arquivo('c.png', 'image/png', { fieldname: 'outro' }),
    ], body: {} }, res);
    expect(res.corpo.total).toBe(3);
    expect(await banco.sql`select id from media`).toHaveLength(3);
  });

  test('responde com media E files — as duas telas leem chaves diferentes', async () => {
    const res = resposta();
    await uploadMedia({ user: USER,  files: [arquivo('a.mp4', 'video/mp4')], body: {} }, res);
    expect(res.corpo.media).toHaveLength(1);
    expect(res.corpo.files[0].id).toBe(res.corpo.media[0].id);
  });

  test('classifica o tipo pelo mimetype', async () => {
    const res = resposta();
    await uploadMedia({ user: USER,  files: [
      arquivo('a.mp4', 'video/mp4'), arquivo('b.jpg', 'image/jpeg'), arquivo('c.bin', 'application/octet-stream'),
    ], body: {} }, res);
    expect(res.corpo.media.map(m => m.type)).toEqual(['video', 'image', 'other']);
  });

  test('pasta informada é respeitada', async () => {
    const res = resposta();
    await uploadMedia({ user: USER,  files: [arquivo('a.mp4', 'video/mp4')], body: { folder: 'promo' } }, res);
    expect(res.corpo.media[0].folder).toBe('promo');
  });

  test('requisição sem arquivo não quebra', async () => {
    const res = resposta();
    await uploadMedia({ user: USER,  body: {} }, res);
    expect(res.corpo.total).toBe(0);
  });
});

describe('getMedia', () => {
  beforeEach(async () => {
    await uploadMedia({ user: USER,  files: [
      arquivo('promo-1.mp4', 'video/mp4'),
      arquivo('video(1)*final.mp4', 'video/mp4'),
      arquivo('foto.jpg', 'image/jpeg'),
    ], body: { folder: 'promo' } }, resposta());
    await uploadMedia({ user: USER,  files: [arquivo('outra.jpg', 'image/jpeg')], body: {} }, resposta());
  });

  test('sem filtro, a biblioteca inteira, com as pastas', async () => {
    const r = await listar({});
    expect(r.files).toHaveLength(4);
    expect(r.total).toBe(4);
    expect(r.folders).toEqual(['default', 'promo']);
  });

  test('filtra por tipo e pasta', async () => {
    const r = await listar({ type: 'video', folder: 'promo' });
    expect(r.files.map(f => f.filename).sort()).toEqual(['promo-1.mp4', 'video(1)*final.mp4']);
  });

  test('tipo inválido é ignorado em vez de virar filtro impossível', async () => {
    expect((await listar({ type: 'qualquer' })).files).toHaveLength(4);
  });

  test('a busca ignora maiúsculas e olha o nome', async () => {
    expect((await listar({ search: 'PROMO' })).files.map(f => f.filename)).toEqual(['promo-1.mp4']);
  });

  test('caractere especial na busca é texto, não padrão', async () => {
    expect((await listar({ search: 'video(1)*' })).files).toHaveLength(1);
    // '%' sem escape casaria com tudo.
    expect((await listar({ search: '%' })).files).toHaveLength(0);
  });

  test('limite e paginação: no máximo 500, e o total é o de todos', async () => {
    const r = await listar({ limit: '2', skip: '1' });
    expect(r.files).toHaveLength(2);
    expect(r.total).toBe(4);
  });
});

describe('pastas e remoção', () => {
  test('criar pasta vazia a faz aparecer na lista', async () => {
    const res = resposta();
    await createFolder({ user: USER,  body: { name: 'Reels Novos' } }, res);
    expect(res.corpo.folder).toBe('reels novos');
    expect((await listar({})).folders).toContain('reels novos');
  });

  test('apagar a pasta devolve as mídias para default', async () => {
    await uploadMedia({ user: USER,  files: [arquivo('a.mp4', 'video/mp4')], body: { folder: 'x' } }, resposta());
    await deleteFolder({ user: USER,  params: { name: 'x' } }, resposta());
    const r = await listar({});
    expect(r.folders).toEqual(['default']);
    expect(r.files[0].folder).toBe('default');
  });

  test('apagar mídia que não existe responde 404', async () => {
    const res = resposta();
    await deleteMedia({ user: USER,  params: { id: '00000000-0000-0000-0000-000000000000' } }, res);
    expect(res.statusCode).toBe(404);
  });
});
