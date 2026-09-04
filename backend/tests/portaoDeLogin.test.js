'use strict';

/**
 * O espaçamento entre logins por senha.
 *
 * ── O que este módulo não promete
 *
 * Não remove o limite do Instagram. O `accounts/login/` tem contador por IP no
 * servidor deles; nada aqui o zera. O limite é uma TAXA — algumas tentativas
 * por janela — e o portão evita ESTOURAR essa taxa, espaçando as tentativas
 * antes de gastá-las.
 *
 * Quatro contas conectadas em sequência gastavam quatro tentativas em dois
 * minutos. Espaçadas, as mesmas quatro passam.
 */

const fs = require('fs');
const portao = require('../src/services/portaoDeLogin');

const {
  conferir, registrarTentativa, registrarLimite, registrarSucesso, limpar,
  esperaSorteada, ESPERA_MIN_MS, ESPERA_MAX_MS, ESPERA_APOS_LIMITE_MS, ARQUIVO,
} = portao;

const T0 = 1_700_000_000_000;

beforeEach(() => limpar());
afterAll(() => limpar());

describe('o portão começa aberto', () => {
  test('primeira tentativa passa na hora', () => {
    /* Ninguém deve esperar para conectar a primeira conta. O espaçamento é
       entre tentativas, não antes da primeira. */
    const r = conferir(T0);
    expect(r.pode).toBe(true);
    expect(r.esperaMs).toBe(0);
  });
});

describe('o espaçamento', () => {
  test('a segunda tentativa espera', () => {
    registrarTentativa(T0, () => 0.5);
    const r = conferir(T0 + 1000);
    expect(r.pode).toBe(false);
    expect(r.esperaMs).toBeGreaterThan(0);
    expect(r.motivo).toMatch(/espaçando/i);
  });

  test('depois da janela, abre de novo', () => {
    registrarTentativa(T0, () => 0);       // espera mínima
    expect(conferir(T0 + ESPERA_MIN_MS + 1).pode).toBe(true);
  });

  test('a espera fica na faixa de 2 a 4 minutos', () => {
    for (let i = 0; i < 500; i++) {
      const ms = esperaSorteada();
      expect(ms).toBeGreaterThanOrEqual(ESPERA_MIN_MS);
      expect(ms).toBeLessThanOrEqual(ESPERA_MAX_MS);
    }
  });

  test('a espera varia — não é um intervalo cravado', () => {
    /* Quatro logins exatamente 150 segundos separados é um padrão tão legível
       quanto quatro seguidos. */
    const vistos = new Set();
    for (let i = 0; i < 200; i++) vistos.add(esperaSorteada());
    expect(vistos.size).toBeGreaterThan(50);
  });
});

describe('quando o Instagram confirma o limite', () => {
  test('o bloqueio dele vence o espaçamento normal', () => {
    /* Sem isto, o próximo clique passaria pelo espaçamento de dois minutos e
       gastaria uma tentativa num IP que acabou de pedir cinco. Insistir dentro
       da janela piora o bloqueio. */
    registrarLimite(300, T0);
    const r = conferir(T0 + ESPERA_MAX_MS + 1000);   // já passou o espaçamento
    expect(r.pode).toBe(false);
    expect(r.motivo).toMatch(/Instagram/);
  });

  test('o tempo que ele informou é respeitado', () => {
    registrarLimite(296, T0);                        // os 4:56 da tela
    expect(conferir(T0 + 290_000).pode).toBe(false);
    expect(conferir(T0 + 297_000).pode).toBe(true);
  });

  test('sem tempo informado, usa o piso', () => {
    registrarLimite(undefined, T0);
    expect(conferir(T0 + ESPERA_APOS_LIMITE_MS - 1000).pode).toBe(false);
    expect(conferir(T0 + ESPERA_APOS_LIMITE_MS + 1000).pode).toBe(true);
  });

  test('dois limites seguidos não encurtam o bloqueio', () => {
    // `Math.max`: um limite curto chegando depois de um longo não pode soltar
    // o portão antes da hora.
    registrarLimite(600, T0);
    registrarLimite(60, T0 + 1000);
    expect(conferir(T0 + 120_000).pode).toBe(false);
  });
});

describe('depois de um login bem-sucedido', () => {
  test('o portão abre mais cedo, mas não na hora', () => {
    /* Sucesso é sinal de que o IP não está limitado — manter a espera cheia
       cobraria por um problema que não existe. Mas quatro logins em trinta
       segundos é o padrão que o espaçamento existe para evitar. */
    registrarTentativa(T0, () => 1);            // espera máxima
    registrarSucesso(T0);
    const r = conferir(T0 + 1000);
    expect(r.pode).toBe(false);
    expect(r.esperaMs).toBeLessThanOrEqual(ESPERA_MIN_MS / 2);
  });

  test('um sucesso limpa um bloqueio anterior', () => {
    registrarLimite(600, T0);
    registrarSucesso(T0);
    expect(conferir(T0 + ESPERA_MIN_MS).pode).toBe(true);
  });
});

describe('o estado sobrevive ao restart', () => {
  test('grava em disco', () => {
    registrarTentativa(T0);
    expect(fs.existsSync(ARQUIVO)).toBe(true);
  });

  test('relê o que gravou', () => {
    /* Em memória, um `docker compose restart` zeraria a contagem e o próximo
       clique gastaria a tentativa que o Instagram ainda está contando — o
       contador dele não reinicia junto com o container. */
    registrarLimite(600, T0);
    jest.resetModules();
    const recarregado = require('../src/services/portaoDeLogin');
    expect(recarregado.conferir(T0 + 60_000).pode).toBe(false);
  });

  test('arquivo corrompido não trava a conexão', () => {
    /* Um estado ilegível não pode impedir logins: começar limpo é o
       comportamento certo. */
    fs.writeFileSync(ARQUIVO, 'isto não é json');
    jest.resetModules();
    const recarregado = require('../src/services/portaoDeLogin');
    expect(() => recarregado.conferir(T0)).not.toThrow();
    expect(recarregado.conferir(T0).pode).toBe(true);
  });
});

describe('a rota usa o portão', () => {
  const fonte = fs.readFileSync(
    require('path').resolve(__dirname, '../src/routes/accountRoutes.js'), 'utf8'
  );

  test('espera antes de gastar a tentativa, em vez de devolver erro', () => {
    /* Um módulo pode estar perfeito e ninguém chamá-lo — foi o defeito do
       arquivo por conta. */
    expect(fonte).toContain('portao.conferir()');
    expect(fonte).toContain('setTimeout(r, vez.esperaMs)');
  });

  test('registra a tentativa ANTES do login', () => {
    // Senha errada consome a tentativa do Instagram do mesmo jeito.
    const i = fonte.indexOf('portao.registrarTentativa()');
    const j = fonte.indexOf('await http.login(account, clean');
    expect(i).toBeGreaterThan(0);
    expect(i).toBeLessThan(j);
  });

  test('registra o limite quando o Instagram o confirma', () => {
    expect(fonte).toContain("code === 'RATE_LIMITED'");
    expect(fonte).toContain('registrarLimite(segundos)');
  });

  test('espera longa vira contagem na tela, não requisição pendurada', () => {
    // Um navegador não segura uma requisição por cinco minutos.
    expect(fonte).toContain('TETO_DE_ESPERA_MS');
    expect(fonte).toContain('retryAfterSeconds');
  });
});
