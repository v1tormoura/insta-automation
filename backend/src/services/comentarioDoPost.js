'use strict';

/**
 * O comentário fixado automático de uma publicação.
 *
 * Sai na fila, 2 minutos depois da publicação, na mídia que a PRÓPRIA
 * publicação devolveu — nunca na "mais recente da conta", que pode ser outra.
 * O mesmo desenho da campanha: um caminho só para os dois.
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
 * @param {{username?: string, nome?: string, cidade?: string}} vars
 * @param {Date} [agora]
 */
function montarMensagem(modelo, vars = {}, agora = new Date()) {
  if (typeof modelo !== 'string') return '';
  const arroba = vars.username ? `@${String(vars.username).replace(/^@+/, '')}` : '';
  return modelo
    .replace(/\{username\}/gi, arroba)
    /* Sem o fallback para o @ o texto ficaria com um buraco. Com ele, a conta
       sem nome cadastrado mostra o @ — que é o que a pessoa reconhece. */
    .replace(/\{nome\}/gi, vars.nome || arroba)
    .replace(/\{data\}/gi, agora.toLocaleDateString('pt-BR'))
    .replace(/\{hora\}/gi, agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }))
    .replace(/\{cidade\}/gi, vars.cidade || '')
    /* `{username}` já sai com o @. Quem escreve "@{username}" — que é o jeito
       natural de escrever uma menção — ganharia "@@conta", e o Instagram não
       liga @@ a ninguém. Colapsar aqui deixa os dois jeitos certos. */
    .replace(/@{2,}/g, '@');
}

/**
 * Decide se e o que comentar. Não comenta — só decide.
 *
 * Separado do envio para ser verificável sozinho: a decisão tem três saídas e
 * duas delas são "não comentar", que é justamente o que passava calado antes.
 *
 * @returns {{comentar: boolean, motivo: string, texto?: string}}
 */
function decidirComentario({ modelo, account, mediaId, agora = new Date() }) {
  const bruto = String(modelo || '').trim();
  if (!bruto) return { comentar: false, motivo: 'sem_texto' };

  /* Sem o id da publicação não há onde comentar. Antes isto era resolvido
     procurando "a mídia mais recente da conta" — que podia ser outra. */
  if (!String(mediaId || '').trim()) return { comentar: false, motivo: 'sem_media_id' };

  /* `{link}` vinha do módulo de Divulgação, que saiu. Um modelo antigo com ele
     viraria "🤖 {link}" publicado no post — melhor não comentar e dizer por quê. */
  if (/\{link\}/i.test(bruto)) return { comentar: false, motivo: 'usa_variavel_link_removida' };

  const texto = montarMensagem(bruto, {
    username: account?.username || '',
    nome: account?.name || '',
  }, agora).trim();

  /* O modelo podia ser só variáveis vazias. Comentário em branco o Instagram
     recusa, e a recusa apareceria como erro sem causa aparente. */
  if (!texto) return { comentar: false, motivo: 'texto_vazio_apos_variaveis' };

  return { comentar: true, motivo: 'ok', texto };
}

module.exports = { montarMensagem, decidirComentario, ATRASO_MS };
