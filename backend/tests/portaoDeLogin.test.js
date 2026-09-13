'use strict';

/**
 * O espaçamento entre logins por senha — POR CONTA.
 *
 * ── O que este módulo não promete
 *
 * Não remove o limite do Instagram. O `accounts/login/` tem contador no servidor
 * deles; nada aqui o zera. O limite é uma TAXA — algumas tentativas por janela —
 * e o portão evita ESTOURAR essa taxa, espaçando as tentativas antes de gastá-las.
 *
 * Quatro contas conectadas em sequência gastavam quatro tentativas em dois
 * minutos. Espaçadas, as mesmas quatro passam.
 *
 * ── Por conta, não global
 *
 * O freio segue a unidade de isolamento. Como cada conta sai por um IP próprio
 * (o molde `__sessid.`), o 429 de uma conta não pode barrar outra — era o que o
 * freio global fazia, e é o que o bloco final aqui prova que não acontece mais.
 */

const fs = require('fs');
const portao = require('../src/services/portaoDeLogin');

const {
  conferir, registrarTentativa, registrarLimite, registrarSucesso, limpar,
  esperaSorteada, ESPERA_MIN_MS, ESPERA_MAX_MS, ESPERA_APOS_LIMITE_MS, ARQUIVO,
} = portao;

const T0 = 1_700_000_000_000;
const A = 'contaA';
const B = 'contaB';

beforeEach(() => limpar());
afterAll(() => limpar());

describe('o portão começa aberto', () => {
  test('primeira tentativa passa na hora', () => {
    /* Ninguém deve esperar para conectar a primeira conta. O espaçamento é
       entre tentativas, não antes da primeira. */
    const r = conferir(A, T0);
    expect(r.pode).toBe(true);
    expect(r.esperaMs).toBe(0);
  });
});

describe('o espaçamento', () => {
  test('a segunda tentativa espera', () => {
    registrarTentativa(A, T0, () => 0.5);
    const r = conferir(A, T0 + 1000);
    expect(r.pode).toBe(false);
    expect(r.esperaMs).toBeGreaterThan(0);
    expect(r.motivo).toMatch(/espaçando/i);
  });

  test('depois da janela, abre de novo', () => {
    registrarTentativa(A, T0, () => 0);       // espera mínima
    expect(conferir(A, T0 + ESPERA_MIN_MS + 1).pode).toBe(true);
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
    registrarLimite(A, 300, T0);
    const r = conferir(A, T0 + ESPERA_MAX_MS + 1000);   // já passou o espaçamento
    expect(r.pode).toBe(false);
    expect(r.motivo).toMatch(/Instagram/);
  });

  test('o tempo que ele informou é respeitado', () => {
    registrarLimite(A, 296, T0);                        // os 4:56 da tela
    expect(conferir(A, T0 + 290_000).pode).toBe(false);
    expect(conferir(A, T0 + 297_000).pode).toBe(true);
  });

  test('sem tempo informado, usa o piso', () => {
    registrarLimite(A, undefined, T0);
    expect(conferir(A, T0 + ESPERA_APOS_LIMITE_MS - 1000).pode).toBe(false);
    expect(conferir(A, T0 + ESPERA_APOS_LIMITE_MS + 1000).pode).toBe(true);
  });

  test('dois limites seguidos não encurtam o bloqueio', () => {
    // `Math.max`: um limite curto chegando depois de um longo não pode soltar
    // o portão antes da hora.
    registrarLimite(A, 600, T0);
    registrarLimite(A, 60, T0 + 1000);
    expect(conferir(A, T0 + 120_000).pode).toBe(false);
  });

  test('sem tempo informado, a espera CRESCE a cada limite seguido', () => {
    /* O defeito que travava a conexão: 429 sem tempo fixava 5 min sempre.
       Espera 5, tenta, 429 de novo, espera 5 — laço infinito, e cada volta
       reforça o bloqueio do lado do Instagram. Agora o degrau sobe. */
    registrarLimite(A, undefined, T0);                 // 1º: 5 min
    expect(conferir(A, T0 + 5 * 60_000 + 1000).pode).toBe(true);

    const T1 = T0 + 6 * 60_000;
    registrarLimite(A, undefined, T1);                 // 2º seguido: 15 min
    expect(conferir(A, T1 + 14 * 60_000).pode).toBe(false);
    expect(conferir(A, T1 + 15 * 60_000 + 1000).pode).toBe(true);

    const T2 = T1 + 16 * 60_000;
    registrarLimite(A, undefined, T2);                 // 3º seguido: 45 min
    expect(conferir(A, T2 + 44 * 60_000).pode).toBe(false);
  });

  test('a espera tem teto de 60 min', () => {
    let t = T0;
    for (let i = 0; i < 8; i++) { registrarLimite(A, undefined, t); t += 1000; }
    // Oito seguidos dariam horas sem o teto.
    expect(conferir(A, t + 60 * 60_000 + 1000).pode).toBe(true);
  });

  test('um período longo sem limite reinicia a sequência', () => {
    registrarLimite(A, undefined, T0);                 // 1º: 5 min
    // Mais de uma janela depois: conta como um novo começo, não o 2º degrau.
    const T1 = T0 + 61 * 60_000;
    registrarLimite(A, undefined, T1);
    expect(conferir(A, T1 + 5 * 60_000 + 1000).pode).toBe(true);   // de volta a 5 min
  });

  test('um sucesso zera a escalada', () => {
    registrarLimite(A, undefined, T0);
    registrarLimite(A, undefined, T0 + 6 * 60_000);    // já no 2º degrau
    registrarSucesso(A, T0 + 7 * 60_000);
    // O próximo limite recomeça em 5 min, não no 3º degrau.
    const T1 = T0 + 8 * 60_000;
    registrarLimite(A, undefined, T1);
    expect(conferir(A, T1 + 5 * 60_000 + 1000).pode).toBe(true);
  });
});

describe('depois de um login bem-sucedido', () => {
  test('o portão abre mais cedo, mas não na hora', () => {
    /* Sucesso é sinal de que o IP não está limitado — manter a espera cheia
       cobraria por um problema que não existe. Mas quatro logins em trinta
       segundos é o padrão que o espaçamento existe para evitar. */
    registrarTentativa(A, T0, () => 1);            // espera máxima
    registrarSucesso(A, T0);
    const r = conferir(A, T0 + 1000);
    expect(r.pode).toBe(false);
    expect(r.esperaMs).toBeLessThanOrEqual(ESPERA_MIN_MS / 2);
  });

  test('um sucesso limpa um bloqueio anterior', () => {
    registrarLimite(A, 600, T0);
    registrarSucesso(A, T0);
    expect(conferir(A, T0 + ESPERA_MIN_MS).pode).toBe(true);
  });
});

describe('o estado sobrevive ao restart', () => {
  test('grava em disco', () => {
    registrarTentativa(A, T0);
    expect(fs.existsSync(ARQUIVO)).toBe(true);
  });

  test('relê o que gravou', () => {
    /* Em memória, um `docker compose restart` zeraria a contagem e o próximo
       clique gastaria a tentativa que o Instagram ainda está contando — o
       contador dele não reinicia junto com o container. */
    registrarLimite(A, 600, T0);
    jest.resetModules();
    const recarregado = require('../src/services/portaoDeLogin');
    expect(recarregado.conferir(A, T0 + 60_000).pode).toBe(false);
  });

  test('arquivo corrompido não trava a conexão', () => {
    /* Um estado ilegível não pode impedir logins: começar limpo é o
       comportamento certo. */
    fs.writeFileSync(ARQUIVO, 'isto não é json');
    jest.resetModules();
    const recarregado = require('../src/services/portaoDeLogin');
    expect(() => recarregado.conferir(A, T0)).not.toThrow();
    expect(recarregado.conferir(A, T0).pode).toBe(true);
  });
});

describe('o freio é por conta', () => {
  test('o 429 de uma conta NÃO bloqueia outra', () => {
    /* O defeito que o print mostrou: com o freio global, a contaB — IP próprio,
       nunca tentou nada — via "aguarde" por causa do 429 da contaA. Agora cada
       conta tem o seu freio. */
    registrarLimite(A, undefined, T0);              // A leva 429
    expect(conferir(A, T0 + 60_000).pode).toBe(false);   // A esperando
    expect(conferir(B, T0 + 60_000).pode).toBe(true);    // B livre
  });

  test('liberar uma conta não mexe na outra', () => {
    registrarLimite(A, undefined, T0);
    registrarLimite(B, undefined, T0);
    limpar(A);
    expect(conferir(A, T0 + 60_000).pode).toBe(true);    // A liberada à mão
    expect(conferir(B, T0 + 60_000).pode).toBe(false);   // B segue no freio
  });
});

describe('a rota usa o portão', () => {
  const fonte = fs.readFileSync(
    require('path').resolve(__dirname, '../src/routes/accountRoutes.js'), 'utf8'
  );

  test('espera antes de gastar a tentativa, em vez de devolver erro', () => {
    /* Um módulo pode estar perfeito e ninguém chamá-lo — foi o defeito do
       arquivo por conta. */
    expect(fonte).toContain('portao.conferir(freioLogin)');
    expect(fonte).toContain('setTimeout(r, vez.esperaMs)');
  });

  test('o freio é chaveado pelo USERNAME, não pelo _id que a conta órfã recria', () => {
    /* Conta nova que falha é apagada e recriada com _id novo; se o freio fosse
       pelo _id, cada recriação o zeraria e o clique gastaria de novo a
       tentativa que o Instagram conta por @. */
    expect(fonte).toContain('const freioLogin = clean');
    expect(fonte).toContain('portao.conferir(freioLogin)');
    expect(fonte).not.toContain('portao.conferir(accountId)');
  });

  test('registra a tentativa ANTES do login', () => {
    // Senha errada consome a tentativa do Instagram do mesmo jeito.
    const i = fonte.indexOf('portao.registrarTentativa(freioLogin)');
    const j = fonte.indexOf('await http.login(account, clean');
    expect(i).toBeGreaterThan(0);
    expect(i).toBeLessThan(j);
  });

  test('registra o limite quando o Instagram o confirma', () => {
    expect(fonte).toContain("code === 'RATE_LIMITED'");
    expect(fonte).toContain('registrarLimite(freioKey, segundos)');
  });

  test('espera longa vira contagem na tela, não requisição pendurada', () => {
    // Um navegador não segura uma requisição por cinco minutos.
    expect(fonte).toContain('TETO_DE_ESPERA_MS');
    expect(fonte).toContain('retryAfterSeconds');
  });
});
