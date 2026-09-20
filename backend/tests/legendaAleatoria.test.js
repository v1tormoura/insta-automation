'use strict';

/**
 * Legenda sorteada da biblioteca a cada post.
 *
 * O que estes testes protegem: a rotação (não repete em sequência enquanto
 * houver legenda; a mais antiga volta primeiro quando acaba), o sorteio por
 * rodada inteira (uma legenda por mídia, sem duplicar dentro da rodada), a
 * leitura tolerante da configuração vinda da tela, e o histórico curto que o
 * job guarda entre rodadas. Biblioteca vazia nunca derruba a publicação — o
 * chamador recebe `vazia` e cai na legenda da caixa.
 */

const {
  normalizar, lerDoCorpo, montar, sortear, sortearParaRodada, TAMANHO_DO_HISTORICO,
} = require('../src/services/legendaAleatoria');

const doc = (i, extra = {}) => ({ _id: `64a00000000000000000000${i}`, title: `L${i}`, text: `texto ${i}`, ...extra });
const docs = [1, 2, 3, 4, 5].map(i => doc(i));

/** Gerador determinístico (mulberry32) para o sorteio ser reproduzível. */
function aleatorioDe(semente) {
  let a = semente >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let x = a;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

describe('lerDoCorpo — o que a tela manda', () => {
  test('desligado, vazio ou estragado vira null (o job fica sem o campo)', () => {
    expect(lerDoCorpo(undefined)).toBeNull();
    expect(lerDoCorpo('')).toBeNull();
    expect(lerDoCorpo('false')).toBeNull();
    expect(lerDoCorpo('{"ativa":false}')).toBeNull();
    expect(lerDoCorpo('{nao e json')).toBeNull();
    expect(lerDoCorpo(42)).toBeNull();
  });

  test('ligado: categoria limpa, sufixo preservado com as quebras de linha', () => {
    const cfg = lerDoCorpo(JSON.stringify({ ativa: true, categoria: '  Viral ', sufixo: '\n\n🔗 Link na bio' }));
    expect(cfg).toEqual({ ativa: true, categoria: 'Viral', sufixo: '\n\n🔗 Link na bio' });
  });

  test('aceita objeto já parseado e "true" em string (FormData)', () => {
    expect(lerDoCorpo({ ativa: 'true' })).toEqual({ ativa: true, categoria: '', sufixo: '' });
  });

  test('sufixo e categoria têm teto de tamanho', () => {
    const cfg = lerDoCorpo({ ativa: true, categoria: 'x'.repeat(500), sufixo: 'y'.repeat(5000) });
    expect(cfg.categoria.length).toBeLessThanOrEqual(60);
    expect(cfg.sufixo.length).toBeLessThanOrEqual(300);
  });
});

describe('montar — o sufixo', () => {
  test('sem sufixo, o texto sai intacto; com sufixo, colado no fim', () => {
    expect(montar('oi', '')).toBe('oi');
    expect(montar('oi', '   ')).toBe('oi');
    expect(montar('oi', '\n\n🔗 Link na bio')).toBe('oi\n\n🔗 Link na bio');
    expect(montar(null, '')).toBe('');
  });
});

describe('sortear — a rotação', () => {
  test('biblioteca vazia ou pedido zero: nada', () => {
    expect(sortear([], 3)).toEqual([]);
    expect(sortear(docs, 0)).toEqual([]);
  });

  test('dentro da rodada não repete enquanto houver legenda', () => {
    const r = sortear(docs, 5, { aleatorio: aleatorioDe(7) });
    expect(new Set(r.map(d => d._id)).size).toBe(5);
  });

  test('as recém-usadas ficam para o fim: primeiro as frescas', () => {
    const evitar = [docs[0]._id, docs[1]._id];
    for (let s = 1; s <= 20; s++) {
      const r = sortear(docs, 3, { evitar, aleatorio: aleatorioDe(s) });
      expect(r.map(d => d._id)).not.toContain(docs[0]._id);
      expect(r.map(d => d._id)).not.toContain(docs[1]._id);
    }
  });

  test('quando as frescas acabam, volta a mais ANTIGA do histórico primeiro', () => {
    // Histórico em ordem cronológica: 1 (mais antiga) … 5 (mais recente).
    const evitar = docs.map(d => d._id);
    const r = sortear(docs, 2, { evitar, aleatorio: aleatorioDe(3) });
    expect(r.map(d => d._id)).toEqual([docs[0]._id, docs[1]._id]);
  });

  test('id repetido no histórico conta pela posição mais recente', () => {
    // 1 foi usada, depois 2, depois 1 de novo: a mais antiga de verdade é a 2.
    const evitar = [docs[0]._id, docs[1]._id, docs[0]._id];
    const r = sortear(docs.slice(0, 2), 2, { evitar, aleatorio: aleatorioDe(1) });
    expect(r.map(d => d._id)).toEqual([docs[1]._id, docs[0]._id]);
  });

  test('mais publicações do que legendas: cicla, sem quebrar', () => {
    const r = sortear(docs.slice(0, 2), 5, { aleatorio: aleatorioDe(9) });
    expect(r).toHaveLength(5);
    expect(r[0]._id).toBe(r[2]._id);
    expect(r[1]._id).toBe(r[3]._id);
  });

  test('ids do histórico que já não existem na biblioteca são ignorados', () => {
    const r = sortear(docs, 5, { evitar: ['inexistente', docs[2]._id], aleatorio: aleatorioDe(2) });
    expect(r).toHaveLength(5);
    expect(r[4]._id).toBe(docs[2]._id);   // a única evitada fica por último
  });

  test('o gerador é usado de verdade: sementes diferentes, ordens diferentes', () => {
    const a = sortear(docs, 5, { aleatorio: aleatorioDe(1) }).map(d => d._id).join();
    const b = sortear(docs, 5, { aleatorio: aleatorioDe(2) }).map(d => d._id).join();
    expect(a).not.toBe(b);
  });
});

describe('sortearParaRodada — a casca com o banco', () => {
  function fabricar(lista) {
    const chamadas = { filtro: null, updates: [] };
    const Legend = { find: filtro => { chamadas.filtro = filtro; return { select: () => ({ lean: async () => lista }) }; } };
    const Job = { updateOne: async (q, u) => { chamadas.updates.push({ q, u }); } };
    return { Legend, Job, chamadas };
  }

  test('job sem o pedido devolve null e não toca no banco', async () => {
    const f = fabricar(docs);
    expect(await sortearParaRodada({ _id: 'J' }, 2, f)).toBeNull();
    expect(await sortearParaRodada({ _id: 'J', legendaAleatoria: { ativa: false } }, 2, f)).toBeNull();
    expect(f.chamadas.filtro).toBeNull();
    expect(f.chamadas.updates).toHaveLength(0);
  });

  test('só ativas, e na categoria pedida quando houver', async () => {
    const f = fabricar(docs);
    await sortearParaRodada({ _id: 'J', legendaAleatoria: { ativa: true, categoria: 'Viral' } }, 1, f);
    expect(f.chamadas.filtro).toEqual({ isActive: true, category: 'Viral' });
    const g = fabricar(docs);
    await sortearParaRodada({ _id: 'J', legendaAleatoria: { ativa: true } }, 1, g);
    expect(g.chamadas.filtro).toEqual({ isActive: true });
  });

  test('biblioteca vazia: `vazia`, sem gravar histórico — o worker cai na legenda da caixa', async () => {
    const f = fabricar([]);
    const r = await sortearParaRodada({ _id: 'J', legendaAleatoria: { ativa: true } }, 3, f);
    expect(r).toEqual({ vazia: true, legendas: [] });
    expect(f.chamadas.updates).toHaveLength(0);
  });

  test('uma legenda por mídia, com sufixo, e o histórico gravado no job', async () => {
    const f = fabricar(docs);
    const job = { _id: 'J', legendaAleatoria: { ativa: true, sufixo: '\n\n🔗 Link na bio', ultimas: [docs[0]._id] } };
    const r = await sortearParaRodada(job, 3, { ...f, aleatorio: aleatorioDe(5) });
    expect(r.vazia).toBe(false);
    expect(r.legendas).toHaveLength(3);
    for (const l of r.legendas) {
      expect(l.texto.endsWith('\n\n🔗 Link na bio')).toBe(true);
      expect(l.id).not.toBe(docs[0]._id);   // a última usada não volta já
    }
    expect(f.chamadas.updates).toHaveLength(1);
    const { q, u } = f.chamadas.updates[0];
    expect(q).toEqual({ _id: 'J' });
    expect(u.$set['legendaAleatoria.ultimas']).toEqual([docs[0]._id, ...r.legendas.map(l => l.id)]);
  });

  test('o histórico não cresce sem limite', async () => {
    const f = fabricar(docs);
    const ultimas = Array.from({ length: 40 }, (_, i) => docs[i % 5]._id);
    const job = { _id: 'J', legendaAleatoria: { ativa: true, ultimas } };
    await sortearParaRodada(job, 2, f);
    expect(f.chamadas.updates[0].u.$set['legendaAleatoria.ultimas']).toHaveLength(TAMANHO_DO_HISTORICO);
  });

  test('normalizar aceita o doc do Mongo com `ultimas` ausente', () => {
    expect(normalizar({ ativa: true }).ultimas).toEqual([]);
    expect(normalizar(null).ativa).toBe(false);
  });
});
