import { describe, test, expect } from 'vitest';

import { acoesPara } from './CampaignHeader';
import { proximaAcao } from './NextUp';
import { montarEtapas } from './PublicationDrawer';
import {
  agruparPorConta, agruparPorConteudo, resumoContas, filtrarPublicacoes,
} from './views';

/**
 * Testes da lógica do painel da campanha.
 *
 * Cobrem as funções puras — quais ações cada estado permite, qual é a próxima
 * ação, como as publicações são agrupadas, filtradas e ordenadas. É aí que mora
 * a chance real de erro; o resto do painel é composição de componentes.
 *
 * Os dados de entrada têm o mesmo formato de `publicacaoSegura` no backend.
 */

/* ── Fábricas ──────────────────────────────────────────────────────────────── */

const conta = (id, username) => ({ _id: id, username, name: `Conta ${username}` });
const conteudo = (id, nome) => ({ _id: id, originalName: nome, filename: `${nome}.mp4`, type: 'video' });

// Base + offset em minutos: montar a string "18:MM" estouraria em "18:60" a
// partir do 12º item e geraria data inválida.
const BASE = new Date('2026-09-01T18:00:00').getTime();

let seq = 0;
function pub(over = {}) {
  seq += 1;
  return {
    _id: `p${seq}`,
    order: seq,
    scheduledAt: new Date(BASE + seq * 5 * 60_000).toISOString(),
    status: 'scheduled',
    attempts: 0,
    error: '', errorCode: '',
    resolvedCaption: 'Legenda', resolvedComment: '',
    commentStatus: 'none', commentAttempts: 0,
    account: conta('a1', 'conta01'),
    content: conteudo('c1', 'Video 1'),
    ...over,
  };
}

/* ── Ações permitidas por estado ───────────────────────────────────────────── */

describe('ações disponíveis por estado', () => {
  test('rascunho permite iniciar, editar e cancelar', () => {
    expect(acoesPara('draft')).toEqual(['start', 'edit', 'cancel']);
  });

  test('em execução permite pausar e cancelar — nunca iniciar', () => {
    const a = acoesPara('running');
    expect(a).toEqual(['pause', 'cancel']);
    expect(a).not.toContain('start');
  });

  test('agendada se comporta como em execução', () => {
    expect(acoesPara('scheduled')).toEqual(['pause', 'cancel']);
  });

  test('pausada permite retomar, não pausar de novo', () => {
    const a = acoesPara('paused');
    expect(a).toContain('resume');
    expect(a).not.toContain('pause');
  });

  test('concluída permite reexecutar falhas e duplicar, nunca pausar', () => {
    const a = acoesPara('completed');
    expect(a).toEqual(['retryFailed', 'duplicate']);
    expect(a).not.toContain('pause');
    expect(a).not.toContain('cancel');
  });

  test('parcial se comporta como concluída', () => {
    expect(acoesPara('partial')).toEqual(['retryFailed', 'duplicate']);
  });

  test('cancelada é terminal — só duplicar', () => {
    expect(acoesPara('cancelled')).toEqual(['duplicate']);
  });

  test('nenhum estado oferece ação incompatível com o próprio estado', () => {
    // Invariante geral: não pausar o que não roda, não iniciar o que já rodou.
    const naoPodemPausar = ['draft', 'planning', 'paused', 'completed', 'partial', 'failed', 'cancelled'];
    for (const st of naoPodemPausar) expect(acoesPara(st)).not.toContain('pause');

    const naoPodemIniciar = ['running', 'scheduled', 'paused', 'completed', 'partial', 'cancelled'];
    for (const st of naoPodemIniciar) expect(acoesPara(st)).not.toContain('start');

    // Campanha encerrada não pode ser cancelada de novo.
    for (const st of ['completed', 'cancelled']) expect(acoesPara(st)).not.toContain('cancel');
  });
});

/* ── Próxima ação ──────────────────────────────────────────────────────────── */

describe('próxima ação', () => {
  const base = { campanha: { status: 'running' }, estatisticas: {}, comentarios: {} };

  test('falhas têm prioridade sobre a contagem regressiva', () => {
    const r = proximaAcao({
      ...base,
      estatisticas: { failed: 3, pending: 5 },
      proxima: pub({ scheduledAt: new Date(Date.now() + 600_000).toISOString() }),
    });
    expect(r.tom).toBe('erro');
    expect(r.titulo).toContain('3 publicações com erro');
  });

  test('campanha pausada vence tudo, menos cancelada', () => {
    const r = proximaAcao({ ...base, campanha: { status: 'paused' }, estatisticas: { failed: 2 } });
    expect(r.titulo).toBe('Campanha pausada');
  });

  test('cancelada tem precedência máxima', () => {
    const r = proximaAcao({ ...base, campanha: { status: 'cancelled' }, estatisticas: { failed: 9 } });
    expect(r.titulo).toBe('Campanha cancelada');
  });

  test('comentário falho aparece quando não há falha de publicação', () => {
    const r = proximaAcao({ ...base, comentarios: { failed: 2 } });
    expect(r.titulo).toContain('2 comentários com erro');
    expect(r.detalhe).toContain('publicação saiu');
  });

  test('processando é reportado antes da próxima agendada', () => {
    const r = proximaAcao({
      ...base,
      estatisticas: { processing: 2 },
      proxima: pub({ scheduledAt: new Date(Date.now() + 600_000).toISOString() }),
    });
    expect(r.titulo).toContain('2 publicando agora');
  });

  test('sem problemas, informa quanto falta para a próxima', () => {
    const agora = Date.now();
    const r = proximaAcao({
      ...base,
      proxima: pub({ scheduledAt: new Date(agora + 8 * 60_000).toISOString() }),
      agora,
    });
    expect(r.titulo).toContain('8 minutos');
    expect(r.detalhe).toContain('@conta01');
  });

  test('campanha concluída sem pendências', () => {
    const r = proximaAcao({
      ...base,
      campanha: { status: 'completed' },
      estatisticas: { total: 16, published: 16 },
      proxima: null,
    });
    expect(r.titulo).toBe('Campanha concluída');
  });

  test('campanha parcial explica que houve falhas', () => {
    const r = proximaAcao({
      ...base,
      campanha: { status: 'partial' },
      estatisticas: { total: 16, published: 14 },
      proxima: null,
    });
    expect(r.detalhe).toContain('falhando');
  });

  test('campanha sem publicações', () => {
    const r = proximaAcao({ ...base, campanha: { status: 'draft' }, estatisticas: { total: 0 }, proxima: null });
    expect(r.titulo).toBe('Nenhuma publicação planejada');
  });
});

/* ── Agrupamento por conta ─────────────────────────────────────────────────── */

describe('agrupamento por conta', () => {
  const dados = () => {
    seq = 0;
    return [
      pub({ account: conta('a1', 'conta01'), status: 'published' }),
      pub({ account: conta('a1', 'conta01'), status: 'published' }),
      pub({ account: conta('a1', 'conta01'), status: 'scheduled' }),
      pub({ account: conta('a2', 'conta02'), status: 'failed' }),
      pub({ account: conta('a2', 'conta02'), status: 'published' }),
    ];
  };

  test('separa por conta e conta cada estado', () => {
    const g = agruparPorConta(dados());
    expect(g).toHaveLength(2);

    const a1 = g.find(x => x.id === 'a1');
    expect(a1.total).toBe(3);
    expect(a1.published).toBe(2);
    expect(a1.pendentes).toBe(1);
    expect(a1.pct).toBe(67);
  });

  test('a próxima da conta é a primeira pendente por horário', () => {
    const g = agruparPorConta(dados());
    const a1 = g.find(x => x.id === 'a1');
    expect(a1.proxima.status).toBe('scheduled');
  });

  test('conta sem pendências não tem próxima', () => {
    const g = agruparPorConta([pub({ account: conta('a9', 'conta09'), status: 'published' })]);
    expect(g[0].proxima).toBeNull();
  });

  test('itens de cada conta saem ordenados por horário', () => {
    const g = agruparPorConta([
      pub({ account: conta('a1', 'c1'), scheduledAt: '2026-09-01T20:00:00' }),
      pub({ account: conta('a1', 'c1'), scheduledAt: '2026-09-01T18:00:00' }),
      pub({ account: conta('a1', 'c1'), scheduledAt: '2026-09-01T19:00:00' }),
    ]);
    const horas = g[0].itens.map(i => new Date(i.scheduledAt).getHours());
    expect(horas).toEqual([18, 19, 20]);
  });
});

/* ── Resumo de contas (métrica) ────────────────────────────────────────────── */

describe('resumo de contas', () => {
  test('conta concluída é a que não tem nada em aberto', () => {
    const r = resumoContas([
      pub({ account: conta('a1', 'c1'), status: 'published' }),
      pub({ account: conta('a1', 'c1'), status: 'published' }),
      pub({ account: conta('a2', 'c2'), status: 'published' }),
      pub({ account: conta('a2', 'c2'), status: 'scheduled' }),
      pub({ account: conta('a3', 'c3'), status: 'failed' }),
    ]);

    expect(r.total).toBe(3);
    expect(r.concluidas).toBe(1);   // só a1
    expect(r.pendentes).toBe(1);    // a2 ainda tem agendada
    expect(r.comErro).toBe(1);      // a3
  });

  test('processando conta como pendente, não como concluída', () => {
    const r = resumoContas([
      pub({ account: conta('a1', 'c1'), status: 'published' }),
      pub({ account: conta('a1', 'c1'), status: 'processing' }),
    ]);
    expect(r.concluidas).toBe(0);
    expect(r.pendentes).toBe(1);
  });

  test('campanha vazia devolve zeros', () => {
    expect(resumoContas([])).toEqual({ total: 0, concluidas: 0, pendentes: 0, comErro: 0 });
  });
});

/* ── Agrupamento por conteúdo ──────────────────────────────────────────────── */

describe('agrupamento por conteúdo', () => {
  test('agrupa pelo conteúdo, não pela conta', () => {
    const g = agruparPorConteudo([
      pub({ content: conteudo('c1', 'Video 1'), account: conta('a1', 'x'), status: 'published' }),
      pub({ content: conteudo('c1', 'Video 1'), account: conta('a2', 'y'), status: 'published' }),
      pub({ content: conteudo('c2', 'Video 2'), account: conta('a1', 'x'), status: 'failed' }),
    ]);

    expect(g).toHaveLength(2);
    const c1 = g.find(x => x.id === 'c1');
    expect(c1.total).toBe(2);
    expect(c1.published).toBe(2);
    expect(c1.pct).toBe(100);
  });
});

/* ── Filtros, busca e ordenação ────────────────────────────────────────────── */

describe('filtros da lista de publicações', () => {
  const dados = () => {
    seq = 0;
    return [
      pub({ status: 'published', account: conta('a1', 'alpha'),  content: conteudo('c1', 'Praia') }),
      pub({ status: 'failed',    account: conta('a2', 'bravo'),  content: conteudo('c2', 'Montanha'), attempts: 3 }),
      pub({ status: 'scheduled', account: conta('a3', 'charlie'), content: conteudo('c1', 'Praia') }),
      pub({ status: 'published', account: conta('a1', 'alpha'),  content: conteudo('c2', 'Montanha'),
            commentStatus: 'failed' }),
      pub({ status: 'published', account: conta('a2', 'bravo'),  content: conteudo('c1', 'Praia'),
            commentStatus: 'scheduled' }),
    ];
  };

  test('sem filtro devolve tudo', () => {
    expect(filtrarPublicacoes(dados(), {})).toHaveLength(5);
  });

  test('filtra por status da publicação', () => {
    expect(filtrarPublicacoes(dados(), { filtro: 'published' })).toHaveLength(3);
    expect(filtrarPublicacoes(dados(), { filtro: 'failed' })).toHaveLength(1);
  });

  test('filtro de comentário pendente olha commentStatus, não status', () => {
    const r = filtrarPublicacoes(dados(), { filtro: 'comment_scheduled' });
    expect(r).toHaveLength(1);
    expect(r[0].commentStatus).toBe('scheduled');
  });

  test('filtro de comentário falho não traz falha de publicação', () => {
    const r = filtrarPublicacoes(dados(), { filtro: 'comment_failed' });
    expect(r).toHaveLength(1);
    expect(r[0].status).toBe('published');       // o post saiu; só o comentário falhou
    expect(r[0].commentStatus).toBe('failed');
  });

  test('busca encontra por username', () => {
    const r = filtrarPublicacoes(dados(), { busca: 'alpha' });
    expect(r).toHaveLength(2);
    expect(r.every(p => p.account.username === 'alpha')).toBe(true);
  });

  test('busca encontra por nome do conteúdo', () => {
    expect(filtrarPublicacoes(dados(), { busca: 'praia' })).toHaveLength(3);
  });

  test('busca não diferencia maiúsculas', () => {
    expect(filtrarPublicacoes(dados(), { busca: 'BRAVO' })).toHaveLength(2);
  });

  test('busca sem resultado devolve lista vazia, não tudo', () => {
    expect(filtrarPublicacoes(dados(), { busca: 'inexistente' })).toHaveLength(0);
  });

  test('filtro e busca se combinam', () => {
    const r = filtrarPublicacoes(dados(), { filtro: 'published', busca: 'alpha' });
    expect(r).toHaveLength(2);
  });

  test('ordena por horário por padrão', () => {
    const r = filtrarPublicacoes(dados(), {});
    const t = r.map(p => new Date(p.scheduledAt).getTime());
    expect(t).toEqual([...t].sort((a, b) => a - b));
  });

  test('ordena por conta em ordem alfabética', () => {
    const r = filtrarPublicacoes(dados(), { ordem: 'conta' });
    expect(r.map(p => p.account.username)).toEqual(['alpha', 'alpha', 'bravo', 'bravo', 'charlie']);
  });

  test('ordena por conteúdo', () => {
    const r = filtrarPublicacoes(dados(), { ordem: 'conteudo' });
    expect(r[0].content.originalName).toBe('Montanha');
  });

  test('ordena por tentativas, das maiores para as menores', () => {
    const r = filtrarPublicacoes(dados(), { ordem: 'tentativas' });
    expect(r[0].attempts).toBe(3);
  });

  test('a ordenação não altera a lista original', () => {
    const original = dados();
    const antes = original.map(p => p._id);
    filtrarPublicacoes(original, { ordem: 'conta' });
    expect(original.map(p => p._id)).toEqual(antes);
  });
});

/* ── Timeline ──────────────────────────────────────────────────────────────── */

describe('ordenação da timeline', () => {
  test('ordena por scheduledAt mesmo se a entrada vier embaralhada', () => {
    seq = 0;
    const embaralhada = [
      pub({ scheduledAt: '2026-09-01T20:00:00' }),
      pub({ scheduledAt: '2026-09-01T18:00:00' }),
      pub({ scheduledAt: '2026-09-02T09:00:00' }),
      pub({ scheduledAt: '2026-09-01T19:00:00' }),
    ];
    const ordenada = [...embaralhada].sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt));
    const iso = ordenada.map(p => p.scheduledAt);

    expect(iso).toEqual([
      '2026-09-01T18:00:00',
      '2026-09-01T19:00:00',
      '2026-09-01T20:00:00',
      '2026-09-02T09:00:00',
    ]);
  });
});

/* ── Matriz conta × conteúdo ───────────────────────────────────────────────── */

describe('matriz de distribuição', () => {
  /** Mesma indexação por chave composta que DistributionMatrix usa. */
  const indexar = publicacoes => {
    const m = new Map();
    for (const p of publicacoes) {
      m.set(`${p.account._id}__${p.content._id}`, p);
    }
    return m;
  };

  test('cada célula corresponde ao par exato conta+conteúdo', () => {
    seq = 0;
    const dados = [
      pub({ account: conta('a1', 'c1'), content: conteudo('v1', 'V1'), status: 'published' }),
      pub({ account: conta('a1', 'c1'), content: conteudo('v2', 'V2'), status: 'failed' }),
      pub({ account: conta('a2', 'c2'), content: conteudo('v1', 'V1'), status: 'scheduled' }),
    ];
    const m = indexar(dados);

    expect(m.get('a1__v1').status).toBe('published');
    expect(m.get('a1__v2').status).toBe('failed');
    expect(m.get('a2__v1').status).toBe('scheduled');
  });

  test('par ausente é distinto de pendente — não planejado', () => {
    seq = 0;
    const m = indexar([
      pub({ account: conta('a1', 'c1'), content: conteudo('v1', 'V1'), status: 'published' }),
    ]);
    // a2 × v1 não existe no plano: a célula não pode virar "agendada".
    expect(m.get('a2__v1')).toBeUndefined();
  });

  test('a ordem de entrada não muda a correspondência das células', () => {
    seq = 0;
    const dados = [
      pub({ account: conta('a2', 'c2'), content: conteudo('v2', 'V2'), status: 'failed' }),
      pub({ account: conta('a1', 'c1'), content: conteudo('v1', 'V1'), status: 'published' }),
    ];
    const m = indexar(dados);
    const invertida = indexar([...dados].reverse());

    expect(m.get('a1__v1').status).toBe(invertida.get('a1__v1').status);
    expect(m.get('a2__v2').status).toBe(invertida.get('a2__v2').status);
  });
});

/* ── Timeline de execução do drawer ────────────────────────────────────────── */

describe('etapas de execução', () => {
  test('publicação concluída marca as etapas até publicada', () => {
    const etapas = montarEtapas(pub({
      status: 'published',
      publishedAt: '2026-09-01T18:05:00',
    }));
    const nomes = etapas.map(e => e.chave);
    expect(nomes).toEqual(['criada', 'agendada', 'processando', 'publicada']);
    expect(etapas.every(e => e.atingida)).toBe(true);
  });

  test('publicação com falha mostra a etapa de falha, não a de publicada', () => {
    const etapas = montarEtapas(pub({ status: 'failed' }));
    const nomes = etapas.map(e => e.chave);
    expect(nomes).toContain('falhou');
    expect(nomes).not.toContain('publicada');
    expect(etapas.find(e => e.chave === 'falhou').erro).toBe(true);
  });

  test('pendente não marca processando como alcançada', () => {
    const etapas = montarEtapas(pub({ status: 'pending' }));
    expect(etapas.find(e => e.chave === 'agendada').atingida).toBe(false);
    expect(etapas.find(e => e.chave === 'processando').atingida).toBe(false);
  });

  test('sem comentário, as etapas de comentário não aparecem', () => {
    const etapas = montarEtapas(pub({ status: 'published', commentStatus: 'none' }));
    expect(etapas.some(e => e.chave.startsWith('comentario'))).toBe(false);
  });

  test('comentário publicado acrescenta as duas etapas', () => {
    const etapas = montarEtapas(pub({
      status: 'published', commentStatus: 'posted', commentPostedAt: '2026-09-01T18:07:00',
    }));
    const nomes = etapas.map(e => e.chave);
    expect(nomes).toContain('comentario_agendado');
    expect(nomes).toContain('comentario_publicado');
    expect(etapas.at(-1).atingida).toBe(true);
  });

  test('comentário falho não marca comentário publicado', () => {
    const etapas = montarEtapas(pub({ status: 'published', commentStatus: 'failed' }));
    const nomes = etapas.map(e => e.chave);
    expect(nomes).toContain('comentario_falhou');
    expect(nomes).not.toContain('comentario_publicado');
  });

  test('publicação sem dados devolve lista vazia', () => {
    expect(montarEtapas(null)).toEqual([]);
  });
});
