'use strict';

/**
 * templateResolver — troca as marcações de um template pelos valores reais.
 *
 * Chamado no MOMENTO DA EXECUÇÃO, nunca ao salvar a campanha. É isso que
 * permite reaproveitar o mesmo template em várias publicações: `{username}`
 * vira uma conta diferente a cada item do plano.
 *
 * Regra de robustez: uma marcação desconhecida NUNCA lança nem apaga texto —
 * ela é deixada como está, e seu nome é devolvido em `unresolved`. Apagar
 * silenciosamente publicaria uma legenda incompleta sem ninguém perceber;
 * lançar erro impediria a publicação por causa de um detalhe cosmético.
 */

/** Marcações reconhecidas → função que extrai o valor do contexto. */
const VARIAVEIS = {
  username:         ctx => ctx.username,
  account_username: ctx => ctx.username,           // alias
  nome:             ctx => ctx.name ?? ctx.fullName,
  name:             ctx => ctx.name ?? ctx.fullName,
  campaign:         ctx => ctx.campaign,
  campaign_name:    ctx => ctx.campaign,           // alias
  content:          ctx => ctx.contentName,
  content_name:     ctx => ctx.contentName,        // alias
  date:             ctx => ctx.date,
  time:             ctx => ctx.time,
};

/** Formata a data no padrão brasileiro, sem depender do locale do processo. */
function _formatarData(d) {
  const dia = String(d.getDate()).padStart(2, '0');
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  return `${dia}/${mes}/${d.getFullYear()}`;
}

function _formatarHora(d) {
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

/**
 * Resolve as marcações de um template.
 *
 * @param {string} template  texto com marcações no formato {chave}
 * @param {Object} context
 * @param {string} [context.username]     username da conta (sem @)
 * @param {string} [context.name]         nome de exibição da conta
 * @param {string} [context.campaign]     nome da campanha
 * @param {string} [context.contentName]  nome do conteúdo
 * @param {Date}   [context.now]          instante de referência para date/time
 *
 * @returns {{ text: string, unresolved: string[] }}
 *          text: template com as marcações conhecidas substituídas;
 *          unresolved: marcações que não puderam ser resolvidas (deixadas intactas).
 */
function resolveTemplate(template, context = {}) {
  if (typeof template !== 'string' || !template) {
    return { text: '', unresolved: [] };
  }

  const agora = context.now instanceof Date && !Number.isNaN(context.now.getTime())
    ? context.now
    : null;

  const ctx = {
    ...context,
    date: context.date ?? (agora ? _formatarData(agora) : undefined),
    time: context.time ?? (agora ? _formatarHora(agora) : undefined),
  };

  const naoResolvidas = new Set();

  const texto = template.replace(/\{([a-zA-Z0-9_]+)\}/g, (original, chave) => {
    const extrator = VARIAVEIS[chave];
    if (!extrator) {
      naoResolvidas.add(chave);
      return original;               // desconhecida — preservada, nunca quebra
    }

    const valor = extrator(ctx);
    if (valor === undefined || valor === null || valor === '') {
      naoResolvidas.add(chave);
      return original;               // conhecida mas sem valor no contexto
    }

    return String(valor);
  });

  return { text: texto, unresolved: [...naoResolvidas] };
}

function _leMapa(mapa, chave) {
  if (!mapa || !chave) return undefined;
  if (typeof mapa.get === 'function') return mapa.get(chave);
  return mapa[chave];
}

/**
 * Resolve a legenda correta seguindo a precedência estrita:
 * 1. conta + conteúdo (byAccountContent: `${accountId}__${contentId}`)
 * 2. conteúdo (byContent: `${contentId}`)
 * 3. conta (byAccount: `${accountId}`)
 * 4. global
 * 5. ''
 *
 * Em seguida, substitui variáveis no template bruto com o contexto informado.
 */
function resolveCaption({ campaign, account, content, captions, context = {} } = {}) {
  const accountId = account?._id ? String(account._id) : (account?.id ? String(account.id) : (typeof account === 'string' ? account : ''));
  const contentId = content?._id ? String(content._id) : (content?.id ? String(content.id) : (typeof content === 'string' ? content : ''));
  const fonte = captions || campaign?.captions;

  let template = '';
  if (fonte) {
    const composta = `${accountId}__${contentId}`;
    const candidatos = [
      _leMapa(fonte.byAccountContent, composta),
      _leMapa(fonte.byContent, contentId),
      _leMapa(fonte.byAccount, accountId),
      fonte.global,
    ];
    for (const valor of candidatos) {
      if (typeof valor === 'string' && valor.length > 0) {
        template = valor;
        break;
      }
    }
  }

  const ctx = {
    username:    account?.username || context.username || '',
    name:        account?.name || account?.fullName || context.name || '',
    campaign:    campaign?.name || context.campaign || '',
    contentName: content?.originalName || content?.name || content?.label || content?.filename || context.contentName || '',
    ...context,
  };

  return resolveTemplate(template, ctx);
}

/**
 * Resolve o comentário seguindo a mesma ordem de precedência.
 */
function resolveComment({ campaign, account, content, comments, context = {} } = {}) {
  return resolveCaption({
    campaign,
    account,
    content,
    captions: comments || campaign?.comments,
    context,
  });
}

/** Nomes das marcações suportadas — usado pelo botão "Inserir variável" da UI. */
function listarVariaveis() {
  return Object.keys(VARIAVEIS);
}

module.exports = { resolveTemplate, resolveCaption, resolveComment, listarVariaveis };

