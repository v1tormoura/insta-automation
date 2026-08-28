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

const ler = (rel) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

/* ── Bloco de declarações ──────────────────────────────────────────────────
   Recorta do seletor até a chave que o fecha, contando aninhamento. Um
   `indexOf('}')` pararia na primeira regra interna e devolveria meia paleta. */
function bloco(css, seletor) {
  const i = css.indexOf(seletor);
  if (i < 0) throw new Error(`seletor não encontrado: ${seletor}`);
  let j = css.indexOf('{', i) + 1;
  let nivel = 1;
  const inicio = j;
  while (j < css.length && nivel > 0) {
    if (css[j] === '{') nivel++;
    else if (css[j] === '}') nivel--;
    j++;
  }
  return css.slice(inicio, j - 1);
}

/* Só as cores opacas. Borda e sombra são branco/preto translúcido: o contraste
   delas depende do que está atrás em cada tela, e afirmar um número aqui seria
   inventar um fundo que o teste não conhece. */
function tokens(texto) {
  const fora = {};
  const re = /--(mf-[\w-]+)\s*:\s*oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)/g;
  for (const m of texto.matchAll(re)) {
    fora[m[1]] = [Number(m[2]), Number(m[3]), Number(m[4])];
  }
  return fora;
}

/* Tokens com alfa: `oklch(L C H / A)`. Usados para o fundo dos crachás. */
function tokensComAlfa(texto) {
  const fora = {};
  const re = /--(mf-[\w-]+)\s*:\s*oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\/\s*([\d.]+)\s*\)/g;
  for (const m of texto.matchAll(re)) {
    fora[m[1]] = { cor: [Number(m[2]), Number(m[3]), Number(m[4])], alfa: Number(m[5]) };
  }
  return fora;
}

/* ── OKLCH → sRGB ─────────────────────────────────────────────────────────── */
function paraRgb(L, C, h) {
  const hr = (h * Math.PI) / 180;
  const a = C * Math.cos(hr);
  const b = C * Math.sin(hr);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ];
}

/* A quantização não é preciosismo: é o passo que transformou 4.50 em 4.49 e
   fez um valor "aprovado" reprovar na tela. Medir em ponto flutuante mede uma
   cor que o monitor nunca exibe. */
function canal8(c) {
  const v = Math.max(0, Math.min(1, c));
  const g = v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
  return Math.round(g * 255) / 255;
}

function luminancia([L, C, h]) {
  const [r, g, b] = paraRgb(L, C, h).map(canal8).map((c) =>
    c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function razao(a, b) {
  const [x, y] = [luminancia(a), luminancia(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/* Contraste de uma cor sobre uma camada translúcida DELA MESMA por cima de uma
   superfície — que é exatamente como um crachá pinta. Medir a cor contra a
   superfície nua dá um número melhor do que a tela mostra: o tint aproxima o
   fundo da cor do texto e come contraste. No escuro isso era a diferença entre
   4.19 (real) e 5.14 (medida ingênua). */
function razaoComTint(cor, alfa, superficie) {
  const c = paraRgb(...cor).map(canal8);
  const s = paraRgb(...superficie).map(canal8);
  const fundo = c.map((v, i) => alfa * v + (1 - alfa) * s[i]);
  const lin = (x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
  const lz = (p) => 0.2126 * lin(p[0]) + 0.7152 * lin(p[1]) + 0.0722 * lin(p[2]);
  const [x, y] = [lz(c), lz(fundo)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

function noGamut([L, C, h]) {
  return paraRgb(L, C, h).every((v) => v >= -0.001 && v <= 1.001);
}

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
