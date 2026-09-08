'use strict';

/**
 * Convites de testador do app.
 *
 * ── O que estes testes protegem
 *
 * A tela promete "convite" e a Meta não tem endpoint para isso. Confirmado na
 * referência dela: `POST /{app-id}/roles` responde que a operação não pode ser
 * executada no ponto de extremidade, os papéis que ela conhece são
 * administrators/developers/testers/insights users — nenhum é o testador do
 * Instagram — e o campo `user` pede o ID numérico de um usuário do Facebook.
 *
 * Então o valor todo está em três coisas pequenas, e cada uma quebra calada:
 *
 *   o @ normalizado    → "@Fulano" e "fulano" viram dois convites para a mesma
 *                        conta, e nenhum deles fecha como conectado
 *   o link do painel   → sem App configurado, `/apps/undefined/roles` leva a
 *                        uma página de erro da Meta em vez de dizer o que falta
 *   conectado derivado → é lido das contas, não gravado. Se fosse gravado,
 *                        precisaria de um gancho no login, e um gancho que
 *                        falhe deixa o convite mentindo para sempre
 */

const { normalizarArroba, MAX } = require('../src/services/arrobaDoInstagram');

describe('o @ do Instagram, normalizado', () => {
  test('tira a arroba e baixa a caixa', () => {
    /* O Instagram não diferencia maiúscula; se nós diferenciássemos, o convite
       de "@Fulano" nunca casaria com a conta "fulano". */
    expect(normalizarArroba('@Fulano')).toBe('fulano');
    expect(normalizarArroba('  FULANO  ')).toBe('fulano');
    expect(normalizarArroba('@@fulano')).toBe('fulano');
  });

  test('aceita o link do perfil colado inteiro', () => {
    /* É o gesto natural de quem está com o perfil aberto. Aceitar as três
       formas custa uma regex e evita ensinar a colar de outro jeito. */
    expect(normalizarArroba('instagram.com/beto_1')).toBe('beto_1');
    expect(normalizarArroba('https://www.instagram.com/beto_1/?hl=pt')).toBe('beto_1');
    expect(normalizarArroba('http://instagram.com/beto_1/')).toBe('beto_1');
  });

  test('só texto entra', () => {
    /* `String(valor)` faria de null o @ "null" e de [1,2] o @ "1,2" — dois @
       inválidos que passariam a parecer válidos. */
    for (const v of [null, undefined, 0, 42, [], ['fulano'], {}, true]) {
      expect(normalizarArroba(v)).toBe('');
    }
  });

  test('recusa o que o Instagram recusa', () => {
    expect(normalizarArroba('com espaço')).toBe('');
    expect(normalizarArroba('acentuação')).toBe('');
    expect(normalizarArroba('barra/dentro')).toBe('');
    expect(normalizarArroba('fim.')).toBe('');       // ponto no fim
    expect(normalizarArroba('')).toBe('');
    expect(normalizarArroba('@')).toBe('');
    expect(normalizarArroba('a'.repeat(MAX + 1))).toBe('');
    expect(normalizarArroba('a'.repeat(MAX))).toBe('a'.repeat(MAX));
  });

  test('o que passa não tem como virar outra URL', () => {
    /* Este valor entra no link do painel da Meta. Se `..` ou `%` passassem,
       o @ deixaria de ser um segmento e viraria caminho. */
    for (const v of ['..', '../../etc', 'a%2Fb', 'a?b=1', 'a#b', 'a b']) {
      expect(normalizarArroba(v)).toBe('');
    }
  });
});

/* ── As rotas ───────────────────────────────────────────────────────────────
   Sem banco: os modelos são substituídos, e o que se verifica é a decisão que
   o código toma sobre o que o banco devolveu. */

jest.mock('../src/models/ConviteDeAcesso', () => ({
  find: jest.fn(), findOneAndUpdate: jest.fn(),
  findByIdAndUpdate: jest.fn(), findByIdAndDelete: jest.fn(),
}));
jest.mock('../src/models/Account', () => ({ find: jest.fn() }));
jest.mock('../src/models/MetaApp', () => ({ findById: jest.fn(), findOne: jest.fn() }));

const Account = require('../src/models/Account');
const MetaApp = require('../src/models/MetaApp');
const Convite = require('../src/models/ConviteDeAcesso');
const rotas   = require('../src/routes/convitesRoutes');
const { painelDaMeta, jaConectados } = rotas;

/** `Account.find(...).select(...).lean()` devolvendo esta lista. */
function contasSendo(lista) {
  Account.find.mockReturnValue({ select: () => ({ lean: async () => lista }) });
}

/** Chama o handler de uma rota do router, com req/res de mentira. */
async function chamar(metodo, caminho, req = {}) {
  const camada = rotas.stack.find(l => l.route?.path === caminho && l.route?.methods?.[metodo]);
  if (!camada) throw new Error('rota inexistente: ' + metodo + ' ' + caminho);
  const resposta = { code: 200, corpo: null };
  const res = {
    status(c) { resposta.code = c; return this; },
    json(c)   { resposta.corpo = c; return this; },
  };
  await camada.route.stack[0].handle({ query: {}, params: {}, body: {}, ...req }, res, () => {});
  return resposta;
}

beforeEach(() => {
  jest.clearAllMocks();
  contasSendo([]);
  MetaApp.findOne.mockReturnValue({ lean: async () => null });
  MetaApp.findById.mockReturnValue({ lean: async () => null });
  Convite.find.mockReturnValue({ sort: () => ({ lean: async () => [] }) });
  delete process.env.META_APP_ID;
  delete process.env.INSTAGRAM_APP_ID;
});

describe('o link do painel da Meta', () => {
  test('sai da conta do App padrão', async () => {
    MetaApp.findOne.mockReturnValue({ lean: async () => ({ appId: '790847580661717' }) });
    const p = await painelDaMeta(null);
    expect(p.appId).toBe('790847580661717');
    /* `roles/roles` é a página que tem a seção de testadores do Instagram. */
    expect(p.url).toBe('https://developers.facebook.com/apps/790847580661717/roles/roles/');
  });

  test('sem App nenhum, o link é null e não um link quebrado', async () => {
    /* `/apps/undefined/roles/` abre uma página de erro da Meta — pior do que a
       tela dizer que falta configurar o App. */
    const p = await painelDaMeta(null);
    expect(p.url).toBeNull();
    expect(p.appId).toBe('');
  });

  test('cai nas variáveis de ambiente quando não há App no banco', async () => {
    process.env.META_APP_ID = '123456';
    const p = await painelDaMeta(null);
    expect(p.url).toContain('/apps/123456/roles/roles/');
  });

  test('banco fora do ar não derruba a rota', async () => {
    /* Um id inválido faz o Mongoose lançar. Sem o try, pedir um convite
       responderia 500 por causa do LINK — que é o detalhe menos importante. */
    MetaApp.findById.mockImplementation(() => { throw new Error('CastError'); });
    process.env.META_APP_ID = '999';
    const p = await painelDaMeta('id-que-nao-existe');
    expect(p.url).toContain('/apps/999/');
  });
});

describe('conectado é lido das contas, não gravado', () => {
  test('conta com token oficial conta como conectada', async () => {
    contasSendo([{ username: 'fulano', igUserId: '17841', accessToken: 'IGAA...' }]);
    expect([...await jaConectados()]).toEqual(['fulano']);
  });

  test('sessão mobile e sessão web também contam', async () => {
    contasSendo([
      { username: 'mobile1', instagrapiSession: '{...}' },
      { username: 'web1',    rawWebSessionid: '123%3Aabc' },
      { username: 'web2',    igSession: 'blob' },
    ]);
    expect([...await jaConectados()].sort()).toEqual(['mobile1', 'web1', 'web2']);
  });

  test('token sem igUserId não é conexão', async () => {
    /* Metade do par não publica em lugar nenhum. É o mesmo critério que a tela
       de contas usa para escrever "conectada" — duas verdades sobre a mesma
       coisa acabariam divergindo. */
    contasSendo([
      { username: 'meio1', accessToken: 'IGAA...' },
      { username: 'meio2', igUserId: '17841' },
    ]);
    expect([...await jaConectados()]).toEqual([]);
  });

  test('conta criada e nunca conectada não conta', async () => {
    contasSendo([{ username: 'novinha', healthStatus: 'ativa' }]);
    expect([...await jaConectados()]).toEqual([]);
  });

  test('a comparação ignora a caixa', async () => {
    /* O defeito em uma frase: o convite era de "@Fulano", a conta chegou como
       "Fulano", e a lista dizia pendente para sempre. */
    contasSendo([{ username: 'Fulano', instagrapiSession: '{}' }]);
    const vinculadas = await jaConectados();
    expect(vinculadas.has('fulano')).toBe(true);
  });

  test('GET marca o convite cuja conta já entrou', async () => {
    Convite.find.mockReturnValue({ sort: () => ({ lean: async () => [
      { _id: '1', username: 'jaentrou', estado: 'enviado' },
      { _id: '2', username: 'faltando', estado: 'pendente' },
    ] }) });
    contasSendo([{ username: 'jaentrou', instagrapiSession: '{}' }]);

    const r = await chamar('get', '/');
    expect(r.code).toBe(200);
    expect(r.corpo.convites.map(c => [c.username, c.conectado]))
      .toEqual([['jaentrou', true], ['faltando', false]]);
  });
});

describe('pedir um convite', () => {
  test('grava o @ normalizado, não o que foi digitado', async () => {
    Convite.findOneAndUpdate.mockResolvedValue({ _id: 'x', username: 'fulano', estado: 'pendente' });
    const r = await chamar('post', '/', { body: { username: '  @Fulano ' } });
    expect(r.code).toBe(201);
    expect(Convite.findOneAndUpdate.mock.calls[0][0]).toEqual({ username: 'fulano' });
  });

  test('@ inválido é recusado antes de tocar o banco', async () => {
    for (const username of ['', '   ', '@', 'com espaço', null, 42, ['fulano']]) {
      const r = await chamar('post', '/', { body: { username } });
      expect(r.code).toBe(400);
    }
    expect(Convite.findOneAndUpdate).not.toHaveBeenCalled();
  });

  test('pedir duas vezes o mesmo @ não é erro', async () => {
    /* É o gesto de quem não lembra se já pediu. Com `create`, o índice único
       responderia E11000 — um erro de banco no lugar de "já está na fila". */
    Convite.findOneAndUpdate.mockResolvedValue({ _id: 'x', username: 'fulano', estado: 'enviado' });
    const r = await chamar('post', '/', { body: { username: 'fulano' } });
    expect(r.code).toBe(201);
    const opcoes = Convite.findOneAndUpdate.mock.calls[0][2];
    expect(opcoes.upsert).toBe(true);
  });

  test('o segundo pedido não rebaixa um convite já enviado', async () => {
    /* `estado` vai em `$setOnInsert` justamente por isso: um `$set` apagaria a
       memória de que o convite já foi disparado no painel. */
    Convite.findOneAndUpdate.mockResolvedValue({ _id: 'x', username: 'fulano', estado: 'enviado' });
    await chamar('post', '/', { body: { username: 'fulano' } });
    const atualizacao = Convite.findOneAndUpdate.mock.calls[0][1];
    expect(atualizacao.$setOnInsert).toEqual({ estado: 'pendente' });
    expect(atualizacao.$set).not.toHaveProperty('estado');
  });

  test('a observação é limitada', async () => {
    Convite.findOneAndUpdate.mockResolvedValue({ _id: 'x', username: 'fulano' });
    await chamar('post', '/', { body: { username: 'fulano', observacao: 'a'.repeat(500) } });
    expect(Convite.findOneAndUpdate.mock.calls[0][1].$set.observacao).toHaveLength(280);
  });

  test('observação que não é texto é ignorada em vez de gravada', async () => {
    Convite.findOneAndUpdate.mockResolvedValue({ _id: 'x', username: 'fulano' });
    await chamar('post', '/', { body: { username: 'fulano', observacao: { $ne: null } } });
    expect(Convite.findOneAndUpdate.mock.calls[0][1].$set).not.toHaveProperty('observacao');
  });

  test('metaAppId que não é texto não entra na consulta', async () => {
    Convite.findOneAndUpdate.mockResolvedValue({ _id: 'x', username: 'fulano' });
    await chamar('post', '/', { body: { username: 'fulano', metaAppId: { $gt: '' } } });
    expect(Convite.findOneAndUpdate.mock.calls[0][1].$set.metaAppId).toBe('');
  });
});

describe('marcar como enviado e remover', () => {
  test('enviado grava a data', async () => {
    Convite.findByIdAndUpdate.mockResolvedValue({ _id: 'x', username: 'fulano', estado: 'enviado' });
    const r = await chamar('patch', '/:id/enviado', { params: { id: 'x' } });
    expect(r.code).toBe(200);
    const patch = Convite.findByIdAndUpdate.mock.calls[0][1];
    expect(patch.estado).toBe('enviado');
    expect(patch.enviadoEm).toBeInstanceOf(Date);
  });

  test('convite que não existe responde 404, não 200', async () => {
    Convite.findByIdAndUpdate.mockResolvedValue(null);
    expect((await chamar('patch', '/:id/enviado', { params: { id: 'x' } })).code).toBe(404);
    Convite.findByIdAndDelete.mockResolvedValue(null);
    expect((await chamar('delete', '/:id', { params: { id: 'x' } })).code).toBe(404);
  });
});

describe('a ligação com o resto do sistema', () => {
  const fs   = require('fs');
  const path = require('path');
  const ler  = p => fs.readFileSync(path.resolve(__dirname, p), 'utf8');

  test('as rotas estão montadas e atrás do JWT', () => {
    /* Um router perfeito que ninguém monta é o defeito mais barato de cometer.
       Atrás do `auth` porque a fila de convites diz quais contas são nossas. */
    const app = ler('../src/app.js');
    expect(app).toMatch(/app\.use\('\/convites',\s*auth,\s*require\('\.\/routes\/convitesRoutes'\)\)/);
  });

  test('o estado conectado não é campo do schema', () => {
    /* Se virar campo, alguém vai precisar gravá-lo — e aí volta o gancho no
       login que estes testes existem para evitar. */
    const modelo = ler('../src/models/ConviteDeAcesso.js');
    expect(modelo).not.toMatch(/conectado:/);
    expect(modelo).toMatch(/enum: \['pendente', 'enviado'\]/);
  });

  test('a tela de contas chama as rotas de convite', () => {
    const tela = ler('../../frontend/src/pages/Accounts.jsx');
    expect(tela).toContain("api.get('/convites'");
    expect(tela).toContain("api.post('/convites'");
    expect(tela).toContain('Pedir acesso via convite');
  });

  test('os três caminhos de conexão estão no cabeçalho', () => {
    const tela = ler('../../frontend/src/pages/Accounts.jsx');
    expect(tela).toContain('Login Manual');
    expect(tela).toContain('Conectar Contas (OAuth)');
    expect(tela).toContain('copiarLinkOAuth');
  });

  test('a escolha de como abrir vem antes do fluxo em duas etapas', () => {
    /* `openOAuthConnect` abrindo direto o modal de duas etapas era o defeito:
       quem vai autorizar nesta aba nunca precisa da segunda etapa.

       A janela era `slice(0, 900)` e quebrou quando um comentário novo empurrou
       a chamada além do 900º caractere — o código estava certo e o teste
       falhou. Agora o corpo da função é delimitado pela DECLARAÇÃO seguinte, e
       o que se afirma é a ordem entre as duas chamadas, que é a propriedade de
       verdade: escolher como abrir vem antes de abrir. */
    const tela = ler('../../frontend/src/pages/Accounts.jsx');
    const inicio = tela.indexOf('async function openOAuthConnect');
    expect(inicio).toBeGreaterThan(-1);

    const seguinte = tela.slice(inicio + 1).search(/\n {2}(?:async )?function /);
    const corpo = seguinte === -1 ? tela.slice(inicio) : tela.slice(inicio, inicio + 1 + seguinte);

    expect(corpo).toContain('setEscolhaOAuth(');
    /* E não abre o fluxo de duas etapas aqui: quem faz isso é o botão dentro
       da escolha, depois de a pessoa optar por copiar o link. */
    expect(corpo).not.toContain('setOauthModal({');
  });

  test('proxies em massa saiu da tela de contas mas não do sistema', () => {
    /* Nenhuma capacidade some: a página de Proxies faz o mesmo e mais — testa
       cada proxy antes de gravar e sabe substituir o de quem já tem um. */
    const contas  = ler('../../frontend/src/pages/Accounts.jsx');
    const proxies = ler('../../frontend/src/pages/Proxies.jsx');
    expect(contas).not.toContain('Proxies em massa');
    expect(contas).not.toContain('bulkProxyOpen');
    expect(proxies).toContain('proxies/bulk-apply');
  });
});
