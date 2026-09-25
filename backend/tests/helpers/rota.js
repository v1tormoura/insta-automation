'use strict';

/**
 * Chama uma rota de um router do Express com req/res de mentira, passando por
 * TODA a cadeia da rota (middlewares como `soAdmin` incluídos), na ordem.
 * @returns {Promise<{code: number, corpo: any}>}
 */
async function chamarRota(router, metodo, caminho, req = {}) {
  const camada = router.stack.find(l => l.route?.path === caminho && l.route?.methods?.[metodo]);
  if (!camada) throw new Error('rota inexistente: ' + metodo + ' ' + caminho);
  // Middlewares de router.use() antes da rota (ex.: router.use(soAdmin)).
  const antes = router.stack.slice(0, router.stack.indexOf(camada)).filter(l => !l.route);
  const cadeia = [...antes.map(l => l.handle), ...camada.route.stack.map(l => l.handle)];

  const resposta = { code: 200, corpo: null };
  const res = {
    status(c) { resposta.code = c; return this; },
    json(c)   { resposta.corpo = c; resposta.fim = true; return this; },
    send(c)   { resposta.corpo = c; resposta.fim = true; return this; },
  };
  const requisicao = { query: {}, params: {}, body: {}, headers: {}, get: () => undefined, ip: '127.0.0.1', ...req };
  for (const handle of cadeia) {
    let seguiu = false;
    await handle(requisicao, res, err => { if (err) throw err; seguiu = true; });
    if (resposta.fim || !seguiu) break;
  }
  return resposta;
}

module.exports = { chamarRota };
