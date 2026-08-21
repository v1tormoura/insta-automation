'use strict';

/**
 * Biblioteca de mídia — upload e listagem.
 *
 * O que estes testes protegem: o upload aceitava só o campo 'media' e respondia
 * 200 com zero arquivos criados quando o nome era outro — foi assim que o
 * upload do wizard de campanha "não funcionava" sem erro nenhum na tela. E a
 * busca precisa escapar a entrada, senão um '(' digitado derruba a rota.
 */

const Media = require('../src/models/Media');
const { getMedia, uploadMedia } = require('../src/controllers/mediaController');

function resposta() {
  const r = {};
  r.statusCode = 200;
  r.corpo = null;
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.corpo = b; return r; };
  return r;
}

/** Encadeamento find().sort().skip().limit() com captura da query usada. */
function mockarBusca(itens, capturas) {
  Media.find = jest.fn((query, projecao) => {
    if (projecao === 'folder') {
      return { lean: async () => itens.map(m => ({ folder: m.folder })) };
    }
    capturas.push(query);
    const cadeia = {
      sort: () => cadeia,
      skip: () => cadeia,
      limit: () => cadeia,
      then: (ok) => Promise.resolve(itens).then(ok),
    };
    return cadeia;
  });
  Media.countDocuments = jest.fn(async () => itens.length);
}

describe('uploadMedia', () => {
  let original;
  beforeEach(() => {
    original = Media.create;
    Media.create = jest.fn(async (doc) => ({ _id: `id-${doc.filename}`, ...doc }));
  });
  afterEach(() => { Media.create = original; });

  test('aceita arquivo enviado com qualquer nome de campo', async () => {
    const req = {
      files: [
        { fieldname: 'files',  filename: 'a.mp4', originalname: 'a.mp4', path: '/x/a.mp4', mimetype: 'video/mp4', size: 10 },
        { fieldname: 'media',  filename: 'b.jpg', originalname: 'b.jpg', path: '/x/b.jpg', mimetype: 'image/jpeg', size: 20 },
        { fieldname: 'outro',  filename: 'c.png', originalname: 'c.png', path: '/x/c.png', mimetype: 'image/png',  size: 30 },
      ],
      body: {},
    };
    const res = resposta();
    await uploadMedia(req, res);

    expect(res.corpo.total).toBe(3);
    expect(Media.create).toHaveBeenCalledTimes(3);
  });

  test('responde com media E files — as duas telas leem chaves diferentes', async () => {
    const req = { files: [{ fieldname: 'files', filename: 'a.mp4', originalname: 'a.mp4', path: '/x', mimetype: 'video/mp4', size: 1 }], body: {} };
    const res = resposta();
    await uploadMedia(req, res);

    expect(res.corpo.media).toHaveLength(1);
    expect(res.corpo.files).toHaveLength(1);
    expect(res.corpo.files[0]._id).toBe(res.corpo.media[0]._id);
  });

  test('classifica o tipo pelo mimetype', async () => {
    const req = {
      files: [
        { fieldname: 'x', filename: 'a.mp4', originalname: 'a', path: '/x', mimetype: 'video/mp4',  size: 1 },
        { fieldname: 'x', filename: 'b.jpg', originalname: 'b', path: '/x', mimetype: 'image/jpeg', size: 1 },
        { fieldname: 'x', filename: 'c.bin', originalname: 'c', path: '/x', mimetype: 'application/octet-stream', size: 1 },
      ],
      body: {},
    };
    const res = resposta();
    await uploadMedia(req, res);
    expect(res.corpo.media.map(m => m.type)).toEqual(['video', 'image', 'other']);
  });

  test('pasta informada é respeitada', async () => {
    const req = { files: [{ fieldname: 'x', filename: 'a.mp4', originalname: 'a', path: '/x', mimetype: 'video/mp4', size: 1 }], body: { folder: 'promo' } };
    const res = resposta();
    await uploadMedia(req, res);
    expect(res.corpo.media[0].folder).toBe('promo');
  });

  test('requisição sem arquivo não quebra', async () => {
    const res = resposta();
    await uploadMedia({ body: {} }, res);
    expect(res.corpo.total).toBe(0);
  });
});

describe('getMedia', () => {
  let originalFind, originalCount;
  beforeEach(() => {
    originalFind = Media.find;
    originalCount = Media.countDocuments;
  });
  afterEach(() => {
    Media.find = originalFind;
    Media.countDocuments = originalCount;
  });

  test('sem filtro, consulta tudo (comportamento antigo preservado)', async () => {
    const capturas = [];
    mockarBusca([{ _id: '1', folder: 'default' }], capturas);
    const res = resposta();
    await getMedia({ query: {} }, res);

    expect(capturas[0]).toEqual({});
    expect(res.corpo.files).toHaveLength(1);
    expect(res.corpo.folders).toEqual(['default']);
  });

  test('filtra por tipo e pasta', async () => {
    const capturas = [];
    mockarBusca([], capturas);
    await getMedia({ query: { type: 'video', folder: 'promo' } }, resposta());
    expect(capturas[0]).toMatchObject({ type: 'video', folder: 'promo' });
  });

  test('tipo inválido é ignorado em vez de virar filtro impossível', async () => {
    const capturas = [];
    mockarBusca([], capturas);
    await getMedia({ query: { type: 'qualquer' } }, resposta());
    expect(capturas[0].type).toBeUndefined();
  });

  test('busca vira regex sobre nome original e nome do arquivo', async () => {
    const capturas = [];
    mockarBusca([], capturas);
    await getMedia({ query: { search: 'promo' } }, resposta());

    expect(capturas[0].$or).toHaveLength(2);
    expect(capturas[0].$or[0].originalName.test('minha PROMO 1')).toBe(true);
  });

  test('caractere especial na busca é escapado, não quebra a regex', async () => {
    const capturas = [];
    mockarBusca([], capturas);
    // Sem escape, '(' sozinho lança "Invalid regular expression".
    await expect(getMedia({ query: { search: 'video(1)*' } }, resposta())).resolves.toBeUndefined();
    expect(capturas[0].$or[0].originalName.test('meu video(1)* final')).toBe(true);
  });

  test('limite é limitado a 500, mesmo pedindo mais', async () => {
    const capturas = [];
    let limitePedido = null;
    Media.find = jest.fn((query, projecao) => {
      if (projecao === 'folder') return { lean: async () => [] };
      capturas.push(query);
      const cadeia = {
        sort: () => cadeia,
        skip: () => cadeia,
        limit: (n) => { limitePedido = n; return cadeia; },
        then: (ok) => Promise.resolve([]).then(ok),
      };
      return cadeia;
    });
    Media.countDocuments = jest.fn(async () => 0);

    await getMedia({ query: { limit: '9999' } }, resposta());
    expect(limitePedido).toBe(500);
  });

  test('erro de banco vira 500 com mensagem, não exceção não tratada', async () => {
    Media.find = jest.fn(() => { throw new Error('mongo caiu'); });
    const res = resposta();
    await getMedia({ query: {} }, res);
    expect(res.statusCode).toBe(500);
    expect(res.corpo.error).toBe('mongo caiu');
  });
});
