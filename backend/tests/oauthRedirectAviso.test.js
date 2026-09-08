'use strict';

/**
 * O aviso sobre o `redirect_uri` configurado.
 *
 * ── O que aconteceu em produção
 *
 * `OAUTH_REDIRECT_URI=https://localhost:3000/api/oauth/callback` com
 * `FRONTEND_URL=https://instaflow.pro`.
 *
 * O Instagram redireciona o NAVEGADOR para o redirect_uri, e `localhost` ali é
 * a máquina de quem clicou — não o servidor. A conexão automática não tinha
 * como funcionar; sobrava copiar a URL da barra de endereços e colar de volta.
 *
 * E nada dizia isso. A pessoa permitia no Instagram, a aba morria numa página
 * que não carrega, e a conclusão natural era "o app não foi aprovado".
 *
 * ── Por que avisa e não corrige
 *
 * Derivar o endereço de `FRONTEND_URL` seria fácil e perigoso: o Meta exige que
 * o redirect_uri seja EXATAMENTE um dos cadastrados no painel dele. Um endereço
 * certo mas não cadastrado quebra a autorização antes de começar — pior que a
 * configuração atual, em que ao menos o caminho de colar funciona.
 *
 * ── O que estes testes protegem
 *
 *   falso positivo em dev   → localhost com frontend em localhost é o caso
 *                             normal de desenvolvimento; avisar ali treina a
 *                             pessoa a ignorar avisos, e o aviso precisa ser
 *                             confiável no dia em que importa
 *   falso negativo          → o caso real encontrado em produção
 *   URL quebrada            → `new URL()` lança, e um aviso que lança derruba
 *                             a rota que ele deveria só comentar
 */

const { avisoDoRedirect } = require('../src/routes/oauthRoutes');

const PUBLICO = 'https://instaflow.pro';

describe('quando o aviso aparece', () => {
  test('localhost no redirect com painel em host público', () => {
    /* O caso real. É o único em que a configuração é impossível: o navegador
       de quem autoriza não é o servidor. */
    const aviso = avisoDoRedirect('https://localhost:3000/api/oauth/callback', PUBLICO);
    expect(aviso).toBeTruthy();
    expect(aviso).toContain('localhost');
    /* Diz o que fazer, não só o que está errado. */
    expect(aviso).toContain('https://instaflow.pro/api/oauth/callback');
    expect(aviso).toContain('painel da Meta');
  });

  test('127.0.0.1, ::1 e 0.0.0.0 contam igual', () => {
    for (const host of ['http://127.0.0.1:3000/cb', 'http://[::1]:3000/cb', 'http://0.0.0.0:3000/cb']) {
      expect(avisoDoRedirect(host, PUBLICO)).toBeTruthy();
    }
  });

  test('redirect vazio ou ausente', () => {
    for (const v of ['', '   ', null, undefined]) {
      expect(avisoDoRedirect(v, PUBLICO)).toContain('não está configurado');
    }
  });

  test('URL quebrada avisa em vez de lançar', () => {
    /* `new URL()` lança. Um aviso que lança derruba a rota que ele deveria só
       comentar — e aí ninguém consegue nem pedir a URL de autorização. */
    expect(() => avisoDoRedirect('nao-e-uma-url', PUBLICO)).not.toThrow();
    expect(avisoDoRedirect('nao-e-uma-url', PUBLICO)).toContain('não é uma URL válida');
  });

  test('a barra sobrando no frontend não vira barra dupla na sugestão', () => {
    const aviso = avisoDoRedirect('https://localhost:3000/cb', 'https://instaflow.pro/');
    expect(aviso).toContain('https://instaflow.pro/api/oauth/callback');
    expect(aviso).not.toContain('pro//api');
  });
});

describe('quando o aviso NÃO aparece', () => {
  test('configuração coerente em produção', () => {
    expect(avisoDoRedirect('https://instaflow.pro/api/oauth/callback', PUBLICO)).toBeNull();
  });

  test('localhost nos DOIS é desenvolvimento, não defeito', () => {
    /* Aqui o navegador e o servidor são a mesma máquina, e localhost está
       certo. Avisar neste caso treinaria a pessoa a ignorar o aviso. */
    expect(avisoDoRedirect('http://localhost:5200/oauth-callback', 'http://localhost:5200')).toBeNull();
    expect(avisoDoRedirect('http://127.0.0.1:3000/cb', 'http://127.0.0.1:5200')).toBeNull();
  });

  test('sem frontend definido, não julga', () => {
    /* Sem saber onde o painel está, não há como afirmar que localhost está
       errado — e um aviso baseado em suposição é pior que nenhum. */
    expect(avisoDoRedirect('http://localhost:3000/cb', '')).toBeNull();
    expect(avisoDoRedirect('http://localhost:3000/cb', undefined)).toBeNull();
  });

  test('outro host que não seja local não é motivo de aviso', () => {
    /* Um redirect num subdomínio é escolha legítima de quem configurou. O que
       a conferência sabe julgar é só o impossível. */
    expect(avisoDoRedirect('https://api.instaflow.pro/api/oauth/callback', PUBLICO)).toBeNull();
    expect(avisoDoRedirect('https://outro-dominio.com/cb', PUBLICO)).toBeNull();
  });

  test('maiúsculas no host não escapam da conferência', () => {
    /* `LOCALHOST` é o mesmo host. Comparar sem normalizar deixaria passar. */
    expect(avisoDoRedirect('https://LOCALHOST:3000/cb', PUBLICO)).toBeTruthy();
  });
});

describe('o aviso chega a quem precisa dele', () => {
  const fs = require('fs');
  const path = require('path');
  const ler = p => fs.readFileSync(path.resolve(__dirname, p), 'utf8');

  test('a rota devolve o aviso junto da URL, sem bloquear', () => {
    /* Avisar não pode bloquear: o caminho de colar a URL de retorno ainda
       funciona com a configuração errada, e tirá-lo deixaria a pessoa sem
       nenhuma saída. */
    const fonte = ler('../src/routes/oauthRoutes.js');
    const rota = fonte.slice(fonte.indexOf("router.get('/url'"), fonte.indexOf("router.post('/connect-by-token'"));
    expect(rota).toContain('avisoDoRedirect(REDIRECT_URI, FRONTEND)');
    expect(rota).toMatch(/res\.json\(\{\s*url,/);
    expect(rota).toContain('...(aviso ? { aviso } : {})');
  });

  test('a tela guarda e mostra o aviso', () => {
    /* Um log no servidor não chega a quem está a um clique de autorizar. */
    const tela = ler('../../frontend/src/pages/Accounts.jsx');
    expect(tela).toContain('setAvisoOAuth(res.data?.aviso');
    expect(tela).toContain('{avisoOAuth && (');
    expect(tela).toContain('Configuração do OAuth');
  });

  test('o aviso vem ANTES dos passos na tela', () => {
    /* Se o retorno não tem para onde ir, seguir os dois passos não conecta
       nada — o aviso perde a função se aparecer depois. */
    const tela = ler('../../frontend/src/pages/Accounts.jsx');
    expect(tela.indexOf('{avisoOAuth && (')).toBeLessThan(tela.indexOf('<PassosDeConexao'));
  });
});
