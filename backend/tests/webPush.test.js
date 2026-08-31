/**
 * Web Push — envio e higiene das inscrições.
 *
 * O que estes testes protegem não é "a notificação chegou" — isso depende de um
 * serviço externo e de um aparelho real. É o COMPORTAMENTO EM VOLTA da entrega,
 * que é onde push costuma apodrecer em silêncio:
 *
 *   • inscrição morta que nunca é removida faz cada envio futuro gastar uma
 *     requisição para receber o mesmo 410, para sempre;
 *   • inscrição viva removida por uma instabilidade de dez minutos desinscreve
 *     o usuário sem que ninguém perceba, até ele reclamar semanas depois;
 *   • um erro de push que derrube a detecção transformaria um extra opcional
 *     em ponto único de falha do módulo inteiro.
 */

const mockInscricoes = [];
const mockEnviados = [];

/* Falhas programadas por endpoint: { endpoint: statusCode }. */
const mockFalhas = {};

jest.mock('../src/models/PushSubscription', () => ({
  find(filtro = {}) {
    return { lean: async () => mockInscricoes.filter(i => {
      const lim = filtro.falhas?.$lt;
      return lim === undefined || (i.falhas || 0) < lim;
    }) };
  },
  async updateOne(filtro, atualizacao) {
    const alvo = mockInscricoes.find(i => String(i._id) === String(filtro._id)
      || i.endpoint === filtro.endpoint);
    if (!alvo) {
      if (filtro.endpoint) {
        mockInscricoes.push({ _id: `s${mockInscricoes.length + 1}`, falhas: 0,
          ...filtro, ...(atualizacao.$set || {}) });
        return { upsertedCount: 1 };
      }
      return { matchedCount: 0 };
    }
    if (atualizacao.$set) Object.assign(alvo, atualizacao.$set);
    if (atualizacao.$inc) for (const [k, v] of Object.entries(atualizacao.$inc)) {
      alvo[k] = (alvo[k] || 0) + v;
    }
    return { matchedCount: 1 };
  },
  async deleteOne(filtro) {
    const i = mockInscricoes.findIndex(x => String(x._id) === String(filtro._id)
      || x.endpoint === filtro.endpoint);
    if (i >= 0) { mockInscricoes.splice(i, 1); return { deletedCount: 1 }; }
    return { deletedCount: 0 };
  },
}));

jest.mock('web-push', () => ({
  setVapidDetails: () => {},
  generateVAPIDKeys: () => ({ publicKey: 'pub', privateKey: 'priv' }),
  async sendNotification(inscricao, corpo) {
    const codigo = mockFalhas[inscricao.endpoint];
    if (codigo) throw Object.assign(new Error('falhou'), { statusCode: codigo });
    mockEnviados.push({ endpoint: inscricao.endpoint, corpo });
    return { statusCode: 201 };
  },
}));

process.env.VAPID_PUBLIC_KEY = 'chave-publica-de-teste';
process.env.VAPID_PRIVATE_KEY = 'chave-privada-de-teste';

const webPush = require('../src/services/smartActivity/webPush');

const inscricao = (id, endpoint, falhas = 0) => ({
  _id: id, endpoint, keys: { p256dh: 'p', auth: 'a' }, falhas,
});

const notificacao = {
  _id: 'n1', titulo: 'Seu Story está bombando 🚀',
  mensagem: '@oliviapaganini chegou a 1.024 visualizações.',
  tema: 'story', username: 'oliviapaganini',
};

beforeEach(() => {
  mockInscricoes.length = 0;
  mockEnviados.length = 0;
  for (const k of Object.keys(mockFalhas)) delete mockFalhas[k];
});

describe('disponibilidade', () => {
  test('com chaves configuradas, está disponível', () => {
    expect(webPush.disponivel()).toBe(true);
    expect(webPush.chavePublica()).toBe('chave-publica-de-teste');
  });
});

describe('envio', () => {
  test('entrega a todos os aparelhos inscritos', async () => {
    mockInscricoes.push(inscricao('s1', 'https://push/aparelho-1'));
    mockInscricoes.push(inscricao('s2', 'https://push/aparelho-2'));

    const r = await webPush.enviar(notificacao);
    expect(r.enviados).toBe(2);
    expect(mockEnviados).toHaveLength(2);
  });

  test('o payload leva o que a notificação do sistema mostra', async () => {
    mockInscricoes.push(inscricao('s1', 'https://push/a'));
    await webPush.enviar(notificacao);

    const corpo = JSON.parse(mockEnviados[0].corpo);
    expect(corpo.titulo).toBe(notificacao.titulo);
    expect(corpo.mensagem).toContain('1.024');
    expect(corpo.id).toBe('n1');
    // O limite prático de um push é ~4KB depois de cifrado.
    expect(mockEnviados[0].corpo.length).toBeLessThan(1024);
  });

  test('sem inscrição, não tenta enviar', async () => {
    const r = await webPush.enviar(notificacao);
    expect(r).toEqual({ enviados: 0, removidos: 0 });
  });
});

describe('higiene das inscrições', () => {
  test('410 Gone remove a inscrição na hora', async () => {
    // O navegador avisou que ela morreu: mantê-la faz cada envio futuro
    // gastar uma requisição para receber o mesmo erro.
    mockInscricoes.push(inscricao('s1', 'https://push/morta'));
    mockFalhas['https://push/morta'] = 410;

    const r = await webPush.enviar(notificacao);
    expect(r.removidos).toBe(1);
    expect(mockInscricoes).toHaveLength(0);
  });

  test('404 também remove', async () => {
    mockInscricoes.push(inscricao('s1', 'https://push/sumiu'));
    mockFalhas['https://push/sumiu'] = 404;
    await webPush.enviar(notificacao);
    expect(mockInscricoes).toHaveLength(0);
  });

  test('erro transitório só CONTA, não remove', async () => {
    // Apagar na primeira falha faria uma instabilidade de dez minutos
    // desinscrever todo mundo em silêncio.
    mockInscricoes.push(inscricao('s1', 'https://push/instavel'));
    mockFalhas['https://push/instavel'] = 500;

    const r = await webPush.enviar(notificacao);
    expect(r.removidos).toBe(0);
    expect(mockInscricoes).toHaveLength(1);
    expect(mockInscricoes[0].falhas).toBe(1);
  });

  test('uma entrega bem-sucedida zera o contador de falhas', async () => {
    mockInscricoes.push(inscricao('s1', 'https://push/voltou', 5));
    await webPush.enviar(notificacao);
    expect(mockInscricoes[0].falhas).toBe(0);
  });

  test('inscrição com falhas demais deixa de ser tentada', async () => {
    mockInscricoes.push(inscricao('s1', 'https://push/desistiu', 8));
    const r = await webPush.enviar(notificacao);
    expect(r.enviados).toBe(0);
    expect(mockEnviados).toHaveLength(0);
  });

  test('um aparelho morto não impede a entrega aos outros', async () => {
    mockInscricoes.push(inscricao('s1', 'https://push/morta'));
    mockInscricoes.push(inscricao('s2', 'https://push/viva'));
    mockFalhas['https://push/morta'] = 410;

    const r = await webPush.enviar(notificacao);
    expect(r.enviados).toBe(1);
    expect(r.removidos).toBe(1);
    expect(mockEnviados[0].endpoint).toBe('https://push/viva');
  });
});

describe('inscrição', () => {
  test('grava o aparelho', async () => {
    await webPush.inscrever({
      endpoint: 'https://push/novo',
      keys: { p256dh: 'p', auth: 'a' },
      aparelho: 'Chrome Android',
    });
    expect(mockInscricoes).toHaveLength(1);
    expect(mockInscricoes[0].endpoint).toBe('https://push/novo');
  });

  test('reinscrever o mesmo aparelho não duplica', async () => {
    // O navegador devolve o MESMO endpoint ao reativar; sem upsert a pessoa
    // receberia a mesma notificação duas vezes.
    const dados = { endpoint: 'https://push/mesmo', keys: { p256dh: 'p', auth: 'a' } };
    await webPush.inscrever(dados);
    await webPush.inscrever(dados);
    expect(mockInscricoes).toHaveLength(1);
  });

  test('inscrição sem chaves é recusada', async () => {
    await expect(webPush.inscrever({ endpoint: 'https://push/x' }))
      .rejects.toMatchObject({ code: 'INSCRICAO_INVALIDA' });
  });

  test('cancelar remove o aparelho', async () => {
    mockInscricoes.push(inscricao('s1', 'https://push/sai'));
    const r = await webPush.cancelar('https://push/sai');
    expect(r.removidos).toBe(1);
    expect(mockInscricoes).toHaveLength(0);
  });
});

describe('aviso de teste', () => {
  /* ── Por que o teste de entrega não grava nada
     
     Não existe rota que CRIE notificação, e isso é deliberado: um endpoint de
     criação daria a qualquer chamador o poder de forjar conquista, e a central
     deixaria de ser o registro do que aconteceu.
     
     O aviso de teste exercita a ENTREGA — chave VAPID, inscrição do aparelho,
     service worker, permissão do navegador — sem inventar um marco. É a
     diferença entre "provar que o cano funciona" e "despejar água nele". */

  test('envia sem persistir: usa o mesmo enviar, com um id que não é do banco', async () => {
    mockInscricoes.push(inscricao('s1', 'https://push/aparelho'));

    const r = await webPush.enviar({
      _id: 'teste', titulo: 'Seu Story está bombando 🚀',
      mensagem: '@sua_conta chegou a 1.024 visualizações.',
      tema: 'story', username: 'sua_conta', teste: true,
    });

    expect(r.enviados).toBe(1);
    const corpo = JSON.parse(mockEnviados[0].corpo);
    expect(corpo.id).toBe('teste');
  });

  test('sem aparelho inscrito, não finge que enviou', async () => {
    // A tela precisa dizer "ligue o aviso no aparelho antes de testar" — um
    // "enviado!" sem destinatário faria a pessoa procurar o defeito no celular.
    const r = await webPush.enviar({ _id: 'teste', titulo: 'x', mensagem: 'y' });
    expect(r.enviados).toBe(0);
  });

  test('a rota de teste existe e NÃO grava notificação', () => {
    const fonte = require('fs').readFileSync(
      require('path').join(__dirname, '..', 'src', 'routes', 'notificacoesRoutes.js'), 'utf8');
    const i = fonte.indexOf("router.post('/push/testar'");
    expect(i).toBeGreaterThan(-1);
    const bloco = fonte.slice(i, i + 2400);
    // Nenhuma escrita no modelo dentro do bloco da rota.
    expect(bloco).not.toMatch(/Notificacao\.(create|insertMany|updateOne|findOneAndUpdate)/);
    // E usa o modelo CONFIGURADO, para o teste também validar o texto editado.
    expect(bloco).toMatch(/cfg\.mensagens/);
  });
});
