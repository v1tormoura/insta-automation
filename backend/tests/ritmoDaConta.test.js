'use strict';

/**
 * Quanto e quando uma conta publica.
 *
 * O estado atual do sistema é: sem teto e sem janela — decisão de quem opera,
 * tomada em 18/09/2026. Estes testes existem em duas metades:
 *
 *  1. o padrão LIBERA, e libera de verdade — inclusive às 3 da manhã e com
 *     centenas de publicações no dia. É o que o dono pediu, e uma regressão
 *     aqui voltaria a segurar publicação sem ninguém entender por quê;
 *
 *  2. o mecanismo continua inteiro e volta pelo ambiente. Ele não foi apagado
 *     porque o defeito que ele corrigia era real — ~36 reels por dia, 24h por
 *     dia, é o padrão de automação mais fácil de contar que existe — e no dia
 *     em que a hipótese voltar à mesa, religar tem que ser duas linhas no
 *     .env, não reescrever o módulo.
 */

const {
  podePublicar, tetoDeHoje, dentroDaJanela, proximaAbertura, deslocamentoDe,
  SEM_TETO,
} = require('../src/services/ritmoDaConta');

const conta = (id, extra = {}) => ({ _id: id, username: id, postsToday: 0, ...extra });

/** Uma data local no dia 15/06/2026, para os testes não dependerem do relógio. */
const emHoras = (h, m = 0) => new Date(2026, 5, 15, h, m, 0, 0);

/** Recarrega o módulo com outro ambiente — as faixas são lidas na importação. */
function comAmbiente(env, fn) {
  const antes = { ...process.env };
  jest.resetModules();
  Object.assign(process.env, env);
  try {
    fn(require('../src/services/ritmoDaConta'));
  } finally {
    process.env = antes;
    jest.resetModules();
  }
}

describe('o padrão: sem teto e sem janela', () => {
  test('três da manhã publica igual três da tarde', () => {
    for (const h of [0, 2, 3, 4, 5, 6, 12, 23]) {
      expect(podePublicar(conta('a'), emHoras(h)).pode).toBe(true);
    }
  });

  test('não existe teto vindo do sistema', () => {
    expect(tetoDeHoje(conta('a'), emHoras(10))).toBe(SEM_TETO);
    expect(tetoDeHoje(conta('b', { dailyPostLimit: SEM_TETO }), emHoras(10))).toBe(SEM_TETO);
  });

  test('centenas de publicações no mesmo dia continuam passando', () => {
    // O caso que o teto barrava. Hoje é o comportamento pedido.
    const r = podePublicar(conta('a', { postsToday: 500 }), emHoras(3));
    expect(r.pode).toBe(true);
    expect(r.motivo).toBe('');
  });

  test('a janela cobre o dia inteiro', () => {
    for (const h of [0, 3, 7, 15, 22, 23]) {
      expect(dentroDaJanela(conta('a'), emHoras(h))).toBe(true);
    }
  });
});

describe('o teto da própria conta continua valendo', () => {
  /* Desligar o padrão é sobre o que o sistema IMPÕE sozinho. Um número que o
     dono digitou na tela de Contas é ordem, não heurística. */
  test('limite configurado à mão é obedecido, sem jitter', () => {
    expect(tetoDeHoje(conta('c', { dailyPostLimit: 3 }), emHoras(10))).toBe(3);
    expect(tetoDeHoje(conta('c', { dailyPostLimit: 1 }), emHoras(10))).toBe(1);
  });

  test('e barra quando é atingido, dizendo o motivo', () => {
    const r = podePublicar(conta('c', { postsToday: 3, dailyPostLimit: 3 }), emHoras(14));
    expect(r.pode).toBe(false);
    expect(r.motivo).toMatch(/teto diário/);
    expect(r.motivo).toContain('3/3');
  });

  test('999999 é ausência de configuração, não um teto de 999999', () => {
    /* Toda conta existente tem esse número gravado — o schema nasceu assim. */
    expect(tetoDeHoje(conta('d', { dailyPostLimit: SEM_TETO }), emHoras(10))).toBe(SEM_TETO);
  });
});

describe('religando pelo ambiente', () => {
  const LIGADO = { TETO_DIARIO_PADRAO: '6-10', JANELA_PUBLICACAO: '7-23' };

  test('o teto volta, sorteado dentro da faixa', () => {
    comAmbiente(LIGADO, r => {
      const t = r.tetoDeHoje(conta('a'), emHoras(10));
      expect(t).toBeGreaterThanOrEqual(6);
      expect(t).toBeLessThanOrEqual(10);
    });
  });

  test('a janela volta e a madrugada fecha', () => {
    comAmbiente(LIGADO, r => {
      for (const h of [1, 2, 3, 4, 5]) {
        expect(r.dentroDaJanela(conta('a'), emHoras(h))).toBe(false);
      }
      for (const h of [10, 12, 15, 18, 20]) {
        expect(r.dentroDaJanela(conta('a'), emHoras(h))).toBe(true);
      }
    });
  });

  test('o motivo distingue teto de janela', () => {
    /* Os dois param a publicação do mesmo jeito e se consertam de formas
       diferentes. Um motivo genérico manda investigar a coisa errada. */
    comAmbiente(LIGADO, r => {
      expect(r.podePublicar(conta('a', { postsToday: 99 }), emHoras(14)).motivo).toMatch(/teto diário/);
      const madrugada = r.podePublicar(conta('a'), emHoras(3));
      expect(madrugada.motivo).toMatch(/janela/);
      expect(madrugada.ate).toBeInstanceOf(Date);
    });
  });

  test('contas diferentes param em números diferentes', () => {
    // Cinco contas parando na oitava publicação todo dia é outro padrão.
    comAmbiente(LIGADO, r => {
      const tetos = new Set(['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8']
        .map(id => r.tetoDeHoje(conta(id), emHoras(10))));
      expect(tetos.size).toBeGreaterThan(1);
    });
  });

  test('o teto muda de um dia para o outro, mas não dentro do dia', () => {
    comAmbiente(LIGADO, r => {
      const hoje = r.tetoDeHoje(conta('x'), new Date(2026, 5, 15));
      const semana = [1, 2, 3, 4, 5, 6, 7].map(d => r.tetoDeHoje(conta('x'), new Date(2026, 5, 15 + d)));
      expect(semana.some(t => t !== hoje)).toBe(true);
      // Senão o teto subiria a cada consulta e a conta publicaria sem parar.
      expect(r.tetoDeHoje(conta('y'), emHoras(8))).toBe(r.tetoDeHoje(conta('y'), emHoras(20)));
    });
  });

  test('faixa mal escrita no ambiente não liga nada pela metade', () => {
    /* Um .env com "6" ou "10-6" não pode virar um teto imprevisível: fica
       desligado, que é o estado seguro e o mesmo de não ter escrito nada. */
    for (const ruim of ['6', '10-6', 'abc', '', '  ']) {
      comAmbiente({ TETO_DIARIO_PADRAO: ruim }, r => {
        expect(r.tetoDeHoje(conta('a'), emHoras(10))).toBe(SEM_TETO);
      });
    }
  });
});

describe('o mecanismo da janela, independente de estar ligada', () => {
  test('cada conta tem o próprio horário de acordar, estável', () => {
    const deslocamentos = new Set(['c1', 'c2', 'c3', 'c4', 'c5', 'c6'].map(id => deslocamentoDe(conta(id))));
    expect(deslocamentos.size).toBeGreaterThan(1);
    expect(deslocamentoDe(conta('z'))).toBe(deslocamentoDe(conta('z')));
  });

  test('janela passada por parâmetro sobrescreve o padrão', () => {
    expect(dentroDaJanela(conta('a'), emHoras(3), { inicio: 7, fim: 23 })).toBe(false);
    expect(dentroDaJanela(conta('a'), emHoras(3), { inicio: 0, fim: 24 })).toBe(true);
  });

  test('janela que atravessa a meia-noite funciona', () => {
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

describe('robustez', () => {
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
    /* Um módulo pode estar perfeito e ninguém chamá-lo. */
    const trecho = fonte.slice(fonte.indexOf('async function checkDailyLimit'));
    // Via podePublicarAgora, que soma a cota da API ao ritmo — os dois saem
    // pelo mesmo veredito.
    expect(trecho).toContain('podePublicarAgora(account)');
    expect(fonte).toContain('const ritmo = podePublicar(account, agora);');
    expect(trecho.slice(0, 900)).not.toContain('account.postsToday < account.dailyPostLimit');
  });

  test('a comparação crua não sobrou em lugar nenhum', () => {
    expect(fonte).not.toContain('postsToday < account.dailyPostLimit');
  });

  test('a rodada adiada loga o motivo real, não o genérico', () => {
    /* "teto diário ou janela de silêncio" mandava investigar a coisa errada:
       podePublicar já devolve qual dos dois foi, e o worker descartava. */
    expect(fonte).toContain('v.ritmo.motivo');
    expect(fonte).not.toContain('(teto diário ou janela de silêncio)');
  });
});
