'use strict';

/**
 * Receita por Reel — que publicação trouxe a venda.
 *
 * ── O limite que define o método
 *
 * O Instagram não deixa link clicável no Reel (nem na legenda, nem nos
 * comentários): a pessoa vê o Reel, vai ao perfil e clica no link da bio. A
 * venda chega com a CONTA (o link rastreado da bio), nunca com o Reel.
 *
 * ── Atribuição: último toque
 *
 * O lead vai para a ÚLTIMA publicação daquela conta antes de a pessoa entrar
 * no bot, dentro de JANELA_H. É o mesmo "último toque" das ferramentas de
 * anúncio — uma estimativa honesta, e a tela diz que é. Lead sem conta (link
 * sem conta, ou bot sem o código) ou sem publicação na janela fica em
 * "sem atribuição", contado à parte em vez de inventado.
 *
 * Só função pura aqui; quem consulta o banco é a rota.
 */

const JANELA_H = 72;
const ORDEM = { entrou: 1, checkout: 2, comprou: 3 };

/**
 * @param {object[]} leads          { contaId, primeiro, etapa, valor }
 * @param {object[]} publicacoes    { accountId, igMediaId, em, jobId, jobName, rotulo }
 * @param {Map<string, object>} insights  igMediaId → { reach, videoViews, permalink, thumbnailUrl, caption, username }
 */
function atribuir(leads, publicacoes, insights = new Map(), { janelaH = JANELA_H } = {}) {
  const porConta = new Map();
  for (const p of publicacoes) {
    if (!p.accountId || !p.igMediaId || !p.em) continue;
    const l = porConta.get(p.accountId) || [];
    l.push({ ...p, t: new Date(p.em).getTime() });
    porConta.set(p.accountId, l);
  }
  for (const l of porConta.values()) l.sort((a, b) => a.t - b.t);

  const janelaMs = janelaH * 3_600_000;
  const reels = new Map();
  const vazio = () => ({ leads: 0, checkout: 0, vendas: 0, receita: 0 });
  const semAtribuicao = vazio();
  const somar = (alvo, lead) => {
    alvo.leads++;
    if (ORDEM[lead.etapa] >= 2) alvo.checkout++;
    if (lead.etapa === 'comprou') { alvo.vendas++; alvo.receita = Math.round((alvo.receita + (Number(lead.valor) || 0)) * 100) / 100; }
  };

  for (const lead of leads) {
    const t = new Date(lead.primeiro).getTime();
    const lista = lead.contaId ? porConta.get(lead.contaId) : null;
    let escolhida = null;
    if (lista) {
      for (let i = lista.length - 1; i >= 0; i--) {
        if (lista[i].t <= t) { if (t - lista[i].t <= janelaMs) escolhida = lista[i]; break; }
      }
    }
    if (!escolhida) { somar(semAtribuicao, lead); continue; }
    const r = reels.get(escolhida.igMediaId) || {
      igMediaId: escolhida.igMediaId, accountId: escolhida.accountId, publicadoEm: escolhida.em,
      jobId: escolhida.jobId || null, jobName: escolhida.jobName || '', rotulo: escolhida.rotulo || '', ...vazio(),
    };
    somar(r, lead);
    reels.set(escolhida.igMediaId, r);
  }

  const lista = [...reels.values()].map(r => {
    const i = insights.get(r.igMediaId) || {};
    const alcance = Number(i.reach) || 0;
    return {
      ...r,
      username: i.username || '', permalink: i.permalink || '', thumbnailUrl: i.thumbnailUrl || '',
      legenda: String(i.caption || '').slice(0, 90), alcance, views: Number(i.videoViews) || 0,
      /* Receita a cada mil pessoas alcançadas: compara reels de tamanhos diferentes. */
      receitaPor1k: alcance ? Math.round((r.receita / alcance) * 1000 * 100) / 100 : null,
      conversao: r.leads ? Math.round((r.vendas / r.leads) * 100) : null,
    };
  }).sort((a, b) => b.receita - a.receita || b.vendas - a.vendas || b.leads - a.leads);

  const agrupar = chave => {
    const g = new Map();
    for (const r of lista) {
      const k = chave(r);
      const x = g.get(k) || { chave: k, reels: 0, alcance: 0, ...vazio() };
      x.reels++; x.alcance += r.alcance; x.leads += r.leads; x.checkout += r.checkout; x.vendas += r.vendas;
      x.receita = Math.round((x.receita + r.receita) * 100) / 100;
      g.set(k, x);
    }
    return [...g.values()].map(x => ({ ...x, receitaPor1k: x.alcance ? Math.round((x.receita / x.alcance) * 1000 * 100) / 100 : null }))
      .sort((a, b) => b.receita - a.receita || b.vendas - a.vendas);
  };

  const total = leads.length;
  return {
    janelaH,
    reels: lista,
    porEtiqueta: agrupar(r => r.rotulo || ''),
    porEnvio: agrupar(r => r.jobId || '').map(x => ({ ...x, jobName: lista.find(r => (r.jobId || '') === x.chave)?.jobName || '' })),
    semAtribuicao,
    cobertura: total ? Math.round(((total - semAtribuicao.leads) / total) * 100) : null,
  };
}

module.exports = { atribuir, JANELA_H };
