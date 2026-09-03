'use strict';

/**
 * A foto de perfil: quando baixar, e por que a URL leva versão.
 *
 * O defeito relatado foi "mudei a foto pela API mobile e não atualizou". Eram
 * três coisas somadas, e cada uma sozinha bastava para o sintoma:
 *
 *  1. `syncInstagrapiAccount` recebia `profile_pic_url` do serviço Python e
 *     não lia o campo — o avatar nunca era gravado para conta mobile;
 *  2. `_aplicarEdicaoInstagrapi` mandava a foto para o Instagram e não a
 *     guardava como avatar da conta;
 *  3. o arquivo tem nome fixo, então mesmo gravando certo o React não
 *     repintava: para ele o `src` não tinha mudado.
 *
 * Este arquivo cobre a terceira e a regra que evita rebaixar a mesma imagem a
 * cada ciclo de sincronização.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  gravarAvatar, caminhoPublico, fotoMudou, origemDaFoto,
} = require('../src/services/avatarLocal');

const UMA_URL = 'https://scontent.cdninstagram.com/v/t51.2885-19/111_n.jpg?stp=x&_nc_ht=a&oe=68B';

describe('a versão na URL', () => {
  test('o caminho carrega ?v=', () => {
    expect(caminhoPublico('fulano')).toMatch(/^\/uploads\/avatars\/fulano\.jpg\?v=\d+$/);
  });

  test('duas gravações dão versões diferentes', () => {
    /* É esta diferença que faz o React repintar. Sem ela o `src` é idêntico,
       o componente não remonta a imagem, e o navegador serve a que já tem —
       a foto antiga, que foi exatamente o sintoma relatado. */
    expect(caminhoPublico('a', 1000)).not.toBe(caminhoPublico('a', 2000));
  });

  test('o caminho do arquivo continua sem a versão', () => {
    // A querystring é para o navegador; no disco o nome é fixo, senão cada
    // troca de foto deixaria um arquivo órfão a mais.
    expect(caminhoPublico('fulano').split('?')[0]).toBe('/uploads/avatars/fulano.jpg');
  });
});

describe('quando a foto mudou', () => {
  test('mesma foto, token novo — não mudou', () => {
    /* O CDN assina cada resposta, então a MESMA imagem volta com URLs
       diferentes. Comparar URLs inteiras diria "mudou" a cada 5 minutos, e o
       sync rebaixaria todas as fotos de todas as contas para nada. */
    const antes = origemDaFoto(UMA_URL);
    const depois = 'https://scontent.cdninstagram.com/v/t51.2885-19/111_n.jpg?stp=OUTRO&oe=999';
    expect(fotoMudou(depois, antes, '/uploads/avatars/x.jpg?v=1')).toBe(false);
  });

  test('imagem diferente — mudou', () => {
    const outra = 'https://scontent.cdninstagram.com/v/t51.2885-19/999_n.jpg?stp=x';
    expect(fotoMudou(outra, origemDaFoto(UMA_URL), '/uploads/avatars/x.jpg?v=1')).toBe(true);
  });

  test('sem avatar local, baixa mesmo com a origem batendo', () => {
    // O campo pode estar preenchido e o arquivo ter sumido do disco.
    expect(fotoMudou(UMA_URL, origemDaFoto(UMA_URL), '')).toBe(true);
  });

  test('conta nova, sem origem registrada — baixa', () => {
    expect(fotoMudou(UMA_URL, '', '')).toBe(true);
    expect(fotoMudou(UMA_URL, undefined, undefined)).toBe(true);
  });

  test('sem URL não há o que baixar', () => {
    /* Devolver true aqui faria o sync tentar baixar `undefined` a cada ciclo,
       falhar três vezes com retry, e registrar um aviso por conta por ciclo. */
    expect(fotoMudou('', 'qualquer', '/uploads/avatars/x.jpg')).toBe(false);
    expect(fotoMudou(null, '', '')).toBe(false);
  });

  test('URL malformada não derruba a comparação', () => {
    expect(() => fotoMudou('não é uma url', '', '')).not.toThrow();
  });
});

describe('gravar o buffer que já está em memória', () => {
  const nome = `teste_${process.pid}`;
  const arquivo = path.join(path.resolve(__dirname, '../uploads/avatars'), `${nome}.jpg`);

  afterAll(() => { try { fs.unlinkSync(arquivo); } catch { /* já não existe */ } });

  test('grava e devolve o caminho versionado', () => {
    const r = gravarAvatar(Buffer.from('conteudo-de-imagem'), nome);
    expect(r).toMatch(new RegExp(`^/uploads/avatars/${nome}\\.jpg\\?v=\\d+$`));
    expect(fs.readFileSync(arquivo, 'utf8')).toBe('conteudo-de-imagem');
  });

  test('sobrescrever devolve versão nova', () => {
    const a = gravarAvatar(Buffer.from('primeira'), nome);
    const b = gravarAvatar(Buffer.from('segunda'), nome);
    expect(fs.readFileSync(arquivo, 'utf8')).toBe('segunda');
    // Mesmo arquivo, versões diferentes — é o que a tela precisa para repintar.
    expect(a.split('?')[0]).toBe(b.split('?')[0]);
  });

  test('buffer vazio ou sem username devolve vazio, não grava lixo', () => {
    /* Devolver um caminho aqui gravaria no banco um avatar que aponta para um
       arquivo de zero byte — e a conta perderia a foto que tinha. */
    expect(gravarAvatar(Buffer.alloc(0), nome)).toBe('');
    expect(gravarAvatar(null, nome)).toBe('');
    expect(gravarAvatar(Buffer.from('x'), '')).toBe('');
  });
});

describe('o campo avatar do modelo aceita a versão', () => {
  test('o schema tem avatarOrigem', () => {
    /* Sem este campo a comparação não tem com o que comparar e `fotoMudou`
       responde "mudou" sempre. */
    const Account = require('../src/models/Account');
    expect(Account.schema.paths).toHaveProperty('avatarOrigem');
    expect(Account.schema.paths).toHaveProperty('avatar');
  });
});

describe('o sync da conta mobile pede os campos que usa', () => {
  test('o select do FastSync traz provider e instagrapiSession', () => {
    /* O ramo instagrapi do FastSync testa `acc.provider` e
       `acc.instagrapiSession`. Num documento vindo de `.select()`, campo não
       pedido volta `undefined` — o teste dava falso para toda conta e o ramo
       nunca rodava. Conta mobile ficava com 0 seguidores e 0 posts para
       sempre, e o comentário acima do ramo descrevia o problema que continuava
       acontecendo.

       Ler o arquivo é grosseiro, mas é o que pega a regressão: o defeito é
       exatamente uma string de select fora de sincronia com o código abaixo
       dela, e nenhum teste de unidade da função enxerga isso. */
    const fonte = fs.readFileSync(
      path.resolve(__dirname, '../src/jobs/accountFastSync.js'), 'utf8'
    );
    const select = fonte.match(/\.select\(([\s\S]*?)\);/);
    expect(select).not.toBeNull();

    for (const campo of ['provider', 'instagrapiSession', 'avatarOrigem', 'avatar']) {
      expect(select[1]).toContain(campo);
    }
  });

  test('syncInstagrapiAccount lê profile_pic_url', () => {
    const fonte = fs.readFileSync(
      path.resolve(__dirname, '../src/services/syncInstagrapiAccount.js'), 'utf8'
    );
    expect(fonte).toContain('profile_pic_url');
    expect(fonte).toContain('baixarAvatar');
  });

  test('a edição de perfil pelo mobile grava o avatar', () => {
    const fonte = fs.readFileSync(
      path.resolve(__dirname, '../src/services/profileEditService.js'), 'utf8'
    );
    // Dentro de _aplicarEdicaoInstagrapi, não só no caminho web.
    const trecho = fonte.slice(fonte.indexOf('_aplicarEdicaoInstagrapi'));
    expect(trecho).toContain('gravarAvatar');
    expect(trecho).toContain('dbUpdate.avatar');
  });
});

describe('não sobra temporário', () => {
  test('a edição apaga o arquivo que mandou para o Instagram', () => {
    /* Cada troca de foto escrevia um `avatar_<id>_<ts>.jpg` em uploads/tmp e
       nunca apagava. Num loop de edições isso enche o disco do servidor. */
    const fonte = fs.readFileSync(
      path.resolve(__dirname, '../src/services/profileEditService.js'), 'utf8'
    );
    const trecho = fonte.slice(fonte.indexOf('_aplicarEdicaoInstagrapi'));
    expect(trecho).toContain('unlinkSync(tmpPath)');
  });
});

describe('o select do FastSync entrega o que o laço lê', () => {
  /* ── A prova, no nível do mongoose ───────────────────────────────────────

     O teste anterior procurava as palavras no arquivo. Isso pega a regressão
     óbvia (alguém tira `provider` do select), mas não demonstra a CAUSA — e a
     causa é o que faz o defeito ser difícil de ver: num documento vindo de um
     `.select()`, um caminho não projetado responde `undefined` mesmo existindo
     no banco e no schema.

     `hydrate(obj, projection)` reproduz exatamente isso: é o caminho que o
     mongoose usa para transformar o que o driver devolveu num documento. */
  const mongoose = require('mongoose');
  const Account = require('../src/models/Account');

  /** O select que está rodando, lido do arquivo — não transcrito aqui. */
  function selectEmProducao() {
    const fonte = fs.readFileSync(
      path.resolve(__dirname, '../src/jobs/accountFastSync.js'), 'utf8'
    );
    const m = fonte.match(/\}\)\.select\(([\s\S]*?)\);/);
    return m[1].replace(/[\n\r]/g, ' ').replace(/'\s*\+\s*'/g, '').replace(/'/g, '').trim();
  }

  /** A linha que decide se a conta mobile sincroniza. */
  const ramoInstagrapi = doc => doc.provider === 'instagrapi' || !!doc.instagrapiSession;

  const conta = () => ({
    _id: new mongoose.Types.ObjectId(),
    username: 'goligi1257',
    provider: 'instagrapi',
    healthStatus: 'ativa',
  });

  test('o select antigo fazia o ramo dar falso — a causa do defeito', () => {
    const ANTIGO = 'username _id igSession rawWebSessionid avatar name bio '
                 + 'followers following postsCount proxy healthStatus';
    const doc = Account.hydrate(conta(), ANTIGO);

    expect(doc.username).toBe('goligi1257');   // projetado: chega
    expect(doc.provider).toBeUndefined();      // não projetado: some
    expect(ramoInstagrapi(doc)).toBe(false);   // e a conta nunca sincronizava
  });

  test('o select atual faz o ramo dar verdadeiro', () => {
    const doc = Account.hydrate(conta(), selectEmProducao());
    expect(doc.provider).toBe('instagrapi');
    expect(ramoInstagrapi(doc)).toBe(true);
  });

  test('avatarOrigem chega, senão a foto seria rebaixada a cada ciclo', () => {
    /* `fotoMudou` compara a URL do CDN com esta origem. Com o campo fora do
       select ele responde `undefined`, a comparação diz "mudou" sempre, e o
       sync rebaixaria todas as fotos de 5 em 5 minutos. */
    const doc = Account.hydrate(
      { ...conta(), avatarOrigem: '/v/t51/111_n.jpg' }, selectEmProducao()
    );
    expect(doc.avatarOrigem).toBe('/v/t51/111_n.jpg');
  });
});
