/**
 * Conferência de ambiente antes de conectar.
 *
 * ── O que ela separa
 *
 * Conectar era tentar e ver no que dá. Quando o ambiente estava quebrado — a
 * cota do proxy tinha acabado — o resultado era um erro de LOGIN, e a leitura
 * natural de um erro de login é culpar a conta ou a senha.
 *
 * Foi o que aconteceu: a tela dizia "verifique se o proxy está ativo", e a
 * conclusão de quem lê aquilo é trocar senha, tentar outra conta, desconfiar
 * do @. Nada disso chega perto de "a cota acabou".
 *
 * Estes testes protegem a separação: cada bloqueio precisa apontar para o dono
 * certo do problema, e "ambiente pronto" precisa significar que o próximo erro
 * é do Instagram, não do ambiente.
 */

const mockResolver = jest.fn();
const mockTestProxy = jest.fn();

jest.mock('../src/services/globalProxy', () => ({ resolverComOrigem: (...a) => mockResolver(...a) }));
jest.mock('../src/services/testProxy', () => (...a) => mockTestProxy(...a));

const { conferir } = require('../src/services/preflightConexao');

const comServico = (ok) => {
  global.fetch = jest.fn(async () => (ok
    ? { ok: true, status: 200 }
    : { ok: false, status: 502 }));
};

beforeEach(() => {
  mockResolver.mockReset().mockResolvedValue({ url: 'http://u:p@host:1', origem: 'pool' });
  mockTestProxy.mockReset().mockResolvedValue({ ok: true, ip: '200.190.131.84', latencyMs: 320 });
  comServico(true);
});

describe('tudo pronto', () => {
  test('diz que o próximo erro será do Instagram, não do ambiente', async () => {
    /* Esta frase é o produto inteiro deste módulo: sem ela, quem vê o login
       falhar não sabe se procura na conta ou na infraestrutura. */
    const r = await conferir();
    expect(r.pronto).toBe(true);
    expect(r.veredito).toMatch(/Instagram recusando esta conta/i);
    expect(r.itens.proxy.ip).toBe('200.190.131.84');
  });
});

describe('cada bloqueio aponta para o dono do problema', () => {
  test('serviço fora: não é problema desta conta', async () => {
    comServico(false);
    const r = await conferir();

    expect(r.pronto).toBe(false);
    expect(r.bloqueios).toContain('servico');
    expect(r.veredito).toMatch(/não é problema desta conta/i);
    expect(r.itens.servico.conserto).toMatch(/instagrapi-svc/);
  });

  test('proxy recusando: não é a senha nem o @', async () => {
    // A leitura errada que custou a semana. A frase precisa dizer isso.
    mockTestProxy.mockResolvedValue({
      ok: false,
      error: 'O proxy recusou: a cota de tráfego do plano acabou (TRAFFIC_EXHAUSTED)',
    });
    const r = await conferir();

    expect(r.pronto).toBe(false);
    expect(r.veredito).toMatch(/não é a senha nem o @/i);
    expect(r.itens.proxy.detalhe).toMatch(/cota de tráfego/i);
  });

  test('o serviço fora ganha do proxy na explicação', async () => {
    /* Com os dois quebrados, dizer "o proxy não responde" mandaria mexer no
       fornecedor quando nem o serviço que usa o proxy está de pé. */
    comServico(false);
    mockTestProxy.mockResolvedValue({ ok: false, error: 'x' });
    const r = await conferir();
    expect(r.veredito).toMatch(/serviço que fala com o Instagram/i);
  });
});

describe('sem proxy é escolha, não falha', () => {
  test('não bloqueia, mas diz que a conta sai pelo IP do servidor', async () => {
    /* Bloquear seria errado — dá para operar sem proxy. Calar também seria:
       várias contas no mesmo IP é o padrão que o Instagram lê como automação,
       e quem escolheu isso deveria estar escolhendo com a informação. */
    mockResolver.mockResolvedValue({ url: '', origem: 'nenhum' });
    const r = await conferir();

    expect(r.pronto).toBe(true);
    expect(r.veredito).toMatch(/IP do servidor/i);
    expect(mockTestProxy).not.toHaveBeenCalled();
  });
});

describe('não polui a métrica que ajuda a interpretar', () => {
  test('resolve o proxy SEM contabilizar operação', async () => {
    /* `resolverComOrigem` conta cada saída para a projeção de consumo. Se a
       conferência contasse, abrir o modal de conectar engordaria o consumo do
       dia sem nenhuma operação ter saído — e a projeção que ela ajuda a ler
       ficaria pessimista por causa dela mesma. */
    await conferir();
    expect(mockResolver).toHaveBeenCalledWith(expect.anything(), { contabilizar: false });
  });
});

describe('tolerância', () => {
  test('uma verificação que lança não derruba a outra', async () => {
    mockResolver.mockRejectedValue(new Error('mongo caiu'));
    const r = await conferir();

    expect(r.itens.servico.ok).toBe(true);
    expect(r.itens.proxy.ok).toBe(false);
    expect(r.pronto).toBe(false);
  });

  test('serviço lento conta como fora, com o tempo dito', async () => {
    global.fetch = jest.fn(async () => { throw Object.assign(new Error('t'), { name: 'TimeoutError' }); });
    const r = await conferir();
    expect(r.itens.servico.detalhe).toMatch(/8s/);
  });
});
