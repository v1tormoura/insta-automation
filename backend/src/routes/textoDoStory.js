'use strict';

/**
 * Limpeza do texto livre que vem da tela de stories.
 *
 * ── Por que num arquivo próprio
 *
 * Este texto termina dentro de um filtro `drawtext` do ffmpeg, montado por
 * concatenação de string. O renderizador escapa os caracteres perigosos, mas
 * escapar é a última linha — não a primeira. O que chega da rede precisa ter
 * forma conhecida antes de virar comando: tipo certo, tamanho com teto, e nada
 * de controle no meio.
 *
 * Fora da rota porque uma função pura se testa com dez linhas, e dentro de um
 * `router.post` de duzentas linhas só se testa subindo o Express inteiro — o
 * que na prática significa que não se testa.
 */

/* Tetos.

   6 linhas × 80 caracteres é mais do que cabe legível num story de 1080×1920
   no maior corpo de fonte. O teto não existe para limitar a escrita: existe
   para que uma requisição com 4 MB de texto não vire uma linha de comando de
   4 MB. O renderizador corta de novo em 6 linhas; aqui o corte é por
   caractere, que é o que protege o comando. */
const MAX_LINHAS = 6;
const MAX_POR_LINHA = 80;

const TAMANHOS = ['pequeno', 'medio', 'grande'];
const CORES = ['branco', 'preto'];

/**
 * Converte o que veio no body num objeto de texto confiável, ou `null`.
 *
 * `null` quando não há texto de verdade — e a diferença importa: o serviço usa
 * a ausência para decidir se vale reprocessar a mídia. Um objeto com string
 * vazia dentro faria o ffmpeg rodar para desenhar nada.
 *
 * @param {any} bruto  O `req.body.textoLivre`, de tipo desconhecido.
 * @returns {{texto:string, x:number, y:number, tamanho:string, cor:string}|null}
 */
function limparTextoLivre(bruto) {
  if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) return null;

  if (typeof bruto.texto !== 'string') return null;

  const texto = bruto.texto
    /* Caracteres de controle fora, menos a quebra de linha — que é a única
       formatação que este campo tem. Um \r sozinho, ou um byte nulo no meio,
       não aparecem na tela e mudam o que o ffmpeg lê da string. */
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x09\x0B-\x1F\x7F]/g, '')
    .split('\n')
    .map(l => l.trim().slice(0, MAX_POR_LINHA))
    .filter(Boolean)
    .slice(0, MAX_LINHAS)
    .join('\n');

  if (!texto) return null;

  return {
    texto,
    x: fracao(bruto.x, 0.5),
    y: fracao(bruto.y, 0.35),
    tamanho: TAMANHOS.includes(bruto.tamanho) ? bruto.tamanho : 'medio',
    cor: CORES.includes(bruto.cor) ? bruto.cor : 'branco',
  };
}

/**
 * Número entre 0 e 1, ou o padrão.
 *
 * `null`, `undefined` e `''` são ausência, não zero — `Number(null)` vale 0, e
 * zero é uma posição legítima (encostar na borda). Confundir os dois joga o
 * texto para o canto de quem só não mexeu no controle.
 */
function fracao(valor, padrao) {
  /* Só número ou string. `Number([])` vale 0 e `Number([7])` vale 7 — finitos
     os dois, e um array chegando como coordenada colocaria o texto na borda
     esquerda sem que ninguém tivesse pedido. O tipo entra na validação porque
     `Number()` aceita coisas demais. */
  if (typeof valor !== 'number' && typeof valor !== 'string') return padrao;
  if (valor === '') return padrao;
  const n = Number(valor);
  if (!Number.isFinite(n)) return padrao;
  return Math.min(1, Math.max(0, n));
}

module.exports = { limparTextoLivre, MAX_LINHAS, MAX_POR_LINHA, TAMANHOS, CORES };
