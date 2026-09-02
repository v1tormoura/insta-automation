import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Contraste da paleta — os dois temas, medido, não conferido no olho.
 *
 * ── Por que este teste existe
 *
 * Trocar a cor de fundo é uma linha de CSS e uma consequência em cinquenta
 * lugares. Numa única troca de paleta, três coisas quebraram sem que nada
 * acusasse:
 *
 *   • o texto terciário passou a reprovar sobre a superfície mais clara, e o
 *     comentário do arquivo continuou anunciando o número antigo — verdadeiro
 *     quando foi escrito, falso depois, e ninguém tem motivo para desconfiar
 *     de um número que está escrito ali com tanta convicção;
 *   • o tema claro já reprovava ANTES, em 4.27, porque a conta original tinha
 *     sido feita contra o `surface-2`; o fundo mais escuro daquele tema é o
 *     `surface-3`. Número correto, pergunta errada;
 *   • um valor calibrado exatamente no limite (4.50 na conta contínua) foi
 *     medido na tela em 4.49 e reprovou, porque o navegador pinta em 8 bits
 *     por canal e o arredondamento come a margem.
 *
 * Os três são invisíveis para lint, para o build e para quem olha a tela.
 *
 * ── Por que ele LÊ os arquivos em vez de repetir os valores
 *
 * Uma cópia dos tokens aqui dentro começaria correta e ficaria para trás na
 * primeira troca. Foi o que aconteceu com a antiga página de comparação de
 * paletas: ela guardava a sua própria cópia dos valores, e depois da troca
 * seguiu exibindo com toda a confiança uma paleta que o produto não usava
 * mais. Um teste com valores copiados testa o passado.
 */

import {
  oklchParaRgb, luminancia as lumRgb, contraste as crRgb,
  contrasteComTint as crTintRgb, noGamut as gamutRgb,
  bloco, tokensOklch, tokensOklchComAlfa,
} from './cor.js';

const ler = (rel) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

/* Adaptadores finos: as asserções deste arquivo falam em ternas OKLCH, o
   módulo de cor fala em sRGB linear. A álgebra mora lá, num lugar só, para as
   duas paletas do produto medirem com a MESMA conta — inclusive a quantização
   em 8 bits, que é o passo que já transformou um 4.50 aprovado num 4.49
   reprovado na tela. */
const rgb = ([L, C, h]) => oklchParaRgb(L, C, h);
const tokens = (t) => tokensOklch(t, 'mf');
const tokensComAlfa = (t) => tokensOklchComAlfa(t, 'mf');
const luminancia = (t) => lumRgb(rgb(t));
const razao = (a, b) => crRgb(rgb(a), rgb(b));
const razaoComTint = (cor, alfa, sup) => crTintRgb(rgb(cor), alfa, rgb(sup));
const noGamut = (t) => gamutRgb(rgb(t));

/* ── As paletas, lidas dos arquivos que o produto usa ──────────────────────
   O tema claro sobrescreve só parte dos tokens; o resto continua vindo do
   bloco base, que é como a cascata resolve. Mesclar aqui reproduz isso — sem
   a mescla, o teste mediria um tema que não existe. */
const cssTokens = ler('./tokens.css');
const cssAvancado = ler('./avancado.css');

const escuro = tokens(bloco(cssTokens, '[data-mf] {'));
const claro = { ...escuro, ...tokens(bloco(cssAvancado, "[data-mf][data-tema='claro'] {")) };

const alfaEscuro = tokensComAlfa(bloco(cssTokens, '[data-mf] {'));
const alfaClaro = { ...alfaEscuro, ...tokensComAlfa(bloco(cssAvancado, "[data-mf][data-tema='claro'] {")) };
const ALFAS = { escuro: alfaEscuro, claro: alfaClaro };

const TEMAS = { escuro, claro };

const SUPERFICIES = ['mf-bg', 'mf-surface-1', 'mf-surface-2', 'mf-surface-3'];
const TEXTOS = ['mf-text', 'mf-text-2', 'mf-text-3'];

/* 4.5:1 para texto pequeno, 3:1 para componente de interface. Ícone de módulo
   e realce entram como interface: são forma e cor, não leitura. */
const AA_TEXTO = 4.5;
const AA_UI = 3.0;

const INTERFACE = [
  'mf-primary-500', 'mf-primary-600', 'mf-primary-700',
  'mf-accent-500', 'mf-accent-700', 'mf-flare-500',
  'mf-mod-contas', 'mf-mod-publicar', 'mf-mod-campanhas',
  'mf-mod-jobs', 'mf-mod-metricas', 'mf-mod-sistema',
];

/* Estes carregam palavra dentro de crachá, então valem como texto. */
const SEMANTICAS = ['mf-success-500', 'mf-warning-500', 'mf-danger-500', 'mf-info-500'];

/* Onde um crachá pode de fato aparecer. O `mf-surface-3` fica de fora, e isso
   é uma afirmação sobre o produto que precisa continuar verdadeira: ele pinta
   trilho de progresso, hover de botão secundário, chip selecionado e fundo de
   miniatura — nenhum deles contém crachá. Se algum dia contiver, o crachá
   entra em ~3.8:1 e este comentário passa a estar errado.

   A alternativa era forçar AA também no surface-3, e o preço estava medido:
   o âmbar virava pêssego e o vermelho virava rosa pálido. Cor lavada em nome
   de um caso que não acontece não é acessibilidade, é dano. */
const SUP_DE_CRACHA = ['mf-bg', 'mf-surface-1', 'mf-surface-2'];

describe.each(Object.entries(TEMAS))('tema %s', (nome, tema) => {
  test('todos os tokens conferidos existem', () => {
    for (const t of [...SUPERFICIES, ...TEXTOS, ...INTERFACE, ...SEMANTICAS, 'mf-primary-fg']) {
      expect(tema[t], `${t} ausente no tema ${nome}`).toBeDefined();
    }
  });

  test('as superfícies cabem no sRGB', () => {
    // Fora do gamut o navegador corta, e a cor que aparece não é a declarada —
    // um fundo pode virar outro sem que o valor no arquivo mude.
    for (const s of SUPERFICIES) {
      expect(noGamut(tema[s]), `${s} fora do gamut`).toBe(true);
    }
  });

  test('texto passa AA sobre TODAS as superfícies', () => {
    // "Todas" é o ponto. Conferir só a superfície onde o texto costuma
    // aparecer é o erro que deixou o tema claro reprovando em 4.27.
    const falhas = [];
    for (const t of TEXTOS) {
      for (const s of SUPERFICIES) {
        const r = razao(tema[t], tema[s]);
        if (r < AA_TEXTO) falhas.push(`${t} sobre ${s}: ${r.toFixed(2)}`);
      }
    }
    expect(falhas).toEqual([]);
  });

  test('cor semântica passa AA dentro do crachá, com o tint contado', () => {
    const falhas = [];
    for (const c of SEMANTICAS) {
      const fundo = ALFAS[nome][c.replace('-500', '-bg')];
      expect(fundo, `${c.replace('-500', '-bg')} ausente`).toBeDefined();
      // O tint tem de ser da MESMA cor do texto: um `-bg` que ficou para trás
      // numa troca de paleta pinta um fundo de outra cor atrás da palavra.
      expect(fundo.cor, `${c} e seu -bg divergiram`).toEqual(tema[c]);
      for (const s of SUP_DE_CRACHA) {
        const r = razaoComTint(tema[c], fundo.alfa, tema[s]);
        if (r < AA_TEXTO) falhas.push(`${c} em crachá sobre ${s}: ${r.toFixed(2)}`);
      }
    }
    expect(falhas).toEqual([]);
  });

  test('cor semântica continua visível no surface-3, mesmo sem carregar texto', () => {
    const falhas = [];
    for (const c of SEMANTICAS) {
      const r = razaoComTint(tema[c], ALFAS[nome][c.replace('-500', '-bg')].alfa, tema['mf-surface-3']);
      if (r < AA_UI) falhas.push(`${c} sobre surface-3: ${r.toFixed(2)}`);
    }
    expect(falhas).toEqual([]);
  });

  test('todo token de interface é literal, e não `var()`', () => {
    /* O leitor destes arquivos casa `oklch(...)` por expressão regular — ele
       não resolve `var()`. Um token escrito como referência fica INVISÍVEL: o
       teste mede o valor do outro tema no lugar dele, e a cor real nunca é
       conferida por ninguém.

       Aconteceu: um codemod trocou quatro literais do tema claro por
       `var(--mf-primary-600)`. Ali o teste até reprovou, porque o valor
       herdado por acaso falhava. Se tivesse passado, quatro tokens teriam
       saído da vigilância em silêncio — e este teste existe justamente para
       que ninguém descubra isso pela tela. */
    const fonte = tema === claro
      ? bloco(cssAvancado, "[data-mf][data-tema='claro'] {")
      : bloco(cssTokens, '[data-mf] {');

    const porReferencia = INTERFACE.filter(nome => {
      /* `\\s` com barra dupla: dentro de template literal, `\s` não é escape
         reconhecido e vira só `s` — a regex passaria a procurar a letra "s".
         Funcionava por acaso (o `[^;]+` absorvia os espaços), e um teste que
         funciona por acaso é um teste que para de funcionar sem aviso. */
      const m = fonte.match(new RegExp(`--${nome}\\s*:\\s*([^;]+);`));
      return m && m[1].includes('var(');
    });

    expect(porReferencia).toEqual([]);
  });

  test('acento e cor de módulo passam o mínimo de interface', () => {
    const falhas = [];
    for (const c of INTERFACE) {
      for (const s of SUPERFICIES) {
        const r = razao(tema[c], tema[s]);
        if (r < AA_UI) falhas.push(`${c} sobre ${s}: ${r.toFixed(2)}`);
      }
    }
    expect(falhas).toEqual([]);
  });

  test('a tinta do botão passa sobre o próprio botão', () => {
    // --mf-primary-fg é o rótulo que fica SOBRE a cor viva. Trocar a paleta e
    // esquecer dele produz botão bonito com texto ilegível.
    for (const fundo of ['mf-primary-500', ...SEMANTICAS]) {
      const r = razao(tema['mf-primary-fg'], tema[fundo]);
      expect(r, `primary-fg sobre ${fundo}: ${r.toFixed(2)}`).toBeGreaterThanOrEqual(AA_TEXTO);
    }
  });

  test('a escada de texto tem degraus perceptíveis', () => {
    // Três tons que passam AA mas são quase iguais não formam hierarquia:
    // a paleta ficaria "acessível" e ilegível como estrutura.
    const [t1, t2, t3] = TEXTOS.map((t) => tema[t]);
    expect(razao(t1, t2)).toBeGreaterThanOrEqual(1.2);
    expect(razao(t2, t3)).toBeGreaterThanOrEqual(1.2);
  });

  test('as quatro superfícies são distinguíveis entre si', () => {
    /* O requisito não é que a rampa suba: é que ninguém confunda duas camadas.
       Exigir ordem monotônica seria uma premissa minha, não do produto — no
       tema claro o card é branco puro, MAIS claro que a página, e as duas
       camadas acima descem para servirem de fundo rebaixado. É um esquema
       deliberado, e um teste que o reprovasse estaria testando meu palpite.

       O piso é 1.03 e não mais: no tema claro a página é levemente cinza sob
       um card branco puro, o que dá 1.046 — separação pequena de propósito,
       porque ali quem desenha a borda do card é a BORDA e a sombra, não a
       diferença de preenchimento. Exigir mais reprovaria um padrão correto.
       O que 1.03 impede é o caso que realmente quebra a hierarquia: duas
       camadas com o mesmo valor, que é o que acontece quando alguém iguala
       um token ao outro para "simplificar". */
    const falhas = [];
    for (let i = 0; i < SUPERFICIES.length; i++) {
      for (let j = i + 1; j < SUPERFICIES.length; j++) {
        const r = razao(tema[SUPERFICIES[i]], tema[SUPERFICIES[j]]);
        if (r < 1.03) falhas.push(`${SUPERFICIES[i]} e ${SUPERFICIES[j]}: ${r.toFixed(3)}`);
      }
    }
    expect(falhas).toEqual([]);
  });

  test('no tema escuro a elevação sobe de verdade', () => {
    // Aqui a monotonia É o desenho: cada camada mais alta é mais clara.
    if (nome !== 'escuro') return;
    const ls = SUPERFICIES.map((s) => luminancia(tema[s]));
    for (let i = 1; i < ls.length; i++) {
      expect(ls[i], `${SUPERFICIES[i]} não é mais claro que o anterior`).toBeGreaterThan(ls[i - 1]);
    }
  });
});

describe('margem contra a quantização', () => {
  test('nenhum par fica em cima da linha', () => {
    /* Um par exatamente em 4.50 reprova na tela: entre o valor declarado e o
       pixel pintado há um arredondamento de 8 bits. Exigir 4.55 aqui deixa
       espaço para ele — o custo é meio ponto de luminosidade, e o benefício é
       não descobrir isso de novo pelo navegador. */
    const apertados = [];
    for (const [nome, tema] of Object.entries(TEMAS)) {
      for (const t of [...TEXTOS, ...SEMANTICAS]) {
        for (const s of SUPERFICIES) {
          const r = razao(tema[t], tema[s]);
          if (r >= AA_TEXTO && r < 4.55) apertados.push(`${nome}: ${t}/${s} = ${r.toFixed(3)}`);
        }
      }
    }
    expect(apertados).toEqual([]);
  });
});
