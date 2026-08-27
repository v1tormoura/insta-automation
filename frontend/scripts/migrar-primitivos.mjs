/**
 * Migra os primitivos de UI para os tokens de geometria, elevação e tipografia.
 *
 * ── Por que um script separado do de cores
 *
 * Os primitivos escrevem estilo em classe utilitária do Tailwind, e dentro de
 * um valor arbitrário — `bg-[...]` — **espaço não é permitido**: o Tailwind
 * usa o espaço para separar classes, e o valor precisa de underscore no lugar.
 *
 * Rodar `migrar-cores.mjs` aqui produziria
 * `bg-[color-mix(in oklch, var(--x) 12%, transparent)]`, que o Tailwind lê
 * como cinco classes quebradas. O resultado não seria um erro de build — seria
 * uma cor que simplesmente some. Daí este arquivo.
 *
 * ── O que ele migra
 *
 * Raio, sombra e tamanho de texto. Cor só na parte que sobrou em `rgba()`
 * literal dentro dos utilitários.
 *
 *   node scripts/migrar-primitivos.mjs             → relatório
 *   node scripts/migrar-primitivos.mjs --aplicar   → grava
 */
import { readFileSync, writeFileSync, globSync } from 'node:fs';
import { argv } from 'node:process';

/** Espaço vira underscore: exigência do Tailwind em valor arbitrário. */
const tw = v => v.replace(/\s+/g, '_');

/* ── Raio ──────────────────────────────────────────────────────────────────
   Os valores encontrados agrupam-se em três aglomerados — 6/7/8, 9/10/11/12
   e 16 — que são exatamente três degraus da escala com nomes diferentes. */
const RAIO = [
  [/rounded-\[(?:6|7|8)px\]/g,           'rounded-[var(--mf-r-sm)]'],
  [/rounded-\[(?:9|10|11|12)px\]/g,      'rounded-[var(--mf-r-md)]'],
  [/rounded-\[(?:13|14|15|16)px\]/g,     'rounded-[var(--mf-r-lg)]'],
  [/rounded-\[(?:18|20|22|24)px\]/g,     'rounded-[var(--mf-r-xl)]'],
  [/rounded-\[(?:2|3|4|5)px\]/g,         'rounded-[var(--mf-r-xs)]'],
];

/* ── Tipografia ────────────────────────────────────────────────────────────
   Nada sobe nem desce de degrau: cada literal cai no token que já tem o mesmo
   tamanho. A migração é de NOME, não de aparência — mudar o corpo do texto de
   dezessete componentes de uma vez quebraria alinhamento em toda a aplicação,
   e isso é assunto de outra passagem, feita com a tela na frente. */
const TIPO = [
  [/text-\[(?:9|9\.5|10|10\.5)px\]/g, 'text-[var(--mf-t-nano)]'],
  [/text-\[(?:11|11\.5)px\]/g,        'text-[var(--mf-t-micro)]'],
  [/text-\[12px\]/g,                  'text-[var(--mf-t-xs)]'],
  [/text-\[13px\]/g,                  'text-[var(--mf-t-sm)]'],
  [/text-\[14px\]/g,                  'text-[var(--mf-t-body)]'],
  [/text-\[16px\]/g,                  'text-[var(--mf-t-h2)]'],
];

/* ── Elevação ──────────────────────────────────────────────────────────────
   Sombra preta pura é distância da superfície, e o sistema tem três degraus.
   O critério é o desfoque: até 24px é elevação de painel, acima é de camada
   flutuante — menu, diálogo, gaveta.

   Brilho de marca é outra coisa e não vira `--mf-shadow-*`: ele acompanha o
   acento, então precisa continuar sendo cor. */
const SOMBRA = [
  [/shadow-\[0_8px_24px_rgba\(0,0,0,\.5\)\]/g,   `shadow-[${tw('var(--mf-shadow-2)')}]`],
  [/shadow-\[0_12px_40px_rgba\(0,0,0,\.5\)\]/g,  `shadow-[${tw('var(--mf-shadow-3)')}]`],
  [/shadow-\[0_16px_50px_rgba\(0,0,0,\.6\)\]/g,  `shadow-[${tw('var(--mf-shadow-3)')}]`],
  [/shadow-\[0_24px_80px_rgba\(0,0,0,\.7\)\]/g,  `shadow-[${tw('var(--mf-shadow-3)')}]`],
  [/shadow-\[0_0_80px_rgba\(0,0,0,\.7\)\]/g,     `shadow-[${tw('var(--mf-shadow-3)')}]`],
];

/** Acento da marca. Segue o módulo quando há um, senão o acento do sistema. */
const ACENTO = 'var(--mf-mod,var(--mf-accent-500))';

/* ── Cor que sobrou em rgba() dentro de utilitário ─────────────────────────
   Mesmo critério do script de cores — traduz a INTENÇÃO — só que escrito na
   sintaxe que o Tailwind aceita. */
const COR = [
  [/rgba\(0,\s*212,\s*255,\s*\.?(\d+)\)/g, (_m, d) => `color-mix(in_oklch,${ACENTO}_${pct(d)}%,transparent)`],
  [/rgba\(0,\s*180,\s*255,\s*\.?(\d+)\)/g, (_m, d) => `color-mix(in_oklch,${ACENTO}_${pct(d)}%,transparent)`],
  [/rgba\(244,\s*63,\s*94,\s*\.?(\d+)\)/g, (_m, d) => `color-mix(in_oklch,var(--mf-danger-500)_${pct(d)}%,transparent)`],
  [/rgba\(16,\s*185,\s*129,\s*\.?(\d+)\)/g, (_m, d) => `color-mix(in_oklch,var(--mf-success-500)_${pct(d)}%,transparent)`],
  [/rgba\(245,\s*158,\s*11,\s*\.?(\d+)\)/g, (_m, d) => `color-mix(in_oklch,var(--mf-warning-500)_${pct(d)}%,transparent)`],
  [/rgba\(139,\s*92,\s*246,\s*\.?(\d+)\)/g, (_m, d) => `color-mix(in_oklch,var(--mf-mod-publicar)_${pct(d)}%,transparent)`],
  [/rgba\(10,\s*20,\s*38,\s*\.?(\d+)\)/g,  () => 'var(--mf-surface-1)'],
  // Branco com alfa nunca foi cor: era borda ou superfície, e o nível certo
  // depende da opacidade. Mesmo critério do script de cores.
  [/rgba\(255,\s*255,\s*255,\s*\.0?([1-5])\)/g,  'var(--mf-border-subtle)'],
  [/rgba\(255,\s*255,\s*255,\s*\.0?([6-9])\)/g,  'var(--mf-border)'],
  [/rgba\(255,\s*255,\s*255,\s*\.1[0-9]?\)/g,    'var(--mf-border-strong)'],
  // Rótulo escuro sobre botão claro: é o fundo do tema, não um azul qualquer.
  [/#040e1c\b/g, 'var(--mf-bg)'],
];

/** `.28` → 28, `.5` → 50. A opacidade distinguia fundo de borda; preserva-se. */
function pct(digitos) {
  return digitos.length === 1 ? Number(digitos) * 10 : Number(digitos);
}

/* Brilho de marca: some do `shadow-[...]` literal e vira cor de acento com a
   mesma opacidade, para acompanhar a paleta quando ela for escolhida. */
const BRILHO = [
  [/shadow-\[0_0_28px_rgba\(0,212,255,\.45\)\]/g,     `shadow-[0_0_28px_${tw(`color-mix(in oklch,${ACENTO} 45%,transparent)`)}]`],
  [/shadow-\[0_0_18px_rgba\(0,212,255,\.28\)\]/g,     `shadow-[0_0_18px_${tw(`color-mix(in oklch,${ACENTO} 28%,transparent)`)}]`],
  [/shadow-\[0_0_12px_rgba\(0,212,255,\.14\)\]/g,     `shadow-[0_0_12px_${tw(`color-mix(in oklch,${ACENTO} 14%,transparent)`)}]`],
  [/shadow-\[0_0_0_1px_rgba\(0,212,255,\.1\)\]/g,     `shadow-[0_0_0_1px_${tw(`color-mix(in oklch,${ACENTO} 10%,transparent)`)}]`],
];

/* ── Estilo em linha ───────────────────────────────────────────────────────
   As páginas escrevem `borderRadius: 8` e `fontSize: 11` direto no objeto de
   estilo, e é onde estão a maioria dos 1.055 raios e 1.431 tamanhos.

   O casamento é DELIBERADAMENTE estreito: só número puro seguido de vírgula
   ou fecha-chave. Raio composto — `'3px 3px 0 0'`, `'0 0 10px 10px'`, o
   ternário `open ? '9px 9px 0 0' : 9` — descreve cantos diferentes entre si e
   não tem token equivalente; trocá-lo por um valor único arredondaria os
   quatro cantos e mudaria a forma da peça. Fica de fora, de propósito.
   Chamadas como `px(8)` também: ali o número é escalado em tempo de render. */
/* Escapado para a STRING, não para o regex: `\s` dentro de aspas simples
   em JavaScript vira um `s` literal, e o padrão passaria a exigir a letra
   `s` no lugar de espaço. Daí o `\s`. */
/* LITERAIS de regex, não `new RegExp('…')`.
   Numa string JavaScript, `\s` não é a classe "espaço" — é um escape que o
   motor não conhece, e o resultado é a letra `s` literal. Montado por string,
   `'borderRadius:\s*'` virava `borderRadius:s*`, um padrão que casa
   `borderRadius:8` e ignora `borderRadius: 8`. Como quase todo o código tem o
   espaço depois dos dois-pontos, a regra parecia funcionar — reportava
   substituições — e deixava a maioria dos casos para trás em silêncio.
   O literal `/…/g` não tem essa camada de escape. */
/* ── Elevação em estilo de linha ───────────────────────────────────────────
   Sombra PRETA PURA é distância da superfície, e o sistema tem três degraus.
   O critério é o desfoque, que é o que o olho lê como altura: até 6px a peça
   está encostada, até 24px está levantada, acima disso está flutuando.

   Brilho colorido fica de fora — `0 0 12px ${cor}` não é elevação, é destaque,
   e a cor dele muda por item. Trocá-lo por um token de sombra apagaria a
   informação que ele carrega. O padrão exige preto explícito por isso. */
const PRETO = /(?:rgba\(0,\s*0,\s*0,\s*\.?\d+\)|oklch\(0 0 0 \/ *\.?\d+\))/.source;
const sombraPreta = (desfoques) =>
  new RegExp("boxShadow: '0 \d+px (?:" + desfoques + ")px " + PRETO + "'", 'g');

const ELEVACAO = [
  [sombraPreta('[1-6]'),                     "boxShadow: 'var(--mf-shadow-1)'"],
  [sombraPreta('[8-9]|1[0-9]|2[0-4]'),       "boxShadow: 'var(--mf-shadow-2)'"],
  [sombraPreta('2[5-9]|[3-9][0-9]|1[0-9][0-9]'), "boxShadow: 'var(--mf-shadow-3)'"],
];

const ENTRE_LINHAS = [
  [/borderRadius:\s*(?:2|3|4|5)(?=\s*[,}\n])/g,     "borderRadius: 'var(--mf-r-xs)'"],
  [/borderRadius:\s*(?:6|7|8)(?=\s*[,}\n])/g,       "borderRadius: 'var(--mf-r-sm)'"],
  [/borderRadius:\s*(?:9|10|11|12)(?=\s*[,}\n])/g,  "borderRadius: 'var(--mf-r-md)'"],
  [/borderRadius:\s*(?:13|14|15|16)(?=\s*[,}\n])/g, "borderRadius: 'var(--mf-r-lg)'"],
  [/borderRadius:\s*(?:18|20|22|24)(?=\s*[,}\n])/g, "borderRadius: 'var(--mf-r-xl)'"],
  [/borderRadius:\s*(?:'50%'|99|100|999|'999px')(?=\s*[,}\n])/g, "borderRadius: 'var(--mf-r-full)'"],

  /* Ordem importa: `11` casaria dentro de `11.5` se o degrau maior viesse
     depois, e o `.5` sobraria solto no meio do objeto de estilo. Os valores
     com decimal vêm primeiro em cada grupo. */
  [/fontSize:\s*(?:9\.5|10\.5|9|10)(?=\s*[,}\n])/g, "fontSize: 'var(--mf-t-nano)'"],
  [/fontSize:\s*(?:11\.5|11)(?=\s*[,}\n])/g,        "fontSize: 'var(--mf-t-micro)'"],
  [/fontSize:\s*12(?=\s*[,}\n])/g,                  "fontSize: 'var(--mf-t-xs)'"],
  [/fontSize:\s*(?:12\.5|13)(?=\s*[,}\n])/g,        "fontSize: 'var(--mf-t-sm)'"],
  [/fontSize:\s*14(?=\s*[,}\n])/g,                  "fontSize: 'var(--mf-t-body)'"],
];

function migrar(texto) {
  let s = texto, n = 0;
  const conta = (re, sub) => {
    s = s.replace(re, (...args) => {
      n++;
      return typeof sub === 'function' ? sub(...args) : sub;
    });
  };
  // Brilho ANTES de COR: os dois casam `rgba(0,212,255,...)`, e o de cor
  // deixaria o `shadow-[...]` com espaço no meio.
  for (const [re, sub] of BRILHO) conta(re, sub);
  for (const [re, sub] of [...RAIO, ...TIPO, ...SOMBRA, ...COR, ...ENTRE_LINHAS, ...ELEVACAO]) conta(re, sub);
  return { texto: s, n };
}

const aplicar = argv.includes('--aplicar');
const alvos = argv.slice(2).filter(a => !a.startsWith('--'));
const arquivos = alvos.length
  ? alvos
  : globSync('src/components/ui/*.jsx').concat(globSync('src/components/magicui/*.jsx'));

/* Espaço dentro de valor arbitrário é o defeito que este script existe para
   não cometer. Conferido no resultado, não presumido. */
const ESPACO_EM_ARBITRARIO = /(?:bg|text|border|shadow|rounded|ring|from|to|via)-\[[^\]]*\s[^\]]*\]/g;

let total = 0;
const relatorio = [];
for (const arquivo of arquivos) {
  const antes = readFileSync(arquivo, 'utf8');
  const { texto, n } = migrar(antes);
  if (!n) continue;
  const quebrados = texto.match(ESPACO_EM_ARBITRARIO) || [];
  total += n;
  relatorio.push({ nome: arquivo.split(/[\\/]/).pop(), n, quebrados: quebrados.length });
  if (aplicar) writeFileSync(arquivo, texto);
}

relatorio.sort((a, b) => b.n - a.n);
for (const r of relatorio) {
  const aviso = r.quebrados ? `  ⚠ ${r.quebrados} valor(es) com espaço` : '';
  console.log(`${String(r.n).padStart(4)}  ${r.nome.padEnd(24)}${aviso}`);
}
const quebrados = relatorio.reduce((a, r) => a + r.quebrados, 0);
console.log(`\n${total} substituições em ${relatorio.length} arquivos${aplicar ? ' (aplicado)' : ' (simulação)'}`);
if (quebrados) console.log(`⚠ ${quebrados} valor(es) arbitrário(s) com espaço — o Tailwind vai ignorá-los.`);
