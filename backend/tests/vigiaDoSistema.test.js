/**
 * Vigia do sistema.
 *
 * ── O que ele evita
 *
 * A cota do proxy acabou e o produto ficou parado quatro dias e meio sem que
 * nada avisasse. Quando a descoberta veio — pelas contas ficarem estranhas —
 * a causa já estava a quatro dias de distância do sintoma, e reconstruir esse
 * caminho custou uma semana.
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

jest.mock('../src/models/Setting', () => ({
  findOne: () => ({ lean: async () => ({ value: mockEstado.valor }) }),
  updateOne: async (_f, up) => { mockEstado.valor = up.$set.value; return { ok: 1 }; },
}));

jest.mock('../src/models/Notificacao', () => ({
  async create(doc) { mockNotificacoes.push(doc); return { _id: 'n' + mockNotificacoes.length, ...doc }; },
}));

jest.mock('../src/services/smartActivity/webPush', () => ({ enviar: (...a) => mockPush(...a) }));
jest.mock('../src/events/broadcaster', () => ({ broadcast: jest.fn() }));

const vigia = require('../src/services/vigiaDoSistema');

/* Dublês passados por PARÂMETRO. A primeira versão tentava sobrescrever o mapa
   exportado e não funcionava: ele é `Object.freeze`, e a atribuição silenciosa
   deixava as verificações REAIS rodarem contra modelos sem conexão — que o
   mongoose enfileira por dez segundos, estourando o tempo de todo teste.
   Injetar é mais simples e não pede que o módulo abra mão da imutabilidade. */
const dubles = (mapa) => Object.fromEntries(
  Object.keys(vigia.VERIFICACOES).map(k => [k, async () => mapa[k] || null])
);
const definir = (mapa) => { atuais = dubles(mapa); };

beforeEach(() => {
  mockEstado.valor = {};
  mockNotificacoes.length = 0;
  mockPush.mockReset().mockResolvedValue({ enviados: 1 });
  vigia.bancoConectado = () => true;
  atuais = dubles({});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

describe('avisar', () => {
  test('problema novo gera aviso e push', async () => {
    definir({ proxy: { titulo: 'O proxy parou', mensagem: 'sem saída', prioridade: 'alta' } });
    const r = await vigia.verificar({ verificacoes: atuais });

    expect(r.avisos).toBe(1);
    expect(mockNotificacoes[0].titulo).toBe('O proxy parou');
    expect(mockNotificacoes[0].eventType).toBe('sistema');
    expect(mockPush).toHaveBeenCalledTimes(1);
  });

  test('prioridade alta usa o tema de alerta, não o neutro', async () => {
    definir({ proxy: { titulo: 'x', mensagem: 'y', prioridade: 'alta' } });
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
    definir({ proxy: { titulo: 'O proxy parou', mensagem: 'x' } });

    expect((await vigia.verificar({ verificacoes: atuais })).avisos).toBe(1);
    expect((await vigia.verificar({ verificacoes: atuais })).avisos).toBe(0);
    expect((await vigia.verificar({ verificacoes: atuais })).avisos).toBe(0);
    expect(mockNotificacoes).toHaveLength(1);
  });

  test('depois de seis horas, repete', async () => {
    definir({ proxy: { titulo: 'O proxy parou', mensagem: 'x' } });
    await vigia.verificar({ verificacoes: atuais });

    // Envelhece o último aviso em sete horas.
    mockEstado.valor.proxy.ultimoAviso = Date.now() - 7 * 3600 * 1000;
    expect((await vigia.verificar({ verificacoes: atuais })).avisos).toBe(1);
    expect(mockNotificacoes).toHaveLength(2);
  });

  test('problemas diferentes avisam cada um por si', async () => {
    definir({
      proxy: { titulo: 'proxy', mensagem: 'a' },
      fila:  { titulo: 'fila',  mensagem: 'b' },
    });
    expect((await vigia.verificar({ verificacoes: atuais })).avisos).toBe(2);
  });
});

describe('recuperação', () => {
  test('avisa quando volta ao normal', async () => {
    /* Sem isto, quem recebeu "proxy fora do ar" às duas da manhã não tem como
       saber que voltou às três — e ou fica conferindo, ou aprende a ignorar. */
    definir({ proxy: { titulo: 'O proxy parou', mensagem: 'x' } });
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
    definir({ proxy: { titulo: 'x', mensagem: 'y' } });
    await vigia.verificar({ verificacoes: atuais });
    mockEstado.valor.proxy.desde = Date.now() - 5 * 3600 * 1000;
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
    definir({ proxy: { titulo: 'x', mensagem: 'y' } });
    await vigia.verificar({ verificacoes: atuais });
    definir({});
    await vigia.verificar({ verificacoes: atuais });
    mockNotificacoes.length = 0;

    definir({ proxy: { titulo: 'x', mensagem: 'y' } });
    expect((await vigia.verificar({ verificacoes: atuais })).avisos).toBe(1);
  });
});

describe('tolerância', () => {
  test('uma verificação que lança não cega as outras', async () => {
    /* O vigia importa exatamente quando algo está errado. Se uma verificação
       quebrada derrubar o ciclo, ele fica cego no único momento que conta. */
    const r = await vigia.verificar({
      verificacoes: {
        proxy:   async () => { throw new Error('mongo caiu'); },
        fila:    async () => ({ titulo: 'fila presa', mensagem: 'z' }),
      },
    });
    expect(r.avisos).toBe(1);
    expect(mockNotificacoes[0].titulo).toBe('fila presa');
  });

  test('sem banco, não faz nada em vez de enfileirar consulta', async () => {
    // Mongoose enfileira sem conexão e só desiste em 10s — um ciclo de vigia
    // travado por 10s a cada 10min é pior que um ciclo que não roda.
    vigia.bancoConectado = () => false;
    expect(await vigia.verificar({ verificacoes: atuais })).toEqual({ avisos: 0, ativos: [], motivo: 'sem banco' });
  });

  test('falha no push não impede o registro na Central', async () => {
    mockPush.mockRejectedValue(new Error('sem inscrição'));
    definir({ proxy: { titulo: 'x', mensagem: 'y' } });

    const r = await vigia.verificar({ verificacoes: atuais });
    expect(r.avisos).toBe(1);
    expect(mockNotificacoes).toHaveLength(1);
  });
});
