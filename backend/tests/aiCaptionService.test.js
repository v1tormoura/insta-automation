'use strict';

/**
 * Geração de legendas por IA.
 *
 * O que estes testes protegem: a chamada é paga e externa, então nada pode
 * chegar ao usuário como erro cru, briefing vazio não pode virar requisição, e
 * uma recusa por política (que vem com HTTP 200) não pode ser lida como
 * resposta normal.
 */

// Prefixo `mock` e exigencia do Jest para a fabrica de jest.mock() poder ver
// a variavel — sem ele o babel recusa o arquivo inteiro.
const mockCriar = jest.fn();

jest.mock('@anthropic-ai/sdk', () => {
  return class ClienteFalso {
    constructor() {
      this.messages = { create: mockCriar };
    }
  };
});

const CHAVE = process.env.ANTHROPIC_API_KEY;

function recarregar() {
  jest.resetModules();
  return require('../src/services/aiCaptionService');
}

function resposta(legendas) {
  return {
    stop_reason: 'end_turn',
    content: [{ type: 'text', text: JSON.stringify({ legendas }) }],
  };
}

beforeEach(() => {
  mockCriar.mockReset();
  process.env.ANTHROPIC_API_KEY = 'sk-teste';
});

afterAll(() => {
  if (CHAVE === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = CHAVE;
});

describe('disponivel', () => {
  test('false sem chave configurada', () => {
    delete process.env.ANTHROPIC_API_KEY;
    expect(recarregar().disponivel()).toBe(false);
  });

  test('false com chave só de espaços', () => {
    process.env.ANTHROPIC_API_KEY = '   ';
    expect(recarregar().disponivel()).toBe(false);
  });

  test('true com chave', () => {
    expect(recarregar().disponivel()).toBe(true);
  });
});

describe('gerarLegendas — validação de entrada', () => {
  test('briefing vazio não vira requisição paga', async () => {
    const ia = recarregar();
    await expect(ia.gerarLegendas({ briefing: '   ' })).rejects.toMatchObject({ code: 'AI_EMPTY_BRIEF' });
    expect(mockCriar).not.toHaveBeenCalled();
  });

  test('briefing gigante é recusado antes de sair', async () => {
    const ia = recarregar();
    await expect(ia.gerarLegendas({ briefing: 'a'.repeat(2001) }))
      .rejects.toMatchObject({ code: 'AI_BRIEF_TOO_LONG' });
    expect(mockCriar).not.toHaveBeenCalled();
  });

  test('sem chave nem tenta chamar', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const ia = recarregar();
    await expect(ia.gerarLegendas({ briefing: 'lançamento' }))
      .rejects.toMatchObject({ code: 'AI_NOT_CONFIGURED' });
    expect(mockCriar).not.toHaveBeenCalled();
  });
});

describe('gerarLegendas — requisição', () => {
  test('usa o modelo e a saída estruturada', async () => {
    const ia = recarregar();
    mockCriar.mockResolvedValue(resposta([{ texto: 'Olá', gancho: 'saudação' }]));

    await ia.gerarLegendas({ briefing: 'lançamento de curso' });

    const corpo = mockCriar.mock.calls[0][0];
    expect(corpo.model).toBe('claude-opus-5');
    expect(corpo.output_config.format.type).toBe('json_schema');
    expect(corpo.output_config.format.schema.required).toContain('legendas');
    expect(corpo.system).toContain('{username}');
  });

  test('quantidade e limite ficam presos em faixas seguras', async () => {
    const ia = recarregar();
    mockCriar.mockResolvedValue(resposta([{ texto: 'x', gancho: 'y' }]));

    await ia.gerarLegendas({ briefing: 'oferta', quantidade: 99, limite: 99999 });

    const pedido = mockCriar.mock.calls[0][0].messages[0].content;
    expect(pedido).toContain('6 variações');
    expect(pedido).toContain('2200 caracteres');
  });

  test('o tom escolhido entra no pedido', async () => {
    const ia = recarregar();
    mockCriar.mockResolvedValue(resposta([{ texto: 'x', gancho: 'y' }]));

    await ia.gerarLegendas({ briefing: 'oferta', tom: 'premium' });
    expect(mockCriar.mock.calls[0][0].messages[0].content).toContain('exclusividade');
  });

  test('tom desconhecido cai no neutro em vez de quebrar', async () => {
    const ia = recarregar();
    mockCriar.mockResolvedValue(resposta([{ texto: 'x', gancho: 'y' }]));

    await expect(ia.gerarLegendas({ briefing: 'oferta', tom: 'inventado' })).resolves.toBeTruthy();
  });
});

describe('gerarLegendas — resposta', () => {
  test('devolve as legendas limpas', async () => {
    const ia = recarregar();
    mockCriar.mockResolvedValue(resposta([
      { texto: '  Primeira  ', gancho: '  curiosidade  ' },
      { texto: 'Segunda', gancho: 'prova social' },
    ]));

    const { legendas, modelo } = await ia.gerarLegendas({ briefing: 'oferta' });
    expect(legendas).toEqual([
      { texto: 'Primeira', gancho: 'curiosidade' },
      { texto: 'Segunda',  gancho: 'prova social' },
    ]);
    expect(modelo).toBe('claude-opus-5');
  });

  test('descarta item sem texto em vez de devolver legenda vazia', async () => {
    const ia = recarregar();
    mockCriar.mockResolvedValue(resposta([{ texto: '', gancho: 'a' }, { texto: 'Vale', gancho: 'b' }]));

    const { legendas } = await ia.gerarLegendas({ briefing: 'oferta' });
    expect(legendas).toHaveLength(1);
  });

  test('recusa por política não é lida como resposta boa', async () => {
    const ia = recarregar();
    mockCriar.mockResolvedValue({
      stop_reason: 'refusal',
      stop_details: { type: 'refusal', category: 'other' },
      content: [],
    });

    await expect(ia.gerarLegendas({ briefing: 'algo' })).rejects.toMatchObject({ code: 'AI_REFUSED' });
  });

  test('resposta fora do formato vira erro legível', async () => {
    const ia = recarregar();
    mockCriar.mockResolvedValue({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'não é json' }] });

    await expect(ia.gerarLegendas({ briefing: 'algo' })).rejects.toMatchObject({ code: 'AI_BAD_OUTPUT' });
  });

  test('lista vazia vira erro em vez de sucesso sem nada', async () => {
    const ia = recarregar();
    mockCriar.mockResolvedValue(resposta([]));

    await expect(ia.gerarLegendas({ briefing: 'algo' })).rejects.toMatchObject({ code: 'AI_BAD_OUTPUT' });
  });
});

describe('_traduzir — nenhum erro cru chega ao usuário', () => {
  test('401 vira instrução sobre a chave, sem citar cabeçalho', () => {
    const ia = recarregar();
    const e = ia._traduzir({ status: 401, message: 'invalid x-api-key header' });
    expect(e.code).toBe('AI_UNAUTHORIZED');
    expect(e.message).not.toMatch(/x-api-key/);
  });

  test('429 vira "tente de novo"', () => {
    expect(recarregar()._traduzir({ status: 429 }).code).toBe('AI_RATE_LIMITED');
  });

  test('500 vira indisponibilidade do serviço', () => {
    expect(recarregar()._traduzir({ status: 503 }).code).toBe('AI_UPSTREAM');
  });

  test('erro sem status ainda vira AiError', () => {
    const e = recarregar()._traduzir(new Error('socket hang up'));
    expect(e.code).toBe('AI_ERROR');
    expect(e.name).toBe('AiError');
  });
});
