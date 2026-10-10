'use strict';

/**
 * Funil de vendas — ver services/funil.js.
 *
 *   publico   GET  /r/:codigo              link rastreado → conta o clique e redireciona
 *             POST /funil/webhook/:token   eventos do bot / checkout (JSON qualquer)
 *   painel    GET  /funil/config            URL do webhook          POST /funil/config/novo-token
 *             GET  /funil/links             links rastreados        POST /funil/links  DELETE /funil/links/:id
 *             GET  /funil/resumo?dias=      etapas, conversão, por conta
 *             GET  /funil/leads?dias=&etapa= quem parou em cada etapa
 *             GET  /funil/eventos           os últimos recebidos (com o JSON original)
 */

const express = require('express');
const { sql } = require('../db');
const config = require('../config');
const funil = require('../services/funil');
const { broadcast } = require('../events/broadcaster');

const publico = express.Router();
const painel = express.Router();

const baseDaApi = req => config.publicUrl || `${req.protocol}://${req.get('host')}`;

/* ── Público ─────────────────────────────────────────────────────────────── */

publico.get('/r/:codigo', async (req, res) => {
  const codigo = String(req.params.codigo || '').toLowerCase();
  const [link] = await sql`select * from funil_links where codigo = ${codigo}`.catch(() => []);
  if (!link) return res.status(404).send('Link não encontrado');
  sql`insert into funil_eventos ${sql({ usuarioId: link.usuarioId, linkId: link.id, codigo, etapa: 'clique', evento: 'clique no link' })}`
    .catch(e => console.log(`[Funil] clique ${codigo}: ${e.message}`));
  res.redirect(302, funil.destinoComCodigo(link.destino, codigo));
});

publico.post('/funil/webhook/:token', express.json({ limit: '1mb' }), express.urlencoded({ extended: true, limit: '1mb' }), async (req, res) => {
  const [cfg] = await sql`select usuario_id from funil_config where token = ${String(req.params.token || '')}`.catch(() => []);
  if (!cfg) return res.status(404).json({ error: 'Webhook não encontrado' });
  const usuarioId = cfg.usuarioId;
  const corpo = req.body && Object.keys(req.body).length ? req.body : { ...req.query };
  const ev = funil.normalizar(corpo, { etapa: String(req.query.etapa || '') });

  /* Sem código no evento (comum na compra): herda o do mesmo lead, de quando entrou. */
  let linkId = null;
  if (ev.codigo) {
    const [l] = await sql`select id from funil_links where codigo = ${ev.codigo} and usuario_id = ${usuarioId}`;
    linkId = l?.id || null;
  } else if (ev.lead) {
    const [antes] = await sql`
      select codigo, link_id from funil_eventos
      where usuario_id = ${usuarioId} and lead = ${ev.lead} and codigo <> ''
      order by criado_em desc limit 1`;
    if (antes) { ev.codigo = antes.codigo; linkId = antes.linkId; }
  }

  /* Nome e @ que não vieram neste evento (a compra costuma vir só com o id): os de antes. */
  if (ev.lead && (!ev.nome || !ev.username)) {
    const [quem] = await sql`
      select max(nullif(nome, '')) as nome, max(nullif(username, '')) as username from funil_eventos
      where usuario_id = ${usuarioId} and lead = ${ev.lead}`;
    ev.nome = ev.nome || quem?.nome || '';
    ev.username = ev.username || quem?.username || '';
  }

  const [novo] = await sql`insert into funil_eventos ${sql({ usuarioId, linkId, ...ev, bruto: sql.json(corpo) })} returning id`;
  broadcast('funil', { etapa: ev.etapa }, usuarioId);
  avisar(usuarioId, ev, linkId).catch(e => console.log(`[Funil] aviso: ${e.message}`));
  res.json({ ok: true, id: novo.id, etapa: ev.etapa, codigo: ev.codigo || null });
});

/* Etapa → aviso editável em Notificações (modelo, liga/desliga). */
const AVISO_DA_ETAPA = { comprou: 'vendaWebhook', checkout: 'checkoutWebhook', entrou: 'leadWebhook' };

async function avisar(usuarioId, ev, linkId) {
  const tipo = AVISO_DA_ETAPA[ev.etapa];
  if (!tipo) return null;
  const cfg = await require('../services/smartActivity/thresholds').carregar(usuarioId).catch(() => null);
  // `carregar` já mistura o padrão: venda ligada; lead e clique em comprar desligados.
  if (!cfg?.ativos?.[tipo]) return null;

  const [l] = linkId ? await sql`
    select l.rotulo, a.username from funil_links l left join accounts a on a.id = l.account_id where l.id = ${linkId}` : [];
  const t = require('../services/smartActivity/templates');
  const modelo = t.modeloDe(tipo, cfg?.mensagens);
  const vars = {
    cliente: ev.nome || (ev.username ? `@${ev.username}` : 'Alguém'),
    plano: ev.plano || 'o plano',
    valor: ev.valor != null ? Number(ev.valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : 'valor não informado',
    origem: l?.username ? `@${l.username}` : (l?.rotulo || 'origem desconhecida'),
    time: 'agora',
  };
  const { notificacoes } = require('../repos');
  const nova = await notificacoes.insert({
    usuarioId, eventType: 'funil', tema: modelo.tema, prioridade: 'normal', username: l?.username || '',
    titulo: t.render(modelo.titulo, vars),
    mensagem: t.render(modelo.mensagem, vars),
    metadados: { funil: true, tipo },
  });
  require('../services/smartActivity/webPush').enviar(nova).catch(() => {});
  broadcast('notificacoes', { novas: 1 }, usuarioId);
  return nova;
}

/* ── Painel ──────────────────────────────────────────────────────────────── */

async function tokenDe(usuarioId) {
  const [c] = await sql`select token from funil_config where usuario_id = ${usuarioId}`;
  if (c) return c.token;
  const [n] = await sql`insert into funil_config ${sql({ usuarioId, token: funil.novoToken() })} on conflict (usuario_id) do update set usuario_id = excluded.usuario_id returning token`;
  return n.token;
}

painel.get('/config', async (req, res) => {
  const token = await tokenDe(req.user.id);
  res.json({ webhook: `${baseDaApi(req)}/funil/webhook/${token}`, baseDoLink: `${baseDaApi(req)}/r/` });
});

painel.post('/config/novo-token', async (req, res) => {
  await sql`insert into funil_config ${sql({ usuarioId: req.user.id, token: funil.novoToken() })}
    on conflict (usuario_id) do update set token = excluded.token`;
  res.json({ webhook: `${baseDaApi(req)}/funil/webhook/${await tokenDe(req.user.id)}` });
});

painel.get('/links', async (req, res) => {
  const links = await sql`
    select l.*, a.username,
      (select count(*)::int from funil_eventos e where e.link_id = l.id and e.etapa = 'clique') as cliques
    from funil_links l left join accounts a on a.id = l.account_id
    where l.usuario_id = ${req.user.id} order by l.criado_em desc`;
  const base = `${baseDaApi(req)}/r/`;
  res.json({ links: links.map(l => ({ ...l, url: base + l.codigo, destinoFinal: funil.destinoComCodigo(l.destino, l.codigo) })) });
});

painel.post('/links', async (req, res) => {
  const destino = String(req.body?.destino || '').trim();
  if (!funil.destinoValido(destino)) return res.status(400).json({ error: 'Cole o link do bot, como https://t.me/seubot' });
  let accountId = req.body?.accountId ? String(req.body.accountId) : null;
  if (accountId) {
    const [a] = await sql`select id from accounts where id = ${accountId} and usuario_id = ${req.user.id}`.catch(() => []);
    if (!a) accountId = null;
  }
  let link;
  for (let i = 0; i < 5 && !link; i++) {
    [link] = await sql`insert into funil_links ${sql({ usuarioId: req.user.id, codigo: funil.novoCodigo(), destino, accountId,
      rotulo: String(req.body?.rotulo || '').trim().slice(0, 60) })} on conflict (codigo) do nothing returning *`;
  }
  res.json({ ...link, url: `${baseDaApi(req)}/r/${link.codigo}` });
});

painel.delete('/links/:id', async (req, res) => {
  await sql`delete from funil_links where id = ${req.params.id} and usuario_id = ${req.user.id}`.catch(() => {});
  res.json({ ok: true });
});

/** Eventos do período, já com a conta de origem. */
async function eventosDoPeriodo(usuarioId, dias) {
  const desde = new Date(Date.now() - dias * 86_400_000);
  return sql`
    select e.id, e.etapa, e.evento, e.lead, e.nome, e.username, e.email, e.telefone, e.valor, e.plano, e.codigo, e.criado_em,
           e.link_id, l.rotulo as link_rotulo, a.username as conta, l.account_id as conta_id
    from funil_eventos e
    left join funil_links l on l.id = e.link_id
    left join accounts a on a.id = l.account_id
    where e.usuario_id = ${usuarioId} and e.criado_em >= ${desde}
    order by e.criado_em asc limit 20000`;
}

const diasDe = q => Math.min(365, Math.max(1, parseInt(q.dias, 10) || 30));

/** Um lead por pessoa: a etapa mais longe a que chegou e os dados que vieram. */
function leadsDe(eventos) {
  const m = new Map();
  for (const e of eventos) {
    if (e.etapa === 'clique' || e.etapa === 'outro') continue;
    const chave = e.lead || e.id;
    const l = m.get(chave) || { lead: e.lead, etapa: 'entrou', nome: '', username: '', email: '', telefone: '', plano: '', valor: null,
      conta: '', contaId: null, origem: '', primeiro: e.criadoEm, ultimo: e.criadoEm, eventos: 0 };
    if (funil.ORDEM[e.etapa] > funil.ORDEM[l.etapa]) l.etapa = e.etapa;
    for (const k of ['nome', 'username', 'email', 'telefone', 'plano']) if (e[k]) l[k] = e[k];
    if (e.etapa === 'comprou' && e.valor != null) l.valor = Number(e.valor);
    if (e.conta || e.linkRotulo) { l.conta = e.conta || ''; l.origem = e.conta ? `@${e.conta}` : e.linkRotulo; }
    if (e.contaId && !l.contaId) l.contaId = String(e.contaId);
    l.ultimo = e.criadoEm; l.eventos++;
    m.set(chave, l);
  }
  return [...m.values()];
}

/* O dia no fuso de quem usa o painel (Brasil), não o dia em UTC. */
const diaLocal = d => new Date(d).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });

/**
 * Por dia: leads novos (primeira vez que a pessoa aparece), quem clicou em
 * comprar, vendas e receita. `hoje` é o último ponto da série.
 */
function seriePorDia(eventos, nDias) {
  const dias = [];
  for (let i = nDias - 1; i >= 0; i--) dias.push(diaLocal(Date.now() - i * 86_400_000));
  const m = new Map(dias.map(d => [d, { dia: d, cliques: 0, entrou: 0, checkout: 0, comprou: 0, receita: 0 }]));
  const vistos = { entrou: new Set(), checkout: new Set(), comprou: new Set() };
  for (const e of eventos) {
    const b = m.get(diaLocal(e.criadoEm));
    if (e.etapa === 'clique') { if (b) b.cliques++; continue; }
    if (e.etapa === 'outro') continue;
    const quem = e.lead || e.id;
    for (const etapa of ['entrou', 'checkout', 'comprou']) {
      if (funil.ORDEM[e.etapa] < funil.ORDEM[etapa] || vistos[etapa].has(quem)) continue;
      vistos[etapa].add(quem);
      if (!b) continue;
      b[etapa]++;
      if (etapa === 'comprou' && e.valor != null) b.receita = Math.round((b.receita + Number(e.valor)) * 100) / 100;
    }
  }
  const serie = [...m.values()];
  return { serie, hoje: serie.at(-1) };
}

painel.get('/resumo', async (req, res) => {
  const dias = diasDe(req.query);
  const eventos = await eventosDoPeriodo(req.user.id, dias);
  const leads = leadsDe(eventos);
  const cliques = eventos.filter(e => e.etapa === 'clique');
  const chegou = etapa => leads.filter(l => funil.ORDEM[l.etapa] >= funil.ORDEM[etapa]).length;
  const etapas = { cliques: cliques.length, entrou: leads.length, checkout: chegou('checkout'), comprou: chegou('comprou') };
  const receita = leads.reduce((s, l) => s + (l.etapa === 'comprou' && l.valor ? l.valor : 0), 0);

  const porOrigem = new Map();
  const origemDe = x => x.conta ? `@${x.conta}` : (x.linkRotulo || x.origem || 'Sem origem');
  for (const c of cliques) {
    const k = origemDe(c);
    const o = porOrigem.get(k) || { origem: k, cliques: 0, entrou: 0, checkout: 0, comprou: 0, receita: 0 };
    o.cliques++; porOrigem.set(k, o);
  }
  for (const l of leads) {
    const k = l.origem || 'Sem origem';
    const o = porOrigem.get(k) || { origem: k, cliques: 0, entrou: 0, checkout: 0, comprou: 0, receita: 0 };
    o.entrou++;
    if (funil.ORDEM[l.etapa] >= 2) o.checkout++;
    if (l.etapa === 'comprou') { o.comprou++; o.receita += l.valor || 0; }
    porOrigem.set(k, o);
  }
  res.json({
    dias, etapas, receita: Math.round(receita * 100) / 100,
    ticketMedio: etapas.comprou ? Math.round((receita / etapas.comprou) * 100) / 100 : 0,
    ...seriePorDia(eventos, Math.min(dias, 30)),
    origens: [...porOrigem.values()].sort((a, b) => b.comprou - a.comprou || b.entrou - a.entrou || b.cliques - a.cliques),
    ultimoEvento: eventos.at(-1)?.criadoEm || null,
  });
});

/* Receita por Reel / envio / etiqueta — ver services/receitaPorConteudo.js. */
painel.get('/por-conteudo', async (req, res) => {
  const dias = diasDe(req.query);
  const { atribuir, JANELA_H } = require('../services/receitaPorConteudo');
  const desde = new Date(Date.now() - (dias * 24 + JANELA_H) * 3_600_000);
  /* As três leituras saem juntas: as métricas vêm das mídias do mesmo
     período por subconsulta, sem esperar a lista de publicações. */
  const [eventos, pubs, ins] = await Promise.all([
    eventosDoPeriodo(req.user.id, dias),
    sql`
      select m->>'accountId' as account_id, m->>'igMediaId' as ig_media_id, m->>'em' as em,
             p.job_id, p.job_name, coalesce(j.rotulo, '') as rotulo
      from posts p
      cross join lateral jsonb_array_elements(p.midias_publicadas) m
      left join jobs j on j.id = p.job_id
      where p.usuario_id = ${req.user.id} and (m->>'em')::timestamptz >= ${desde}`,
    sql`
      select ig_media_id, username, reach, video_views, permalink, thumbnail_url, caption from insights
      where usuario_id = ${req.user.id} and ig_media_id in (
        select m->>'igMediaId'
        from posts p cross join lateral jsonb_array_elements(p.midias_publicadas) m
        where p.usuario_id = ${req.user.id} and (m->>'em')::timestamptz >= ${desde})`,
  ]);
  const r = atribuir(leadsDe(eventos), pubs.map(p => ({ ...p, accountId: p.accountId })), new Map(ins.map(i => [i.igMediaId, i])));
  res.json({ dias, ...r });
});

painel.get('/leads', async (req, res) => {
  const leads = leadsDe(await eventosDoPeriodo(req.user.id, diasDe(req.query))).reverse();
  const etapa = String(req.query.etapa || '');
  const filtrados = ['entrou', 'checkout', 'comprou'].includes(etapa) ? leads.filter(l => l.etapa === etapa) : leads;
  res.json({ total: filtrados.length, leads: filtrados.slice(0, 500) });
});

painel.get('/eventos', async (req, res) => {
  const eventos = await sql`
    select id, etapa, evento, lead, nome, valor, codigo, bruto, criado_em from funil_eventos
    where usuario_id = ${req.user.id} and etapa <> 'clique' order by criado_em desc limit 30`;
  res.json({ eventos });
});

module.exports = { publico, painel, leadsDe };
