'use strict';

/**
 * Conferência antes de conectar uma conta.
 *
 * ── O problema que isto resolve
 *
 * Conectar uma conta era tentar e ver no que dá. Quando o ambiente estava
 * quebrado — proxy sem cota, serviço Python fora — o resultado era um erro de
 * LOGIN, e a leitura natural de um erro de login é culpar a conta ou a senha.
 *
 * Foi exatamente o que aconteceu: a cota do proxy tinha acabado, e a tela dizia
 * "erro de proxy — verifique se o proxy está ativo", com um rastro de pilha do
 * Python embaixo. A conclusão de quem lê aquilo é trocar a senha, tentar outra
 * conta, desconfiar do @. Nada disso chega perto.
 *
 * ── O que a conferência separa
 *
 * Dez segundos antes do login, três perguntas cujas respostas têm DONOS
 * diferentes:
 *
 *   o serviço Python está de pé?   -> infraestrutura, você resolve reiniciando
 *   o proxy responde?              -> fornecedor, você resolve renovando
 *   qual é o IP de saída?          -> informação, não bloqueio
 *
 * Nenhuma delas é sobre a conta. Se as três passam e o login ainda falha, aí
 * sim o Instagram recusou aquela conta — e é uma conversa completamente
 * diferente, com outra solução.
 *
 * ── Por que não bloqueia
 *
 * A conferência AVISA e deixa tentar. Um bloqueio transformaria um diagnóstico
 * em um portão, e diagnóstico errado vira portão errado: se o teste de proxy
 * falhar por uma instabilidade de dez segundos, quem quiser conectar mesmo
 * assim não deveria ser impedido por isso.
 */

const TIMEOUT_SERVICO = 8_000;

/** O serviço Python responde? */
async function _servico() {
  /* MESMA variável que o cliente usa. Um nome próprio aqui cairia no padrão
     silenciosamente e a conferência testaria um endereço diferente do que a
     publicação usa — dizendo "de pé" sobre um serviço que não é o dela. */
  const base = (process.env.INSTAGRAPI_SERVICE_URL || 'http://instagrapi-svc:8000').replace(/\/$/, '');
  try {
    const res = await fetch(`${base}/healthz`, { signal: AbortSignal.timeout(TIMEOUT_SERVICO) });
    if (!res.ok) {
      return { ok: false, detalhe: `respondeu HTTP ${res.status}`,
               conserto: 'docker compose restart instagrapi-svc' };
    }
    return { ok: true, detalhe: 'de pé' };
  } catch (e) {
    return {
      ok: false,
      detalhe: e.name === 'TimeoutError' ? 'não respondeu em 8s' : 'inalcançável',
      conserto: 'docker compose up -d instagrapi-svc',
    };
  }
}

/** O proxy que ESTA conta vai usar responde? */
async function _proxy(account) {
  const { resolverComOrigem } = require('./globalProxy');
  const testProxy = require('./testProxy');

  /* `contabilizar: false`: isto é diagnóstico, não operação. Contar aqui
     inflaria o consumo do dia a cada abertura do modal de conectar. */
  const { url, origem } = await resolverComOrigem(account || {}, { contabilizar: false });
  if (!url) {
    /* Sem proxy é escolha, não falha — mas precisa ser dita: a conta vai sair
       pelo IP do servidor, e várias contas no mesmo IP é o padrão que o
       Instagram lê como automação. */
    return { ok: true, alerta: true, origem: 'nenhum',
             detalhe: 'sem proxy — a conta vai sair pelo IP do servidor' };
  }

  const r = await testProxy(url);
  return r.ok
    ? { ok: true, origem, detalhe: `responde · saída ${r.ip}`, ip: r.ip, latenciaMs: r.latencyMs }
    : { ok: false, origem, detalhe: r.error || 'não respondeu',
        conserto: 'Confira em Proxies. Se disser cota, renove no painel do fornecedor.' };
}

/**
 * Roda a conferência.
 * @param {object} [account] — quando informada, testa o proxy DELA; sem ela,
 *   testa o que uma conta nova receberia.
 */
async function conferir(account = null) {
  const [servico, proxy] = await Promise.all([
    _servico().catch(e => ({ ok: false, detalhe: e.message })),
    _proxy(account).catch(e => ({ ok: false, detalhe: e.message })),
  ]);

  const itens = { servico, proxy };
  const bloqueios = Object.entries(itens).filter(([, v]) => !v.ok).map(([k]) => k);

  let veredito;
  if (!bloqueios.length && proxy.alerta) {
    veredito = 'O ambiente está pronto, mas sem proxy: a conta vai sair pelo IP do servidor.';
  } else if (!bloqueios.length) {
    veredito = 'Ambiente pronto. Se o login falhar agora, é o Instagram recusando esta conta.';
  } else if (bloqueios.includes('servico')) {
    veredito = 'O serviço que fala com o Instagram está fora do ar. Nenhuma conta consegue conectar — não é problema desta conta.';
  } else {
    veredito = 'O proxy não está respondendo. O login vai falhar antes de chegar ao Instagram — não é a senha nem o @.';
  }

  return { pronto: bloqueios.length === 0, bloqueios, veredito, itens };
}

module.exports = { conferir };
