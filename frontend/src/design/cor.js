/**
 * Medição de cor — OKLCH, sRGB e contraste WCAG.
 *
 * Extraído porque duas paletas precisam da mesma conta: a atual, escrita em
 * OKLCH, e a da direção nova, escrita em hexadecimal. Duplicar sessenta linhas
 * de álgebra de cor entre dois arquivos de teste seria a duplicação que a
 * revisão condena, e — pior — deixaria as duas cópias divergirem exatamente na
 * parte que ninguém relê.
 *
 * ── A lição que está gravada aqui, e não em comentário solto
 *
 * `quantizar` existe porque medir em ponto flutuante mede uma cor que o
 * monitor nunca exibe. Um par calibrado em 4.50 na conta contínua foi medido
 * em 4.49 na tela e reprovou: o navegador pinta em 8 bits por canal, e o
 * arredondamento come a margem. Toda função daqui quantiza antes de comparar.
 */

/** OKLCH → sRGB linear, sem recorte. Valores fora de [0,1] indicam gamut. */
export function oklchParaRgb(L, C, h) {
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

/** `#rrggbb` → sRGB linear. */
export function hexParaRgb(hex) {
  const h = String(hex).trim().replace('#', '');
  const par = i => parseInt(h.slice(i, i + 2), 16) / 255;
  const lin = c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return [lin(par(0)), lin(par(2)), lin(par(4))];
}

/**
 * sRGB linear → os três canais como o navegador os pinta: com gama aplicada e
 * arredondados para 8 bits.
 */
export function quantizar(rgbLinear) {
  return rgbLinear.map(c => {
    const v = Math.max(0, Math.min(1, c));
    const g = v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
    return Math.round(g * 255) / 255;
  });
}

export function paraHex(rgbLinear) {
  return '#' + quantizar(rgbLinear)
    .map(c => Math.round(c * 255).toString(16).padStart(2, '0')).join('');
}

/** Luminância relativa WCAG, medida já quantizada. */
export function luminancia(rgbLinear) {
  const [r, g, b] = quantizar(rgbLinear).map(c =>
    c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contraste(rgbA, rgbB) {
  const [x, y] = [luminancia(rgbA), luminancia(rgbB)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/**
 * Contraste de uma cor sobre uma camada translúcida DELA MESMA por cima de
 * uma superfície — que é como um crachá pinta.
 *
 * Medir a cor contra a superfície nua dá um número melhor do que a tela
 * mostra: o tint aproxima o fundo da cor do texto e come contraste. No tema
 * escuro isso era a diferença entre 4.19 real e 5.14 na medida ingênua.
 */
export function contrasteComTint(rgbCor, alfa, rgbSuperficie) {
  const c = quantizar(rgbCor);
  const s = quantizar(rgbSuperficie);
  const fundo = c.map((v, i) => alfa * v + (1 - alfa) * s[i]);
  const lin = x => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
  const lz = p => 0.2126 * lin(p[0]) + 0.7152 * lin(p[1]) + 0.0722 * lin(p[2]);
  const [x, y] = [lz(c), lz(fundo)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** Cabe no sRGB? Fora do gamut o navegador corta, e a cor exibida não é a declarada. */
export function noGamut(rgbLinear) {
  return rgbLinear.every(v => v >= -0.001 && v <= 1.001);
}

/**
 * Recorta o bloco de declarações de um seletor, contando aninhamento.
 *
 * Um `indexOf('}')` pararia na primeira regra interna e devolveria meia
 * paleta — com a metade que falta simplesmente ausente do teste, que é o
 * modo silencioso de um teste passar sem medir nada.
 */
export function bloco(css, seletor) {
  const i = css.indexOf(seletor);
  if (i < 0) throw new Error(`seletor não encontrado: ${seletor}`);
  let j = css.indexOf('{', i) + 1;
  const inicio = j;
  let nivel = 1;
  while (j < css.length && nivel > 0) {
    if (css[j] === '{') nivel++;
    else if (css[j] === '}') nivel--;
    j++;
  }
  return css.slice(inicio, j - 1);
}

/** Tokens `--nome: oklch(L C H)`, só os opacos. */
export function tokensOklch(texto, prefixo = 'mf') {
  const fora = {};
  const re = new RegExp(
    `--(${prefixo}-[\\w-]+)\\s*:\\s*oklch\\(\\s*([\\d.]+)\\s+([\\d.]+)\\s+([\\d.]+)\\s*\\)`, 'g');
  for (const m of texto.matchAll(re)) {
    fora[m[1]] = [Number(m[2]), Number(m[3]), Number(m[4])];
  }
  return fora;
}

/** Tokens `--nome: oklch(L C H / A)` — o fundo translúcido dos crachás. */
export function tokensOklchComAlfa(texto, prefixo = 'mf') {
  const fora = {};
  const re = new RegExp(
    `--(${prefixo}-[\\w-]+)\\s*:\\s*oklch\\(\\s*([\\d.]+)\\s+([\\d.]+)\\s+([\\d.]+)\\s*\\/\\s*([\\d.]+)\\s*\\)`, 'g');
  for (const m of texto.matchAll(re)) {
    fora[m[1]] = { cor: [Number(m[2]), Number(m[3]), Number(m[4])], alfa: Number(m[5]) };
  }
  return fora;
}

/** Tokens `--nome: #rrggbb`. */
export function tokensHex(texto, prefixo = 'g') {
  const fora = {};
  const re = new RegExp(`--(${prefixo}-[\\w-]+)\\s*:\\s*(#[0-9a-fA-F]{6})\\b`, 'g');
  for (const m of texto.matchAll(re)) fora[m[1]] = m[2];
  return fora;
}
