/**
 * Notificação de publicação — sucesso e falha.
 *
 * ── O que estes testes protegem
 *
 * A publicação já é o evento em si — diferente do marco, que espera métrica
 * chegar do Instagram. O risco aqui não é duplicata (cada chamada É uma
 * publicação distinta, e duas contas publicando o mesmo vídeo devem gerar
 * dois avisos), é o gate: quem desligou "publicado" ou "erro" no painel não
 * pode continuar recebendo, e quem não desligou não pode ficar sem.
 */

const mockNotificacoes = [];
const mockPush = jest.fn();
const mockBroadcast = jest.fn();

jest.mock('../src/models/Notificacao', () => ({
  async create(doc) {
    const nova = { ...doc, _id: `n${mockNotificacoes.length + 1}`, criadaEm: new Date() };
    mockNotificacoes.push(nova);
    return nova;
  },
}));

jest.mock('../src/services/smartActivity/webPush', () => ({
  disponivel: () => true,
  enviar: (...a) => mockPush(...a),
}));

jest.mock('../src/events/broadcaster', () => ({ broadcast: (...a) => mockBroadcast(...a) }));

const thresholds = require('../src/services/smartActivity/thresholds');
thresholds.bancoConectado = () => true;

const CFG = {
  ativos: { postPublicado: true, erroPublicacao: true },
  mensagens: {},
  privacidade: { mostrarNome: true, mostrarValor: true },
};

const eventos = require('../src/services/smartActivity/eventosDePublicacao');

const conta = (id = 'c1', username = 'oliviapaganini') => ({ _id: id, username, avatar: '' });

beforeEach(() => {
  mockNotificacoes.length = 0;
  mockPush.mockReset().mockResolvedValue({ enviados: 1 });
  mockBroadcast.mockReset();
  thresholds.carregar = async () => ({ ...CFG });
});

describe('notificarPublicado', () => {
  test('publicação com sucesso grava e envia push', async () => {
    const n = await eventos.notificarPublicado({ conta: conta(), contentType: 'VIDEO' });

    expect(n).toBeTruthy();
    expect(n.eventType).toBe('postPublicado');
    expect(n.titulo).toBe('Publicado ✅');
    expect(n.mensagem).toBe('@oliviapaganini publicou um Reel.');
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockBroadcast).toHaveBeenCalledWith('notificacoes', { novas: 1 });
  });

  test('duas contas publicando o mesmo conteúdo geram DOIS avisos', async () => {
    // Diferente do marco: aqui não existe "a mesma publicação de novo".
    await eventos.notificarPublicado({ conta: conta('a', 'ana'), contentType: 'STORY' });
    await eventos.notificarPublicado({ conta: conta('b', 'bia'), contentType: 'STORY' });
    expect(mockNotificacoes).toHaveLength(2);
  });

  test('desligado no painel não grava nem envia', async () => {
    thresholds.carregar = async () => ({ ...CFG, ativos: { ...CFG.ativos, postPublicado: false } });
    const n = await eventos.notificarPublicado({ conta: conta(), contentType: 'VIDEO' });

    expect(n).toBeNull();
    expect(mockNotificacoes).toHaveLength(0);
    expect(mockPush).not.toHaveBeenCalled();
  });

  test('aceita o vocabulário do modelo Post (minúsculo), não só o do Graph API', async () => {
    const n = await eventos.notificarPublicado({ conta: conta(), contentType: 'reel' });
    expect(n.mensagem).toBe('@oliviapaganini publicou um Reel.');
  });

  test('privacidade de nome troca @ por termo genérico', async () => {
    thresholds.carregar = async () => ({
      ...CFG, privacidade: { mostrarNome: false, mostrarValor: true },
    });
    const n = await eventos.notificarPublicado({ conta: conta(), contentType: 'VIDEO' });
    expect(n.mensagem).not.toContain('oliviapaganini');
    expect(n.mensagem).toBe('sua conta publicou um Reel.');
  });
});

describe('notificarErro', () => {
  test('falha ao publicar grava com prioridade alta', async () => {
    const n = await eventos.notificarErro({
      conta: conta(), contentType: 'STORY', erro: 'Tempo de conexão esgotado.',
    });

    expect(n.eventType).toBe('erroPublicacao');
    expect(n.prioridade).toBe('alta');
    expect(n.mensagem).toBe('@oliviapaganini: Tempo de conexão esgotado.');
  });

  test('desligado no painel não grava', async () => {
    thresholds.carregar = async () => ({ ...CFG, ativos: { ...CFG.ativos, erroPublicacao: false } });
    const n = await eventos.notificarErro({ conta: conta(), erro: 'x' });
    expect(n).toBeNull();
    expect(mockNotificacoes).toHaveLength(0);
  });

  test('sem conta, não grava nem lança', async () => {
    await expect(eventos.notificarErro({ erro: 'x' })).resolves.toBeNull();
    await expect(eventos.notificarPublicado({})).resolves.toBeNull();
  });

  test('mensagem de erro não é escondida pela privacidade de valor', async () => {
    // A frase inteira É o aviso — esconder o "porquê" tornaria o alerta inútil.
    thresholds.carregar = async () => ({
      ...CFG, privacidade: { mostrarNome: true, mostrarValor: false },
    });
    const n = await eventos.notificarErro({ conta: conta(), erro: 'Sessão expirou.' });
    expect(n.mensagem).toContain('Sessão expirou.');
  });
});
