'use strict';

/** Funil: o webhook entende formatos diferentes de bot, e o link liga o lead à conta. */

const http = require('http');
const banco = require('./helpers/banco');
const { sql } = banco;
const funil = require('../src/services/funil');

describe('normalizar (formatos diferentes de bot)', () => {
  test('entrou no bot, com o código do link no start', () => {
    const e = funil.normalizar({ event: 'bot_started', user: { id: 777, first_name: 'Ana', username: '@ana' }, start_param: 'nxab12cd' });
    expect(e).toMatchObject({ etapa: 'entrou', lead: '777', nome: 'Ana', username: 'ana', codigo: 'nxab12cd' });
  });
  test('PIX gerado é checkout, não compra', () => {
    expect(funil.normalizar({ type: 'payment', status: 'pending', chat_id: 9, amount: 29.9 }).etapa).toBe('checkout');
    expect(funil.normalizar({ evento: 'pix_gerado', telegram_id: 9 }).etapa).toBe('checkout');
  });
  test('pagamento aprovado é compra, com valor em centavos convertido', () => {
    const e = funil.normalizar({ data: { status: 'approved', customer: { email: 'a@b.com', name: 'Bia' }, amount_cents: 4990, plan: { name: 'VIP Mensal' } } });
    expect(e).toMatchObject({ etapa: 'comprou', lead: 'a@b.com', nome: 'Bia', valor: 49.9 });
  });
  test('reembolso e recusa não contam como compra', () => {
    expect(funil.normalizar({ status: 'refunded' }).etapa).not.toBe('comprou');
    expect(funil.normalizar({ status: 'payment_refused' }).etapa).not.toBe('comprou');
  });
  test('link do Telegram ganha ?start=<codigo>', () => {
    expect(funil.destinoComCodigo('https://t.me/meubot', 'nxab12cd')).toBe('https://t.me/meubot?start=nxab12cd');
    expect(funil.destinoComCodigo('t.me/meubot?start=x', 'nxab12cd')).toBe('https://t.me/meubot?start=x');
  });
});

describe('ponta a ponta', () => {
  let srv, base, token, codigo;
  beforeAll(async () => {
    await banco.limpar();
    const express = require('express');
    const rotas = require('../src/routes/funilRoutes');
    const app = express();
    app.use(rotas.publico);
    app.use('/funil', (req, _res, next) => { req.user = { id: banco.DONO_ID }; next(); }, express.json(), rotas.painel);
    srv = http.createServer(app).listen(0);
    base = `http://127.0.0.1:${srv.address().port}`;
  });
  afterAll(async () => { srv.close(); await sql.end(); });

  const pedir = (caminho, opcoes = {}) => fetch(base + caminho, { redirect: 'manual', headers: { 'content-type': 'application/json' }, ...opcoes });

  test('link → clique → entrou → checkout → comprou, atribuído à origem', async () => {
    const cfg = await (await pedir('/funil/config')).json();
    token = cfg.webhook.split('/').pop();
    const link = await (await pedir('/funil/links', { method: 'POST', body: JSON.stringify({ destino: 'https://t.me/meubot', rotulo: 'Bio da conta A' }) })).json();
    codigo = link.codigo;
    expect(codigo).toMatch(funil.PADRAO_CODIGO);

    const r = await pedir(`/r/${codigo}`);
    expect(r.status).toBe(302);
    expect(r.headers.get('location')).toBe(`https://t.me/meubot?start=${codigo}`);

    const hook = corpo => pedir(`/funil/webhook/${token}`, { method: 'POST', body: JSON.stringify(corpo) }).then(x => x.json());
    expect((await hook({ event: 'start', user_id: 1, first_name: 'Ana', start: codigo })).etapa).toBe('entrou');
    await hook({ event: 'start', user_id: 2, first_name: 'Beto', start: codigo });
    await hook({ event: 'start', user_id: 3, first_name: 'Caio' });
    await hook({ event: 'checkout', user_id: 1 });
    await hook({ event: 'checkout', user_id: 2 });
    const compra = await hook({ status: 'approved', user_id: 1, value: '29,90' });
    expect(compra).toMatchObject({ etapa: 'comprou', codigo }); // herdou o código de quando entrou

    const resumo = await (await pedir('/funil/resumo?dias=7')).json();
    expect(resumo.etapas).toEqual({ cliques: 1, entrou: 3, checkout: 2, comprou: 1 });
    expect(resumo.receita).toBe(29.9);
    expect(resumo.ticketMedio).toBe(29.9);
    expect(resumo.serie).toHaveLength(7);
    expect(resumo.hoje).toMatchObject({ cliques: 1, entrou: 3, checkout: 2, comprou: 1, receita: 29.9 });
    expect(resumo.origens.find(o => o.origem === 'Bio da conta A')).toMatchObject({ cliques: 1, entrou: 2, checkout: 2, comprou: 1 });

    const parados = await (await pedir('/funil/leads?dias=7&etapa=checkout')).json();
    expect(parados.leads.map(l => l.nome)).toEqual(['Beto']);
    await new Promise(r => setTimeout(r, 300));
    // Só a venda avisa por padrão (lead e clique em comprar ficam desligados).
    const avisos = await sql`select titulo, mensagem from notificacoes where usuario_id = ${banco.DONO_ID} and event_type = 'funil'`;
    expect(avisos.map(a => [a.titulo, a.mensagem.replace(/\s/g, ' ')])).toEqual([['Venda no funil 💰', 'Ana comprou o plano · R$ 29,90 — veio de Bio da conta A.']]);
  });

  test('/por-conteudo: a venda vai para a última publicação da conta antes do lead', async () => {
    const [conta] = await sql`insert into accounts ${sql({ usuarioId: banco.DONO_ID, username: 'contaa', igUserId: 'igA' })} returning id`;
    const link = await (await pedir('/funil/links', { method: 'POST', body: JSON.stringify({ destino: 'https://t.me/bot', accountId: conta.id }) })).json();
    const [job] = await sql`insert into jobs ${sql({ usuarioId: banco.DONO_ID, name: 'Lote X', rotulo: 'Original' })} returning id`;
    const antes = new Date(Date.now() - 3_600_000).toISOString();
    await sql`insert into posts ${sql({ usuarioId: banco.DONO_ID, media: 'x.mp4', jobId: job.id, jobName: 'Lote X',
      midiasPublicadas: sql.json([{ accountId: conta.id, igMediaId: 'REEL9', em: antes }]) })}`;
    const hook = corpo => pedir(`/funil/webhook/${token}`, { method: 'POST', body: JSON.stringify(corpo) });
    await hook({ event: 'start', user_id: 77, first_name: 'Eva', start: link.codigo });
    await hook({ status: 'approved', user_id: 77, amount: 40 });
    const r = await (await pedir('/funil/por-conteudo?dias=7')).json();
    expect(r.reels.find(x => x.igMediaId === 'REEL9')).toMatchObject({ vendas: 1, receita: 40, rotulo: 'Original', jobName: 'Lote X' });
    expect(r.porEtiqueta.find(e => e.chave === 'Original').receita).toBe(40);
  });

  test('o texto editado em Notificações é o que sai', async () => {
    await require('../src/repos/settings').gravar(`smartActivity:${banco.DONO_ID}`, {
      ativos: { vendaWebhook: true, leadWebhook: true },
      mensagens: { vendaWebhook: { titulo: 'Caiu venda!', mensagem: '{{valor}} de {{cliente}}' } },
    });
    await sql`delete from notificacoes where usuario_id = ${banco.DONO_ID}`;
    const hook = corpo => pedir(`/funil/webhook/${token}`, { method: 'POST', body: JSON.stringify(corpo) });
    await hook({ event: 'start', user_id: 9, first_name: 'Duda' });
    await hook({ status: 'approved', user_id: 9, amount: 10 });
    await new Promise(r => setTimeout(r, 300));
    const avisos = await sql`select titulo, mensagem from notificacoes where usuario_id = ${banco.DONO_ID} and event_type = 'funil' order by criada_em`;
    expect(avisos.map(a => a.titulo)).toEqual(['Novo lead no bot 👋', 'Caiu venda!']);
    expect(avisos[1].mensagem.replace(/\s/g, ' ')).toBe('R$ 10,00 de Duda');
  });

  test('token errado: 404', async () => {
    expect((await pedir('/funil/webhook/errado', { method: 'POST', body: '{}' })).status).toBe(404);
  });
});

