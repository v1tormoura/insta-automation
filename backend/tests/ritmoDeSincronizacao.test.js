'use strict';

/**
 * O ritmo das varreduras periódicas.
 *
 * ── O que estes testes protegem
 *
 * Não é "a fatia tem o tamanho certo" — isso é aritmética. É a propriedade que
 * torna a fatia utilizável no lugar da lista inteira:
 *
 *   TODA conta é vista dentro de um intervalo, e nenhuma fica para trás.
 *
 * Sem isso, espaçar as varreduras não teria reduzido sinal nenhum: teria só
 * deixado algumas contas sem sincronizar para sempre, o que aparece como
 * "seguidores parados" semanas depois e ninguém liga a esta mudança.
 *
 * O caso que mais me preocupava é o de POUCAS contas: com 5 contas e 6 tiques,
 * uma divisão inteira honesta dá zero, e o job passaria a não fazer nada.
 */

const ritmo = require('../src/services/ritmoDeSincronizacao');

/* Meio-dia: fora do silêncio noturno, para os testes de fatia não dependerem
   da hora em que a suíte roda. */
const MEIO_DIA = new Date('2026-09-09T12:00:00');

/** Roda `voltas` tiques, devolvendo o conjunto de contas vistas. */
function girar(contas, voltas, opts = {}) {
  let fila = [...contas];
  const vistas = new Set();
  for (let i = 0; i < voltas; i++) {
    const f = ritmo.fatiaDaVez(fila, { agora: MEIO_DIA, ...opts });
    f.forEach(c => vistas.add(c));
    /* Simula o efeito do `sort({ lastSync: 1 })`: quem foi sincronizado vai
       para o fim da fila. É o que o banco faz na consulta seguinte. */
    fila = fila.slice(f.length).concat(f);
  }
  return vistas;
}

describe('a fatia cobre todas as contas dentro do intervalo', () => {
  test('12 contas, 6 tiques — todas vistas, 2 por vez', () => {
    const contas = Array.from({ length: 12 }, (_, i) => `c${i}`);
    expect(ritmo.fatiaDaVez(contas, { agora: MEIO_DIA })).toHaveLength(2);
    expect(girar(contas, 6).size).toBe(12);
  });

  test('número que não divide certo: 13 contas ainda são todas vistas', () => {
    /* 13/6 = 2,17 → `ceil` dá 3. A última volta sobra, e é isso que se quer:
       sobrar é melhor que faltar. */
    const contas = Array.from({ length: 13 }, (_, i) => `c${i}`);
    expect(girar(contas, 6).size).toBe(13);
  });

  test('POUCAS contas: 5 em 6 tiques não podem dar fatia vazia', () => {
    /* O defeito que `Math.ceil` + `Math.max(1, …)` evitam. Com divisão inteira
       simples, `floor(5/6)` = 0 e NENHUMA conta seria sincronizada — nunca.
       O job continuaria rodando, o log continuaria limpo, e os números do
       painel simplesmente parariam. */
    const contas = ['a', 'b', 'c', 'd', 'e'];
    expect(ritmo.fatiaDaVez(contas, { agora: MEIO_DIA }).length).toBeGreaterThan(0);
    expect(girar(contas, 6).size).toBe(5);
  });

  test('uma conta só é vista em todo tique', () => {
    expect(ritmo.fatiaDaVez(['unica'], { agora: MEIO_DIA })).toEqual(['unica']);
  });

  test('lista vazia devolve vazia, sem estourar', () => {
    expect(ritmo.fatiaDaVez([], { agora: MEIO_DIA })).toEqual([]);
    expect(ritmo.fatiaDaVez(null, { agora: MEIO_DIA })).toEqual([]);
    expect(ritmo.fatiaDaVez(undefined, { agora: MEIO_DIA })).toEqual([]);
  });

  test('tique maior que o intervalo processa tudo, em vez de dividir por zero', () => {
    const contas = ['a', 'b', 'c'];
    const f = ritmo.fatiaDaVez(contas, { agora: MEIO_DIA, tiqueMs: 60 * 60 * 1000, intervalo: 5 * 60 * 1000 });
    expect(f).toHaveLength(3);
  });
});

describe('silêncio noturno', () => {
  const hora = h => new Date(`2026-09-09T${String(h).padStart(2, '0')}:30:00`);

  test('a janela padrão é 1h–7h', () => {
    expect(ritmo.emSilencio(hora(0))).toBe(false);
    expect(ritmo.emSilencio(hora(1))).toBe(true);
    expect(ritmo.emSilencio(hora(4))).toBe(true);
    expect(ritmo.emSilencio(hora(6))).toBe(true);
    expect(ritmo.emSilencio(hora(7))).toBe(false);
    expect(ritmo.emSilencio(hora(15))).toBe(false);
  });

  test('durante o silêncio a fatia sai vazia mesmo com contas na fila', () => {
    expect(ritmo.fatiaDaVez(['a', 'b', 'c'], { agora: hora(3) })).toEqual([]);
  });

  describe('janela que cruza a meia-noite', () => {
    const original = { ...process.env };
    beforeEach(() => { process.env.SYNC_SILENCIO_INICIO = '23'; process.env.SYNC_SILENCIO_FIM = '6'; });
    afterEach(() => { process.env = { ...original }; });

    test('23h–6h vale nos dois lados da virada', () => {
      /* Uma comparação `h >= inicio && h < fim` cobriria só janelas que não
         cruzam a meia-noite — e o silêncio noturno de verdade é justamente o
         que cruza. Ele nunca valeria, e nada acusaria. */
      expect(ritmo.emSilencio(hora(23))).toBe(true);
      expect(ritmo.emSilencio(hora(2))).toBe(true);
      expect(ritmo.emSilencio(hora(5))).toBe(true);
      expect(ritmo.emSilencio(hora(6))).toBe(false);
      expect(ritmo.emSilencio(hora(12))).toBe(false);
    });
  });

  describe('configuração', () => {
    const original = { ...process.env };
    afterEach(() => { process.env = { ...original }; });

    test('início igual ao fim desliga o silêncio', () => {
      process.env.SYNC_SILENCIO_INICIO = '3';
      process.env.SYNC_SILENCIO_FIM = '3';
      expect(ritmo.emSilencio(hora(3))).toBe(false);
      expect(ritmo.emSilencio(hora(15))).toBe(false);
    });

    test('valor inválido cai no padrão em vez de virar NaN', () => {
      /* `Number('abc')` é NaN, e NaN em comparação é sempre falso: o silêncio
         sumiria em silêncio. */
      process.env.SYNC_SILENCIO_INICIO = 'abc';
      process.env.SYNC_SILENCIO_FIM = '';
      expect(ritmo.emSilencio(hora(4))).toBe(true);
      expect(ritmo.emSilencio(hora(12))).toBe(false);
    });

    test('o intervalo respeita limites', () => {
      process.env.SYNC_INTERVALO_MIN = '45';
      expect(ritmo.intervaloMs()).toBe(45 * 60 * 1000);

      /* Abaixo de 5 min não faz sentido: é o próprio tique. */
      process.env.SYNC_INTERVALO_MIN = '1';
      expect(ritmo.intervaloMs()).toBe(5 * 60 * 1000);

      process.env.SYNC_INTERVALO_MIN = 'nada';
      expect(ritmo.intervaloMs()).toBe(ritmo.PADRAO.intervaloMin * 60 * 1000);
    });
  });
});

describe('os jobs de varredura usam a fatia, não a lista inteira', () => {
  const fs = require('fs');
  const path = require('path');
  const ler = n => fs.readFileSync(path.join(__dirname, '../src/jobs', n), 'utf8');

  for (const arquivo of ['accountFastSync.js', 'accountAutoSync.js', 'healthCheck.js']) {
    test(`${arquivo} percorre a fatia`, () => {
      const src = ler(arquivo);
      expect(src).toMatch(/ritmo\.fatiaDaVez\(/);
      /* A âncora é a SINTAXE do laço, não a prosa: já escrevi asserção
         negativa que casava com o meu próprio comentário explicando o
         problema — quatro vezes neste projeto. */
      expect(src).toMatch(/for \(const acc of daVez\)/);
      expect(src).not.toMatch(/for \(const acc of accounts\)/);
    });
  }

  test('healthCheck ordena pelo campo DELE, não pelo do FastSync', () => {
    /* O próprio arquivo explica que ele mantém `lastHealthCheck` para não
       disputar com o FastSync, que reescreve `lastSync`. Ordenar a fatia por
       `lastSync` faria as mesmas contas voltarem sempre. */
    const src = ler('healthCheck.js');
    expect(src).toMatch(/\.sort\(\{ lastHealthCheck: 1 \}\)/);
  });

  test('a publicação NÃO passa por aqui', () => {
    /* Postar, story, loop e campanha são ações que a pessoa agendou: acontecem
       na hora marcada, inclusive de madrugada. O silêncio vale só para a
       varredura, que é iniciativa do sistema. */
    for (const n of ['loopJob.js', 'repostJob.js']) {
      const caminho = path.join(__dirname, '../src/jobs', n);
      if (!fs.existsSync(caminho)) continue;
      expect(fs.readFileSync(caminho, 'utf8')).not.toMatch(/fatiaDaVez|emSilencio/);
    }
  });
});
