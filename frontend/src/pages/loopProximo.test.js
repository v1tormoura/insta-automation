import { describe, test, expect } from 'vitest';
import { faltam, contagem, proximoPasso, proximaMidia } from './loopProximo.js';

/**
 * O que o cartão do loop diz que vem a seguir.
 *
 * O print que motivou isto mostrava `em —` como o selo mais importante do
 * cartão: o loop estava ativo, com 28 mídias na fila, 0 ciclos e 0 publicados.
 * Três estados diferentes — "vai publicar em 12min", "ativo mas nunca rodou" e
 * "pausado" — produziam o mesmo traço.
 */

const AGORA = new Date('2026-09-02T12:00:00Z').getTime();
const daquiA = (s) => new Date(AGORA + s * 1000).toISOString();

describe('a contagem', () => {
  test('segundos só no último minuto', () => {
    /* Antes disso eles mudam o texto a cada tick sem acrescentar nada. Um
       número que pisca o tempo todo é ruído; um que começa a piscar quando
       falta pouco é aviso. */
    expect(contagem(daquiA(45), AGORA)).toBe('45s');
    expect(contagem(daquiA(90), AGORA)).toBe('1min 30s');
    expect(contagem(daquiA(3 * 3600 + 5 * 60), AGORA)).toBe('3h 05min');
  });

  test('horário no passado vira "agora", não um número negativo', () => {
    expect(contagem(daquiA(-30), AGORA)).toBe('agora');
    expect(contagem(daquiA(0), AGORA)).toBe('agora');
  });

  test('sem horário não inventa contagem', () => {
    expect(contagem(null, AGORA)).toBeNull();
    expect(contagem(undefined, AGORA)).toBeNull();
    expect(contagem('não é data', AGORA)).toBeNull();
  });

  test('faltam devolve as partes para a tela decidir', () => {
    const f = faltam(daquiA(3661), AGORA);
    expect(f).toMatchObject({ h: 1, m: 1, s: 1, passou: false });
  });
});

describe('o próximo passo', () => {
  const loop = (extra) => ({ status: 'ativo', mediaFiles: ['a', 'b'], ...extra });

  test('ativo com horário: conta e diz para quê', () => {
    const r = proximoPasso(loop({ nextRunAt: daquiA(600) }), AGORA);
    expect(r.tom).toBe('espera');
    expect(r.titulo).toBe('10min 00s');
    expect(r.detalhe).toMatch(/próxima publicação/);
  });

  test('pausado diz que nada vai acontecer', () => {
    /* "Pausado" sozinho descreve; o que a pessoa precisa saber é a
       consequência — que a fila não anda até ela voltar. */
    const r = proximoPasso(loop({ status: 'pausado', nextRunAt: daquiA(600) }), AGORA);
    expect(r.tom).toBe('parado');
    expect(r.detalhe).toMatch(/até você retomar/);
  });

  test('ativo SEM horário é atenção, não silêncio', () => {
    /* O caso do print: ativo, 28 mídias, 0 ciclos, `em —`. Parecia
       funcionando e nunca ia publicar. */
    const r = proximoPasso(loop({ nextRunAt: null, postsCount: 0 }), AGORA);
    expect(r.tom).toBe('atencao');
    expect(r.detalhe).toMatch(/ainda não rodou/i);
  });

  test('ativo sem horário DEPOIS de já ter publicado aponta o histórico', () => {
    /* Nunca rodou e parou de agendar são causas diferentes: uma é começar, a
       outra é descobrir o que quebrou na última. */
    const r = proximoPasso(loop({ nextRunAt: null, postsCount: 12 }), AGORA);
    expect(r.tom).toBe('atencao');
    expect(r.detalhe).toMatch(/hist[óo]rico/i);
  });

  test('ativo sem mídia nenhuma', () => {
    const r = proximoPasso(loop({ mediaFiles: [], nextRunAt: daquiA(60) }), AGORA);
    expect(r.tom).toBe('atencao');
    expect(r.titulo).toMatch(/Sem mídias/);
  });

  test('horário vencido: publicando agora', () => {
    const r = proximoPasso(loop({ nextRunAt: daquiA(-5) }), AGORA);
    expect(r.tom).toBe('conta');
    expect(r.titulo).toMatch(/agora/i);
  });
});

describe('a próxima mídia', () => {
  test('aponta a do currentIndex', () => {
    const r = proximaMidia({ mediaFiles: ['a', 'b', 'c'], currentIndex: 1 });
    expect(r).toMatchObject({ indice: 1, arquivo: 'b', total: 3 });
  });

  test('índice além do fim volta ao começo', () => {
    /* A lista encolhe entre ciclos e o ponteiro fica para trás. O loop volta
       ao início; a tela precisa mostrar a MESMA que ele vai usar, não um
       vazio. */
    expect(proximaMidia({ mediaFiles: ['a', 'b'], currentIndex: 7 }).arquivo).toBe('b');
    expect(proximaMidia({ mediaFiles: ['a', 'b'], currentIndex: 2 }).arquivo).toBe('a');
  });

  test('índice ausente ou inválido começa do zero', () => {
    for (const i of [undefined, null, 'x', -1]) {
      expect(proximaMidia({ mediaFiles: ['a', 'b'], currentIndex: i }).indice).toBe(
        i === -1 ? 1 : 0     // -1 dá a volta e cai na última
      );
    }
  });

  test('fila vazia não tem próxima', () => {
    expect(proximaMidia({ mediaFiles: [] })).toBeNull();
    expect(proximaMidia({})).toBeNull();
  });
});
