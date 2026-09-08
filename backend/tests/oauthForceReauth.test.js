'use strict';

/**
 * `force_reauth` na URL de autorização.
 *
 * ── O que ele resolve
 *
 * Conectar uma conta atrás da outra no mesmo navegador. Sem o parâmetro, a
 * segunda autorização reaproveita a sessão do Instagram e autoriza a MESMA
 * conta de novo — em silêncio, como se fosse outra. O sintoma é a lista de
 * contas conectadas repetindo um @ em vez de crescer.
 *
 * ── De onde ele veio, e o que não se sabe
 *
 * Não está na referência pública da Business Login. Está na "URL incorporado"
 * que o PRÓPRIO painel da Meta gera na etapa 4 da configuração do login da
 * empresa: `...oauth/authorize?force_reauth=true&client_id=...`. É a Meta que
 * o emite, e é essa a evidência — não há contrato escrito.
 *
 * Por isso existe o desligamento por variável de ambiente, e por isso este
 * teste guarda os dois caminhos: se o Instagram passar a recusar o parâmetro,
 * `OAUTH_FORCE_REAUTH=false` volta ao comportamento anterior sem deploy.
 *
 * ── O que estes testes protegem
 *
 *   'false' como string   → `Boolean('false')` é true; sem comparação
 *                           explícita, desligar ligaria
 *   ligado por omissão    → é o caso de uso real (muitas contas); um padrão
 *                           desligado devolveria o defeito calado
 *   texto da tela         → a faixa dizia "troque de conta na janela", que
 *                           deixou de ser verdade quando o comportamento mudou
 */

const fs = require('fs');
const path = require('path');

const fonte = fs.readFileSync(path.resolve(__dirname, '../src/routes/oauthRoutes.js'), 'utf8');
/* Só a rota que monta a URL de autorização — as outras montagens de params
   neste arquivo são a troca do código, que não leva `force_reauth`. */
const rotaUrl = fonte.slice(fonte.indexOf("router.get('/url'"), fonte.indexOf("router.post('/connect-by-token'"));

/** A decisão, como o código a escreve — para exercitá-la sem subir a rota. */
function ligado(valor) {
  return String(valor ?? 'true').toLowerCase() !== 'false';
}

describe('a decisão de ligar', () => {
  test('ligado quando a variável não existe', () => {
    /* O caso de uso real é conectar muitas contas. Um padrão desligado
       devolveria o defeito de autorizar a mesma conta duas vezes, calado. */
    expect(ligado(undefined)).toBe(true);
    expect(ligado(null)).toBe(true);
  });

  test("'false' desliga — e é comparação de texto, não de verdade", () => {
    /* `Boolean('false')` é true. Sem a comparação explícita, quem escrevesse
       `OAUTH_FORCE_REAUTH=false` para desligar acabaria ligando. */
    expect(ligado('false')).toBe(false);
    expect(ligado('FALSE')).toBe(false);
    expect(ligado('False')).toBe(false);
  });

  test('qualquer outro valor mantém ligado', () => {
    /* Vale mais errar para o lado que funciona: um valor digitado torto não
       deve reintroduzir o defeito. */
    for (const v of ['true', '1', 'sim', '', 'talvez']) {
      expect(ligado(v)).toBe(true);
    }
  });
});

describe('o parâmetro entra na URL certa', () => {
  test('a rota de autorização o define', () => {
    expect(rotaUrl).toContain("params.set('force_reauth', 'true')");
  });

  test('atrás da variável de ambiente', () => {
    /* Sem o desligamento, um dia em que o Instagram recuse o parâmetro exige
       deploy para voltar. */
    expect(rotaUrl).toContain('OAUTH_FORCE_REAUTH');
  });

  test('a comparação é com o texto "false"', () => {
    expect(rotaUrl).toMatch(/toLowerCase\(\)\s*!==\s*'false'/);
  });

  test('NÃO entra na troca do código por token', () => {
    /* `force_reauth` é da tela de autorização. Na troca do código ele não
       significa nada, e mandar parâmetro estranho num POST de token é o tipo
       de coisa que a Meta responde com erro genérico. */
    const troca = fonte.slice(fonte.indexOf('async function exchangeCodeForToken'));
    const corpo = troca.slice(0, troca.indexOf('\n}'));
    expect(corpo).not.toContain('force_reauth');
  });

  test('o parâmetro é o que o painel da Meta emite', () => {
    /* Escrito exatamente como aparece na URL incorporado da etapa 4:
       `force_reauth=true`. Um nome parecido mas diferente seria ignorado em
       silêncio, e o defeito voltaria sem nada indicar por quê. */
    expect(rotaUrl).toMatch(/'force_reauth'\s*,\s*'true'/);
  });
});

describe('a tela conta a verdade nova', () => {
  const tela = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/pages/Accounts.jsx'), 'utf8');

  test('não promete mais trocar de conta na mão', () => {
    /* Era a verdade antes do parâmetro. Texto que descreve um comportamento
       que mudou é pior que texto nenhum: manda a pessoa fazer um passo que já
       não existe. */
    expect(tela).not.toContain('troque de conta na janela do Instagram');
  });

  test('diz que cada janela pede o login', () => {
    expect(tela).toContain('Cada janela pede o login da conta');
  });
});
