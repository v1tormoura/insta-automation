'use strict';

/**
 * A rota que liga a Página do Facebook a uma conta já conectada.
 *
 * ── O que ela decide
 *
 * Ela grava um token de PUBLICAÇÃO numa conta. Errar aqui não dá erro visível:
 * dá story publicado no perfil errado, ou uma conexão que a tela mostra como
 * ativa e que a publicação nunca usa. Por isso os testes olham menos o "deu
 * certo" e mais em QUAL conta o token foi parar, e QUAL token foi guardado.
 *
 * ── A trava do `state`
 *
 * `verifyAndStripState` devolve `{ valid, state }`, não a string. A primeira
 * versão desta rota tratou o retorno como string: `.startsWith` num objeto é
 * sempre falso, então TODA autorização legítima voltava como "inválida ou
 * expirada" — um erro que manda procurar o defeito no Facebook, onde ele não
 * está. O primeiro teste existe para que isso não volte.
 */

process.env.OAUTH_STATE_SECRET = 'a'.repeat(64);
process.env.META_APP_ID = 'APP_123';
process.env.META_APP_SECRET = 'SEGREDO_DO_APP';

const salvas = [];
jest.mock('../src/models/Account', () => ({
  findById: jest.fn(),
  updateOne: jest.fn(async () => ({ modifiedCount: 1 })),
}));

/* MetaApp precisa de dublê: sem ele o mongoose enfileira a consulta por 10s
   esperando uma conexão que não existe, e o teste estoura o tempo por um
   motivo que não tem nada a ver com o que ele mede. */
jest.mock('../src/models/MetaApp', () => ({
  findById: jest.fn(() => ({ lean: async () => null })),
  findOne:  jest.fn(() => ({ lean: async () => null })),
}));

const Account = require('../src/models/Account');
const MetaApp = require('../src/models/MetaApp');
const { signState } = require('../src/services/csrfState');
const router = require('../src/routes/graphLinkRoutes');

/** Acha o handler de uma rota do router do express. */
function handler(metodo, caminho) {
  const camada = router.stack.find(c => c.route
    && c.route.path === caminho && c.route.methods[metodo]);
  if (!camada) throw new Error(`rota ${metodo} ${caminho} não registrada`);
  return camada.route.stack[camada.route.stack.length - 1].handle;
}

/** Um `res` que guarda o que foi respondido. */
function resposta() {
  const r = { code: 200, corpo: null };
  r.status = c => { r.code = c; return r; };
  r.json   = b => { r.corpo = b; return r; };
  return r;
}

function contaFake(username = 'loja') {
  const c = {
    _id: 'conta1', username,
    save: jest.fn(async () => { salvas.push({ ...c }); }),
  };
  return c;
}

/** Fila de respostas da Meta, na ordem em que a rota as pede. */
function metaResponde(...respostas) {
  const fila = [...respostas];
  global.fetch = jest.fn(async () => ({ json: async () => fila.shift() }));
}

const PAGINA = (nome, user, id = 'PG1') => ({
  id, name: nome, access_token: `TOKEN_PAGINA_${id}`,
  instagram_business_account: { id: `IG_${id}`, username: user },
});

beforeEach(() => {
  salvas.length = 0;
  Account.findById.mockReset();
  Account.updateOne.mockClear();
  MetaApp.findById.mockReturnValue({ lean: async () => null });
  MetaApp.findOne.mockReturnValue({ lean: async () => null });
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

async function chamarCallback(state, conta = contaFake()) {
  Account.findById.mockResolvedValue(conta);
  const res = resposta();
  await handler('post', '/callback')({ body: { code: 'CODIGO', state } }, res);
  return { res, conta };
}

describe('o state assinado', () => {
  test('autorização legítima é aceita — o retorno é objeto, não string', async () => {
    metaResponde(
      { access_token: 'CURTO' },
      { access_token: 'LONGO', expires_in: 5184000 },
      { data: [PAGINA('Minha Loja', 'loja')] },
    );

    const { res } = await chamarCallback(signState('fb_conta1'));

    expect(res.code).toBe(200);
    expect(res.corpo.ok).toBe(true);
  });

  test('state adulterado não chega a tocar na conta', async () => {
    const bom = signState('fb_conta1');
    const adulterado = bom.replace('fb_conta1', 'fb_conta_de_outro');

    const res = resposta();
    await handler('post', '/callback')({ body: { code: 'C', state: adulterado } }, res);

    expect(res.code).toBe(400);
    expect(res.corpo.code).toBe('STATE_INVALIDO');
    expect(Account.findById).not.toHaveBeenCalled();
  });

  test('state do outro fluxo é recusado aqui', async () => {
    /* O OAuth do Instagram usa a mesma porta de retorno. Aceitar o state dele
       aqui trocaria um token por outro na conta errada. */
    const res = resposta();
    await handler('post', '/callback')({ body: { code: 'C', state: signState('new') } }, res);

    expect(res.code).toBe(400);
    expect(Account.findById).not.toHaveBeenCalled();
  });
});

describe('qual Página vira o token', () => {
  test('casa pelo @ mesmo com várias Páginas na conta do Facebook', async () => {
    /* Pegar a primeira publicaria o story no perfil errado — e o sintoma seria
       "o story saiu, mas não no lugar certo", que ninguém liga a esta escolha. */
    metaResponde(
      { access_token: 'CURTO' },
      { access_token: 'LONGO', expires_in: 5184000 },
      { data: [
        PAGINA('Outra Marca', 'outramarca', 'PG_A'),
        PAGINA('Minha Loja',  'loja',       'PG_B'),
        PAGINA('Terceira',    'terceira',   'PG_C'),
      ] },
    );

    const { res, conta } = await chamarCallback(signState('fb_conta1'));

    expect(res.code).toBe(200);
    expect(conta.fbPageId).toBe('PG_B');
    expect(conta.fbAccessToken).toBe('TOKEN_PAGINA_PG_B');
  });

  test('nenhuma Página leva ao @ da conta: recusa e lista o que existe', async () => {
    metaResponde(
      { access_token: 'CURTO' },
      { access_token: 'LONGO', expires_in: 5184000 },
      { data: [PAGINA('Outra Marca', 'outramarca')] },
    );

    const { res, conta } = await chamarCallback(signState('fb_conta1'));

    expect(res.code).toBe(422);
    expect(res.corpo.code).toBe('PAGINA_NAO_CORRESPONDE');
    expect(res.corpo.disponiveis).toEqual([{ pagina: 'Outra Marca', instagram: 'outramarca' }]);
    expect(conta.save).not.toHaveBeenCalled();
  });

  test('sem Página com Instagram, explica o que fazer no Instagram', async () => {
    /* Este é o caso comum de quem nunca fez isso, e o conserto não é no
       sistema: é mudar a conta para comercial e vinculá-la a uma Página. */
    metaResponde(
      { access_token: 'CURTO' },
      { access_token: 'LONGO', expires_in: 5184000 },
      { data: [{ id: 'PG', name: 'Página sem Instagram' }] },
    );

    const { res } = await chamarCallback(signState('fb_conta1'));

    expect(res.code).toBe(422);
    expect(res.corpo.code).toBe('SEM_PAGINA_COM_INSTAGRAM');
    expect(res.corpo.comoResolver).toMatch(/comercial/i);
  });
});

describe('o que fica guardado', () => {
  test('token da Página, id do Facebook em campo próprio, e o outro fluxo intacto', async () => {
    metaResponde(
      { access_token: 'CURTO' },
      { access_token: 'LONGO_DO_USUARIO', expires_in: 5184000 },
      { data: [PAGINA('Minha Loja', 'loja', 'PG_B')] },
    );

    const conta = contaFake();
    conta.igUserId = 'ID_DO_INSTAGRAM_LOGIN';
    conta.accessToken = 'TOKEN_DO_INSTAGRAM_LOGIN';
    await chamarCallback(signState('fb_conta1'), conta);

    /* O token da PÁGINA, não o do usuário: é ele que publica em nome dela e
       não morre junto com a sessão de quem autorizou. */
    expect(conta.fbAccessToken).toBe('TOKEN_PAGINA_PG_B');
    expect(conta.fbAccessToken).not.toBe('LONGO_DO_USUARIO');

    /* Espaços de id separados. Escrever o id do Facebook em `igUserId` faria a
       publicação normal passar a usar um número emitido por outra porta. */
    expect(conta.fbIgUserId).toBe('IG_PG_B');
    expect(conta.igUserId).toBe('ID_DO_INSTAGRAM_LOGIN');

    // A conexão que já existia continua de pé.
    expect(conta.accessToken).toBe('TOKEN_DO_INSTAGRAM_LOGIN');
  });

  test('troca o token curto pelo longo antes de guardar', async () => {
    /* O curto vale uma hora. Uma conexão que morre em uma hora funciona no
       teste e falha na primeira publicação do dia seguinte. */
    metaResponde(
      { access_token: 'CURTO' },
      { access_token: 'LONGO', expires_in: 5184000 },
      { data: [PAGINA('Minha Loja', 'loja')] },
    );

    const { conta } = await chamarCallback(signState('fb_conta1'));
    const chamadas = global.fetch.mock.calls.map(c => String(c[0]));

    expect(chamadas[1]).toContain('grant_type=fb_exchange_token');
    expect(conta.fbTokenExpiresAt.getTime()).toBeGreaterThan(Date.now() + 50 * 864e5);
  });

  test('desativar apaga só o que é do Facebook', async () => {
    const res = resposta();
    await handler('delete', '/:accountId')({ params: { accountId: 'conta1' } }, res);

    const [, mudanca] = Account.updateOne.mock.calls[0];
    expect(Object.keys(mudanca.$set).sort())
      .toEqual(['fbAccessToken', 'fbIgUserId', 'fbPageId', 'fbPageName', 'fbTokenExpiresAt']);
    expect(res.corpo.ok).toBe(true);
  });
});

describe('quando a Meta recusa', () => {
  test('a mensagem dela vai junto, não é trocada por uma frase genérica', async () => {
    /* As recusas da Meta são específicas — "a conta precisa ser comercial" —
       e substituí-las por um texto curado manda depurar às cegas. */
    metaResponde({ error: { message: 'This authorization code has expired.', code: 100, type: 'OAuthException' } });

    const { res } = await chamarCallback(signState('fb_conta1'));

    expect(res.code).toBe(422);
    expect(res.corpo.detalhe).toContain('expired');
    expect(res.corpo.codigoMeta).toBe(100);
  });
});

describe('o início do fluxo', () => {
  test('pede os escopos que o link exige e assina o state com a conta', async () => {
    const res = resposta();
    await handler('get', '/start')({ query: { accountId: 'conta1' } }, res);

    const url = new URL(res.corpo.url);
    expect(url.origin + url.pathname).toBe('https://www.facebook.com/v21.0/dialog/oauth');

    /* Sem `instagram_content_publish` o diálogo passa e o link não funciona —
       a falha aparece só na hora de publicar, longe daqui. */
    const escopos = url.searchParams.get('scope').split(',');
    expect(escopos).toContain('instagram_content_publish');
    expect(escopos).toContain('instagram_basic');
    expect(escopos).toContain('pages_show_list');

    expect(url.searchParams.get('state')).toMatch(/^fb_conta1~/);
  });

  test('sem conta não começa', async () => {
    const res = resposta();
    await handler('get', '/start')({ query: {} }, res);
    expect(res.code).toBe(400);
  });
});

describe('qual app da Meta é usado', () => {
  /* O registro `MetaApp` guarda dois pares. `appId`/`appSecret` são do app do
     FACEBOOK; `instagramAppId`/`instagramAppSecret` são do Instagram, e é deles
     que o outro fluxo vive. Pegar o par errado aqui faz o diálogo recusar com
     "app inválido" — mensagem que não sugere que existem dois pares. */

  const APP = {
    _id: 'app1',
    appId: 'FACEBOOK_APP',        appSecret: 'SEGREDO_FACEBOOK',
    instagramAppId: 'INSTA_APP',  instagramAppSecret: 'SEGREDO_INSTA',
  };

  test('usa o par do Facebook, nunca o do Instagram', async () => {
    MetaApp.findOne.mockReturnValue({ lean: async () => APP });

    const res = resposta();
    await handler('get', '/start')({ query: { accountId: 'conta1' } }, res);

    const url = new URL(res.corpo.url);
    expect(url.searchParams.get('client_id')).toBe('FACEBOOK_APP');
    expect(url.searchParams.get('client_id')).not.toBe('INSTA_APP');
  });

  test('o state carrega o app, para o callback trocar o código no mesmo', async () => {
    /* Resolver o padrão no callback quando o começo usou outro app dá
       "redirect_uri mismatch", que manda olhar a URL de retorno — o lugar
       errado. */
    MetaApp.findById.mockReturnValue({ lean: async () => APP });

    const res = resposta();
    await handler('get', '/start')({ query: { accountId: 'conta1', metaAppId: 'app1' } }, res);
    const state = new URL(res.corpo.url).searchParams.get('state');
    expect(state).toMatch(/^fb_conta1:app1~/);

    metaResponde(
      { access_token: 'CURTO' },
      { access_token: 'LONGO', expires_in: 5184000 },
      { data: [PAGINA('Minha Loja', 'loja')] },
    );
    const r2 = await chamarCallback(state);

    expect(r2.res.code).toBe(200);
    expect(MetaApp.findById).toHaveBeenCalledWith('app1');
    expect(String(global.fetch.mock.calls[0][0])).toContain('client_secret=SEGREDO_FACEBOOK');
  });

  test('sem registro no banco, cai no ambiente', async () => {
    const res = resposta();
    await handler('get', '/start')({ query: { accountId: 'conta1' } }, res);
    expect(new URL(res.corpo.url).searchParams.get('client_id')).toBe('APP_123');
  });
});
