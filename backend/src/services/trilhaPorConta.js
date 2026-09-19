'use strict';

/**
 * Trilha de áudio por conta, na hora de publicar.
 *
 * ── O problema que isto resolve
 *
 * O áudio é o sinal mais forte do reconhecimento de conteúdo reutilizado —
 * fingerprint feito para atravessar ruído, EQ e pequena variação de
 * velocidade. Enquanto o áudio original ficar, o vídeo é reconhecido; e as
 * contas todas publicando o mesmo áudio são reconhecidas como o mesmo material.
 *
 * Aqui a trilha entra na conversão por conta, no mesmo ponto em que entram a
 * marca d'água e a variação de edição. Com mais de uma trilha escolhida, cada
 * conta sorteia a sua — determinístico em (publicação, conta), como todo o
 * resto: retry reproduz a mesma trilha, contas diferentes recebem diferentes.
 *
 * ── Os dois modos, e o que cada um é
 *
 * `substituir`: o áudio original sai, a trilha entra. É o único modo que muda
 * o fingerprint de áudio. Só faz sentido em vídeo SEM fala — em vídeo com fala,
 * apaga o conteúdo.
 *
 * `misturar`: a trilha entra por baixo do original. NÃO muda o fingerprint
 * (o original continua lá, e o reconhecimento foi feito para ouvir através de
 * fundo). É clima, não disfarce — e a tela diz isso com todas as letras.
 */

const MODOS = Object.freeze(['nenhuma', 'substituir', 'misturar']);
const VOLUME_MIN = 0.05;
const VOLUME_MAX = 1.5;
const VOLUME_PADRAO = Object.freeze({ substituir: 1.0, misturar: 0.3 });

/** Só ids que parecem ObjectId — o resto é lixo de formulário. */
function _ids(lista) {
  if (!Array.isArray(lista)) return [];
  return [...new Set(lista.map(v => String(v || '').trim()).filter(v => /^[0-9a-f]{24}$/i.test(v)))];
}

/**
 * Normaliza a configuração vinda da tela ou do banco. Nunca lança: campo
 * estragado vira o padrão, porque perder a publicação por um ajuste de áudio
 * seria troca ruim — mesma regra de `marcaDagua.normalizar`.
 */
function normalizar(bruto) {
  const b = bruto && typeof bruto === 'object' ? bruto : {};
  const modo = MODOS.includes(b.modo) ? b.modo : 'nenhuma';
  const ids = _ids(b.ids);
  const v = Number(b.volume);
  const volume = Number.isFinite(v) && v > 0
    ? Math.min(VOLUME_MAX, Math.max(VOLUME_MIN, v))
    : (VOLUME_PADRAO[modo] ?? 1);
  return { modo, ids, volume };
}

/**
 * A configuração que chegou no corpo da requisição, ou `null` quando não há o
 * que fazer (modo nenhuma, ou nenhuma trilha escolhida).
 *
 * O Postar envia `multipart/form-data`, então o objeto chega como JSON numa
 * string — mesmo contrato de `marcaDagua.lerDoCorpo`.
 */
function lerDoCorpo(valor) {
  let bruto = valor;
  if (typeof bruto === 'string') {
    if (!bruto.trim()) return null;
    try { bruto = JSON.parse(bruto); } catch { return null; }
  }
  const c = normalizar(bruto);
  if (c.modo === 'nenhuma' || !c.ids.length) return null;
  return c;
}

/**
 * A trilha desta conta.
 *
 * @param {object}   config    `{ modo, ids, volume }` já normalizada
 * @param {object[]} trilhas   documentos `Trilha` encontrados para `ids`
 * @param {function} aleatorio gerador semeado em (publicação, conta)
 * @returns {{arquivo:string, nome:string, modo:string, volume:number}|null}
 */
function escolher(config, trilhas, aleatorio) {
  const c = normalizar(config);
  if (c.modo === 'nenhuma') return null;

  /* Só as que a configuração pediu E que existem no banco, NA ORDEM dos ids
     pedidos: o sorteio precisa ser estável, e a ordem que o banco devolve não
     é garantida. */
  const porId = new Map((trilhas || []).map(t => [String(t._id), t]));
  const validas = c.ids.map(id => porId.get(id)).filter(t => t && t.arquivo);
  if (!validas.length) return null;

  const sorteia = typeof aleatorio === 'function' ? aleatorio : Math.random;
  const t = validas[Math.floor(sorteia() * validas.length) % validas.length];
  return { arquivo: String(t.arquivo), nome: String(t.nome || ''), modo: c.modo, volume: c.volume };
}

module.exports = { normalizar, lerDoCorpo, escolher, MODOS, VOLUME_MIN, VOLUME_MAX, VOLUME_PADRAO };
