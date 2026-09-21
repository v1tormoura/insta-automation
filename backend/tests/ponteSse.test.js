'use strict';

/**
 * A ponte SSE entre processos.
 *
 * O que estes testes protegem: o que o worker emite chega aos clientes do
 * backend (via canal), o backend não reentrega a si mesmo o que já escreveu,
 * lixo no canal não derruba nada, e sem Redis o comportamento local continua
 * exatamente o de antes. É o defeito que fazia a notificação de publicação
 * nascer no worker e a Central só saber dela na próxima sincronização.
 */

const broadcaster = require('../src/events/broadcaster');

/** Um cliente SSE de mentira: guarda o que recebeu. */
function cliente() {
  const c = { escritos: [], writable: true, writableEnded: false, destroyed: false };
  c.write = m => { c.escritos.push(m); return true; };
  c.once = () => {};
  return c;
}

/** Redis de mentira: publish grava; duplicate devolve um assinante com `on`. */
function redisFalso() {
  const r = { publicados: [], handlers: {}, assinado: null };
  r.publish = async (canal, msg) => { r.publicados.push({ canal, msg }); return 1; };
  r.duplicate = () => ({
    on: (ev, fn) => { r.handlers[ev] = fn; },
    subscribe: async canal => { r.assinado = canal; },
  });
  return r;
}

afterEach(() => broadcaster.usarRedis(null));

describe('sem Redis — o de sempre', () => {
  test('escreve nos clientes locais e não quebra', () => {
    const c = cliente();
    broadcaster.addClient(c);
    broadcaster.broadcast('posts', { action: 'created' });
    broadcaster.removeClient(c);
    expect(c.escritos).toEqual(['event: posts\ndata: {"action":"created"}\n\n']);
  });
});

describe('com Redis — o worker fala, o backend ouve', () => {
  test('todo broadcast é publicado no canal, assinado com a origem deste processo', async () => {
    const r = redisFalso();
    broadcaster.usarRedis(r);
    broadcaster.broadcast('notificacoes', { novas: 1 });
    await Promise.resolve();
    expect(r.publicados).toHaveLength(1);
    expect(r.publicados[0].canal).toBe(broadcaster.CANAL);
    const m = JSON.parse(r.publicados[0].msg);
    expect(m).toEqual({ origem: broadcaster.ORIGEM, event: 'notificacoes', data: { novas: 1 } });
  });

  test('publica mesmo sem cliente local — é o caso do worker', async () => {
    const r = redisFalso();
    broadcaster.usarRedis(r);
    expect(broadcaster.clientCount()).toBe(0);
    broadcaster.broadcast('accounts', { action: 'synced' });
    await Promise.resolve();
    expect(r.publicados).toHaveLength(1);
  });

  test('o que vem de OUTRO processo é entregue aos clientes locais', () => {
    const c = cliente();
    broadcaster.addClient(c);
    const entregou = broadcaster.receberDaPonte(JSON.stringify({ origem: 'worker:abc', event: 'notificacoes', data: { novas: 1 } }));
    broadcaster.removeClient(c);
    expect(entregou).toBe(true);
    expect(c.escritos).toEqual(['event: notificacoes\ndata: {"novas":1}\n\n']);
  });

  test('o que veio de MIM mesmo não é entregue de novo (já escrevi localmente)', () => {
    const c = cliente();
    broadcaster.addClient(c);
    const entregou = broadcaster.receberDaPonte(JSON.stringify({ origem: broadcaster.ORIGEM, event: 'posts', data: {} }));
    broadcaster.removeClient(c);
    expect(entregou).toBe(false);
    expect(c.escritos).toEqual([]);
  });

  test('lixo no canal é ignorado sem exceção', () => {
    const c = cliente();
    broadcaster.addClient(c);
    expect(broadcaster.receberDaPonte('{nao e json')).toBe(false);
    expect(broadcaster.receberDaPonte(JSON.stringify({ origem: 'x' }))).toBe(false);
    expect(broadcaster.receberDaPonte(JSON.stringify({ origem: 'x', event: '' }))).toBe(false);
    expect(broadcaster.receberDaPonte(JSON.stringify(null))).toBe(false);
    broadcaster.removeClient(c);
    expect(c.escritos).toEqual([]);
  });

  test('iniciarPonte assina o canal numa conexão própria e liga o handler de mensagem', async () => {
    const r = redisFalso();
    broadcaster.usarRedis(r);
    expect(await broadcaster.iniciarPonte()).toBe(true);
    expect(r.assinado).toBe(broadcaster.CANAL);
    expect(typeof r.handlers.message).toBe('function');

    const c = cliente();
    broadcaster.addClient(c);
    r.handlers.message(broadcaster.CANAL, JSON.stringify({ origem: 'worker:1', event: 'jobs', data: { jobId: 'J' } }));
    r.handlers.message('outro-canal', JSON.stringify({ origem: 'worker:1', event: 'jobs', data: {} }));
    broadcaster.removeClient(c);
    expect(c.escritos).toEqual(['event: jobs\ndata: {"jobId":"J"}\n\n']);
  });

  test('dados ausentes viram {} no fio, nunca "undefined"', () => {
    const c = cliente();
    broadcaster.addClient(c);
    broadcaster.receberDaPonte(JSON.stringify({ origem: 'w', event: 'refresh' }));
    broadcaster.removeClient(c);
    expect(c.escritos).toEqual(['event: refresh\ndata: {}\n\n']);
  });
});
