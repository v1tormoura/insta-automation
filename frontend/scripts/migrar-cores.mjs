/**
 * Migra cores literais para os tokens do design system.
 *
 * Escrito como script porque a troca é mecânica e repetitiva — dezenas de
 * ocorrências por tela, sempre o mesmo mapeamento — e fazer isso à mão
 * convida a erro de digitação num hexadecimal, que passa despercebido.
 *
 * O mapeamento traduz INTENÇÃO, não aparência: um verde vira
 * `--mf-success-500` porque significava sucesso, não porque era verde. É por
 * isso que ele mora aqui e não numa tabela de substituição cega — a decisão
 * de qual token usar depende do que a cor queria dizer.
 *
 *   node scripts/migrar-cores.mjs                → relatório, não altera nada
 *   node scripts/migrar-cores.mjs --aplicar      → grava as alterações
 *   node scripts/migrar-cores.mjs --aplicar a.jsx b.jsx
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { globSync } from 'node:fs';
import { argv } from 'node:process';

/* Famílias de cor do tema antigo → token do sistema.
   Cada linha diz o que a cor SIGNIFICAVA. Onde o mesmo matiz aparecia em
   dois ou três tons quase idênticos (três verdes diferentes para "deu
   certo"), todos convergem para o mesmo token — a variação não carregava
   informação, só era o resultado de escolhas feitas em momentos diferentes. */
const SOLIDAS = [
  // sucesso
  [/#22c55e\b/gi, 'var(--mf-success-500)'],
  [/#34d399\b/gi, 'var(--mf-success-500)'],
  [/#10b981\b/gi, 'var(--mf-success-500)'],
  [/#4ade80\b/gi, 'var(--mf-success-500)'],
  [/#86efac\b/gi, 'var(--mf-success-500)'],
  // aviso
  [/#f59e0b\b/gi, 'var(--mf-warning-500)'],
  [/#fbbf24\b/gi, 'var(--mf-warning-500)'],
  [/#facc15\b/gi, 'var(--mf-warning-500)'],
  [/#fcd34d\b/gi, 'var(--mf-warning-500)'],
  [/#eab308\b/gi, 'var(--mf-warning-500)'],
  [/#f97316\b/gi, 'var(--mf-warning-500)'],
  [/#fb923c\b/gi, 'var(--mf-warning-500)'],
  // perigo
  [/#ef4444\b/gi, 'var(--mf-danger-500)'],
  [/#f87171\b/gi, 'var(--mf-danger-500)'],
  [/#f43f5e\b/gi, 'var(--mf-danger-500)'],
  [/#fca5a5\b/gi, 'var(--mf-danger-500)'],
  [/#dc2626\b/gi, 'var(--mf-danger-500)'],
  // informação
  [/#60a5fa\b/gi, 'var(--mf-info-500)'],
  [/#3b82f6\b/gi, 'var(--mf-info-500)'],
  [/#2563eb\b/gi, 'var(--mf-info-500)'],
  [/#93c5fd\b/gi, 'var(--mf-info-500)'],
  // módulos
  [/#a78bfa\b/gi, 'var(--mf-mod-publicar)'],
  [/#8b5cf6\b/gi, 'var(--mf-mod-publicar)'],
  [/#c4b5fd\b/gi, 'var(--mf-mod-publicar)'],
  [/#6366f1\b/gi, 'var(--mf-primary-500)'],
  [/#818cf8\b/gi, 'var(--mf-primary-300)'],
  [/#a5b4fc\b/gi, 'var(--mf-primary-300)'],
  [/#ec4899\b/gi, 'var(--mf-mod-campanhas)'],
  [/#f472b6\b/gi, 'var(--mf-mod-campanhas)'],
  [/#00d4ff\b/gi, 'var(--mf-mod-contas)'],
  [/#22d3ee\b/gi, 'var(--mf-mod-contas)'],
  /* Paleta própria da tela de Top Posts: um esquema ardósia-ciano que não
     existia em nenhuma outra tela. Os tons de azul acinzentado formavam uma
     escala de texto — do mais claro ao mais escuro — e mapeiam direto nos
     três níveis do sistema. */
  [/#d9f4ff\b/gi, 'var(--mf-text)'],
  [/#8eb2d5\b/gi, 'var(--mf-text-2)'],
  [/#5a7a99\b/gi, 'var(--mf-text-3)'],
  [/#334155\b/gi, 'var(--mf-border-strong)'],
  [/#22d7ff\b/gi, 'var(--mf-mod, var(--mf-accent-500))'],
  /* Segunda família: a paleta do Tailwind, que entrou em algumas telas por
     cópia de exemplo. Mesmo critério — traduz o significado, não o matiz. */
  [/#06b6d4\b/gi, 'var(--mf-mod-contas)'],
  [/#0891b2\b/gi, 'var(--mf-mod-contas)'],
  [/#a855f7\b/gi, 'var(--mf-mod-publicar)'],
  [/#7c3aed\b/gi, 'var(--mf-primary-500)'],
  [/#16a34a\b/gi, 'var(--mf-success-500)'],
  [/#15803d\b/gi, 'var(--mf-success-500)'],
  [/#b91c1c\b/gi, 'var(--mf-danger-500)'],
  [/#374151\b/gi, 'var(--mf-border-strong)'],
  [/#1f2937\b/gi, 'var(--mf-surface-2)'],
  [/#f1f5f9\b/gi, 'var(--mf-text)'],
  [/#f8fafc\b/gi, 'var(--mf-text)'],
  /* Terceira família: o que restou depois das duas primeiras passagens.
     Inclui os tons de texto do tema navy original (#e2edfd, #7f9ab5) e os
     azuis decorativos que sobraram em telas isoladas.
     O \b no fim de cada padrão não é enfeite: sem ele, #10b981 casaria
     dentro de #10b98115 — hexadecimal de oito dígitos, onde os dois últimos
     são a opacidade — e o resultado seria var(--mf-success-500)15, uma
     propriedade inválida que o navegador descarta em silêncio. */
  [/#e2edfd\b/gi, 'var(--mf-text)'],
  [/#7f9ab5\b/gi, 'var(--mf-text-2)'],
  [/#6b7280\b/gi, 'var(--mf-text-3)'],
  [/#9ca3af\b/gi, 'var(--mf-text-3)'],
  [/#111827\b/gi, 'var(--mf-surface-2)'],
  [/#0a1628\b/gi, 'var(--mf-surface-1)'],
  [/#040e1c\b/gi, 'var(--mf-bg)'],
  [/#1e40af\b/gi, 'var(--mf-info-500)'],
  [/#c7d2fe\b/gi, 'var(--mf-primary-300)'],
  [/#67e8f9\b/gi, 'var(--mf-mod-contas)'],
  [/#4ade80\b/gi, 'var(--mf-success-500)'],
  // neutros
  [/#94a3b8\b/gi, 'var(--mf-text-3)'],
  [/#64748b\b/gi, 'var(--mf-text-3)'],
  [/#cbd5e1\b/gi, 'var(--mf-text-2)'],
  [/#e2e8f0\b/gi, 'var(--mf-text)'],
  [/#ffffff\b/gi, 'var(--mf-text)'],
  [/#fff\b(?![0-9a-f])/gi, 'var(--mf-text)'],
];

/* rgba() do tema antigo. A opacidade original é preservada: ela costumava
   distinguir fundo (baixa) de borda (média), e achatar tudo num valor só
   apagaria essa diferença. */
const TRANSLUCIDAS = [
  [/rgba\(\s*34,\s*197,\s*94\s*,\s*([\d.]+)\s*\)/g,   'var(--mf-success-500)'],
  [/rgba\(\s*52,\s*211,\s*153\s*,\s*([\d.]+)\s*\)/g,  'var(--mf-success-500)'],
  [/rgba\(\s*16,\s*185,\s*129\s*,\s*([\d.]+)\s*\)/g,  'var(--mf-success-500)'],
  [/rgba\(\s*245,\s*158,\s*11\s*,\s*([\d.]+)\s*\)/g,  'var(--mf-warning-500)'],
  [/rgba\(\s*251,\s*191,\s*36\s*,\s*([\d.]+)\s*\)/g,  'var(--mf-warning-500)'],
  [/rgba\(\s*249,\s*115,\s*22\s*,\s*([\d.]+)\s*\)/g,  'var(--mf-warning-500)'],
  [/rgba\(\s*250,\s*204,\s*21\s*,\s*([\d.]+)\s*\)/g,  'var(--mf-warning-500)'],
  [/rgba\(\s*239,\s*68,\s*68\s*,\s*([\d.]+)\s*\)/g,   'var(--mf-danger-500)'],
  [/rgba\(\s*248,\s*113,\s*113\s*,\s*([\d.]+)\s*\)/g, 'var(--mf-danger-500)'],
  [/rgba\(\s*244,\s*63,\s*94\s*,\s*([\d.]+)\s*\)/g,   'var(--mf-danger-500)'],
  [/rgba\(\s*96,\s*165,\s*250\s*,\s*([\d.]+)\s*\)/g,  'var(--mf-info-500)'],
  [/rgba\(\s*59,\s*130,\s*246\s*,\s*([\d.]+)\s*\)/g,  'var(--mf-info-500)'],
  [/rgba\(\s*139,\s*92,\s*246\s*,\s*([\d.]+)\s*\)/g,  'var(--mf-mod-publicar)'],
  [/rgba\(\s*167,\s*139,\s*250\s*,\s*([\d.]+)\s*\)/g, 'var(--mf-mod-publicar)'],
  [/rgba\(\s*99,\s*102,\s*241\s*,\s*([\d.]+)\s*\)/g,  'var(--mf-primary-500)'],
  [/rgba\(\s*236,\s*72,\s*153\s*,\s*([\d.]+)\s*\)/g,  'var(--mf-mod-campanhas)'],
  [/rgba\(\s*0,\s*212,\s*255\s*,\s*([\d.]+)\s*\)/g,   'var(--mf-mod-contas)'],
  [/rgba\(\s*148,\s*163,\s*184\s*,\s*([\d.]+)\s*\)/g, 'var(--mf-text-3)'],
  [/rgba\(\s*100,\s*116,\s*139\s*,\s*([\d.]+)\s*\)/g, 'var(--mf-text-3)'],
  [/rgba\(\s*51,\s*65,\s*85\s*,\s*([\d.]+)\s*\)/g,    'var(--mf-border-strong)'],
  [/rgba\(\s*6,\s*182,\s*212\s*,\s*([\d.]+)\s*\)/g,   'var(--mf-mod-contas)'],
  [/rgba\(\s*168,\s*85,\s*247\s*,\s*([\d.]+)\s*\)/g,  'var(--mf-mod-publicar)'],
  [/rgba\(\s*251,\s*146,\s*60\s*,\s*([\d.]+)\s*\)/g,  'var(--mf-warning-500)'],
  [/rgba\(\s*124,\s*58,\s*237\s*,\s*([\d.]+)\s*\)/g,  'var(--mf-primary-500)'],
  [/rgba\(\s*0,\s*180,\s*255\s*,\s*([\d.]+)\s*\)/g,   'var(--mf-mod-contas)'],
  [/rgba\(\s*36,\s*201,\s*255\s*,\s*([\d.]+)\s*\)/g,  'var(--mf-mod-contas)'],
  [/rgba\(\s*74,\s*222,\s*128\s*,\s*([\d.]+)\s*\)/g,  'var(--mf-success-500)'],
];

/* Branco com alfa não era cor: era borda ou superfície. O nível certo
   depende da opacidade — foi assim que o tema antigo os usou, mesmo sem
   dizer. Abaixo de 0.055 é divisória interna, até 0.11 é borda de card,
   acima disso é borda de destaque; valores altos viram superfície. */
function brancoParaToken(alfa) {
  const a = parseFloat(alfa);
  if (a <= 0.055) return 'var(--mf-border-subtle)';
  if (a <= 0.11)  return 'var(--mf-border)';
  if (a <= 0.30)  return 'var(--mf-border-strong)';
  return 'var(--mf-surface-3)';
}

/* Variáveis do tema antigo que ainda aparecem no JSX. */
const VARIAVEIS = [
  [/var\(--text3\)/g,     'var(--mf-text-3)'],
  [/var\(--text2\)/g,     'var(--mf-text-2)'],
  [/var\(--text4\)/g,     'var(--mf-text-3)'],
  [/var\(--text\)/g,      'var(--mf-text)'],
  [/var\(--cyan\)/g,      'var(--mf-mod, var(--mf-accent-500))'],
  [/var\(--green\)/g,     'var(--mf-success-500)'],
  [/var\(--red\)/g,       'var(--mf-danger-500)'],
  [/var\(--amber\)/g,     'var(--mf-warning-500)'],
  [/var\(--orange\)/g,    'var(--mf-warning-500)'],
  [/var\(--purple\)/g,    'var(--mf-mod-publicar)'],
  [/var\(--pink\)/g,      'var(--mf-mod-campanhas)'],
  [/var\(--blue\)/g,      'var(--mf-info-500)'],
  [/var\(--font-mono\)/g, 'var(--mf-mono)'],
];

function migrar(texto) {
  let s = texto;
  let n = 0;
  const conta = (antes) => { if (s !== antes) n++; };

  for (const [re, token] of SOLIDAS) {
    s = s.replace(re, () => { n++; return token; });
  }
  for (const [re, token] of TRANSLUCIDAS) {
    s = s.replace(re, (_m, alfa) => {
      n++;
      const pct = Math.round(parseFloat(alfa) * 100);
      return `color-mix(in oklch, ${token} ${pct}%, transparent)`;
    });
  }
  /* Os quase-pretos azulados que várias telas usavam como fundo de painel.
     Todos descreviam a mesma coisa — "a superfície de um card" — em valores
     ligeiramente diferentes, e convergem para o token de superfície. */
  s = s.replace(/rgba\(\s*(?:2,\s*12,\s*28|8,\s*25,\s*52|10,\s*18,\s*36|10,\s*20,\s*38|9,\s*9,\s*15|14,\s*20,\s*34)\s*,\s*[\d.]+\s*\)/g, () => {
    n++; return 'var(--mf-surface-1)';
  });
  s = s.replace(/rgba\(\s*255,\s*255,\s*255\s*,\s*([\d.]+)\s*\)/g, (_m, a) => {
    n++; return brancoParaToken(a);
  });
  s = s.replace(/oklch\(\s*1 0 0 \/ ([\d.]+)\s*\)/g, (_m, a) => {
    n++; return brancoParaToken(a);
  });
  /* Preto com alfa é sombra, e sombra não pertence a paleta nenhuma —
     permanece literal de propósito. */
  for (const [re, token] of VARIAVEIS) {
    s = s.replace(re, () => { n++; return token; });
  }
  conta(texto);
  return { texto: s, substituicoes: n };
}

const RESTANTES = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g;

const args = argv.slice(2);
const aplicar = args.includes('--aplicar');
const alvos = args.filter(a => !a.startsWith('--'));

/* Estava aqui a lista de páginas que renderizam FORA do MainLayout — login,
   termos, privacidade e o retorno do OAuth. Os tokens vivem sob `[data-mf]`,
   que era o elemento da casca, então trocar as cores delas por `var(--mf-*)`
   daria propriedade inválida e uma tela de login ilegível.

   A decisão que faltava era como escopar os tokens fora da casca, e ela foi
   tomada do jeito mais simples: as quatro páginas ganharam `data-mf` no seu
   próprio elemento raiz. Nada vaza para fora delas — que era o motivo do
   escopo existir — e os tokens passam a valer lá dentro. A lista ficou vazia.

   Se alguma página nova nascer fora da casca, o caminho é o mesmo: `data-mf`
   na raiz dela, não uma exceção aqui. */
const FORA_DA_CASCA = new Set([]);

/* `**` e não `*`: a primeira passagem varreu só o primeiro nível e deixou
   `components/campaign/` e `components/campaign/detail/` inteiros de fora —
   catorze arquivos com quase quatrocentas cores literais, que nunca chegaram
   ao relatório porque nunca foram lidos. */
/* Arquivos com cor literal DELIBERADA, que uma nova passagem desfaria.
   No ContentPicker há branco e preto sobre a FOTO da miniatura: o nome do
   arquivo no gradiente, o botão de remover, a borda do botão de capa. Não são
   cores da superfície do app — seguir o tema faria o texto sumir contra a
   imagem. O motivo está comentado em cada um dos três pontos. */
const PRESERVAM_LITERAL = new Set(['ContentPicker.jsx']);

const arquivos = (alvos.length
  ? alvos
  : globSync('src/pages/**/*.jsx').concat(globSync('src/components/**/*.jsx'))
).filter(f => {
  const nome = f.split(/[\\/]/).pop();
  return !FORA_DA_CASCA.has(nome) && !PRESERVAM_LITERAL.has(nome);
});

let total = 0;
const relatorio = [];
for (const arquivo of arquivos) {
  const antes = readFileSync(arquivo, 'utf8');
  const { texto, substituicoes } = migrar(antes);
  if (!substituicoes) continue;
  const sobrou = (texto.match(RESTANTES) || []).filter(c => !c.startsWith('oklch(0 0 0'));
  total += substituicoes;
  relatorio.push({ arquivo: arquivo.split(/[\\/]/).pop(), substituicoes, restante: sobrou.length });
  if (aplicar) writeFileSync(arquivo, texto);
}

relatorio.sort((a, b) => b.substituicoes - a.substituicoes);
for (const r of relatorio) {
  console.log(`${String(r.substituicoes).padStart(4)}  ${r.arquivo.padEnd(26)} restante: ${r.restante}`);
}
console.log(`\n${total} substituições em ${relatorio.length} arquivos${aplicar ? ' (aplicado)' : ' (simulação — use --aplicar)'}`);
