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

const doc = (i, extra = {}) => ({ id: `64a00000000000000000000${i}`, title: `L${i}`, text: `texto ${i}`, ...extra });
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
    expect(new Set(r.map(d => d.id)).size).toBe(5);
  });

  test('as recém-usadas ficam para o fim: primeiro as frescas', () => {
    const evitar = [docs[0].id, docs[1].id];
    for (let s = 1; s <= 20; s++) {
      const r = sortear(docs, 3, { evitar, aleatorio: aleatorioDe(s) });
      expect(r.map(d => d.id)).not.toContain(docs[0].id);
      expect(r.map(d => d.id)).not.toContain(docs[1].id);
    }
  });

  test('quando as frescas acabam, volta a mais ANTIGA do histórico primeiro', () => {
    // Histórico em ordem cronológica: 1 (mais antiga) … 5 (mais recente).
    const evitar = docs.map(d => d.id);
    const r = sortear(docs, 2, { evitar, aleatorio: aleatorioDe(3) });
    expect(r.map(d => d.id)).toEqual([docs[0].id, docs[1].id]);
  });

  test('id repetido no histórico conta pela posição mais recente', () => {
    // 1 foi usada, depois 2, depois 1 de novo: a mais antiga de verdade é a 2.
    const evitar = [docs[0].id, docs[1].id, docs[0].id];
    const r = sortear(docs.slice(0, 2), 2, { evitar, aleatorio: aleatorioDe(1) });
    expect(r.map(d => d.id)).toEqual([docs[1].id, docs[0].id]);
  });

  test('mais publicações do que legendas: cicla, sem quebrar', () => {
    const r = sortear(docs.slice(0, 2), 5, { aleatorio: aleatorioDe(9) });
    expect(r).toHaveLength(5);
    expect(r[0].id).toBe(r[2].id);
    expect(r[1].id).toBe(r[3].id);
  });

  test('ids do histórico que já não existem na biblioteca são ignorados', () => {
    const r = sortear(docs, 5, { evitar: ['inexistente', docs[2].id], aleatorio: aleatorioDe(2) });
    expect(r).toHaveLength(5);
    expect(r[4].id).toBe(docs[2].id);   // a única evitada fica por último
  });

  test('o gerador é usado de verdade: sementes diferentes, ordens diferentes', () => {
    const a = sortear(docs, 5, { aleatorio: aleatorioDe(1) }).map(d => d.id).join();
    const b = sortear(docs, 5, { aleatorio: aleatorioDe(2) }).map(d => d.id).join();
    expect(a).not.toBe(b);
  });
});

describe('sortearParaRodada — com o banco', () => {
  const banco = require('./helpers/banco');
  beforeEach(() => banco.limpar());

  async function preparar() {
    const viral = await Promise.all([1, 2, 3, 4].map(i => banco.criarLegenda({ title: `v${i}`, text: `viral ${i}`, category: 'Viral' })));
    const outra = await banco.criarLegenda({ title: 'g', text: 'geral', category: 'Geral' });
    await banco.criarLegenda({ title: 'x', text: 'inativa', category: 'Viral', isActive: false });
    return { viral, outra };
  }

  test('job sem o pedido devolve null', async () => {
    expect(await sortearParaRodada({ id: 'J' }, 2)).toBeNull();
    expect(await sortearParaRodada({ id: 'J', legendaAleatoria: { ativa: false } }, 2)).toBeNull();
  });

  test('só ativas, e na categoria pedida quando houver', async () => {
    const { viral, outra } = await preparar();
    const job = await banco.criarJob({ legendaAleatoria: { ativa: true, categoria: 'Viral' } });
    const r = await sortearParaRodada(job, 4);
    expect(r.legendas.map(l => l.id).sort()).toEqual(viral.map(v => v.id).sort());
    const semCategoria = await banco.criarJob({ legendaAleatoria: { ativa: true } });
    const todas = await sortearParaRodada(semCategoria, 5);
    expect(todas.legendas.map(l => l.id)).toContain(outra.id);
    expect(todas.legendas.map(l => l.texto)).not.toContain('inativa');
  });

  test('biblioteca vazia: `vazia`, sem gravar histórico — o worker cai na legenda da caixa', async () => {
    const job = await banco.criarJob({ legendaAleatoria: { ativa: true } });
    expect(await sortearParaRodada(job, 3)).toEqual({ vazia: true, legendas: [] });
    const [j] = await banco.sql`select legenda_aleatoria from jobs where id = ${job.id}`;
    expect(j.legendaAleatoria.ultimas).toBeUndefined();
  });

  test('uma legenda por mídia, com sufixo, e o histórico gravado no job', async () => {
    const { viral } = await preparar();
    const job = await banco.criarJob({
      legendaAleatoria: { ativa: true, categoria: 'Viral', sufixo: '\n\n🔗 Link na bio', ultimas: [viral[0].id] },
    });
    const r = await sortearParaRodada(job, 3, { aleatorio: aleatorioDe(5) });
    expect(r.vazia).toBe(false);
    expect(r.legendas).toHaveLength(3);
    for (const l of r.legendas) {
      expect(l.texto.endsWith('\n\n🔗 Link na bio')).toBe(true);
      expect(l.id).not.toBe(viral[0].id);   // a última usada não volta já
    }
    const [j] = await banco.sql`select legenda_aleatoria from jobs where id = ${job.id}`;
    expect(j.legendaAleatoria.ultimas).toEqual([viral[0].id, ...r.legendas.map(l => l.id)]);
  });

  test('o histórico não cresce sem limite', async () => {
    const { viral } = await preparar();
    const ultimas = Array.from({ length: 40 }, (_, i) => viral[i % 4].id);
    const job = await banco.criarJob({ legendaAleatoria: { ativa: true, ultimas } });
    await sortearParaRodada(job, 2);
    const [j] = await banco.sql`select legenda_aleatoria from jobs where id = ${job.id}`;
    expect(j.legendaAleatoria.ultimas).toHaveLength(TAMANHO_DO_HISTORICO);
  });

  test('normalizar aceita a configuração com `ultimas` ausente', () => {
    expect(normalizar({ ativa: true }).ultimas).toEqual([]);
    expect(normalizar(null).ativa).toBe(false);
  });
});
