'use strict';

/**
 * Story com link — a segunda conexão, feita pelo Facebook Login.
 *
 * ── O que estes testes protegem
 *
 * O token do Instagram Login publica story e RECUSA a figurinha de link: a
 * Graph responde 9007. Link exige o outro token, emitido para uma Página do
 * Facebook. Como os dois convivem no mesmo registro de conta, três confusões
 * ficam possíveis — e todas falham de um jeito que não se parece com a causa:
 *
 *   token certo no host errado   → o Facebook não atende em graph.instagram.com
 *   id de um espaço no outro     → publica em lugar nenhum, ou no perfil errado
 *   campo escondido não buscado  → story sai sem link, como se não houvesse
 *                                  conexão nenhuma
 *
 * O último é o mais traiçoeiro: `fbAccessToken` é `select: false`, então quem
 * carregou a conta para publicar quase nunca o tem em mãos. Sem a busca, a
 * ativação funcionaria na tela e não faria efeito nenhum no story.
 */

jest.mock('../src/models/Account', () => ({ findById: jest.fn() }));
jest.mock('../src/services/instagramPrivateService', () => ({ createClient: jest.fn() }));
jest.mock('../src/services/storyWebSession', () => ({
  postStoryWebSession: jest.fn(),
  hasPuppeteerSession: jest.fn(() => false),
}));
jest.mock('../src/services/storyPuppeteer', () => ({ postStoryPuppeteer: jest.fn() }));

const Account = require('../src/models/Account');
const { postStory } = require('../src/services/storyService');

const IMAGEM = 'https://cdn.exemplo.com/foto.jpg';
const LINK   = 'https://minhaloja.com/oferta';

/** Chamadas que saíram, em pares {url, corpo}. */
let saidas;

function responder(fila) {
  global.fetch = jest.fn(async (url, init) => {
    const corpo = init?.body ? Object.fromEntries(new URLSearchParams(init.body)) : {};
    saidas.push({ url: String(url), corpo });
    const proxima = fila.length > 1 ? fila.shift() : fila[0];
    return { ok: true, json: async () => proxima };
  });
}

/** Conta OAuth comum: publica story, sem direito a link. */
function contaOficial(extra = {}) {
  return {
    _id: 'conta1',
    username: 'loja',
    provider: 'official',
    accessToken: 'TOKEN_INSTAGRAM_LOGIN',
    igUserId: '111111',
    ...extra,
  };
}

/** A mesma conta, com a conexão do Facebook ativa. */
function comLink(extra = {}) {
  return contaOficial({
    fbPageId: 'PAGINA_9',
    fbPageName: 'Minha Loja',
    fbIgUserId: '999999',
    fbAccessToken: 'TOKEN_DA_PAGINA',
    fbTokenExpiresAt: new Date(Date.now() + 30 * 864e5),
    ...extra,
  });
}

const criacao   = s => s.find(c => c.url.includes('/media?') || c.url.endsWith('/media'));
const publicacao = s => s.find(c => c.url.includes('/media_publish'));

beforeEach(() => {
  saidas = [];
  Account.findById.mockReset();
  responder([{ id: 'container_1' }, { id: 'story_publicado' }]);
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

describe('com a conexão do Facebook ativa', () => {
  test('o link vai pelo host, id e token do Facebook — nunca misturados', async () => {
    const r = await postStory(comLink(), { imageUrl: IMAGEM, linkUrl: LINK });

    const c = criacao(saidas);
    expect(c.url).toContain('graph.facebook.com');
    expect(c.url).toContain('/999999/media');          // id do espaço do Facebook
    expect(c.corpo.access_token).toBe('TOKEN_DA_PAGINA');
    expect(c.corpo.link_sticker_url).toBe(LINK);

    /* O publish tem de sair pela MESMA porta: um container criado no Facebook
       e publicado no Instagram Login não é encontrado. */
    const p = publicacao(saidas);
    expect(p.url).toContain('graph.facebook.com');
    expect(p.corpo.access_token).toBe('TOKEN_DA_PAGINA');

    expect(r.withLink).toBe(true);
    expect(r.viaPagina).toBe(true);
  });

  test('story SEM link continua pelo caminho de sempre', async () => {
    /* A conexão nova não substitui a antiga. Trocar o token de uma publicação
       que já funciona seria arriscá-la para não ganhar nada — não há link a
       colocar. */
    const r = await postStory(comLink(), { imageUrl: IMAGEM });

    const c = criacao(saidas);
    expect(c.url).toContain('graph.instagram.com');
    expect(c.url).toContain('/111111/media');
    expect(c.corpo.access_token).toBe('TOKEN_INSTAGRAM_LOGIN');
    expect(r.viaPagina).toBe(false);
  });

  test('busca o token no banco quando ele não veio selecionado', async () => {
    /* `select: false` faz o campo chegar vazio na maioria dos caminhos. Sem
       esta busca, o story sairia sem link por ausência de campo — e a tela
       continuaria dizendo "Link on", porque `fbPageId` está lá.

       O mock resolve direto de `select`, sem `lean`: o token é cifrado em
       repouso e só volta legível pelo getter do schema, que o lean não roda. */
    Account.findById.mockReturnValue({
      select: () => Promise.resolve({ fbAccessToken: 'TOKEN_DA_PAGINA', fbIgUserId: '999999' }),
    });

    const conta = comLink({ fbAccessToken: undefined, fbIgUserId: undefined });
    await postStory(conta, { imageUrl: IMAGEM, linkUrl: LINK });

    expect(Account.findById).toHaveBeenCalledWith('conta1');
    const c = criacao(saidas);
    expect(c.url).toContain('graph.facebook.com/v21.0/999999/media');
    expect(c.corpo.access_token).toBe('TOKEN_DA_PAGINA');
  });
});

describe('quando a conexão não serve', () => {
  test('token vencido volta ao caminho antigo em vez de falhar', async () => {
    /* Vencido não é motivo para não publicar: o story sai sem link, que é o
       que acontecia antes desta funcionalidade existir. Falhar aqui trocaria
       "sem figurinha" por "story nenhum". */
    const conta = comLink({ fbTokenExpiresAt: new Date(Date.now() - 864e5) });
    const r = await postStory(conta, { imageUrl: IMAGEM, linkUrl: LINK });

    expect(criacao(saidas).url).toContain('graph.instagram.com');
    expect(r.viaPagina).toBe(false);
  });

  test('sem fbIgUserId não arrisca o igUserId do outro fluxo', async () => {
    /* Os dois ids vêm de portas diferentes e não há garantia de serem o mesmo
       número. Reaproveitar o do Instagram Login com o token da Página
       publicaria no perfil errado — ou daria um erro que não menciona ids. */
    Account.findById.mockReturnValue({ select: () => Promise.resolve({ fbAccessToken: 'TOKEN_DA_PAGINA' }) });

    const conta = comLink({ fbIgUserId: '', fbAccessToken: undefined });
    await postStory(conta, { imageUrl: IMAGEM, linkUrl: LINK });

    const c = criacao(saidas);
    expect(c.url).toContain('graph.instagram.com');
    expect(c.url).not.toContain('999999');
  });

  test('conta sem a conexão publica sem link, como antes', async () => {
    responder([
      { error: { code: 9007, message: 'link sticker not available' } },
      { id: 'container_1' },
      { id: 'story_publicado' },
    ]);

    const r = await postStory(contaOficial(), { imageUrl: IMAGEM, linkUrl: LINK });

    expect(r.withLink).toBe(false);
    expect(saidas.every(c => c.url.includes('graph.instagram.com'))).toBe(true);
  });
});

describe('o 9007 diz coisas diferentes conforme a conexão', () => {
  /* Mesmo código de erro, duas causas, dois consertos. Uma frase só mandaria
     metade das pessoas procurar no lugar errado: quem não tem a conexão
     precisa ativá-la; quem tem precisa olhar o modo comercial da conta. */

  const recusarOLink = () => responder([
    { error: { code: 9007, message: 'x' } },
    { id: 'c' }, { id: 'p' },
  ]);

  const falado = () => {
    const frases = [];
    console.log.mockImplementation(m => frases.push(String(m)));
    return frases;
  };

  test('sem a conexão, aponta o botão que a cria', async () => {
    const frases = falado();
    recusarOLink();
    await postStory(contaOficial(), { imageUrl: IMAGEM, linkUrl: LINK });
    expect(frases.join(' | ')).toMatch(/Ativar link em story/i);
  });

  test('com a conexão, aponta a conta comercial e nomeia a Página', async () => {
    const frases = falado();
    recusarOLink();
    await postStory(comLink(), { imageUrl: IMAGEM, linkUrl: LINK });
    const texto = frases.join(' | ');
    expect(texto).toMatch(/comercial/i);
    expect(texto).toContain('Minha Loja');
  });
});
