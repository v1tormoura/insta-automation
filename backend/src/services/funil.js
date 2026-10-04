'use strict';

/**
 * Funil de vendas — de qual conta do Instagram veio quem entrou no bot,
 * quem clicou em comprar e quem pagou.
 *
 * ── Duas entradas
 *
 *   /r/:codigo              link rastreado (bio, legenda): conta o clique e
 *                           manda para o bot com ?start=<codigo>
 *   /funil/webhook/:token   o bot (ApexVIP, SharkBot, checkout, n8n...) avisa
 *                           os eventos
 *
 * ── Por que o webhook não exige um formato
 *
 * Cada bot manda um JSON diferente e nenhum documenta o mesmo nome de campo.
 * Em vez de um adaptador por bot, o evento é lido pelo SIGNIFICADO das chaves
 * (event/status/type → etapa; chat_id/user_id → lead; amount/valor → valor) e
 * o JSON original fica guardado, para conferir e ajustar. Quem quiser ser
 * explícito passa ?etapa=comprou na URL do webhook.
 */

const crypto = require('crypto');

const ETAPAS = ['clique', 'entrou', 'checkout', 'comprou', 'outro'];
const ORDEM = { clique: 0, outro: 0, entrou: 1, checkout: 2, comprou: 3 };
const PADRAO_CODIGO = /\bnx[a-z0-9]{6}\b/i;

/** Todas as folhas do JSON: [{ chave: 'ultimo segmento', caminho, valor }]. */
function folhas(obj, caminho = '', saida = [], nivel = 0) {
  if (obj == null || nivel > 5) return saida;
  if (Array.isArray(obj)) { obj.slice(0, 20).forEach((v, i) => folhas(v, `${caminho}[${i}]`, saida, nivel + 1)); return saida; }
  if (typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) folhas(v, caminho ? `${caminho}.${k}` : k, saida, nivel + 1);
    return saida;
  }
  const chave = caminho.split('.').pop().replace(/\[\d+\]$/, '').toLowerCase();
  saida.push({ chave, caminho: caminho.toLowerCase(), valor: obj });
  return saida;
}

const primeiro = (fs, re, filtro = () => true) => fs.find(f => re.test(f.chave) && f.valor !== '' && filtro(f))?.valor;
const texto = v => (v == null ? '' : String(v).trim());

/** A etapa pelo texto do evento/status. Pagamento ganha de tudo; pendente não é pago. */
function etapaDoTexto(t) {
  const s = String(t || '').toLowerCase();
  if (!s) return 'outro';
  const pendente = /pend|waiting|aguard|generat|gerad|creat|criad|abandon|refus|recus|cancel|expir|fail|falh|chargeback|refund|reembols/;
  if (/approv|aprov|paid|pago|purchase|compra|sale|venda|confirm|complet|conclu|success|sucesso|renew|renov|active_subscription|assinatura_ativa/.test(s) && !pendente.test(s)) return 'comprou';
  if (/checkout|pix|boleto|cart|carrinho|click|clique|payment|pagamento|order|pedido|invoice|fatura|abandon|plano_escolhido|plan_selected|pend|waiting|aguard/.test(s)) return 'checkout';
  if (/start|entrou|join|new_user|novo|lead|subscri|inscri|member|registr|signup|cadastr|bot_started|welcome/.test(s)) return 'entrou';
  return 'outro';
}

/**
 * JSON qualquer → evento do funil.
 * @param {object} corpo
 * @param {{ etapa?: string }} [forcar] ?etapa= da URL
 */
function normalizar(corpo, forcar = {}) {
  const fs = folhas(corpo || {});
  const evento = fs.filter(f => /^(event|evento|event_type|type|tipo|status|action|acao|ação|trigger|name)$/.test(f.chave) && typeof f.valor !== 'object')
    .map(f => texto(f.valor)).filter(Boolean).slice(0, 4).join(' · ');
  const etapa = ETAPAS.includes(forcar.etapa) ? forcar.etapa : etapaDoTexto(evento);

  const lead = texto(primeiro(fs, /^(telegram_?id|chat_?id|user_?id|from_?id|customer_?id|client_?id|lead_?id|buyer_?id|subscriber_?id)$/)
    // { user: { id } }, { from: { id } } — o formato do próprio Telegram.
    ?? fs.find(f => /(^|\.)(user|from|chat|customer|client|buyer|lead|member|subscriber|usuario|cliente)\.id$/.test(f.caminho))?.valor);
  const email = texto(primeiro(fs, /e-?mail/, f => /@/.test(String(f.valor))));
  const telefone = texto(primeiro(fs, /phone|telefone|celular|whatsapp|mobile/));
  const username = texto(primeiro(fs, /^(username|user_name|telegram_username|tg_username)$/)).replace(/^@/, '');
  const nome = texto(primeiro(fs, /^(name|nome|first_name|full_name|customer_name|client_name|buyer_name)$/, f => !/@/.test(String(f.valor))));
  const plano = texto(primeiro(fs, /plan|plano|product|produto|offer|oferta/, f => typeof f.valor === 'string'));

  let valor = null;
  const v = fs.find(f => /^(value|valor|amount|price|preco|preço|total|amount_paid|valor_pago|price_cents|amount_cents|total_cents)$/.test(f.chave)
    && Number.isFinite(Number(String(f.valor).replace(',', '.'))));
  if (v) {
    valor = Number(String(v.valor).replace(',', '.'));
    if (/cent/.test(v.chave)) valor /= 100;
    valor = Math.round(valor * 100) / 100;
  }

  /* O código do link: um campo de origem (start, ref, utm...) ou qualquer texto com o formato nxXXXXXX. */
  let codigo = texto(primeiro(fs, /^(start|start_param|startapp|ref|referral|src|source|utm_source|utm_campaign|utm_content|utm_term|codigo|code|tracking|sck|payload)$/,
    f => PADRAO_CODIGO.test(String(f.valor))));
  if (!codigo) codigo = fs.map(f => String(f.valor)).find(s => PADRAO_CODIGO.test(s)) || '';
  codigo = (codigo.match(PADRAO_CODIGO) || [''])[0].toLowerCase();

  return {
    etapa, evento: evento.slice(0, 200), codigo,
    lead: (lead || email || telefone || username).slice(0, 120),
    nome: nome.slice(0, 120), username: username.slice(0, 60), email: email.slice(0, 160), telefone: telefone.slice(0, 40),
    valor, plano: plano.slice(0, 120),
  };
}

const novoCodigo = () => `nx${crypto.randomBytes(4).toString('hex').slice(0, 6)}`;
const novoToken = () => crypto.randomBytes(18).toString('base64url');

/** O destino com o código: t.me/bot vira t.me/bot?start=<codigo>; {codigo} é trocado. */
function destinoComCodigo(destino, codigo) {
  const d = String(destino || '').trim();
  if (d.includes('{codigo}')) return d.replaceAll('{codigo}', codigo);
  let u;
  try { u = new URL(/^https?:\/\//i.test(d) ? d : `https://${d}`); } catch { return d; }
  if (/(^|\.)t\.me$|(^|\.)telegram\.me$/i.test(u.hostname) && !u.searchParams.has('start')) u.searchParams.set('start', codigo);
  else if (!/(^|\.)t\.me$|(^|\.)telegram\.me$/i.test(u.hostname) && !u.searchParams.has('utm_source')) u.searchParams.set('utm_source', codigo);
  return u.toString();
}

/** Destino aceito: só http(s) — o link é aberto pelo navegador de quem clicou. */
function destinoValido(destino) {
  try {
    const u = new URL(/^https?:\/\//i.test(destino) ? destino : `https://${destino}`);
    return /^https?:$/.test(u.protocol) && u.hostname.includes('.');
  } catch { return false; }
}

module.exports = { normalizar, etapaDoTexto, folhas, novoCodigo, novoToken, destinoComCodigo, destinoValido, ETAPAS, ORDEM, PADRAO_CODIGO };
