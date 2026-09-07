'use strict';

/**
 * Um arquivo de mídia por conta, e não um compartilhado por todas.
 *
 * ── O problema que este módulo resolve
 *
 * O caminho da API Mobile mandava `post.media` direto para o `clip_upload`: o
 * arquivo que a pessoa subiu, sem tocar. Todo o pipeline de vídeo — escala para
 * 1080×1920, H.264 High, `faststart`, remoção de metadados, remoção dos NAL
 * units SEI, humanização — existia só no ramo do Graph API.
 *
 * Três consequências, medidas e não supostas:
 *
 *  1. O MESMO arquivo subia para todas as contas. Byte a byte. Detecção de
 *     duplicata não precisa de hash perceptual para isso — comparação direta
 *     resolve. E o loop repete os mesmos arquivos a cada ciclo, para sempre.
 *
 *  2. Os metadados do original subiam junto. Vídeo baixado de outra conta
 *     carrega marcas de origem, e elas iam intactas para o Instagram.
 *
 *  3. Nenhuma validação de formato. Reel fora de spec o Instagram re-comprime
 *     mais forte, e reel re-comprimido entrega pior.
 *
 * E o `processMode` configurado na tela não fazia nada em conta mobile: a
 * interface inteira de humanização era decoração.
 *
 * ── Por que a semente
 *
 * A variação é determinística no par (post, conta). Contas diferentes recebem
 * arquivos diferentes — que é o ponto. Mas a MESMA conta, reprocessando o mesmo
 * post, recebe o mesmo arquivo.
 *
 * Isso importa numa falha parcial: se o upload passou e o registro não, a
 * tentativa seguinte precisa mandar o mesmo vídeo. Com aleatoriedade pura ela
 * mandaria outro, e a conta terminaria com dois reels quase idênticos — pior
 * que o problema original.
 *
 * ── O custo
 *
 * N contas = N conversões, onde antes era uma. É mais CPU e mais disco. As
 * conversões acontecem dentro dos intervalos de 3 a 7 minutos entre contas, que
 * é tempo ocioso de sobra; e o arquivo é apagado logo depois de subir. O custo
 * é real e é o preço de cada conta publicar algo que só ela publicou.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { convertToReelFormat, isVideo } = require('./videoProcessor');
const { argumentosDeMetadado } = require('./metadadosDoArquivo');

const RAIZ_UPLOADS = path.resolve(__dirname, '../../uploads');

/* Os modos que produzem arquivo diferente a cada semente. Os outros são
   determinísticos — mesma entrada, mesmos bytes de saída. */
const VARIAM = new Set(['ultra_clean', 'humanizador']);

/**
 * Gerador pseudoaleatório determinístico (mulberry32).
 *
 * Pequeno, sem dependência, e com distribuição boa o suficiente para escolher
 * um deslocamento de 3 pixels. Não é para criptografia — é para o vídeo da
 * conta A não ser igual ao da conta B.
 */
function criarAleatorio(semente) {
  let a = semente >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Semente estável para o par — mesmo par, mesma semente, sempre. */
function sementeDe(postId, accountId) {
  const digest = crypto
    .createHash('sha256')
    .update(`${postId}:${accountId}`)
    .digest();
  return digest.readUInt32BE(0);
}

/** Um identificador curto para o nome do arquivo, derivado da mesma semente. */
function marcaDe(postId, accountId) {
  return crypto
    .createHash('sha256')
    .update(`${postId}:${accountId}`)
    .digest('hex')
    .slice(0, 10);
}

/**
 * Prepara a mídia desta conta para esta publicação.
 *
 * Devolve `{ caminho, proprio }`. `proprio: true` significa que o arquivo foi
 * gerado para esta conta e pode ser apagado depois de subir; `false` significa
 * que é o original (imagem, ou vídeo que não deu para converter) e NÃO deve ser
 * apagado — ele é o arquivo da biblioteca da pessoa.
 *
 * Nunca lança por causa da conversão. Um vídeo que não converteu ainda pode ser
 * publicado como está: perder o post inteiro por causa da humanização seria
 * trocar um problema de alcance por um de funcionamento.
 *
 * @param {Object} post     — precisa de `_id`, `media` e opcionalmente `processMode`
 * @param {Object} account  — precisa de `_id`
 */
async function prepararParaConta(post, account, opcoes = {}) {
  const relativo = String(post?.media || '');
  if (!relativo) return { caminho: relativo, proprio: false };

  const absoluto = path.isAbsolute(relativo)
    ? relativo
    : path.join(RAIZ_UPLOADS, relativo);

  /* Imagem não passa por aqui. `convertImageForInstagram` existe e é outro
     caminho; misturar os dois neste módulo faria a função ter dois contratos. */
  if (!isVideo(absoluto)) return { caminho: relativo, proprio: false };

  if (!fs.existsSync(absoluto)) {
    console.log(`⚠️ [MidiaPorConta] arquivo não encontrado: ${relativo}`);
    return { caminho: relativo, proprio: false };
  }

  /* ── Modos que não variam são promovidos ────────────────────────────

     `sem_limpeza` e `limpeza_leve` não fazem UMA chamada aleatória. Encodei o
     mesmo vídeo duas vezes com os parâmetros de `limpeza_leve` e o SHA-256
     bateu: sem variação, a semente por conta não muda nada e todas as contas
     voltariam a subir bytes idênticos — que é exatamente o defeito que este
     módulo existe para corrigir.

     A campanha ainda pede `limpeza_leve` por padrão, e o Post herda isso. Em
     vez de deixar o módulo devolver algo que contradiz o próprio nome, o modo
     é promovido para o menor que cumpre o contrato. Quem escolhe
     `ultra_clean` ou `humanizador` de propósito continua com o que escolheu. */
  const pedido = opcoes.processMode || post.processMode || 'humanizador';
  const modo = VARIAM.has(pedido) ? pedido : 'humanizador';

  const semente = sementeDe(String(post._id), String(account._id));
  const marca = marcaDe(String(post._id), String(account._id));

  /* ── A marca d'água desta conta ───────────────────────────────────────────

     Montada aqui porque é aqui que se sabe QUAL conta publica — o texto é o @
     dela. O `videoProcessor` recebe o filtro pronto e não conhece contas.

     `filtroDaMarca` devolve null quando a marca está desligada, quando o @ não
     é válido ou quando não há fonte no sistema. Null vira `undefined` na opção,
     e o vídeo sai sem marca em vez de a conversão falhar: perder a publicação
     por causa de um enfeite seria troca ruim. */
  const configDaMarca = opcoes.marcaDagua || post.marcaDagua || null;
  const filtro = configDaMarca
    ? require('./marcaDagua').filtroDaMarca(configDaMarca, account.username)
    : null;

  /* ── O metadado desta publicação ──────────────────────────────────────────

     Montado aqui pelo mesmo motivo da marca: depende do post e da conta, e o
     `videoProcessor` não conhece nenhum dos dois.

     A limpeza continua sendo feita lá (`-map_metadata -1` e companhia) — isto
     não substitui nada, acrescenta. Limpar tudo tira os traços da origem, que
     é essencial; mas deixava o arquivo sem metadado NENHUM, e vídeo de celular
     tem hora de gravação. Sem hora nenhuma, o vazio é o sinal.

     A hora sai do instante do POST, não do relógio: é o que mantém a promessa
     de que a mesma conta reprocessando o mesmo post recebe o mesmo arquivo. */
  const metadados = argumentosDeMetadado(post, account);

  try {
    const saida = await convertToReelFormat(absoluto, {
      processMode: modo,
      quality: opcoes.quality || 'high',
      aleatorio: criarAleatorio(semente),
      sufixo: `c${marca}`,
      metadados,
      ...(filtro ? { marcaDagua: filtro } : {}),
    });

    // O publicador espera caminho relativo à raiz de uploads.
    const rel = path.relative(RAIZ_UPLOADS, saida).split(path.sep).join('/');
    const caminho = rel.startsWith('..') ? saida : rel;

    console.log(
      `🎬 [MidiaPorConta] @${account.username || account._id} → ` +
      `${path.basename(caminho)} (${modo})`
    );
    return { caminho, proprio: true };
  } catch (err) {
    console.log(
      `⚠️ [MidiaPorConta] conversão falhou para @${account.username || account._id}: ` +
      `${err.message} — publicando o original`
    );
    return { caminho: relativo, proprio: false };
  }
}

/**
 * Apaga o arquivo gerado para uma conta.
 *
 * Só quando `proprio` for verdadeiro: apagar o original tiraria da biblioteca
 * um vídeo que a pessoa ainda vai usar nos próximos ciclos do loop.
 *
 * Sem isto, cada ciclo do loop deixa N arquivos de dezenas de MB no disco. Um
 * loop de 44 reels em 5 contas gera 220 arquivos por volta — o disco enche em
 * dias, e o sintoma aparece como falha de publicação sem relação aparente.
 */
function descartar(caminho, proprio) {
  if (!proprio || !caminho) return;
  const absoluto = path.isAbsolute(caminho)
    ? caminho
    : path.join(RAIZ_UPLOADS, caminho);
  try {
    fs.unlinkSync(absoluto);
  } catch {
    /* Já não existe, ou outro processo apagou. Não é motivo para ruído no log:
       o objetivo era o arquivo não estar lá, e ele não está. */
  }
}

/**
 * A URL pública da mídia desta conta — para o caminho do Graph API.
 *
 * ── Por que o Graph precisa de URL e não de caminho
 *
 * O `clip_upload` da instagrapi lê o arquivo do disco. O Graph API faz o
 * contrário: recebe uma URL e BAIXA o vídeo do nosso servidor. São dois
 * contratos diferentes para a mesma decisão de "qual arquivo esta conta
 * publica", e por isso as duas funções moram aqui em vez de cada caminho
 * inventar a sua.
 *
 * ── O vazamento que isto fecha
 *
 * `prepareVideo(post)` era chamada UMA vez por post, antes do laço de contas, e
 * a mesma URL ia para todas as contas Graph. A correção do arquivo por conta
 * cobriu só o caminho mobile: conta oficial continuava subindo bytes idênticos
 * às das outras.
 *
 * @returns {Promise<{url: string|null, caminho: string, proprio: boolean}>}
 */
async function urlParaConta(post, account, opcoes = {}) {
  const publico = String(process.env.PUBLIC_URL || '').replace(/\/$/, '');
  if (!publico) {
    /* Sem PUBLIC_URL o Graph não tem de onde baixar. Devolver null deixa o
       chamador cair no comportamento antigo em vez de publicar uma URL
       inválida — que o Meta aceita e depois falha, sem dizer por quê. */
    console.log('⚠️ [MidiaPorConta] PUBLIC_URL não definido — o Graph usa o caminho antigo');
    return { url: null, caminho: '', proprio: false };
  }

  const r = await prepararParaConta(post, account, opcoes);
  if (!r.proprio) {
    // Não converteu (imagem, arquivo ausente, ou falha). O chamador decide.
    return { url: null, caminho: r.caminho, proprio: false };
  }

  /* `convertToReelFormat` grava em `uploads/processed`, que é exatamente o que
     `/uploads` serve — a URL é o basename sobre esse prefixo, a mesma forma que
     `prepareVideo` montava. */
  return {
    url: `${publico}/uploads/processed/${path.basename(r.caminho)}`,
    caminho: r.caminho,
    proprio: true,
  };
}

module.exports = {
  prepararParaConta, urlParaConta, descartar,
  criarAleatorio, sementeDe, marcaDe,
};
