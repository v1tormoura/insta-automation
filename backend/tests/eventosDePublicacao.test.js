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

const mockPush = jest.fn();
const mockBroadcast = jest.fn();

jest.mock('../src/services/smartActivity/webPush', () => ({
  disponivel: () => true,
  enviar: (...a) => mockPush(...a),
}));

jest.mock('../src/events/broadcaster', () => ({ broadcast: (...a) => mockBroadcast(...a) }));

const thresholds = require('../src/services/smartActivity/thresholds');
const banco = require('./helpers/banco');
const gravadas = () => banco.sql`select * from notificacoes`;

const CFG = {
  ativos: { postPublicado: true, erroPublicacao: true },
  mensagens: {},
  privacidade: { mostrarNome: true, mostrarValor: true },
};

const eventos = require('../src/services/smartActivity/eventosDePublicacao');

/* As notificações apontam para a conta: ela precisa existir no banco. */
const contas = {};
const conta = (chave = 'c1', username = 'oliviapaganini') => contas[chave] || { username };

beforeEach(async () => {
  await banco.limpar();
  contas.c1 = await banco.criarConta({ username: 'oliviapaganini' });
  contas.a = await banco.criarConta({ username: 'ana' });
  contas.b = await banco.criarConta({ username: 'bia' });
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
    expect(await gravadas()).toHaveLength(2);
  });

  test('desligado no painel não grava nem envia', async () => {
    thresholds.carregar = async () => ({ ...CFG, ativos: { ...CFG.ativos, postPublicado: false } });
    const n = await eventos.notificarPublicado({ conta: conta(), contentType: 'VIDEO' });

    expect(n).toBeNull();
    expect(await gravadas()).toHaveLength(0);
    expect(mockPush).not.toHaveBeenCalled();
  });

  test('aceita o vocabulário dos posts (minúsculo), não só o da Graph API', async () => {
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
    expect(await gravadas()).toHaveLength(0);
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
    const n = await eventos.notificarErro({ conta: conta(), erro: 'Token expirou.' });
    expect(n.mensagem).toContain('Token expirou.');
  });
});

describe('avisos que não repetem', () => {
  test('conta caiu: um aviso por janela de 6h', async () => {
    const um = await eventos.notificarContaCaiu({ conta: conta(), motivo: 'token inválido' });
    const dois = await eventos.notificarContaCaiu({ conta: conta(), motivo: 'token inválido' });
    expect(um).toBeTruthy();
    expect(dois).toBeNull();
    // Outra conta não é bloqueada pela janela da primeira.
    expect(await eventos.notificarContaCaiu({ conta: conta('a', 'ana'), motivo: 'x' })).toBeTruthy();
  });

  test('cota da API cheia diz quando libera', async () => {
    const n = await eventos.notificarCotaDaApi({ conta: conta(), motivo: 'cota (50/50)', ate: new Date('2026-09-25T14:35:00') });
    expect(n.eventType).toBe('cotaApi');
    expect(n.mensagem).toMatch(/50\/50/);
  });
});
