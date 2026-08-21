'use strict';

/**
 * Capa de vídeo na campanha.
 *
 * O que estes testes protegem: a capa é gravada como id de Media e só vira nome
 * de arquivo na hora de publicar. Se essa conversão quebrar, o Reel sai com a
 * miniatura que o Instagram escolher e ninguém percebe até ver o perfil.
 */

jest.mock('../src/queue/postQueue', () => ({ add: jest.fn(), getJob: jest.fn(), remove: jest.fn() }));

const Media    = require('../src/models/Media');
const Campaign = require('../src/models/Campaign');
const { _arquivoDaCapa } = require('../src/services/campaignExecutor');
const { _filtrarCapas }  = require('../src/services/campaignService');

describe('model — covers.byContent', () => {
  test('o schema guarda o mapa por conteúdo', () => {
    const c = new Campaign({ name: 'x', covers: { byContent: { abc123: 'media1' } } });
    expect(c.covers.byContent.get('abc123')).toBe('media1');
  });

  test('campanha sem capas nasce com mapa vazio, não indefinido', () => {
    const c = new Campaign({ name: 'x' });
    expect(c.covers.byContent.size).toBe(0);
  });
});

describe('_filtrarCapas — só o que continua na campanha', () => {
  test('descarta capa de conteúdo que saiu da seleção', () => {
    const saida = _filtrarCapas(
      { byContent: { c1: 'capa1', c2: 'capa2' } },
      ['c1'],
    );
    expect(saida).toEqual({ c1: 'capa1' });
  });

  test('aceita Map do Mongoose além de objeto simples', () => {
    const saida = _filtrarCapas(
      { byContent: new Map([['c1', 'capa1']]) },
      ['c1'],
    );
    expect(saida).toEqual({ c1: 'capa1' });
  });

  test('ignora entrada sem mídia associada', () => {
    expect(_filtrarCapas({ byContent: { c1: '', c2: null } }, ['c1', 'c2'])).toEqual({});
  });

  test('campanha sem capas devolve objeto vazio, não quebra', () => {
    expect(_filtrarCapas(undefined, ['c1'])).toEqual({});
    expect(_filtrarCapas({}, ['c1'])).toEqual({});
  });

  test('ids são normalizados para string (ObjectId vira chave utilizável)', () => {
    const idObjeto = { toString: () => 'c1' };
    expect(_filtrarCapas({ byContent: { c1: 'capa1' } }, [idObjeto])).toEqual({ c1: 'capa1' });
  });
});

describe('_arquivoDaCapa — id vira nome de arquivo', () => {
  let original;

  beforeEach(() => {
    original = Media.findById;
    Media.findById = jest.fn(() => ({
      select: () => ({ lean: async () => ({ filename: 'capa-real.jpg' }) }),
    }));
  });

  afterEach(() => { Media.findById = original; });

  test('resolve a capa configurada', async () => {
    const campanha = { covers: { byContent: new Map([['conteudo1', 'media-capa']]) } };
    await expect(_arquivoDaCapa(campanha, 'conteudo1')).resolves.toBe('capa-real.jpg');
    expect(Media.findById).toHaveBeenCalledWith('media-capa');
  });

  test('mapa como objeto simples também é lido', async () => {
    const campanha = { covers: { byContent: { conteudo1: 'media-capa' } } };
    await expect(_arquivoDaCapa(campanha, 'conteudo1')).resolves.toBe('capa-real.jpg');
  });

  test('conteúdo sem capa não consulta a biblioteca', async () => {
    const campanha = { covers: { byContent: new Map() } };
    await expect(_arquivoDaCapa(campanha, 'conteudo1')).resolves.toBe('');
    expect(Media.findById).not.toHaveBeenCalled();
  });

  test('campanha antiga, sem o campo covers, não quebra', async () => {
    await expect(_arquivoDaCapa({}, 'conteudo1')).resolves.toBe('');
    await expect(_arquivoDaCapa(null, 'conteudo1')).resolves.toBe('');
  });

  test('capa apagada da biblioteca não derruba a publicação', async () => {
    Media.findById = jest.fn(() => ({ select: () => ({ lean: async () => null }) }));
    const campanha = { covers: { byContent: new Map([['c1', 'sumiu']]) } };
    await expect(_arquivoDaCapa(campanha, 'c1')).resolves.toBe('');
  });

  test('erro de banco vira "sem capa", não exceção', async () => {
    Media.findById = jest.fn(() => { throw new Error('mongo caiu'); });
    const campanha = { covers: { byContent: new Map([['c1', 'media1']]) } };
    await expect(_arquivoDaCapa(campanha, 'c1')).resolves.toBe('');
  });

  test('contentId é comparado como string', async () => {
    const campanha = { covers: { byContent: new Map([['c1', 'media-capa']]) } };
    await expect(_arquivoDaCapa(campanha, { toString: () => 'c1' })).resolves.toBe('capa-real.jpg');
  });
});
