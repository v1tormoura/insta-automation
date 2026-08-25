'use strict';

/**
 * Reserva de proxy no momento em que a conta é conectada.
 *
 * ── O problema que isto resolve
 *
 * O proxy global é UM só: todas as contas saem pelo mesmo IP, que é
 * exatamente o sinal de automação que se quer evitar. Atribuir manualmente um
 * proxy por conta funciona, mas exige lembrar de fazê-lo a cada conta nova —
 * e o esquecimento é silencioso, porque a conta conecta do mesmo jeito e só
 * mais tarde começa a ser recusada.
 *
 * Aqui a reserva acontece sozinha, no instante da conexão: a conta nasce com
 * um proxy próprio ou não nasce.
 *
 * ── A regra que não se negocia
 *
 * Um proxy, uma conta. Nunca compartilhado. Se o pool acabar, a conexão falha
 * com uma mensagem que diz isso — em vez de cair no proxy global e recriar o
 * problema com um IP diferente.
 */

const ProxyPool = require('../models/ProxyPool');
const { parseLista, testarLote } = require('./proxyAssignment');

/**
 * Importa uma lista colada pelo usuário. Proxies repetidos são ignorados em
 * silêncio — o fornecedor às vezes repete linha, e recusar a importação
 * inteira por causa disso seria hostil.
 *
 * @returns {{adicionados: number, jaExistiam: number, invalidas: string[]}}
 */
async function importar(texto) {
  const { urls, invalidas } = parseLista(texto);

  let adicionados = 0;
  let jaExistiam = 0;

  for (const url of urls) {
    try {
      await ProxyPool.create({ url });
      adicionados++;
    } catch (err) {
      // 11000 = índice único violado, ou seja, o proxy já está no pool.
      if (err?.code === 11000) jaExistiam++;
      else throw err;
    }
  }

  return { adicionados, jaExistiam, invalidas };
}

/**
 * Reserva um proxy livre para esta conta.
 *
 * `findOneAndUpdate` numa condição de `contaId: null` é o que garante que
 * duas conexões simultâneas não recebam o mesmo proxy: o MongoDB resolve a
 * disputa no documento, e a segunda requisição simplesmente não encontra
 * aquele registro livre e pega o próximo.
 *
 * Idempotente: conta que já tem proxy reservado recebe o mesmo de volta, em
 * vez de consumir outro do pool. Isso importa porque reconectar uma conta é
 * comum, e cada reconexão gastando um proxy esvaziaria o pool por engano.
 *
 * @returns {Promise<string|null>} a URL reservada, ou null se o pool acabou
 */
async function reservar(accountId) {
  const id = String(accountId);

  // Sem conexão ativa o Mongoose ENFILEIRA a consulta em vez de falhar, e só
  // desiste depois de `bufferTimeoutMS` — 10 segundos por padrão. Esta função
  // roda no caminho de TODO login e TODA publicação, então uma instabilidade
  // do Mongo travaria cada operação por 10s antes de cair no proxy global.
  //
  // A mesma armadilha já estava documentada em getGlobalProxyConfig, e eu
  // caí nela aqui. Ausência de conexão vale como "pool indisponível": quem
  // chama segue para o proxy global na hora.
  if (!module.exports.bancoConectado()) return null;

  const jaTem = await ProxyPool.findOne({ contaId: id }).lean();
  if (jaTem) return jaTem.url;

  // Proxy comprovadamente ruim não é reservado: trocar "conta saindo pelo IP
  // errado" por "conta que não conecta" é piorar. `ok: null` (nunca testado)
  // continua elegível — recusar o que ainda não foi testado deixaria o pool
  // inutilizável logo após a importação.
  const reservado = await ProxyPool.findOneAndUpdate(
    { contaId: null, ok: { $ne: false }, rotativo: { $ne: true } },
    { $set: { contaId: id, reservadoEm: new Date() } },
    { new: true, sort: { ultimoTeste: -1, createdAt: 1 } }
  ).lean();

  return reservado ? reservado.url : null;
}

/**
 * Devolve ao pool o proxy de uma conta. Chamado ao excluir a conta — sem
 * isso o proxy ficaria reservado para um dono que não existe mais, e o pool
 * encolheria a cada conta removida.
 */
async function liberar(accountId) {
  const r = await ProxyPool.updateMany(
    { contaId: String(accountId) },
    { $set: { contaId: null, reservadoEm: null } }
  );
  return r.modifiedCount || 0;
}

/** Quantos livres, quantos reservados, quantos reprovados. */
async function resumo() {
  const [total, livres, ruins, rotativos] = await Promise.all([
    ProxyPool.countDocuments({}),
    ProxyPool.countDocuments({ contaId: null, ok: { $ne: false }, rotativo: { $ne: true } }),
    ProxyPool.countDocuments({ ok: false }),
    ProxyPool.countDocuments({ rotativo: true }),
  ]);
  return { total, livres, reservados: total - livres - ruins - rotativos, ruins, rotativos };
}

/** Lista o pool com o dono de cada proxy. */
async function listar() {
  return ProxyPool.find({})
    .populate('contaId', 'username')
    .sort({ createdAt: 1 })
    .lean();
}

/**
 * Testa todos os proxies do pool e grava o resultado.
 *
 * Marcar o resultado importa para a reserva: um proxy reprovado deixa de ser
 * entregue a contas novas, e um rotativo também — ele quebra o login, que são
 * várias requisições em sequência a partir do mesmo IP.
 */
async function testarTodos() {
  const itens = await ProxyPool.find({}).lean();
  if (!itens.length) return { testados: 0, ok: 0, ruins: 0, rotativos: 0 };

  const resultados = await testarLote(itens.map(i => i.url));
  const agora = new Date();

  let ok = 0, ruins = 0, rotativos = 0;
  for (const r of resultados) {
    if (r.ok && !r.rotativo) ok++;
    else if (r.rotativo) rotativos++;
    else ruins++;

    await ProxyPool.updateOne(
      { url: r.url },
      { $set: { ok: r.ok, ip: r.ip || '', rotativo: !!r.rotativo, erro: r.erro || '', ultimoTeste: agora } }
    );
  }

  return { testados: resultados.length, ok, ruins, rotativos };
}

/** Remove um proxy do pool, liberando a conta que o usava. */
async function remover(url) {
  const r = await ProxyPool.deleteOne({ url });
  return r.deletedCount > 0;
}

/**
 * O Mongo está pronto para responder?
 *
 * Exportado, e chamado via `module.exports`, para que o teste possa
 * substituí-lo. Substituir o mongoose inteiro não serve — os modelos que a
 * cadeia carrega precisam de Schema de verdade — e mexer no `readyState` da
 * conexão real atrapalha o registro dos modelos. Uma função pequena e
 * declarada é a costura mais honesta aqui.
 */
function bancoConectado() {
  return require('mongoose').connection?.readyState === 1;
}

module.exports = {
  importar, reservar, liberar, resumo, listar, testarTodos, remover, bancoConectado,
};
