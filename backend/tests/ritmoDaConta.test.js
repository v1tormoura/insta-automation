'use strict';

/**
 * Quanto e quando uma conta publica.
 *
 * O defeito: `dailyPostLimit` nascia 999999 — na prática, sem teto — e não
 * havia janela de horário. Com o loop a cada 40 minutos, cada conta publicava
 * ~36 reels por dia, 24 horas por dia.
 *
 * Trinta e seis publicações distribuídas uniformemente pelas 24 horas é o
 * padrão mais característico de automação que existe: basta contar publicações
 * por hora. Nenhuma humanização de arquivo compensa isso.
 */

const {
  podePublicar, tetoDeHoje, dentroDaJanela, proximaAbertura, deslocamentoDe,
  TETO_MIN, TETO_MAX, SEM_TETO,
} = require('../src/services/ritmoDaConta');

const conta = (id, extra = {}) => ({ _id: id, username: id, postsToday: 0, ...extra });

/** Uma data local no dia 15/06/2026, para os testes não dependerem do relógio. */
const emHoras = (h, m = 0) => new Date(2026, 5, 15, h, m, 0, 0);

describe('o teto diário', () => {
  test('999999 é tratado como "nunca configurado", não como "sem limite"', () => {
    /* Toda conta existente tem 999999 gravado — o schema nasceu assim. Tratar
       o valor como um teto legítimo faria a correção não valer para nenhuma
       das contas que já existem, e exigiria migração para valer. */
    const t = tetoDeHoje(conta('a', { dailyPostLimit: SEM_TETO }), emHoras(10));
    expect(t).toBeGreaterThanOrEqual(TETO_MIN);
    expect(t).toBeLessThanOrEqual(TETO_MAX);
  });

  test('sem campo nenhum, cai na faixa conservadora', () => {
    const t = tetoDeHoje(conta('b'), emHoras(10));
    expect(t).toBeGreaterThanOrEqual(TETO_MIN);
    expect(t).toBeLessThanOrEqual(TETO_MAX);
  });

  test('teto configurado à mão é obedecido sem jitter', () => {
    /* Quem digitou 3 quer 3. Sortear entre 2 e 4 seria desobedecer em nome de
       uma heurística. */
    expect(tetoDeHoje(conta('c', { dailyPostLimit: 3 }), emHoras(10))).toBe(3);
    expect(tetoDeHoje(conta('c', { dailyPostLimit: 1 }), emHoras(10))).toBe(1);
  });

  test('contas diferentes param em números diferentes', () => {
    /* Cinco contas parando exatamente na oitava publicação, todo dia, é o
       mesmo tipo de padrão que o teto existe para quebrar. */
    const tetos = new Set(
      ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8'].map(id => tetoDeHoje(conta(id), emHoras(10)))
    );
    expect(tetos.size).toBeGreaterThan(1);
  });

  test('o teto de uma conta muda de um dia para o outro', () => {
    const hoje = tetoDeHoje(conta('x'), new Date(2026, 5, 15));
    const daquiUmaSemana = [1, 2, 3, 4, 5, 6, 7]
      .map(d => tetoDeHoje(conta('x'), new Date(2026, 5, 15 + d)));
    expect(daquiUmaSemana.some(t => t !== hoje)).toBe(true);
  });

  test('o mesmo dia dá sempre o mesmo teto', () => {
    // Senão o teto subiria a cada consulta e a conta publicaria sem parar.
    expect(tetoDeHoje(conta('y'), emHoras(8))).toBe(tetoDeHoje(conta('y'), emHoras(20)));
  });
});

describe('a janela de horário', () => {
  test('de madrugada, não publica', () => {
    /* O silêncio é o sinal: uma conta que nunca dorme não se parece com
       ninguém. Antes o loop publicava às 3h como publica às 15h. */
    for (const h of [1, 2, 3, 4, 5]) {
      expect(dentroDaJanela(conta('a'), emHoras(h))).toBe(false);
    }
  });

  test('durante o dia, publica', () => {
    for (const h of [10, 12, 15, 18, 20]) {
      expect(dentroDaJanela(conta('a'), emHoras(h))).toBe(true);
    }
  });

  test('cada conta tem o próprio horário de acordar', () => {
    /* Todas acordando às 07:00 em ponto se comportam como um enxame. */
    const deslocamentos = new Set(
      ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'].map(id => deslocamentoDe(conta(id)))
    );
    expect(deslocamentos.size).toBeGreaterThan(1);
  });

  test('o horário de acordar de uma conta é o mesmo todo dia', () => {
    // Uma pessoa com rotina, não uma que sorteia quando levanta.
    expect(deslocamentoDe(conta('z'))).toBe(deslocamentoDe(conta('z')));
  });

  test('janela cobrindo o dia todo desliga a regra', () => {
    // O caminho de quem quer publicar 24h de propósito.
    expect(dentroDaJanela(conta('a'), emHoras(3), { inicio: 0, fim: 24 })).toBe(true);
  });

  test('janela que atravessa a meia-noite funciona', () => {
    /* 22h às 6h é o caso de quem publica de madrugada de propósito. Sem o ramo
       para `inicio > fim`, a comparação recusaria sempre. */
    const j = { inicio: 22, fim: 6 };
    expect(dentroDaJanela(conta('semDeslocamento'), emHoras(23), j)).toBe(true);
    expect(dentroDaJanela(conta('semDeslocamento'), emHoras(2), j)).toBe(true);
    expect(dentroDaJanela(conta('semDeslocamento'), emHoras(12), j)).toBe(false);
  });

  test('a próxima abertura é sempre no futuro', () => {
    for (const h of [0, 3, 8, 15, 23]) {
      const agora = emHoras(h);
      expect(proximaAbertura(conta('a'), agora).getTime()).toBeGreaterThan(agora.getTime());
    }
  });
});

describe('o veredito', () => {
  test('dentro da janela e abaixo do teto: pode', () => {
    const r = podePublicar(conta('a', { postsToday: 1 }), emHoras(14));
    expect(r.pode).toBe(true);
    expect(r.motivo).toBe('');
  });

  test('teto atingido: não pode, e o motivo diz por quê', () => {
    const c = conta('a', { postsToday: 99 });
    const r = podePublicar(c, emHoras(14));
    expect(r.pode).toBe(false);
    expect(r.motivo).toMatch(/teto diário/);
  });

  test('madrugada: não pode, e o motivo é outro', () => {
    /* Teto atingido e fora da janela param a publicação do mesmo jeito e
       consertam de formas diferentes. Um motivo genérico mandaria investigar
       a coisa errada. */
    const r = podePublicar(conta('a', { postsToday: 0 }), emHoras(3));
    expect(r.pode).toBe(false);
    expect(r.motivo).toMatch(/janela/);
    expect(r.ate).toBeInstanceOf(Date);
  });

  test('o que era permitido antes agora é barrado', () => {
    /* O teste que descreve o defeito: uma conta com 36 publicações no dia,
       às 4 da manhã, passava. Era literalmente o que acontecia. */
    const c = conta('a', { postsToday: 36, dailyPostLimit: SEM_TETO });
    expect(c.postsToday < c.dailyPostLimit).toBe(true);        // a regra antiga
    expect(podePublicar(c, emHoras(4)).pode).toBe(false);       // a regra nova
  });

  test('conta sem campos não derruba o veredito', () => {
    for (const ruim of [null, undefined, {}, { postsToday: null }]) {
      expect(() => podePublicar(ruim, emHoras(14))).not.toThrow();
    }
  });
});

describe('o worker usa o módulo', () => {
  const fs = require('fs');
  const path = require('path');
  const fonte = fs.readFileSync(path.resolve(__dirname, '../src/queue/worker.js'), 'utf8');

  test('checkDailyLimit consulta o ritmo, não o campo cru', () => {
    /* Um módulo pode estar perfeito e ninguém chamá-lo — foi o defeito do
       arquivo por conta. */
    const trecho = fonte.slice(fonte.indexOf('async function checkDailyLimit'));
    expect(trecho).toContain('podePublicar(account)');
    expect(trecho.slice(0, 900)).not.toContain('account.postsToday < account.dailyPostLimit');
  });

  test('a comparação crua não sobrou em lugar nenhum', () => {
    expect(fonte).not.toContain('postsToday < account.dailyPostLimit');
  });
});
