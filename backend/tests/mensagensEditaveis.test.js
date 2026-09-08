'use strict';

/**
 * Mensagens editáveis — inclusive as dos avisos do sistema.
 *
 * ── O que estes testes protegem
 *
 * Os seis avisos do vigia tinham o texto embutido em template string. Passá-lo
 * para modelo editável é o tipo de mudança que quebra em silêncio: a
 * notificação continua saindo, só com a frase errada — ou com `{{presas}}`
 * escrito na tela. Ninguém repara até acontecer um problema de verdade, que é
 * o único momento em que esses avisos aparecem.
 *
 * Então o primeiro teste é o mais chato e o mais importante: o texto padrão
 * tem de ser o MESMO de antes, palavra por palavra. Editar passou a ser
 * possível; receber outra coisa sem pedir, não.
 */

const t = require('../src/services/smartActivity/templates');

describe('O texto padrão não mudou', () => {
  /* Copiado do vigia ANTES da mudança. Se alguém reescrever uma frase por
     acidente, é aqui que aparece — e não num celular às três da manhã. */
  const ANTES = {
    proxy: {
      titulo: 'O proxy parou de responder',
      mensagem: 'A automação não consegue sair para o Instagram.',
      vars: { erro: 'A automação não consegue sair para o Instagram.' },
    },
    pool: {
      titulo: 'O pool de proxies acabou',
      mensagem: 'Os 8 proxies estão reservados. A próxima conta vai sair pelo IP global, '
              + 'dividindo endereço com as outras — o padrão que o Instagram lê como automação.',
      vars: { proxies: 8 },
    },
    sessoes: {
      titulo: '5 de 9 contas sem conseguir conectar',
      mensagem: 'Quando é a maioria de uma vez, a causa costuma ser comum a todas — '
              + 'proxy, rede ou serviço — e não cada conta individualmente.',
      vars: { contasRuins: 5, contasTotal: 9 },
    },
    fila: {
      titulo: '2 publicação(ões) presa(s) na fila',
      mensagem: 'Em processamento há mais de uma hora. Normalmente leva segundos — '
              + 'quando passa disso, alguma coisa travou no meio.',
      vars: { presas: 2 },
    },
    erros: {
      titulo: '23 erros de publicação hoje',
      mensagem: 'Muitos erros no mesmo dia raramente são coincidência. '
              + 'Vale olhar se todos têm o mesmo motivo.',
      vars: { errosHoje: 23 },
    },
    cota: {
      titulo: 'Cota do proxy em 87%',
      mensagem: '12 GB de 100 GB restantes. No ritmo atual, acaba em cerca de 4 dia(s). '
              + 'Renove antes de acabar — quando acaba, tudo para de uma vez.',
      vars: { percentual: 87, restanteGb: 12, totalGb: 100, diasRestantes: 4,
              previsao: 'No ritmo atual, acaba em cerca de 4 dia(s).' },
    },
  };

  for (const [chave, esperado] of Object.entries(ANTES)) {
    test(`${chave}: mesma frase de antes`, () => {
      const m = t.PADRAO[chave];
      expect(t.render(m.titulo, esperado.vars)).toBe(esperado.titulo);
      expect(t.render(m.mensagem, esperado.vars)).toBe(esperado.mensagem);
    });
  }

  test('nenhum modelo sai com marcador sobrando quando recebe as suas variáveis', () => {
    for (const chave of Object.keys(t.PADRAO)) {
      const vars = t.EXEMPLOS;
      const saida = t.render(t.PADRAO[chave].titulo, vars) + t.render(t.PADRAO[chave].mensagem, vars);
      /* Um `{{` no resultado significa variável usada pelo modelo que a lista
         de exemplos não tem — o mesmo defeito que apareceria na tela. */
      expect(saida).not.toContain('{{');
    }
  });

  test('todo modelo declara as suas variáveis, e só usa as declaradas', () => {
    for (const [chave, modelo] of Object.entries(t.PADRAO)) {
      const usadas = [...`${modelo.titulo} ${modelo.mensagem}`.matchAll(/\{\{\s*(\w+)\s*\}\}/g)]
        .map(m => m[1]);
      const permitidas = t.VARIAVEIS_POR_TIPO[chave];
      expect(permitidas).toBeDefined();
      for (const v of usadas) expect(permitidas).toContain(v);
    }
  });

  test('toda variável declarada existe no dicionário com descrição', () => {
    for (const nomes of Object.values(t.VARIAVEIS_POR_TIPO)) {
      for (const n of nomes) {
        expect(typeof t.VARIAVEIS[n]).toBe('string');
        expect(t.VARIAVEIS[n].length).toBeGreaterThan(0);
      }
    }
  });

  test('toda variável declarada tem valor de exemplo — a prévia depende disso', () => {
    for (const nomes of Object.values(t.VARIAVEIS_POR_TIPO)) {
      for (const n of nomes) expect(t.EXEMPLOS[n]).toBeDefined();
    }
  });
});

describe('validação por tipo', () => {
  test('variável de outro aviso é recusada', () => {
    /* `presas` existe no sistema e não existe num aviso de story. Aprovar aqui
       deixaria `{{presas}}` literal sair na notificação. */
    expect(t.validar('{{presas}} pessoas', 'storyViews')).toEqual(['presas']);
    expect(t.validar('{{account}} viu', 'fila')).toEqual(['account']);
  });

  test('variável do próprio aviso passa', () => {
    expect(t.validar('{{presas}} presas', 'fila')).toEqual([]);
    expect(t.validar('{{account}} chegou a {{views}}', 'storyViews')).toEqual([]);
  });

  test('sem tipo, confere contra o dicionário inteiro — como os chamadores antigos', () => {
    expect(t.validar('{{presas}} e {{account}}')).toEqual([]);
    expect(t.validar('{{naoExiste}}')).toEqual(['naoExiste']);
  });

  test('tipo desconhecido não recusa tudo', () => {
    /* Recusar contra uma lista vazia transformaria um tipo não mapeado em
       "nenhuma variável é válida", e nada poderia ser salvo. */
    expect(t.validar('{{account}}', 'tipoQueNaoExiste')).toEqual([]);
  });

  test('variaveisDe devolve só as do aviso, com descrição', () => {
    const v = t.variaveisDe('fila');
    expect(Object.keys(v)).toEqual(['presas']);
    expect(v.presas).toMatch(/fila/i);
  });

  test('variaveisDe de tipo desconhecido devolve tudo, não vazio', () => {
    expect(Object.keys(t.variaveisDe('nada')).length).toBe(Object.keys(t.VARIAVEIS).length);
  });
});

describe('modeloDe completa campo por campo', () => {
  test('título próprio não apaga a mensagem padrão', () => {
    const m = t.modeloDe('fila', { fila: { titulo: 'A fila travou' } });
    expect(m.titulo).toBe('A fila travou');
    expect(m.mensagem).toBe(t.PADRAO.fila.mensagem);
  });

  test('campo vazio volta ao padrão em vez de sair em branco', () => {
    const m = t.modeloDe('erros', { erros: { titulo: '', mensagem: '' } });
    expect(m.titulo).toBe(t.PADRAO.erros.titulo);
    expect(m.mensagem).toBe(t.PADRAO.erros.mensagem);
  });

  test('sem nada salvo, é o padrão', () => {
    expect(t.modeloDe('pool', {})).toEqual(t.PADRAO.pool);
    expect(t.modeloDe('pool')).toEqual(t.PADRAO.pool);
  });
});

/* ── O vigia usando os modelos ──────────────────────────────────────────── */

const mockEstado = { valor: {} };
const mockNotificacoes = [];
const mockMensagens = { valor: {} };

jest.mock('../src/models/Setting', () => ({
  findOne: () => ({ lean: async () => ({ value: mockEstado.valor }) }),
  updateOne: async (_f, up) => { mockEstado.valor = up.$set.value; return { ok: 1 }; },
}));
jest.mock('../src/models/Notificacao', () => ({
  async create(doc) { mockNotificacoes.push(doc); return { _id: 'n', ...doc }; },
}));
jest.mock('../src/services/smartActivity/webPush', () => ({ enviar: async () => ({ enviados: 0 }) }));
jest.mock('../src/events/broadcaster', () => ({ broadcast: jest.fn() }));
jest.mock('../src/services/smartActivity/thresholds', () => ({
  CHAVE: 'smartActivity',
  carregar: async () => ({ mensagens: mockMensagens.valor }),
}));

const vigia = require('../src/services/vigiaDoSistema');

/** Só a verificação nomeada acha problema; as outras ficam quietas. */
const so = (chave, problema) => Object.fromEntries(
  Object.keys(vigia.VERIFICACOES).map(k => [k, async () => (k === chave ? problema : null)])
);

describe('vigiaDoSistema usa o modelo editável', () => {
  beforeEach(() => {
    mockEstado.valor = {};
    mockNotificacoes.length = 0;
    mockMensagens.valor = {};
    vigia.bancoConectado = () => true;
  });

  test('sem nada editado, sai o texto padrão renderizado', async () => {
    await vigia.verificar({ verificacoes: so('fila', { vars: { presas: 3 }, prioridade: 'normal' }) });
    expect(mockNotificacoes[0].titulo).toBe('3 publicação(ões) presa(s) na fila');
    expect(mockNotificacoes[0].mensagem).toBe(t.PADRAO.fila.mensagem);
  });

  test('com modelo salvo, sai o texto de quem editou', async () => {
    mockMensagens.valor = { fila: { titulo: 'Socorro: {{presas}} presas', mensagem: 'Olha a fila.' } };
    await vigia.verificar({ verificacoes: so('fila', { vars: { presas: 7 }, prioridade: 'normal' }) });
    expect(mockNotificacoes[0].titulo).toBe('Socorro: 7 presas');
    expect(mockNotificacoes[0].mensagem).toBe('Olha a fila.');
  });

  test('o tema só muda quando alguém escolheu um', async () => {
    /* Sem escolha: continua derivado da prioridade, como antes. Ligar a edição
       não pode repintar o aviso de quem nunca editou nada. */
    await vigia.verificar({ verificacoes: so('proxy', { vars: { erro: 'x' }, prioridade: 'alta' }) });
    expect(mockNotificacoes[0].tema).toBe('warning');

    mockEstado.valor = {};
    mockNotificacoes.length = 0;
    mockMensagens.valor = { proxy: { tema: 'achievement' } };
    await vigia.verificar({ verificacoes: so('proxy', { vars: { erro: 'x' }, prioridade: 'alta' }) });
    expect(mockNotificacoes[0].tema).toBe('achievement');
  });

  test('verificação com texto pronto ignora o modelo', async () => {
    /* O seam dos dublês: "minha frase já é final". Sem isto, o modelo do
       painel sobrescreveria o texto de uma verificação injetada. */
    mockMensagens.valor = { fila: { titulo: 'do painel', mensagem: 'do painel' } };
    await vigia.verificar({
      verificacoes: so('fila', { titulo: 'texto pronto', mensagem: 'já final' }),
    });
    expect(mockNotificacoes[0].titulo).toBe('texto pronto');
  });

  test('a recuperação usa o modelo `normalizado` e um nome legível', async () => {
    mockEstado.valor = { sessoes: { desde: Date.now() - 5 * 3.6e6, ultimoAviso: Date.now() - 5 * 3.6e6 } };
    await vigia.verificar({ verificacoes: so('sessoes', null) });

    const n = mockNotificacoes[0];
    /* Saía "Normalizado: sessoes" — a chave interna, sem acento, no meio de
       uma frase em português. */
    expect(n.titulo).toBe('Normalizado: sessões das contas');
    expect(n.titulo).not.toContain('sessoes');
    expect(n.mensagem).toMatch(/5 h/);
    expect(n.tema).toBe('success');
  });

  test('a recuperação também é editável', async () => {
    mockMensagens.valor = { normalizado: { titulo: '✅ {{aviso}} voltou', mensagem: '{{horas}}h fora.' } };
    mockEstado.valor = { proxy: { desde: Date.now() - 2 * 3.6e6, ultimoAviso: Date.now() - 2 * 3.6e6 } };
    await vigia.verificar({ verificacoes: so('proxy', null) });
    expect(mockNotificacoes[0].titulo).toBe('✅ proxy voltou');
    expect(mockNotificacoes[0].mensagem).toBe('2h fora.');
  });

  test('modelo editado com variável que não existe sai com o marcador visível', async () => {
    /* De propósito. Um `{{typo}}` na tela é consertado no mesmo dia; um espaço
       em branco no lugar não é consertado nunca — ver templates.js. */
    mockMensagens.valor = { erros: { titulo: '{{naoExiste}} erros' } };
    await vigia.verificar({ verificacoes: so('erros', { vars: { errosHoje: 40 } }) });
    expect(mockNotificacoes[0].titulo).toBe('{{naoExiste}} erros');
  });

  test('falha ao ler os modelos não impede o aviso', async () => {
    jest.resetModules();
    /* O aviso é a razão de o vigia existir. Se a configuração não abrir, ele
       tem de sair com o padrão em vez de não sair. */
    const th = require('../src/services/smartActivity/thresholds');
    const original = th.carregar;
    th.carregar = async () => { throw new Error('sem banco'); };
    try {
      await vigia.verificar({ verificacoes: so('fila', { vars: { presas: 1 } }) });
      expect(mockNotificacoes[0].titulo).toBe('1 publicação(ões) presa(s) na fila');
    } finally {
      th.carregar = original;
    }
  });
});
