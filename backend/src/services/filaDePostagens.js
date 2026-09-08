'use strict';

/**
 * A fila de postagens — a consulta e os filtros.
 *
 * ── O que não existia
 *
 * Havia uma lista de posts, sem filtro e sem agrupamento. Trinta linhas iguais,
 * e três perguntas que a tela não respondia:
 *
 *   "de que envio é esta linha?"   → o Post não guardava o job. A informação
 *                                    existia no Job e nunca descia.
 *   "quantas views deu?"           → o Post não guardava o `igMediaId`. As
 *                                    métricas existiam em `Insight`, com
 *                                    `videoViews`, e os dois lados existiam
 *                                    sem nada no meio.
 *   "quais falharam?"              → sem filtro por status, era rolar e olhar.
 *
 * Os dois primeiros foram elos que faltavam, não recursos novos: a publicação
 * SEMPRE devolveu o id da mídia, e a campanha já o usava para comentar.
 *
 * ── Por que a lógica mora aqui
 *
 * O controller monta a resposta HTTP; a decisão de o que consultar é o que tem
 * casos de borda — filtro inventado, página fora do fim, id que não é ObjectId.
 * Separada, ela é chamável sem subir um servidor.
 */

const mongoose = require('mongoose');

/* Os status que o Post de fato usa. Descobertos lendo quem os grava, não
   supostos: o schema declara `status` como String sem enum, então a lista real
   está espalhada pelo worker e pelos controllers. */
const STATUS = ['pendente', 'processando', 'concluido', 'parcial', 'erro', 'cancelado'];
const FORMATOS = ['reel', 'post', 'story'];

/* O que "interrompida ou cancelada" quer dizer ao limpar a fila. `parcial` NÃO
   entra: parcial é publicação que saiu em algumas contas e falhou em outras —
   apagá-la perderia o registro do que foi publicado. */
const LIMPAVEIS = ['erro', 'cancelado'];

const LIMITE_PADRAO = 10;
const LIMITE_MAX = 100;

/**
 * Traduz os filtros da tela em um `find` do Mongo.
 *
 * Filtro desconhecido é IGNORADO em vez de virar consulta vazia: 'todos' e
 * 'bagunça' têm o mesmo efeito, que é não filtrar. A alternativa — mandar o
 * valor cru para o Mongo — devolveria zero linhas e pareceria "a fila está
 * vazia".
 */
function montarConsulta({ status, formato, job } = {}) {
  const q = {};

  if (STATUS.includes(status)) q.status = status;
  if (FORMATOS.includes(formato)) q.postType = formato;

  /* `job` só entra se for um ObjectId de verdade. Um id inventado faria o
     Mongoose LANÇAR um CastError no meio da consulta, e a fila responderia
     500 por causa de um parâmetro de URL. */
  if (job && job !== 'todos' && mongoose.Types.ObjectId.isValid(String(job))) {
    q.jobId = String(job);
  }

  return q;
}

/**
 * Página e limite dentro de faixas utilizáveis.
 *
 * ── Por que o negativo é tratado antes do `max`
 *
 * A primeira versão era `Math.max(1, Math.floor(Number(limit)) || PADRAO)`, e
 * com `limit=-3` o resultado era 1 item por página, não o padrão: `-3` é
 * truthy, então o `||` não o substituía, e o `max(1, -3)` o transformava em 1.
 *
 * O sintoma seria uma fila mostrando uma linha por página, com dezoito páginas
 * — e nada na tela ligando isso ao parâmetro da URL. Um teste pegou.
 *
 * Não positivo é o MESMO caso que ausente: quem manda `-3` não está pedindo
 * uma linha por página, está mandando lixo.
 */
function montarPaginacao({ page, limit } = {}) {
  const utilizavel = valor => {
    const n = Math.floor(Number(valor));
    return Number.isFinite(n) && n > 0 ? n : null;
  };

  const pagina = utilizavel(page) ?? 1;
  const porPagina = Math.min(LIMITE_MAX, utilizavel(limit) ?? LIMITE_PADRAO);
  return { pagina, porPagina, pular: (pagina - 1) * porPagina };
}

/**
 * As views de cada publicação, pelo id da mídia.
 *
 * Uma consulta para o lote inteiro, não uma por linha: dez linhas na tela
 * viravam dez consultas, e a fila abriria em dez idas ao banco.
 *
 * Publicação sem `igMediaId` (ainda não publicada, ou publicada antes deste
 * campo existir) simplesmente não aparece no mapa — e a tela mostra um traço
 * em vez de zero. Zero seria uma afirmação falsa: é "não sabemos", não "não
 * teve nenhuma".
 *
 * @param {Array<{igMediaId?: string}>} posts
 * @param {import('mongoose').Model} Insight
 * @returns {Promise<Map<string, number>>}
 */
async function viewsPorMidia(posts, Insight) {
  const ids = [...new Set(
    (posts || []).map(p => String(p?.igMediaId || '').trim()).filter(Boolean)
  )];
  if (!ids.length) return new Map();

  try {
    const rows = await Insight.find({ igMediaId: { $in: ids } })
      .select('igMediaId videoViews reach')
      .lean();
    return new Map(rows.map(r => [
      String(r.igMediaId),
      /* `videoViews` é o campo do reel. Caindo para `reach` quando ele é zero:
         reel recém-publicado costuma ter alcance antes de contabilizar
         reprodução, e mostrar 0 ao lado de um post que já circulou é pior que
         mostrar o número que existe. */
      Number(r.videoViews) > 0 ? Number(r.videoViews) : Number(r.reach) || 0,
    ]));
  } catch (err) {
    /* Métrica é enfeite da linha; a linha é o que importa. */
    console.log(`⚠️ [Fila] não deu para buscar views: ${err.message}`);
    return new Map();
  }
}

/**
 * Uma linha da fila, como a tela precisa dela.
 *
 * `views` é `null` e não 0 quando não se sabe — ver `viewsPorMidia`.
 */
function montarLinha(post, views) {
  const contas = (post.accounts || [])
    .filter(a => a && typeof a === 'object')
    .map(a => ({ id: String(a._id), username: a.username || '', avatar: a.avatar || '' }));

  const idDaMidia = String(post.igMediaId || '').trim();

  return {
    id: String(post._id),
    /* `scheduledAt` é quando devia sair; `createdAt` é quando entrou na fila.
       A tela mostra a primeira, porque é a que responde "quando isto vai (ou
       foi) ao ar". */
    quando: post.scheduledAt || post.createdAt || null,
    envio: post.jobName || '',
    envioId: post.jobId ? String(post.jobId) : null,
    contas,
    formato: post.postType || 'reel',
    status: post.status || 'pendente',
    /* O erro vai junto na linha. Antes ele existia no documento e não aparecia
       em lugar nenhum: a linha dizia "erro" e o motivo ficava no banco. */
    erro: post.error || '',
    views: idDaMidia && views.has(idDaMidia) ? views.get(idDaMidia) : null,
    midiaId: idDaMidia || null,
  };
}

module.exports = {
  montarConsulta, montarPaginacao, viewsPorMidia, montarLinha,
  STATUS, FORMATOS, LIMPAVEIS, LIMITE_PADRAO, LIMITE_MAX,
};
