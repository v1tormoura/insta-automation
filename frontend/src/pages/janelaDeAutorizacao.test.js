import { describe, test, expect } from 'vitest';
import {
  ehJanela, lerAviso, deveAnunciar, chaveDoArroba,
  TIPO_DE_AVISO, PRAZO_DE_REPETICAO_MS,
} from './janelaDeAutorizacao.js';

/**
 * A janela de autorização da API oficial.
 *
 * ── Por que estes testes existem
 *
 * Duas razões, e a segunda é a que obriga.
 *
 * A primeira é a mesma do `emendaMobile.test.js`: lógica dentro de um
 * `useEffect` de uma página de 2.700 linhas vai para produção sem nunca ter
 * sido executada.
 *
 * A segunda é que o caminho da janela NÃO É EXECUTÁVEL no navegador de teste —
 * `window.open` devolve null lá, popup bloqueado. Clicar o botão exercita
 * apenas o desvio de fallback. Sem estes testes, o caminho principal desta
 * funcionalidade seria entregue sem uma única execução.
 *
 * ── O que pode dar errado, e é calado
 *
 *   origem não conferida  → qualquer página com referência a esta anuncia uma
 *                           conta conectada que não existe
 *   `includes` no lugar de
 *   igualdade             → "instaflow.pro.site-do-invasor" contém
 *                           "instaflow.pro" e passa
 *   aviso sem prazo       → a janela avisa e o SSE transmite; a mesma conexão
 *                           vira dois avisos
 *   prazo permanente      → reconectar a mesma conta meia hora depois não
 *                           avisa nada, e parece que não funcionou
 *   caixa do @            → SSE traz "Fulano", janela traz "fulano", e a
 *                           deduplicação não reconhece que é o mesmo
 */

const ORIGEM = 'https://instaflow.pro';

/** Um MessageEvent como o navegador entrega. */
const aviso = (data, origin = ORIGEM) => ({ origin, data });

describe('esta página é uma janela?', () => {
  test('com opener vivo, é janela', () => {
    expect(ehJanela({ opener: { closed: false } })).toBe(true);
  });

  test('sem opener, é aba comum', () => {
    /* É o caminho de sempre: o desfecho tem de virar navegação para /accounts,
       não uma tentativa de avisar ninguém. */
    expect(ehJanela({ opener: null })).toBe(false);
    expect(ehJanela({})).toBe(false);
    expect(ehJanela(undefined)).toBe(false);
  });

  test('opener já fechado não é janela', () => {
    /* Avisar um `opener` fechado não chega a lugar nenhum, e fechar esta janela
       deixaria o usuário sem tela. */
    expect(ehJanela({ opener: { closed: true } })).toBe(false);
  });

  test('opener de outra origem que lança é tratado como aba', () => {
    /* Ler `opener.closed` pode lançar quando a origem é outra. Sem o try, a
       página quebraria em vez de cair no caminho de sempre. */
    const win = { get opener() { throw new Error('cross-origin'); } };
    expect(ehJanela(win)).toBe(false);
  });
});

describe('o que a tela aceita de fora', () => {
  test('o aviso legítimo passa', () => {
    expect(lerAviso(aviso({ tipo: TIPO_DE_AVISO, ok: true, username: 'fulano' }), ORIGEM))
      .toEqual({ ok: true, username: 'fulano', erro: '' });
  });

  test('origem diferente é ignorada', () => {
    /* O buraco que isto fecha: sem a conferência, qualquer página que
       conseguisse uma referência a esta anunciaria contas que não existem. */
    expect(lerAviso(aviso({ tipo: TIPO_DE_AVISO, ok: true, username: 'invasor' }, 'https://site-do-invasor.com'), ORIGEM))
      .toBeNull();
  });

  test('origem que só CONTÉM a nossa é ignorada', () => {
    /* `includes` no lugar de igualdade deixaria estas três passarem. */
    for (const falsa of [
      'https://instaflow.pro.site-do-invasor.com',
      'https://instaflow.pro.br',
      'http://instaflow.pro',            // esquema diferente
      'https://sub.instaflow.pro',
    ]) {
      expect(lerAviso(aviso({ tipo: TIPO_DE_AVISO, ok: true, username: 'x' }, falsa), ORIGEM)).toBeNull();
    }
  });

  test('mensagem de outro tipo é ignorada', () => {
    /* A página recebe mensagens de extensões e de bibliotecas. Sem o tipo,
       qualquer uma delas com `ok: true` viraria uma conta conectada. */
    expect(lerAviso(aviso({ tipo: 'webpack-hmr', ok: true, username: 'x' }), ORIGEM)).toBeNull();
    expect(lerAviso(aviso({ ok: true, username: 'x' }), ORIGEM)).toBeNull();
  });

  test('carga que não é objeto simples é ignorada', () => {
    for (const d of [null, undefined, 'mf_oauth', 42, [{ tipo: TIPO_DE_AVISO, ok: true }]]) {
      expect(lerAviso(aviso(d), ORIGEM)).toBeNull();
    }
  });

  test('sem origem esperada, nada passa', () => {
    /* Chamar com '' ou undefined não pode virar "aceita tudo". */
    expect(lerAviso(aviso({ tipo: TIPO_DE_AVISO, ok: true, username: 'x' }), '')).toBeNull();
    expect(lerAviso(aviso({ tipo: TIPO_DE_AVISO, ok: true, username: 'x' }), undefined)).toBeNull();
  });

  test('ok só é verdadeiro quando é o booleano', () => {
    /* `ok: 'false'` é uma string, e string não vazia é verdadeira em JS: sem a
       comparação estrita, uma falha viraria sucesso. */
    expect(lerAviso(aviso({ tipo: TIPO_DE_AVISO, ok: 'false', erro: 'deu erro' }), ORIGEM).ok).toBe(false);
    expect(lerAviso(aviso({ tipo: TIPO_DE_AVISO, ok: 1 }), ORIGEM).ok).toBe(false);
    expect(lerAviso(aviso({ tipo: TIPO_DE_AVISO }), ORIGEM).ok).toBe(false);
  });

  test('o @ é recortado no tamanho que o Instagram emite', () => {
    /* Vai para dentro de um texto na tela. Trinta caracteres é o teto real do
       Instagram; o que passa disso não é um @. */
    const r = lerAviso(aviso({ tipo: TIPO_DE_AVISO, ok: true, username: 'a'.repeat(500) }), ORIGEM);
    expect(r.username).toHaveLength(30);
  });

  test('@ que não é texto vira vazio, não "undefined" na tela', () => {
    for (const u of [undefined, null, 42, {}, ['fulano']]) {
      expect(lerAviso(aviso({ tipo: TIPO_DE_AVISO, ok: true, username: u }), ORIGEM).username).toBe('');
    }
  });

  test('o erro é recortado e só sai quando falhou', () => {
    const falha = lerAviso(aviso({ tipo: TIPO_DE_AVISO, ok: false, erro: 'x'.repeat(900) }), ORIGEM);
    expect(falha.erro).toHaveLength(200);
    /* Num aviso de sucesso, um `erro` pendurado não deve virar texto de erro. */
    const sucesso = lerAviso(aviso({ tipo: TIPO_DE_AVISO, ok: true, username: 'f', erro: 'ignore' }), ORIGEM);
    expect(sucesso.erro).toBe('');
  });
});

describe('o mesmo @ não avisa duas vezes', () => {
  test('a primeira vez avisa', () => {
    expect(deveAnunciar(new Map(), 'fulano', 1_000)).toBe(true);
  });

  test('dentro do prazo, não avisa de novo', () => {
    /* O defeito em uma frase: a janela avisa, o SSE transmite, e o usuário vê
       "Conta conectada!" duas vezes para uma conta. */
    const m = new Map([['fulano', 1_000]]);
    expect(deveAnunciar(m, 'fulano', 1_000 + PRAZO_DE_REPETICAO_MS - 1)).toBe(false);
  });

  test('passado o prazo, avisa de novo', () => {
    /* Reconectar a mesma conta depois é evento novo. Um "já avisei" permanente
       deixaria a reconexão silenciosa, e pareceria que não funcionou. */
    const m = new Map([['fulano', 1_000]]);
    expect(deveAnunciar(m, 'fulano', 1_000 + PRAZO_DE_REPETICAO_MS)).toBe(true);
  });

  test('a caixa do @ não cria dois registros', () => {
    /* O SSE traz o @ como o Instagram devolveu, a janela traz o que estava na
       tela. "Fulano" e "fulano" são a mesma conta. */
    const m = new Map([['fulano', 1_000]]);
    expect(deveAnunciar(m, 'FULANO', 1_500)).toBe(false);
    expect(deveAnunciar(m, '  Fulano  ', 1_500)).toBe(false);
  });

  test('contas diferentes avisam cada uma', () => {
    const m = new Map([['fulano', 1_000]]);
    expect(deveAnunciar(m, 'beltrano', 1_100)).toBe(true);
  });

  test('valor estranho na memória não trava o aviso', () => {
    /* Se o registro vier corrompido, o certo é avisar — perder um aviso é pior
       que repetir um. */
    const m = new Map([['fulano', 'ontem']]);
    expect(deveAnunciar(m, 'fulano', 1_000)).toBe(true);
  });

  test('sem @ nenhum, os dois caminhos ainda deduplicam entre si', () => {
    /* O SSE pode transmitir sem username. Dois avisos vazios em sequência
       continuam sendo a mesma conexão. */
    const m = new Map();
    expect(deveAnunciar(m, '', 1_000)).toBe(true);
    m.set(chaveDoArroba(''), 1_000);
    expect(deveAnunciar(m, undefined, 1_200)).toBe(false);
  });
});
