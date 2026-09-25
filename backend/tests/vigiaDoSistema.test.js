/**
 * Vigia do sistema.
 *
 * ── O que ele evita
 *
 * Um problema que para a publicação em silêncio (fila presa, tokens caindo,
 * erros em massa) é descoberto dias depois, pelas contas ficarem estranhas —
 * e aí a causa já está longe do sintoma.
 *
 * ── O que estes testes protegem
 *
 * Não é "o alerta dispara": isso é fácil e óbvio. É a disciplina em volta, que
 * é onde vigilância costuma apodrecer:
 *
 *   • um problema que dura três dias virando três dias de avisos, até a pessoa
 *     desligar as notificações — e aí o próximo alerta, o que importava,
 *     também não chega;
 *   • o aviso de recuperação faltando, e quem recebeu o alerta de madrugada
 *     não sabendo que passou;
 *   • uma verificação quebrada derrubando as outras, deixando o vigia cego
 *     exatamente quando algo está errado.
 */

const mockEstado = { valor: {} };
const mockNotificacoes = [];
const mockPush = jest.fn();
let atuais;

jest.mock('../src/repos/settings', () => ({
  ler: async () => mockEstado.valor,
  gravar: async (_chave, valor) => { mockEstado.valor = valor; },
}));

jest.mock('../src/repos', () => ({
  notificacoes: {
    async insert(doc) { mockNotificacoes.push(doc); return { id: 'n' + mockNotificacoes.length, ...doc }; },
  },
}));

jest.mock('../src/services/smartActivity/webPush', () => ({ enviar: (...a) => mockPush(...a) }));
jest.mock('../src/events/broadcaster', () => ({ broadcast: jest.fn() }));

/* `ativos` por padrão: todas as chaves do vigia LIGADAS aqui, mesmo com o
   padrão real (thresholds.js) tendo mudado para desligado — o propósito
   destes testes é a mecânica de aviso/repetição/recuperação, não o gate
   novo. O gate ganha sua própria seção, mais abaixo, com o mock trocado por
   teste. */
const mockAtivos = { valor: { sessoes: true, fila: true, erros: true } };
jest.mock('../src/services/smartActivity/thresholds', () => ({
  carregar: async () => ({ ativos: mockAtivos.valor, mensagens: {} }),
}));

const vigia = require('../src/services/vigiaDoSistema');

/* Dublês passados por PARÂMETRO: o mapa exportado é `Object.freeze`, e
   injetar não pede que o módulo abra mão da imutabilidade. */
const dubles = (mapa) => Object.fromEntries(
  Object.keys(vigia.VERIFICACOES).map(k => [k, async () => mapa[k] || null])
);
const definir = (mapa) => { atuais = dubles(mapa); };

beforeEach(() => {
  mockEstado.valor = {};
  mockNotificacoes.length = 0;
  mockPush.mockReset().mockResolvedValue({ enviados: 1 });
  atuais = dubles({});
  mockAtivos.valor = { sessoes: true, fila: true, erros: true };
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

describe('avisar', () => {
  test('problema novo gera aviso e push', async () => {
    definir({ sessoes: { titulo: 'Contas sem conectar', mensagem: 'sem saída', prioridade: 'alta' } });
    const r = await vigia.verificar({ verificacoes: atuais });

    expect(r.avisos).toBe(1);
    expect(mockNotificacoes[0].titulo).toBe('Contas sem conectar');
    expect(mockNotificacoes[0].eventType).toBe('sistema');
    expect(mockPush).toHaveBeenCalledTimes(1);
  });

  test('prioridade alta usa o tema de alerta, não o neutro', async () => {
    definir({ sessoes: { titulo: 'x', mensagem: 'y', prioridade: 'alta' } });
    await vigia.verificar({ verificacoes: atuais });
    expect(mockNotificacoes[0].tema).toBe('warning');
  });

  test('grava na Central — diferente do aviso de teste', async () => {
    /* O de teste não persiste, porque inventaria um marco. Estes SÃO eventos
       que aconteceram, e o histórico deles é o que responde "isto começou
       quando?" — a pergunta que custou quatro dias. */
    definir({ fila: { titulo: 'fila presa', mensagem: 'z' } });
    await vigia.verificar({ verificacoes: atuais });
    expect(mockNotificacoes).toHaveLength(1);
    expect(mockNotificacoes[0].metadados.vigia).toBe('fila');
  });
});

describe('não vira spam', () => {
  test('o mesmo problema não avisa duas vezes seguidas', async () => {
    // Três dias de problema não podem virar três dias de avisos: a pessoa
    // desliga as notificações, e aí o próximo alerta — o que importa — também
    // não chega.
    definir({ sessoes: { titulo: 'Contas sem conectar', mensagem: 'x' } });

    expect((await vigia.verificar({ verificacoes: atuais })).avisos).toBe(1);
    expect((await vigia.verificar({ verificacoes: atuais })).avisos).toBe(0);
    expect((await vigia.verificar({ verificacoes: atuais })).avisos).toBe(0);
    expect(mockNotificacoes).toHaveLength(1);
  });

  test('depois de seis horas, repete', async () => {
    definir({ sessoes: { titulo: 'Contas sem conectar', mensagem: 'x' } });
    await vigia.verificar({ verificacoes: atuais });

    // Envelhece o último aviso em sete horas.
    mockEstado.valor.sessoes.ultimoAviso = Date.now() - 7 * 3600 * 1000;
    expect((await vigia.verificar({ verificacoes: atuais })).avisos).toBe(1);
    expect(mockNotificacoes).toHaveLength(2);
  });

  test('problemas diferentes avisam cada um por si', async () => {
    definir({
      sessoes: { titulo: 'contas', mensagem: 'a' },
      fila:  { titulo: 'fila',  mensagem: 'b' },
    });
    expect((await vigia.verificar({ verificacoes: atuais })).avisos).toBe(2);
  });
});

describe('recuperação', () => {
  test('avisa quando volta ao normal', async () => {
    /* Sem isto, quem recebeu "fila presa" às duas da manhã não tem como
       saber que voltou às três — e ou fica conferindo, ou aprende a ignorar. */
    definir({ sessoes: { titulo: 'Contas sem conectar', mensagem: 'x' } });
    await vigia.verificar({ verificacoes: atuais });
    mockNotificacoes.length = 0;

    definir({});
    const r = await vigia.verificar({ verificacoes: atuais });

    expect(r.avisos).toBe(1);
    expect(mockNotificacoes[0].titulo).toMatch(/Normalizado/);
    expect(mockNotificacoes[0].tema).toBe('success');
    expect(mockNotificacoes[0].metadados.recuperacao).toBe(true);
  });

  test('a recuperação diz quanto tempo durou', async () => {
    definir({ sessoes: { titulo: 'x', mensagem: 'y' } });
    await vigia.verificar({ verificacoes: atuais });
    mockEstado.valor.sessoes.desde = Date.now() - 5 * 3600 * 1000;
    mockNotificacoes.length = 0;

    definir({});
    await vigia.verificar({ verificacoes: atuais });
    expect(mockNotificacoes[0].mensagem).toMatch(/5 h/);
  });

  test('não avisa recuperação de problema que nunca houve', async () => {
    definir({});
    expect((await vigia.verificar({ verificacoes: atuais })).avisos).toBe(0);
    expect(mockNotificacoes).toHaveLength(0);
  });

  test('depois de recuperar, o problema voltando avisa de novo', async () => {
    definir({ sessoes: { titulo: 'x', mensagem: 'y' } });
    await vigia.verificar({ verificacoes: atuais });
    definir({});
    await vigia.verificar({ verificacoes: atuais });
    mockNotificacoes.length = 0;

    definir({ sessoes: { titulo: 'x', mensagem: 'y' } });
    expect((await vigia.verificar({ verificacoes: atuais })).avisos).toBe(1);
  });
});

describe('tolerância', () => {
  test('uma verificação que lança não cega as outras', async () => {
    /* O vigia importa exatamente quando algo está errado. Se uma verificação
       quebrada derrubar o ciclo, ele fica cego no único momento que conta. */
    const r = await vigia.verificar({
      verificacoes: {
        sessoes: async () => { throw new Error('banco caiu'); },
        fila:    async () => ({ titulo: 'fila presa', mensagem: 'z' }),
      },
    });
    expect(r.avisos).toBe(1);
    expect(mockNotificacoes[0].titulo).toBe('fila presa');
  });

  test('falha no push não impede o registro na Central', async () => {
    mockPush.mockRejectedValue(new Error('sem inscrição'));
    definir({ sessoes: { titulo: 'x', mensagem: 'y' } });

    const r = await vigia.verificar({ verificacoes: atuais });
    expect(r.avisos).toBe(1);
    expect(mockNotificacoes).toHaveLength(1);
  });
});

describe('desligado no painel', () => {
  /* Os avisos do vigia vêm desligados por padrão (thresholds.js), e ligar ou
     desligar no painel tem de valer para cada um. */
  test('aviso desligado não dispara, mesmo com problema de verdade', async () => {
    mockAtivos.valor.sessoes = false;
    definir({ sessoes: { titulo: 'Contas sem conectar', mensagem: 'x' } });

    const r = await vigia.verificar({ verificacoes: atuais });

    expect(r.avisos).toBe(0);
    expect(mockNotificacoes).toHaveLength(0);
  });

  test('desligar um não impede os outros', async () => {
    mockAtivos.valor.sessoes = false;
    definir({
      sessoes: { titulo: 'contas', mensagem: 'a' },
      fila:  { titulo: 'fila',  mensagem: 'b' },
    });

    const r = await vigia.verificar({ verificacoes: atuais });

    expect(r.avisos).toBe(1);
    expect(mockNotificacoes[0].titulo).toBe('fila');
  });

  test('a verificação desligada nem chega a rodar', async () => {
    mockAtivos.valor.sessoes = false;
    const chamada = jest.fn(async () => null);

    await vigia.verificar({ verificacoes: { ...atuais, sessoes: chamada } });

    expect(chamada).not.toHaveBeenCalled();
  });

  test('ligar de novo volta a disparar', async () => {
    mockAtivos.valor.sessoes = false;
    definir({ sessoes: { titulo: 'x', mensagem: 'y' } });
    await vigia.verificar({ verificacoes: atuais });
    expect(mockNotificacoes).toHaveLength(0);

    mockAtivos.valor.sessoes = true;
    const r = await vigia.verificar({ verificacoes: atuais });

    expect(r.avisos).toBe(1);
  });
});

/* ── As verificações de verdade, contra o banco ──────────────────────────── */
describe('as verificações leem o banco', () => {
  const banco = require('./helpers/banco');
  beforeEach(() => banco.limpar());

  test('contas sem conectar: só avisa quando é metade ou mais', async () => {
    await banco.criarConta({ username: 'a' });
    await banco.criarConta({ username: 'b' });
    await banco.criarConta({ username: 'c', healthStatus: 'token_invalido' });
    expect(await vigia.VERIFICACOES.sessoes()).toBeNull();
    await banco.criarConta({ username: 'd', healthStatus: 'token_invalido' });
    expect(await vigia.VERIFICACOES.sessoes()).toMatchObject({ vars: { contasRuins: 2, contasTotal: 4 } });
  });

  test('fila presa: processando há mais de uma hora', async () => {
    await banco.criarPost({ status: 'processando' });
    expect(await vigia.VERIFICACOES.fila()).toBeNull();
    await banco.criarPost({ status: 'processando', updatedAt: new Date(Date.now() - 2 * 3600_000) });
    expect(await vigia.VERIFICACOES.fila()).toMatchObject({ vars: { presas: 1 } });
  });

  test('erros do dia: a partir de 20', async () => {
    for (let i = 0; i < 19; i++) await banco.criarPost({ status: 'erro' });
    expect(await vigia.VERIFICACOES.erros()).toBeNull();
    await banco.criarPost({ status: 'erro' });
    expect(await vigia.VERIFICACOES.erros()).toMatchObject({ vars: { errosHoje: 20 } });
  });
});
