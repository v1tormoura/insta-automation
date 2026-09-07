'use strict';

/**
 * O comentário fixado automático de uma publicação.
 *
 * ── O que estava errado
 *
 * A função existia e três coisas não funcionavam. Medido lendo o código, não
 * suposto:
 *
 *  1. `{nome}` NUNCA funcionava. `buildMessage` lia `vars.name` e quem chamava
 *     passava `vars.nome`. A variável caía no fallback e virava o @ — a tela
 *     oferecia três variáveis e entregava duas.
 *
 *  2. Conta mobile não recebia comentário NENHUM. A função começava com
 *     `if (!account.accessToken || !account.igUserId) return;` — só conta da
 *     API oficial passava, e saía calada. Num sistema em que a maioria das
 *     contas entra por senha, isso é a maioria dos casos.
 *
 *  3. Comentava na "mídia mais recente da conta", descoberta por uma consulta
 *     depois de esperar dois minutos. Se a conta publicasse outra coisa nesse
 *     meio, o comentário ia para o post errado.
 *
 * E a espera era um `await delay(120_000)` guardado na memória do worker: um
 * restart nessa janela perdia o comentário sem deixar rastro.
 *
 * ── O padrão que já existia
 *
 * A campanha faz certo desde a fase 8: despacha pelo `ProviderFactory` (conta
 * mobile comenta pelo serviço Python, conta oficial pela Graph), usa o
 * `mediaId` que a própria publicação devolveu, e agenda o comentário como
 * tarefa própria na fila. Este módulo leva o Postar e o Loop para o mesmo
 * caminho em vez de manter dois.
 */

/* Quanto depois da publicação o comentário sai. Dois minutos porque a mídia
   precisa estar indexada para aceitar comentário — e porque comentar no próprio
   post no mesmo segundo em que ele sobe não é o que uma pessoa faz. */
const ATRASO_MS = 2 * 60 * 1000;

/**
 * Substitui as variáveis do texto.
 *
 * Uma só função, com os nomes das chaves conferidos: era a divergência entre
 * `vars.name` e `vars.nome` que fazia `{nome}` cair no @ silenciosamente.
 *
 * @param {string} modelo
 * @param {{link?: string, username?: string, nome?: string, cidade?: string}} vars
 * @param {Date} [agora]
 */
function montarMensagem(modelo, vars = {}, agora = new Date()) {
  if (typeof modelo !== 'string') return '';
  const arroba = vars.username ? `@${String(vars.username).replace(/^@+/, '')}` : '';
  return modelo
    .replace(/\{link\}/gi, vars.link || '')
    .replace(/\{username\}/gi, arroba)
    /* Sem o fallback para o @ o texto ficaria com um buraco. Com ele, a conta
       sem nome cadastrado mostra o @ — que é o que a pessoa reconhece. */
    .replace(/\{nome\}/gi, vars.nome || arroba)
    .replace(/\{data\}/gi, agora.toLocaleDateString('pt-BR'))
    .replace(/\{hora\}/gi, agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }))
    .replace(/\{cidade\}/gi, vars.cidade || '');
}

/**
 * O texto usa `{link}` e não há link para pôr?
 *
 * `{link}` sai de `account.promoLink`. Sem ele, o modelo padrão da tela
 * ("🤖 {link}") vira "🤖 " — um comentário com um emoji e nada. Melhor não
 * comentar: um comentário quebrado no próprio post é pior que nenhum, e fica
 * lá para todo mundo ver.
 */
function faltaOLink(modelo, account) {
  return /\{link\}/i.test(String(modelo || '')) && !String(account?.promoLink || '').trim();
}

/**
 * Decide se e o que comentar. Não comenta — só decide.
 *
 * Separado do envio para ser verificável sozinho: a decisão tem quatro saídas e
 * três delas são "não comentar", que é justamente o que passava calado antes.
 *
 * @returns {{comentar: boolean, motivo: string, texto?: string}}
 */
function decidirComentario({ modelo, account, mediaId, agora = new Date() }) {
  const bruto = String(modelo || '').trim();
  if (!bruto) return { comentar: false, motivo: 'sem_texto' };

  /* Sem o id da publicação não há onde comentar. Antes isto era resolvido
     procurando "a mídia mais recente da conta" — que podia ser outra. */
  if (!String(mediaId || '').trim()) return { comentar: false, motivo: 'sem_media_id' };

  if (faltaOLink(bruto, account)) return { comentar: false, motivo: 'sem_promo_link' };

  const texto = montarMensagem(bruto, {
    link: account?.promoLink || '',
    username: account?.username || '',
    nome: account?.name || '',
  }, agora).trim();

  /* O modelo podia ser só variáveis vazias. Comentário em branco o Instagram
     recusa, e a recusa apareceria como erro sem causa aparente. */
  if (!texto) return { comentar: false, motivo: 'texto_vazio_apos_variaveis' };

  return { comentar: true, motivo: 'ok', texto };
}

module.exports = { montarMensagem, decidirComentario, faltaOLink, ATRASO_MS };
