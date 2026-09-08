'use strict';

/**
 * Minha Conta e a senha do painel.
 *
 * ── Por que estes testes são diferentes dos outros do projeto
 *
 * Errar em quase qualquer rota dá trabalho. Errar aqui tranca a pessoa fora do
 * próprio painel — e o painel é onde ela iria ver o que aconteceu. Então o que
 * está protegido aqui não é "a senha troca", que é o caminho fácil. É:
 *
 *   • a senha do ambiente continua entrando depois da troca, porque é a chave
 *     de recuperação;
 *   • ela continua entrando com o banco fora do ar, que é o caso em que a
 *     recuperação existe para servir;
 *   • um erro ao ler o usuário não vira 500 no login, porque para quem está
 *     tentando entrar um 500 é indistinguível de "o servidor caiu".
 *
 * ── E um defeito que apareceu rodando, não lendo
 *
 * `temSenhaPropria` saía `false` mesmo depois de a senha ter sido trocada com
 * sucesso: `senhaHash` é `select: false` no schema, e a leitura não pedia o
 * campo. O login com a senha nova funcionava e a tela dizia que não havia
 * senha própria. O último teste deste arquivo é sobre isso.
 */

const senhas = require('../src/services/senhaDoPainel');

describe('senhaDoPainel', () => {
  test('confere a senha certa e recusa a errada', () => {
    const h = senhas.gerar('uma-senha-boa');
    expect(senhas.conferir('uma-senha-boa', h)).toBe(true);
    expect(senhas.conferir('uma-senha-bo', h)).toBe(false);
    expect(senhas.conferir('Uma-Senha-Boa', h)).toBe(false);
  });

  test('a senha nunca aparece no que é guardado', () => {
    const h = senhas.gerar('senha-secreta-42');
    expect(h).not.toContain('senha-secreta-42');
    expect(h.startsWith('scrypt$')).toBe(true);
  });

  test('dois hashes da mesma senha são diferentes', () => {
    /* Sal por hash. Sem isto, dois campos iguais no banco revelariam que duas
       senhas são a mesma. */
    expect(senhas.gerar('igual-igual')).not.toBe(senhas.gerar('igual-igual'));
  });

  test('os parâmetros de custo vão dentro do hash', () => {
    /* É o que faz um hash antigo continuar conferindo no dia em que o custo
       subir. Sem eles, toda senha gravada antes passaria a falhar. */
    const [algo, n, r, p] = senhas.gerar('parametros-dentro').split('$');
    expect(algo).toBe('scrypt');
    expect(Number(n)).toBeGreaterThan(1);
    expect(Number(r)).toBeGreaterThan(0);
    expect(Number(p)).toBeGreaterThan(0);
  });

  test('hash de outro formato é false, não exceção', () => {
    /* Uma exceção aqui viraria 500 no login. Para quem está tentando entrar,
       500 é indistinguível de "o servidor caiu". */
    for (const lixo of ['', 'bcrypt$x$y', 'scrypt$a$b$c$d$e', null, undefined, 42, {}]) {
      expect(senhas.conferir('qualquer', lixo)).toBe(false);
    }
    expect(senhas.conferir(null, senhas.gerar('valida-mesmo'))).toBe(false);
  });

  test('senha curta é recusada na hora de gerar', () => {
    expect(() => senhas.gerar('curta')).toThrow(/pelo menos/);
    try { senhas.gerar('curta'); } catch (e) { expect(e.code).toBe('SENHA_CURTA'); }
    /* Exatamente no mínimo passa: o requisito é "pelo menos". */
    expect(() => senhas.gerar('a'.repeat(senhas.MINIMO))).not.toThrow();
  });

  test('acentos normalizados: a mesma senha digitada de dois jeitos confere', () => {
    /* `é` pode chegar como um ponto de código ou como `e` + acento combinante,
       dependendo do teclado e do sistema. Sem NFKC, a senha digitada num
       aparelho não abriria no outro — e ninguém descobriria por quê. */
    const composta = 'senha-café-01';         // é
    const decomposta = 'senha-café-01';      // e + ´
    expect(composta).not.toBe(decomposta);
    expect(senhas.conferir(decomposta, senhas.gerar(composta))).toBe(true);
  });
});

/* ── O login com as duas senhas ────────────────────────────────────────────
   Mock do model e do mongoose, porque o que está sob teste é a ORDEM das
   tentativas — e ela não precisa de banco para ser verificada. */

const mockUsuario = { valor: null, erro: null };
const mockConexao = { readyState: 1 };

jest.mock('mongoose', () => ({
  get connection() { return mockConexao; },
}));

jest.mock('../src/models/Usuario', () => ({
  findOne: () => ({
    select: () => ({
      lean: async () => {
        if (mockUsuario.erro) throw mockUsuario.erro;
        return mockUsuario.valor;
      },
    }),
  }),
}));

const { senhaConfere } = require('../src/routes/authRoutes');

describe('login: qual senha entra', () => {
  const AMBIENTE = process.env.AUTH_PASSWORD || 'admin123';

  beforeEach(() => {
    mockUsuario.valor = null;
    mockUsuario.erro = null;
    mockConexao.readyState = 1;
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  test('sem senha própria, entra com a do ambiente', async () => {
    expect((await senhaConfere(AMBIENTE)).ok).toBe(true);
    expect((await senhaConfere('chute')).ok).toBe(false);
  });

  test('com senha própria, ela entra', async () => {
    mockUsuario.valor = { senhaHash: senhas.gerar('a-minha-senha-1') };
    const r = await senhaConfere('a-minha-senha-1');
    expect(r.ok).toBe(true);
    expect(r.via).toBe('hash');
  });

  test('com senha própria, a do ambiente CONTINUA entrando', async () => {
    /* De propósito, e dito na tela com essas palavras. Se o hash fosse a única
       porta, um banco fora do ar trancaria a pessoa fora do painel. */
    mockUsuario.valor = { senhaHash: senhas.gerar('a-minha-senha-1') };
    const r = await senhaConfere(AMBIENTE);
    expect(r.ok).toBe(true);
    expect(r.via).toBe('ambiente');
  });

  test('uma terceira senha não entra por nenhum caminho', async () => {
    mockUsuario.valor = { senhaHash: senhas.gerar('a-minha-senha-1') };
    expect((await senhaConfere('nem-uma-nem-outra')).ok).toBe(false);
  });

  test('banco fora do ar: a do ambiente entra sem tocar no model', async () => {
    mockConexao.readyState = 0;
    /* Se tocasse, o mongoose enfileiraria a consulta e o login ficaria dez
       segundos pendurado antes de falhar. */
    mockUsuario.erro = new Error('não deveria ter sido chamado');
    const r = await senhaConfere(AMBIENTE);
    expect(r.ok).toBe(true);
    expect(r.via).toBe('ambiente-sem-banco');
  });

  test('erro ao ler o usuário não vira exceção no login', async () => {
    mockUsuario.erro = new Error('coleção sumiu');
    const r = await senhaConfere(AMBIENTE);
    expect(r.ok).toBe(true);
  });

  test('entrada pelo caminho alternativo é registrada', async () => {
    /* Uma porta de recuperação que ninguém consegue auditar depois é uma porta
       que não se sabe se foi usada. */
    mockUsuario.valor = { senhaHash: senhas.gerar('a-minha-senha-1') };
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});

    await senhaConfere('a-minha-senha-1');
    const depoisDoHash = log.mock.calls.length;

    await senhaConfere(AMBIENTE);
    expect(log.mock.calls.length).toBeGreaterThan(depoisDoHash);
  });
});

describe('a rota não vaza o hash', () => {
  const fonte = require('fs').readFileSync(
    require('path').join(__dirname, '../src/routes/contaRoutes.js'), 'utf8');

  test('`publico()` lista campo por campo e não inclui senhaHash', () => {
    const corpo = fonte.slice(fonte.indexOf('function publico'));
    const fim = corpo.indexOf('\n}');
    const dentro = corpo.slice(0, fim);

    expect(dentro).toMatch(/temSenhaPropria:\s*!!u\?\.senhaHash/);
    /* A âncora é a sintaxe de atribuição, não a palavra: `senhaHash` aparece
       de propósito na linha acima, e uma asserção sobre a palavra solta
       casaria com ela. Já escrevi asserção negativa que pegava o meu próprio
       comentário — quatro vezes neste projeto. */
    expect(dentro).not.toMatch(/senhaHash:\s*u/);
    expect(dentro).not.toMatch(/\.\.\.u\b/);
  });

  test('a leitura pede o hash explicitamente', () => {
    /* Sem `+senhaHash`, `select: false` no schema esconde o campo e
       `temSenhaPropria` sai false para sempre — inclusive depois de a senha ter
       sido trocada com sucesso. Foi o defeito que apareceu rodando a rota. */
    expect(fonte).toMatch(/select\('\+senhaHash'\)/);
  });

  test('só JPG, PNG e WebP — SVG fora', () => {
    /* SVG é documento com script dentro, servido de `/uploads` no mesmo
       domínio. `image/*` o aceitaria. */
    const lista = fonte.slice(fonte.indexOf('const TIPOS'), fonte.indexOf('const TIPOS') + 260);
    expect(lista).toContain('image/jpeg');
    expect(lista).toContain('image/webp');
    expect(lista).not.toContain('svg');
    expect(lista).not.toMatch(/image\/\*/);
  });

  test('o caminho da foto sai versionado', () => {
    /* Sem `?v=`, o nome do arquivo é fixo, o React vê o mesmo `src` e não
       repinta: a foto troca no disco e a tela segue com a antiga. Já aconteceu
       com o avatar das contas — ver avatarLocal.js. */
    expect(fonte).toMatch(/usuario\$\{ext\}\?v=\$\{Date\.now\(\)\}/);
  });
});

describe('privacidade do aviso', () => {
  const t = require('../src/services/smartActivity/templates');

  test('nome desligado troca o @ por um termo genérico', () => {
    const v = t.discretas({ account: '@olivia', username: 'olivia', views: '1.024' },
      { mostrarNome: false });
    expect(v.account).not.toContain('olivia');
    expect(v.username).not.toContain('olivia');
    /* Não removido: `render` deixaria `{{account}}` literal na tela. */
    expect(v.account).toBeTruthy();
    expect(v.views).toBe('1.024');
  });

  test('valor desligado esconde TODOS os números, não só views', () => {
    /* Esconder `views` e deixar `{{likes}}` aberto no mesmo texto não esconde
       nada. */
    const v = t.discretas(
      { account: '@olivia', views: '1.024', threshold: '1.000', likes: '87',
        comments: '12', shares: '4', reach: '940' },
      { mostrarValor: false });
    for (const campo of ['views', 'threshold', 'likes', 'comments', 'shares', 'reach']) {
      expect(v[campo]).not.toMatch(/\d/);
    }
    expect(v.account).toBe('@olivia');
  });

  test('a substituição não deixa a frase estranha', () => {
    const vars = t.contexto({
      conta: { username: 'olivia' }, insight: {}, threshold: 1000, valor: 1024,
      metricType: 'storyViews', privacidade: { mostrarNome: false, mostrarValor: false },
    });
    const frase = t.render(t.PADRAO.storyViews.mensagem, vars);
    /* O modelo padrão é "chegou a {{views}} visualizações": qualquer
       substantivo ali produziria "chegou a um marco visualizações". */
    expect(frase).toBe('sua conta chegou a ••• visualizações.');
    expect(frase).not.toContain('{{');
  });

  test('sem privacidade declarada, nada é escondido', () => {
    /* O padrão MOSTRA — é o comportamento que sempre existiu, e mudá-lo
       esconderia dado de quem nunca pediu para esconder. */
    const vars = t.contexto({ conta: { username: 'olivia' }, insight: {}, valor: 500 });
    expect(vars.account).toBe('@olivia');
    expect(vars.views).toBe('500');
  });
});
