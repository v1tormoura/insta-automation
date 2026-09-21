'use strict';

/**
 * Capa por perfil.
 *
 * O que estes testes protegem: a conta com capa própria publica com ELA e as
 * outras seguem com a capa geral; a leitura do corpo aceita biblioteca
 * (`arquivo`) e upload da própria requisição (`indice`) e rejeita caminho
 * fora de uploads/; `aplicar` nunca muta o Post compartilhado e nunca derruba
 * a publicação quando a capa sumiu do disco.
 */

const { normalizar, lerDoCorpo, capaDaConta, aplicar } = require('../src/services/capaPorConta');

const A = '64a000000000000000000001';
const B = '64a000000000000000000002';
const C = '64a000000000000000000003';

describe('normalizar', () => {
  test('lista e objeto viram a mesma forma; conta repetida fica com a última', () => {
    expect(normalizar([{ accountId: A, arquivo: 'a.jpg' }, { accountId: A, arquivo: 'a2.jpg' }]))
      .toEqual([{ accountId: A, arquivo: 'a2.jpg' }]);
    expect(normalizar({ [B]: 'b.jpg' })).toEqual([{ accountId: B, arquivo: 'b.jpg' }]);
  });

  test('item inválido é descartado, entrada inválida vira lista vazia', () => {
    expect(normalizar([{ accountId: 'nao-e-id', arquivo: 'x.jpg' }, { accountId: A, arquivo: '' }, null])).toEqual([]);
    expect(normalizar('lixo')).toEqual([]);
    expect(normalizar(null)).toEqual([]);
  });

  test('caminho vira só o nome do arquivo — nunca sai de uploads/', () => {
    expect(normalizar([{ accountId: A, arquivo: '../../etc/passwd' }])).toEqual([{ accountId: A, arquivo: 'passwd' }]);
    expect(normalizar([{ accountId: A, arquivo: '..' }])).toEqual([]);
    expect(normalizar([{ accountId: A, arquivo: 'sub/dir/c.jpg' }])).toEqual([{ accountId: A, arquivo: 'c.jpg' }]);
  });
});

describe('lerDoCorpo — biblioteca e upload na mesma requisição', () => {
  const enviados = [{ filename: 'capas-1700-a.jpg' }, { filename: 'capas-1700-b.jpg' }];

  test('`arquivo` vem da biblioteca; `indice` aponta para o upload', () => {
    const r = lerDoCorpo(JSON.stringify([
      { accountId: A, arquivo: 'lib-rosto.jpg' },
      { accountId: B, indice: 1 },
      { accountId: C, indice: 0 },
    ]), enviados);
    expect(r).toEqual([
      { accountId: A, arquivo: 'lib-rosto.jpg' },
      { accountId: B, arquivo: 'capas-1700-b.jpg' },
      { accountId: C, arquivo: 'capas-1700-a.jpg' },
    ]);
  });

  test('índice fora da lista, vazio ou JSON estragado: null (o job fica sem o campo)', () => {
    expect(lerDoCorpo(JSON.stringify([{ accountId: A, indice: 7 }]), enviados)).toBeNull();
    expect(lerDoCorpo('')).toBeNull();
    expect(lerDoCorpo(undefined)).toBeNull();
    expect(lerDoCorpo('{nao')).toBeNull();
    expect(lerDoCorpo(JSON.stringify({ a: 1 }))).toBeNull();
  });

  test('aceita objeto já parseado (o loop manda JSON de verdade)', () => {
    expect(lerDoCorpo([{ accountId: A, arquivo: 'x.jpg' }])).toEqual([{ accountId: A, arquivo: 'x.jpg' }]);
  });
});

describe('capaDaConta / aplicar', () => {
  const capas = [{ accountId: A, arquivo: 'rosto-a.jpg' }, { accountId: B, arquivo: 'rosto-b.jpg' }];
  const existe = () => true;

  test('cada conta recebe a sua; quem não tem, fica com a geral', () => {
    expect(capaDaConta(capas, A)).toBe('rosto-a.jpg');
    expect(capaDaConta(capas, C)).toBe('');
    expect(capaDaConta(undefined, A)).toBe('');
  });

  test('aplicar devolve cópia com a capa da conta — e o post original fica intacto', () => {
    const post = { _id: 'p1', media: 'v.mp4', cover: 'geral.jpg', caption: 'oi', capasPorConta: capas };
    const paraA = aplicar(post, { _id: A, username: 'a' }, { existe });
    const paraB = aplicar(post, { _id: B, username: 'b' }, { existe });
    expect(paraA.cover).toBe('rosto-a.jpg');
    expect(paraB.cover).toBe('rosto-b.jpg');
    expect(paraA.caption).toBe('oi');          // o resto vem junto
    expect(paraA.capaPropria).toBe(true);
    expect(post.cover).toBe('geral.jpg');      // não mutou
    expect(paraA).not.toBe(post);
  });

  test('conta sem capa própria recebe o MESMO objeto (zero mudança de comportamento)', () => {
    const post = { _id: 'p1', cover: 'geral.jpg', capasPorConta: capas };
    expect(aplicar(post, { _id: C }, { existe })).toBe(post);
    const semCampo = { _id: 'p2', cover: 'g.jpg' };
    expect(aplicar(semCampo, { _id: A }, { existe })).toBe(semCampo);
    expect(aplicar(null, { _id: A })).toBeNull();
  });

  test('doc do Mongoose vira objeto plano via toObject', () => {
    const doc = { _id: 'p1', cover: 'g.jpg', capasPorConta: capas, toObject() { return { _id: 'p1', cover: 'g.jpg', media: 'v.mp4', capasPorConta: capas }; } };
    const r = aplicar(doc, { _id: A }, { existe });
    expect(r.cover).toBe('rosto-a.jpg');
    expect(r.media).toBe('v.mp4');
    expect(typeof r.toObject).toBe('undefined');
  });

  test('capa que sumiu do disco: cai na geral, sem exceção', () => {
    const post = { _id: 'p1', cover: 'geral.jpg', capasPorConta: capas };
    const silencio = jest.spyOn(console, 'log').mockImplementation(() => {});
    expect(aplicar(post, { _id: A, username: 'a' }, { existe: () => false })).toBe(post);
    silencio.mockRestore();
  });
});
