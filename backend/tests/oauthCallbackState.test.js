'use strict';

/**
 * O state do OAuth no callback do servidor.
 *
 * ── O defeito, e por que ele era invisível
 *
 * `GET /oauth/callback` lia o `state` CRU e decidia com `state !== 'new'`.
 *
 * Só que `/oauth/url` ASSINA o state: 'new' sai como `new~<nonce>~<hmac>`.
 * Então a comparação era sempre verdadeira, toda conexão caía no ramo de
 * "conta que já existe", e o handler chamava
 * `Account.findByIdAndUpdate('new~ab12~cd34')` — um texto que não é ObjectId.
 * O Mongoose lança CastError, o `catch` redireciona para a tela de erro, e
 * nada é gravado.
 *
 * Valia para os dois casos, porque o id da conta também vem assinado. E o
 * sintoma não aponta para cá: a tela do Instagram mostra "Permitir", a pessoa
 * permite, e o painel simplesmente não muda. Parece que falta aprovar o app.
 *
 * O `POST /oauth/connect/:state` — o caminho de colar a URL à mão — já fazia
 * certo. Eram dois caminhos para a mesma coisa e só um estava correto.
 *
 * ── O que estes testes protegem
 *
 *   comparação com o state cru   → o defeito acima, de volta
 *   id assinado numa busca       → CastError no meio do callback
 *   `__mapp_` não desmontado     → quem tem mais de um App da Meta fica com o
 *                                  id do app grudado no id da conta
 *   destino protegido            → o navegador do perfil não está logado no
 *                                  painel: a conta conecta e a pessoa vê a
 *                                  tela de login
 */

const fs = require('fs');
const path = require('path');

const CHAVE = 'a'.repeat(64);
const ler = p => fs.readFileSync(path.resolve(__dirname, p), 'utf8');

describe('a assinatura do state', () => {
  let signState, verifyAndStripState;

  beforeAll(() => {
    process.env.OAUTH_STATE_SECRET = CHAVE;
    ({ signState, verifyAndStripState } = require('../src/services/csrfState'));
  });

  test("state assinado NUNCA é igual ao original — é o coração do defeito", () => {
    /* Era exatamente disto que `state !== 'new'` dependia para funcionar, e
       nunca funcionou: assinado, 'new' não é 'new'. */
    const assinado = signState('new');
    expect(assinado).not.toBe('new');
    expect(assinado.startsWith('new~')).toBe(true);
  });

  test('desmontado, volta a ser o original', () => {
    for (const original of ['new', '68bd4a800000000000000001', 'new__mapp_64b000000000000000000009']) {
      const r = verifyAndStripState(signState(original));
      expect(r.valid).toBe(true);
      expect(r.state).toBe(original);
    }
  });

  test('adulterado é recusado', () => {
    const assinado = signState('68bd4a800000000000000001');
    const outro = assinado.replace('68bd4a800000000000000001', '68bd4a800000000000000099');
    expect(verifyAndStripState(outro).valid).toBe(false);
  });

  test('o id assinado não é um ObjectId — daí o CastError', () => {
    /* A conta existente também vinha assinada, então o ramo de reconexão
       recebia um texto impróprio para busca. */
    const mongoose = require('mongoose');
    const assinado = signState('68bd4a800000000000000001');
    expect(mongoose.Types.ObjectId.isValid(assinado)).toBe(false);
    expect(mongoose.Types.ObjectId.isValid(verifyAndStripState(assinado).state)).toBe(true);
  });
});

describe('o callback do servidor desmonta antes de decidir', () => {
  const fonte = ler('../src/routes/oauthRoutes.js');
  /* Só o corpo do `GET /callback`: o `POST /connect` já fazia certo, e
     misturar os dois esconderia uma regressão no que foi corrigido. */
  const callback = fonte.slice(
    fonte.indexOf("router.get('/callback'"),
    fonte.indexOf("router.delete('/disconnect/"),
  );

  test('confere a assinatura antes de qualquer coisa', () => {
    expect(callback).toContain('verifyAndStripState(state)');
    expect(callback.indexOf('verifyAndStripState(state)'))
      .toBeLessThan(callback.indexOf('exchangeCodeForToken'));
  });

  test('state inválido não segue para a troca do código', () => {
    /* Sem esta saída, um state adulterado ainda gastaria uma troca de código
       com o Meta e gravaria o token onde o atacante escolheu. */
    expect(callback).toMatch(/if\s*\(!conferido\.valid\)/);
  });

  test('NÃO compara mais o state cru', () => {
    /* A linha que era o defeito abria com `if (state && …`.

       A assertiva ancora na SINTAXE do `if`, não no texto da comparação: o
       texto aparece no comentário que explica o defeito, e uma assertiva que
       não distingue prosa de código falha por causa da própria documentação.
       Foi a quarta vez que escrevi isso errado neste projeto — daí a âncora. */
    expect(callback).not.toMatch(/if\s*\(\s*state\s*&&/);
  });

  test('decide pelo valor desmontado', () => {
    expect(callback).toMatch(/alvo\s*!==\s*'new'/);
  });

  test('confere que o alvo é ObjectId antes de buscar', () => {
    /* Sem isto, um state legado sem assinatura passaria adiante e o
       `findByIdAndUpdate` voltaria a lançar CastError. */
    expect(callback).toContain('mongoose.Types.ObjectId.isValid(alvo)');
    expect(callback.indexOf('mongoose.Types.ObjectId.isValid(alvo)'))
      .toBeLessThan(callback.indexOf('Account.findByIdAndUpdate(alvo'));
  });

  test('desmonta o App da Meta do state', () => {
    /* Quem tem mais de um App tinha o id do app grudado no id da conta — e o
       Meta recusa a troca do código com `client_id` de um app e código
       emitido por outro. */
    expect(callback).toContain("alvo.includes('__mapp_')");
    expect(callback).toContain('exchangeCodeForToken(code, appDaConexao)');
  });

  test('o mongoose está importado — senão o guard lança ReferenceError', () => {
    /* Um guard que quebra é pior que guard nenhum: o callback responderia 500
       em vez de conectar. */
    expect(fonte).toMatch(/^const mongoose\s*=\s*require\('mongoose'\);/m);
  });
});

describe('para onde o navegador vai depois de conectar', () => {
  const fonte = ler('../src/routes/oauthRoutes.js');

  test('o sucesso vai para uma página PÚBLICA', () => {
    /* `/accounts` é rota protegida. No navegador do perfil (multilogin), que
       não está logado no painel, a conta conectava de verdade e a tela que
       aparecia era a de login — parecia que não tinha funcionado. */
    expect(fonte).toContain('function destinoDeSucesso');
    const fn = fonte.slice(fonte.indexOf('function destinoDeSucesso'));
    expect(fn.slice(0, 200)).toContain('/conectar?ok=');
  });

  test('os dois ramos de sucesso usam o mesmo destino', () => {
    /* Reconexão e conta nova. Um dos dois apontando para a rota protegida
       deixaria metade dos casos com o sintoma de volta. */
    const callback = fonte.slice(
      fonte.indexOf("router.get('/callback'"),
      fonte.indexOf("router.delete('/disconnect/"),
    );
    const usos = callback.match(/destinoDeSucesso\(username\)/g) || [];
    expect(usos).toHaveLength(2);
    expect(callback).not.toMatch(/accounts\?oauth=success/);
  });

  test('o @ vai codificado na URL', () => {
    const fn = fonte.slice(fonte.indexOf('function destinoDeSucesso'));
    expect(fn.slice(0, 200)).toContain('encodeURIComponent(username');
  });

  test('a página guiada mostra o desfecho', () => {
    /* Um destino público que não diz nada seria a mesma confusão com outra
       tela. */
    const tela = ler('../../frontend/src/pages/ConectarGuiado.jsx');
    expect(tela).toContain("params.get('ok')");
    expect(tela).toContain('Conta conectada');
  });
});
