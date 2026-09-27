/**
 * Lista os textos das telas que ainda não estão no dicionário (src/i18n/en.json).
 *
 *   node scripts/i18n-pendentes.cjs
 *
 * Texto novo sem tradução aparece em português mesmo com o painel em inglês ou
 * espanhol — não quebra nada, só fica sem traduzir. Para traduzir, acrescente
 * a frase em `textos` (ou em `padroes`, com {} nas partes variáveis) nos dois
 * arquivos: en.json e es.json.
 */
const fs = require('fs');
const path = require('path');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;

const SRC = path.resolve(__dirname, '../src');
const en = require('../src/i18n/en.json');
const conhecidos = new Set(Object.keys(en.textos).map(t => t.toLowerCase()));
const padroes = en.padroes.map(([p]) => new RegExp('^' + p.split('{}').map(x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('(.*?)') + '$'));
const ATRIB = new Set(['placeholder', 'title', 'aria-label', 'alt', 'label']);
const pareceTexto = t => /[a-zà-ú]{3}/i.test(t) && !/var\(|oklch|color-mix|\d+px|^[a-z0-9_.:\/\-#]+$|^https?:/.test(t);
const coberto = t => conhecidos.has(t.toLowerCase()) || padroes.some(re => re.test(t));

const pendentes = new Map();
(function varre(d) {
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f);
    if (fs.statSync(p).isDirectory()) { if (f !== 'i18n') varre(p); continue; }
    if (!/\.jsx$/.test(f) || /\.test\./.test(f)) continue;
    const ast = parser.parse(fs.readFileSync(p, 'utf8'), { sourceType: 'module', plugins: ['jsx'] });
    const add = v => { const t = v.replace(/\s+/g, ' ').trim(); if (pareceTexto(t) && !coberto(t)) pendentes.set(t, path.relative(SRC, p)); };
    traverse(ast, {
      JSXText(q) { add(q.node.value); },
      StringLiteral(q) { if (q.parent.type === 'JSXAttribute' && ATRIB.has(q.parent.name.name)) add(q.node.value); },
    });
  }
})(SRC);

for (const [t, arq] of pendentes) console.log(`${arq}\t${t}`);
console.log(`\n${pendentes.size} texto(s) sem tradução.`);
