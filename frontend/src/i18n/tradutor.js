/**
 * Tradução do painel (pt → en/es), aplicada na tela.
 *
 * ── Por que na tela, e não texto por texto nos componentes
 *
 * As telas foram escritas com o texto em português direto no JSX — cerca de
 * 26 mil linhas. Trocar cada frase por uma chave seria reescrever o painel
 * inteiro e deixá-lo mais difícil de ler e de manter. Aqui um dicionário
 * (`en.json`, `es.json`) é aplicado nos nós de texto e nos atributos visíveis
 * (placeholder, title, aria-label, alt) conforme o React os desenha, como o
 * tradutor do navegador faz — só que com a nossa tradução, e só com ela.
 *
 * ── Por que não quebra o React
 *
 * Só o `nodeValue` de nós de texto e atributos são trocados; nenhum nó é
 * criado, movido ou embrulhado (o que o tradutor do Chrome faz e é o que
 * derruba apps React). Quando o React atualiza um texto, ele escreve o novo
 * valor em português no mesmo nó, e o observador traduz de novo. O original
 * fica guardado para voltar ao português sem recarregar.
 *
 * ── O que não é traduzido
 *
 * Campos de digitação, `<code>`/`<pre>`, conteúdo editável e tudo dentro de
 * `[data-sem-traducao]` (legendas, nomes, o que a pessoa escreveu).
 */

const ATRIBUTOS = ['placeholder', 'title', 'aria-label', 'alt'];
const IGNORAR = 'script,style,textarea,input,code,pre,[contenteditable="true"],[data-sem-traducao]';

let idioma = 'pt';
let dic = null;           // { textos: Map, padroes: [{ re, trad }] }
let observador = null;
const cache = {};         // idioma → dicionário compilado

/* nó de texto → { pt, trad }; elemento → { atributo: { pt, trad } } */
const textoOriginal = new WeakMap();
const atributoOriginal = new WeakMap();

const normalizar = s => s.replace(/\s+/g, ' ').trim();

function compilar(bruto) {
  const textos = new Map(Object.entries(bruto.textos || {}));
  /* Mesma frase com outra caixa ("HOJE", "agora") cai aqui. */
  const semCaixa = new Map();
  for (const [pt, tr] of textos) if (!semCaixa.has(pt.toLowerCase())) semCaixa.set(pt.toLowerCase(), tr);
  const padroes = (bruto.padroes || []).map(([pt, trad]) => {
    const partes = pt.split('{}').map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const curto = pt.replace(/\{\}/g, '').replace(/[^\p{L}]/gu, '').length < 8;
    return { re: new RegExp('^' + partes.join('(.*?)') + '$'), trad, curto };
  });
  /* Por último, os genéricos: "Rótulo: valor" e "A — B", traduzindo cada lado. */
  padroes.push(
    { re: /^(.+?): (.+)$/, trad: '{}: {}', generico: true },
    { re: /^(.+?) — (.+)$/, trad: '{} — {}', generico: true },
  );
  return { textos, semCaixa, padroes };
}

/** Aplica ao texto traduzido a caixa do original (TUDO MAIÚSCULO, minúsculo, Capitalizado). */
function comCaixaDe(original, trad) {
  if (original === original.toUpperCase() && original !== original.toLowerCase()) return trad.toUpperCase();
  if (original[0] === original[0].toLowerCase() && original[0] !== original[0].toUpperCase()) return trad[0].toLowerCase() + trad.slice(1);
  return trad;
}

async function carregar(lang) {
  if (lang === 'pt') return null;
  if (!cache[lang]) {
    const mod = lang === 'en' ? await import('./en.json') : await import('./es.json');
    cache[lang] = compilar(mod.default || mod);
  }
  return cache[lang];
}

/** Traduz uma frase inteira (sem os espaços das pontas). `null` = sem tradução. */
function traduzirFrase(frase, prof = 0) {
  if (!dic || !frase || prof > 2) return null;
  const direto = dic.textos.get(frase);
  if (direto != null) return direto;
  const caixa = dic.semCaixa.get(frase.toLowerCase());
  if (caixa != null) return comCaixaDe(frase, caixa);
  for (const { re, trad, curto, generico } of dic.padroes) {
    const m = re.exec(frase);
    if (!m) continue;
    /* Padrão com pouco texto fixo ("{} dias") não pode engolir uma frase
       inteira: as partes variáveis dele são números e nomes, não orações. */
    if (curto && m.slice(1).some(v => v.length > 24)) continue;
    let i = 1, mudou = false;
    const saida = trad.replace(/\{\}/g, () => {
      const v = m[i++] ?? '';
      const t = v.trim() ? traduzirFrase(v.trim(), prof + 1) : null;
      if (t == null) return v;
      mudou = true;
      return v.replace(v.trim(), t);
    });
    /* Os genéricos só valem se traduziram algum lado. */
    if (generico && !mudou) continue;
    return saida;
  }
  /* Pontuação no fim ("conta:", "visualizações.") — depois dos padrões, que
     podem incluir a pontuação. */
  const p = /^(.*?[^\s.:;,!?])([.:;,!?…]+)$/.exec(frase);
  if (p) {
    const t = traduzirFrase(p[1], prof + 1);
    if (t != null) return t + p[2];
  }
  return null;
}

/** Traduz mantendo os espaços das pontas (o React junta nós por eles). */
export function traduzirTexto(texto) {
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(texto);
  const t = traduzirFrase(normalizar(m[2]));
  return t == null ? null : m[1] + t + m[3];
}

function ignorado(el) {
  return !el || !!el.closest?.(IGNORAR);
}

function processarTexto(no) {
  if (ignorado(no.parentElement)) return;
  const atual = no.nodeValue;
  const reg = textoOriginal.get(no);
  if (reg && atual === reg.trad) return;            // já é a nossa tradução
  if (!dic) {                                        // voltando ao português
    if (reg && atual === reg.trad) no.nodeValue = reg.pt;
    return;
  }
  const trad = traduzirTexto(atual);
  if (trad != null && trad !== atual) {
    textoOriginal.set(no, { pt: atual, trad });
    no.nodeValue = trad;
  } else {
    textoOriginal.delete(no);
  }
}

function processarAtributos(el) {
  if (ignorado(el) && !['INPUT', 'TEXTAREA'].includes(el.tagName)) return;
  if (el.closest?.('[data-sem-traducao]')) return;
  let regs = atributoOriginal.get(el);
  for (const a of ATRIBUTOS) {
    if (!el.hasAttribute(a)) continue;
    const atual = el.getAttribute(a);
    const reg = regs?.[a];
    if (reg && atual === reg.trad) continue;
    const trad = dic ? traduzirTexto(atual) : null;
    if (trad != null && trad !== atual) {
      if (!regs) { regs = {}; atributoOriginal.set(el, regs); }
      regs[a] = { pt: atual, trad };
      el.setAttribute(a, trad);
    }
  }
}

function varrer(raiz) {
  if (raiz.nodeType === 3) { processarTexto(raiz); return; }
  if (raiz.nodeType !== 1) return;
  processarAtributos(raiz);
  const w = document.createTreeWalker(raiz, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    if (n.nodeType === 3) processarTexto(n);
    else processarAtributos(n);
  }
}

/** Volta tudo ao português, usando os originais guardados. */
function restaurar() {
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let n = w.currentNode; n; n = w.nextNode()) {
    if (n.nodeType === 3) {
      const reg = textoOriginal.get(n);
      if (reg && n.nodeValue === reg.trad) n.nodeValue = reg.pt;
      textoOriginal.delete(n);
    } else if (n.nodeType === 1) {
      const regs = atributoOriginal.get(n);
      if (regs) {
        for (const [a, { pt, trad }] of Object.entries(regs)) if (n.getAttribute(a) === trad) n.setAttribute(a, pt);
        atributoOriginal.delete(n);
      }
    }
  }
}

let tituloPt = null;
function traduzirTitulo() {
  const atual = document.title;
  if (tituloPt && atual === traduzirTexto(tituloPt)) return;
  tituloPt = atual;
  const t = dic ? traduzirTexto(atual) : null;
  if (t && t !== atual) document.title = t;
}

function observar() {
  if (observador) return;
  observador = new MutationObserver(mutacoes => {
    if (!dic) return;
    for (const m of mutacoes) {
      if (m.type === 'characterData') processarTexto(m.target);
      else if (m.type === 'attributes') processarAtributos(m.target);
      else m.addedNodes.forEach(varrer);
    }
  });
  observador.observe(document.body, {
    subtree: true, childList: true, characterData: true,
    attributes: true, attributeFilter: ATRIBUTOS,
  });
  const titulo = document.querySelector('title');
  if (titulo) new MutationObserver(() => dic && traduzirTitulo()).observe(titulo, { childList: true, characterData: true, subtree: true });
}

/* Datas e números formatados com 'pt-BR' ("21 de set.", "1.024") passam a
   sair no idioma escolhido. Remendo uma vez; com o português ativo, nada muda. */
const LOCALE = { en: 'en-US', es: 'es-ES' };
function trocarLocale(loc) {
  if (idioma === 'pt') return loc;
  if (loc === undefined || (typeof loc === 'string' && /^pt/i.test(loc))) return LOCALE[idioma];
  return loc;
}
let remendado = false;
function remendarFormatos() {
  if (remendado) return;
  remendado = true;
  for (const [obj, fns] of [[Date.prototype, ['toLocaleDateString', 'toLocaleTimeString', 'toLocaleString']], [Number.prototype, ['toLocaleString']]]) {
    for (const fn of fns) {
      const orig = obj[fn];
      obj[fn] = function (loc, opts) { return orig.call(this, trocarLocale(loc), opts); };
    }
  }
  const DTF = Intl.DateTimeFormat, NF = Intl.NumberFormat;
  Intl.DateTimeFormat = function (loc, opts) { return new DTF(trocarLocale(loc), opts); };
  Intl.DateTimeFormat.prototype = DTF.prototype;
  Intl.DateTimeFormat.supportedLocalesOf = DTF.supportedLocalesOf;
  Intl.NumberFormat = function (loc, opts) { return new NF(trocarLocale(loc), opts); };
  Intl.NumberFormat.prototype = NF.prototype;
  Intl.NumberFormat.supportedLocalesOf = NF.supportedLocalesOf;
}

/** Troca o idioma da tela: 'pt' | 'en' | 'es'. */
export async function definirIdioma(lang) {
  const alvo = ['en', 'es'].includes(lang) ? lang : 'pt';
  if (alvo === idioma && (alvo === 'pt' || dic)) return;
  const novo = await carregar(alvo).catch(() => null);
  if (dic) restaurar();
  idioma = alvo;
  dic = novo;
  if (alvo !== 'pt') remendarFormatos();
  observar();
  if (dic) { varrer(document.body); traduzirTitulo(); }
  else if (tituloPt) document.title = tituloPt;
}

export const idiomaAtual = () => idioma;

/* Para textos montados em JS que não passam pela tela (alert, confirm, título
   de notificação do navegador). */
export function t(texto) {
  return (dic && traduzirTexto(String(texto))) || texto;
}

/** Só para testes: usa um dicionário sem mexer na tela. */
export function _usarDicionario(bruto, lang = 'en') {
  dic = bruto ? compilar(bruto) : null;
  idioma = bruto ? lang : 'pt';
}
