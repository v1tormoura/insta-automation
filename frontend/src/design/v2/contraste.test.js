import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  hexParaRgb, luminancia, contraste, bloco, tokensHex,
} from '../cor.js';

/**
 * Contraste da direção nova, medido nos arquivos que o protótipo usa.
 *
 * ── Por que existe antes da migração
 *
 * Esta paleta ainda não está no produto — está numa rota isolada, esperando
 * aprovação. Travar agora é o ponto: enquanto a direção é só uma proposta, os
 * números podem ser ajustados de graça. Depois de espalhados por 43 páginas,
 * descobrir que o texto terciário reprova sobre a superfície mais alta custa
 * uma varredura no produto inteiro.
 *
 * Foi exatamente o que aconteceu com a paleta anterior: o tema claro reprovava
 * em 4.27 desde antes, e ninguém soube até um teste ler os arquivos.
 *
 * ── O que ele NÃO faz
 *
 * Não julga estética. Contraste é condição necessária e não suficiente: uma
 * paleta pode passar em tudo aqui e ainda ser feia. O que ele impede é a
 * classe de defeito que não se vê olhando — a que só aparece quando alguém
 * com pouca visão, ou um monitor ruim, ou luz do sol na tela, encontra o
 * texto que sumiu.
 */

const css = readFileSync(fileURLToPath(new URL('./tokens.css', import.meta.url)), 'utf8');
const T = tokensHex(bloco(css, '[data-mf2] {'), 'g');
const rgb = nome => hexParaRgb(T[nome]);

const SUPERFICIES = ['g-ground', 'g-panel', 'g-raised', 'g-high'];
const TEXTOS = ['g-ink', 'g-ink-2', 'g-ink-3'];

/* Ciano e violeta carregam ícone, trilho e realce: são interface. Os
   semânticos carregam palavra dentro de crachá, então valem como texto. */
const INTERFACE = ['g-brand', 'g-brand-2'];
const SEMANTICOS = ['g-ok', 'g-warn', 'g-crit', 'g-rare'];

const AA_TEXTO = 4.5;
const AA_UI = 3.0;

describe('a paleta foi lida', () => {
  test('todos os tokens conferidos existem no arquivo', () => {
    const esperados = [...SUPERFICIES, ...TEXTOS, ...INTERFACE, ...SEMANTICOS, 'g-on-brand'];
    const faltando = esperados.filter(n => !T[n]);
    expect(faltando).toEqual([]);
  });
});

describe('superfícies', () => {
  test('o chão é escuro de verdade', () => {
    /* A direção escolhida foi "escuro profundo", e escuro profundo é um
       número: a média de Linear, Vercel, Raycast, Supabase e Stripe é
       L 0.173. A paleta anterior estava em 0.274 — 1,6x mais clara — e era
       isso que o olho lia como desbotado. */
    const L = luminancia(rgb('g-ground'));
    expect(L).toBeLessThan(0.045);   // luminância relativa, não OKLCH
  });

  test('as quatro camadas são distinguíveis entre si', () => {
    // Não exijo ordem monotônica: isso seria um palpite sobre o desenho. O
    // invariante real é que ninguém confunda duas camadas.
    const falhas = [];
    for (let i = 0; i < SUPERFICIES.length; i++) {
      for (let j = i + 1; j < SUPERFICIES.length; j++) {
        const r = contraste(rgb(SUPERFICIES[i]), rgb(SUPERFICIES[j]));
        if (r < 1.03) falhas.push(`${SUPERFICIES[i]} e ${SUPERFICIES[j]}: ${r.toFixed(3)}`);
      }
    }
    expect(falhas).toEqual([]);
  });

  test('a elevação sobe: cada camada é mais clara que a anterior', () => {
    // Aqui a monotonia É o desenho — no escuro, mais alto significa mais luz.
    const ls = SUPERFICIES.map(s => luminancia(rgb(s)));
    for (let i = 1; i < ls.length; i++) {
      expect(ls[i], `${SUPERFICIES[i]} não é mais claro que o anterior`)
        .toBeGreaterThan(ls[i - 1]);
    }
  });
});

describe('texto', () => {
  test('passa AA sobre TODAS as superfícies', () => {
    /* "Todas" é o ponto. Conferir só a superfície onde o texto costuma
       aparecer é o erro que deixou o tema claro anterior reprovando em 4.27
       com um comentário no arquivo anunciando 4.67 — número verdadeiro,
       pergunta errada. */
    const falhas = [];
    for (const t of TEXTOS) {
      for (const s of SUPERFICIES) {
        const r = contraste(rgb(t), rgb(s));
        if (r < AA_TEXTO) falhas.push(`${t} sobre ${s}: ${r.toFixed(2)}`);
      }
    }
    expect(falhas).toEqual([]);
  });

  test('nenhum par fica em cima da linha', () => {
    // Entre o valor declarado e o pixel pintado há um arredondamento de 8
    // bits. Um par exatamente em 4.50 reprova na tela; 4.55 sobrevive.
    const apertados = [];
    for (const t of TEXTOS) {
      for (const s of SUPERFICIES) {
        const r = contraste(rgb(t), rgb(s));
        if (r >= AA_TEXTO && r < 4.55) apertados.push(`${t}/${s} = ${r.toFixed(3)}`);
      }
    }
    expect(apertados).toEqual([]);
  });

  test('a escada tem degraus perceptíveis', () => {
    /* Três tons que passam AA mas são quase iguais não formam hierarquia: a
       paleta ficaria acessível e ilegível como estrutura. O chão profundo é
       o que devolve amplitude — a paleta anterior conseguia 1.55 e 1.42. */
    const [a, b, c] = TEXTOS.map(rgb);
    expect(contraste(a, b)).toBeGreaterThanOrEqual(1.6);
    expect(contraste(b, c)).toBeGreaterThanOrEqual(1.5);
  });
});

describe('cor viva', () => {
  test('marca e segunda voz passam o mínimo de interface', () => {
    const falhas = [];
    for (const c of INTERFACE) {
      for (const s of SUPERFICIES) {
        const r = contraste(rgb(c), rgb(s));
        if (r < AA_UI) falhas.push(`${c} sobre ${s}: ${r.toFixed(2)}`);
      }
    }
    expect(falhas).toEqual([]);
  });

  test('cor semântica passa AA — ela carrega palavra', () => {
    const falhas = [];
    for (const c of SEMANTICOS) {
      for (const s of SUPERFICIES) {
        const r = contraste(rgb(c), rgb(s));
        if (r < AA_TEXTO) falhas.push(`${c} sobre ${s}: ${r.toFixed(2)}`);
      }
    }
    expect(falhas).toEqual([]);
  });

  test('a tinta do botão passa sobre toda cor viva que fica atrás dela', () => {
    /* `--g-on-brand` é o rótulo que fica SOBRE cor viva: botão primário,
       selo, monograma. Trocar a marca e esquecer dele produz botão bonito
       com texto ilegível — e ninguém confere o texto de um botão que sempre
       funcionou. */
    for (const fundo of [...INTERFACE, ...SEMANTICOS]) {
      const r = contraste(rgb('g-on-brand'), rgb(fundo));
      expect(r, `on-brand sobre ${fundo}: ${r.toFixed(2)}`).toBeGreaterThanOrEqual(AA_TEXTO);
    }
  });

  test('o chão é quase neutro — a cor mora na luz', () => {
    /* A regra que organiza a direção inteira. Fundo colorido não deixa
       acento brilhar: o olho compara, e se o chão já é azul, o azul do
       acento vira mais do mesmo. A paleta anterior tinha croma 0.049 no
       chão, quase quatro vezes a média das referências, e era essa inversão
       que matava a sensação de premium.

       Medido como distância entre o canal mais forte e o mais fraco: um
       cinza puro dá 0, e quanto mais colorido, maior. */
    for (const s of SUPERFICIES) {
      const [r, g, b] = hexParaRgb(T[s]);
      const spread = Math.max(r, g, b) - Math.min(r, g, b);
      expect(spread, `${s} (${T[s]}) tem cor demais para ser chão`).toBeLessThan(0.02);
    }
  });
});
