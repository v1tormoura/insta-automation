'use strict';

/**
 * Vigia do sistema — avisa antes de quebrar.
 *
 * ── Por que existe
 *
 * A cota do proxy acabou e o produto ficou parado quatro dias e meio sem que
 * nada avisasse. A descoberta veio pelas contas ficarem estranhas, não por o
 * sistema ter falado — e quando veio, a causa já estava a quatro dias de
 * distância do sintoma.
 *
 * A tubulação de push já existe e já tem aparelhos inscritos. Ela estava sendo
 * usada só para marcos de audiência. Um marco de 500 mil visualizações é bom
 * saber; um proxy morto às três da manhã é PRECISO saber.
 *
 * ── A disciplina contra spam é a mesma dos marcos
 *
 * Um problema que dura três dias não pode virar três dias de avisos. Cada
 * condição avisa UMA vez ao começar, repete só depois de seis horas se
 * persistir, e avisa uma vez ao voltar ao normal.
 *
 * O aviso de recuperação não é enfeite: sem ele, quem recebeu "proxy fora do
 * ar" às duas da manhã não tem como saber que voltou às três, e ou fica
 * checando ou ignora o próximo aviso.
 *
 * ── Por que grava na Central
 *
 * Diferente do aviso de TESTE, que não grava: estes são eventos que
 * aconteceram de verdade, e o histórico deles é o que responde "isto começou
 * quando?" — a pergunta que custou quatro dias desta vez.
 */

const CHAVE = 'vigiaDoSistema';
const REAVISO_MS = 6 * 60 * 60 * 1000;   // repete só depois de 6h
const FILA_PARADA_MS = 60 * 60 * 1000;   // publicação presa há mais de 1h
const ERROS_PARA_ALERTAR = 20;           // no dia

/** Mongoose enfileira consulta sem conexão e só desiste em 10s. */
function bancoConectado() {
  try { return require('mongoose').connection?.readyState === 1; }
  catch { return false; }
}

/* ── As verificações ────────────────────────────────────────────────────────
   Cada uma devolve `null` quando está tudo bem, ou `{ titulo, mensagem }`
   quando há problema. Nenhuma pode lançar: uma verificação quebrada não pode
   derrubar as outras, senão o vigia fica cego justamente quando algo está
   errado — que é o único momento em que ele importa. */

async function _proxy() {
  const { getGlobalProxyConfig } = require('./globalProxy');
  const ProxyPool = require('../models/ProxyPool');
  const testProxy = require('./testProxy');

  const cfg = await getGlobalProxyConfig().catch(() => null);
  const doPool = await ProxyPool.findOne({ ok: { $ne: false } }).select('url').lean().catch(() => null);
  const url = (cfg?.ativo && cfg?.url) || doPool?.url;
  if (!url) return null;   // sem proxy configurado é escolha, não falha

  const r = await testProxy(url);
  if (r.ok) return null;

  return {
    titulo: 'O proxy parou de responder',
    mensagem: r.error || 'A automação não consegue sair para o Instagram.',
    prioridade: 'alta',
  };
}

async function _pool() {
  const ProxyPool = require('../models/ProxyPool');
  const [total, livres] = await Promise.all([
    ProxyPool.countDocuments({}),
    ProxyPool.countDocuments({ contaId: null, ok: { $ne: false }, rotativo: { $ne: true } }),
  ]);
  if (!total || livres > 0) return null;

  /* Pool esgotado não impede nada de imediato — as contas caem no proxy
     global. É justamente por isso que precisa avisar: o dano é silencioso e
     acumulativo, e o sintoma aparece semanas depois como conta sinalizada. */
  return {
    titulo: 'O pool de proxies acabou',
    mensagem: `Os ${total} proxies estão reservados. A próxima conta vai sair pelo IP global, `
            + 'dividindo endereço com as outras — o padrão que o Instagram lê como automação.',
    prioridade: 'alta',
  };
}

async function _sessoes() {
  const Account = require('../models/Account');
  const RUINS = ['sessao_expirada', 'erro_login', 'token_invalido'];
  const [total, ruins] = await Promise.all([
    Account.countDocuments({}),
    Account.countDocuments({ healthStatus: { $in: RUINS } }),
  ]);
  if (!total || !ruins) return null;

  // Uma conta com problema é rotina. Metade delas é um evento.
  if (ruins * 2 < total) return null;

  return {
    titulo: `${ruins} de ${total} contas sem conseguir conectar`,
    mensagem: 'Quando é a maioria de uma vez, a causa costuma ser comum a todas — '
            + 'proxy, rede ou serviço — e não cada conta individualmente.',
    prioridade: 'alta',
  };
}

async function _fila() {
  const Post = require('../models/Post');
  const limite = new Date(Date.now() - FILA_PARADA_MS);
  const presos = await Post.countDocuments({ status: 'processando', updatedAt: { $lt: limite } });
  if (!presos) return null;

  return {
    titulo: `${presos} publicação(ões) presa(s) na fila`,
    mensagem: 'Em processamento há mais de uma hora. Normalmente leva segundos — '
            + 'quando passa disso, alguma coisa travou no meio.',
    prioridade: 'normal',
  };
}

async function _erros() {
  const Post = require('../models/Post');
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const erros = await Post.countDocuments({ status: 'erro', updatedAt: { $gte: hoje } });
  if (erros < ERROS_PARA_ALERTAR) return null;

  return {
    titulo: `${erros} erros de publicação hoje`,
    mensagem: 'Muitos erros no mesmo dia raramente são coincidência. '
            + 'Vale olhar se todos têm o mesmo motivo.',
    prioridade: 'normal',
  };
}

const VERIFICACOES = Object.freeze({
  proxy:   _proxy,
  pool:    _pool,
  sessoes: _sessoes,
  fila:    _fila,
  erros:   _erros,
});

/* ── O ciclo ──────────────────────────────────────────────────────────────── */

async function _estado() {
  const Setting = require('../models/Setting');
  const doc = await Setting.findOne({ key: CHAVE }).lean().catch(() => null);
  return (doc?.value && typeof doc.value === 'object') ? doc.value : {};
}

async function _gravarEstado(estado) {
  const Setting = require('../models/Setting');
  await Setting.updateOne({ key: CHAVE }, { $set: { value: estado } }, { upsert: true });
}

async function _avisar({ chave, titulo, mensagem, prioridade, recuperacao }) {
  const Notificacao = require('../models/Notificacao');

  const nova = await Notificacao.create({
    eventType:  'sistema',
    tema:       recuperacao ? 'success' : (prioridade === 'alta' ? 'warning' : 'info'),
    prioridade: recuperacao ? 'baixa' : (prioridade || 'normal'),
    titulo,
    mensagem,
    metadados:  { vigia: chave, recuperacao: !!recuperacao },
  });

  /* Push sem `await`: a entrega é um extra e não pode atrasar nem derrubar o
     registro. Se o push falhar, a notificação continua na Central. */
  require('./smartActivity/webPush').enviar(nova).catch(() => {});

  try {
    require('../events/broadcaster').broadcast('notificacoes', { novas: 1 });
  } catch { /* sem SSE, a Central busca no próximo ciclo */ }

  return nova;
}

/**
 * Roda todas as verificações e avisa o que mudou.
 *
 * As verificações entram por PARÂMETRO, com o conjunto real como padrão. É
 * injeção em vez de mutação: o teste passa os seus dublês sem precisar
 * descongelar o mapa público nem mexer no módulo, e o módulo continua imutável
 * para quem o consome — que é o ponto de tê-lo congelado.
 *
 * @param {{verificacoes?: Record<string, () => Promise<object|null>>}} [opts]
 * @returns {Promise<{avisos: number, ativos: string[]}>}
 */
async function verificar({ verificacoes = VERIFICACOES } = {}) {
  if (!module.exports.bancoConectado()) return { avisos: 0, ativos: [], motivo: 'sem banco' };

  const estado = await _estado();
  const agora = Date.now();
  let avisos = 0;

  for (const [chave, fn] of Object.entries(verificacoes)) {
    let problema = null;
    try {
      problema = await fn();
    } catch (err) {
      // Verificação quebrada não pode cegar as outras.
      console.warn(`[Vigia] ${chave} falhou:`, err.message);
      continue;
    }

    const anterior = estado[chave];

    if (problema) {
      const novo = !anterior;
      const velho = anterior && (agora - anterior.ultimoAviso) > REAVISO_MS;
      if (novo || velho) {
        await _avisar({ chave, ...problema });
        avisos++;
        estado[chave] = { desde: anterior?.desde || agora, ultimoAviso: agora };
      }
    } else if (anterior) {
      /* Voltou ao normal. Sem este aviso, quem recebeu o alerta às duas da
         manhã não tem como saber que passou — e ou fica conferindo, ou
         aprende a ignorar o próximo. */
      const horas = Math.max(1, Math.round((agora - anterior.desde) / 3.6e6));
      await _avisar({
        chave, recuperacao: true,
        titulo: 'Normalizado: ' + chave,
        mensagem: `Ficou fora por cerca de ${horas} h e voltou a funcionar.`,
      });
      avisos++;
      delete estado[chave];
    }
  }

  await _gravarEstado(estado);
  return { avisos, ativos: Object.keys(estado) };
}

function iniciar(intervaloMs = 10 * 60 * 1000) {
  // Primeira passada depois do arranque, para não competir com o resto da
  // inicialização — e porque um alerta nos primeiros segundos costuma ser
  // sobre um serviço que ainda está subindo.
  setTimeout(() => verificar().catch(() => {}), 90_000);
  setInterval(() => verificar().catch(() => {}), intervaloMs);
  console.log('👁️  [Vigia] Agendado — verificação a cada ' + Math.round(intervaloMs / 60000) + ' min');
}

module.exports = { verificar, iniciar, bancoConectado, CHAVE, VERIFICACOES };
