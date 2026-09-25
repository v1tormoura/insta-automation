'use strict';

/**
 * Um arquivo de mídia por conta, e não um compartilhado por todas.
 *
 * ── O problema que este módulo resolve
 *
 * Mandar o arquivo que a pessoa subiu, sem tocar, para todas as contas tem três
 * consequências, medidas e não supostas:
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

/**
 * Resolve a trilha desta conta em algo que o conversor consome:
 * `{ caminho (absoluto), modo, volume }` — ou `null` para "sem trilha".
 *
 * Trilha escolhida que sumiu do disco não derruba a publicação: sai sem
 * trilha e loga. Um caminho quebrado não vale perder o post — mas tem que
 * aparecer, senão a pessoa acha que a troca aconteceu.
 */
async function _trilhaDaConta(config, aleatorio, account) {
  if (!config || !config.modo || config.modo === 'nenhuma') return null;
  const ids = Array.isArray(config.ids) ? config.ids : [];
  if (!ids.length) return null;
  try {
    const { sql } = require('../db');
    const { escolher } = require('./trilhaPorConta');
    const docs = await sql`select * from trilhas where id = any(${ids.map(String)}::uuid[])`;
    const t = escolher(config, docs, aleatorio);
    if (!t) return null;
    const caminho = path.join(RAIZ_UPLOADS, t.arquivo);
    if (!fs.existsSync(caminho)) {
      console.log(`⚠️ [MidiaPorConta] trilha "${t.nome}" não está no disco (${t.arquivo}) — @${account?.username || account?.id} sai sem trilha`);
      return null;
    }
    console.log(`🎵 [MidiaPorConta] @${account?.username || account?.id} → trilha "${t.nome}" (${t.modo}, vol ${t.volume})`);
    return { caminho, modo: t.modo, volume: t.volume, nome: t.nome };
  } catch (err) {
    console.log(`⚠️ [MidiaPorConta] trilha indisponível (${err.message}) — publicando sem trilha`);
    return null;
  }
}

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

/**
 * Semente do arquivo desta publicação.
 *
 * O `token` é o que torna o arquivo único por PUBLICAÇÃO, não só por par
 * (post, conta). Sem ele (token vazio) a função continua pura e determinística
 * — mesmo par, mesma semente — que é o contrato que os testes de unidade e a
 * unicidade ENTRE contas dependem. Com um token diferente a cada vez que o reel
 * sai, a MESMA conta repostando o MESMO reel (o caso do loop) gera bytes
 * diferentes: sai como novo por mais que se poste.
 */
function sementeDe(postId, accountId, token = '') {
  const digest = crypto
    .createHash('sha256')
    .update(`${postId}:${accountId}:${token}`)
    .digest();
  return digest.readUInt32BE(0);
}

/** Um identificador curto para o nome do arquivo, derivado da mesma semente. */
function marcaDe(postId, accountId, token = '') {
  return crypto
    .createHash('sha256')
    .update(`${postId}:${accountId}:${token}`)
    .digest('hex')
    .slice(0, 10);
}

/**
 * O token que faz cada publicação ser única.
 *
 * `opcoes.tokenPublicacao` é um id ESTÁVEL da publicação (quando o chamador tem
 * um — ex.: o id da publicação da campanha, o ciclo do loop): duas conversões
 * da MESMA publicação (um retry) dão o mesmo arquivo, sem re-encodar à toa. Sem
 * ele, um nonce aleatório garante que cada saída seja diferente — que é o
 * comportamento que o produto quer por padrão: reel novo a cada publicação.
 */
function tokenDaPublicacao(opcoes = {}) {
  if (opcoes.tokenPublicacao) return String(opcoes.tokenPublicacao);
  return crypto.randomBytes(8).toString('hex');
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
 * @param {Object} post     — precisa de `id`, `media` e opcionalmente `processMode`
 * @param {Object} account  — precisa de `id`
 */
async function prepararParaConta(post, account, opcoes = {}) {
  const relativo = String(post?.media || '');
  if (!relativo) return { caminho: relativo, proprio: false };

  const absoluto = path.isAbsolute(relativo)
    ? relativo
    : path.join(RAIZ_UPLOADS, relativo);

  /* ── Imagem ───────────────────────────────────────────────────────────────

     A humanização de vídeo não se aplica: não há crop temporal, nem pitch de
     áudio, nem CRF. O que se aplica é a marca d'água — e antes disso a imagem
     saía sem marca nenhuma, mesmo com a opção ligada na tela. Quem postava foto
     via "Marca d'água ativa" no painel e nada no post.

     Só a marca, de propósito: reformatar a imagem aqui mudaria o que já é
     publicado hoje, e o pedido era a marca. */
  if (!isVideo(absoluto)) {
    if (!fs.existsSync(absoluto)) return { caminho: relativo, proprio: false };
    const comMarca = await marcarImagem(absoluto, post, account, opcoes);
    return comMarca || { caminho: relativo, proprio: false };
  }

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

  const token = tokenDaPublicacao(opcoes);
  const semente = sementeDe(String(post.id), String(account.id), token);
  const marca = marcaDe(String(post.id), String(account.id), token);

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

     A hora sai do instante do POST, não do relógio: é uma "hora de gravação"
     plausível e estável para a mídia de origem. A unicidade por publicação NÃO
     vem daqui — vem da semente (o `token`), que muda os pixels do humanizador e
     portanto o hash do arquivo, mesmo com a mesma hora de metadado. */
  const metadados = argumentosDeMetadado(post, account);

  /* ── A EDIÇÃO desta conta ────────────────────────────────────────────────

     O arquivo único resolve duplicata de arquivo, e só. O vídeo continuava
     sendo o mesmo: mesma abertura, mesmo ritmo, mesmo texto. Cinco contas
     postando o mesmo material disputavam o mesmo público com a mesma ideia.

     Aqui cada conta recebe um corte de início, uma velocidade e um gancho
     diferentes. A semente é DERIVADA da do arquivo (não a mesma) para o sorteio
     da edição não consumir valores do gerador do humanizador — senão ligar a
     variação mudaria também o micro-crop e o CRF, e duas coisas independentes
     ficariam amarradas sem motivo. */
  const configVariacao = opcoes.variacaoEdicao || post.variacaoEdicao || null;
  const variacao = configVariacao
    ? require('./variacaoDeEdicao').resolver(
        configVariacao,
        criarAleatorio((semente ^ 0x9e3779b9) >>> 0),
      )
    : null;
  const ganchoFiltro = variacao && variacao.gancho
    ? require('./variacaoDeEdicao').filtroDoGancho(variacao.gancho, variacao.segundosDoGancho)
    : null;

  /* ── A TRILHA desta conta ────────────────────────────────────────────────

     O áudio é o sinal mais forte do reconhecimento de conteúdo reutilizado.
     Aqui cada conta pode sair com outra trilha (substituindo o original) ou
     com uma trilha por baixo (misturando — que NÃO muda o fingerprint; a tela
     avisa). Semente própria, derivada, pela mesma razão da edição: sortear a
     trilha não pode mexer no que o humanizador e a edição sortearam. */
  const trilha = await _trilhaDaConta(
    opcoes.trilha || post.trilha || null,
    criarAleatorio((semente ^ 0x7f4a7c15) >>> 0),
    account,
  );

  try {
    const saida = await convertToReelFormat(absoluto, {
      processMode: modo,
      quality: opcoes.quality || 'high',
      aleatorio: criarAleatorio(semente),
      sufixo: `c${marca}`,
      metadados,
      ...(filtro ? { marcaDagua: filtro } : {}),
      ...(variacao ? { variacao } : {}),
      ...(ganchoFiltro ? { ganchoFiltro } : {}),
      ...(trilha ? { trilha } : {}),
    });

    // O publicador espera caminho relativo à raiz de uploads.
    const rel = path.relative(RAIZ_UPLOADS, saida).split(path.sep).join('/');
    const caminho = rel.startsWith('..') ? saida : rel;

    console.log(
      `🎬 [MidiaPorConta] @${account.username || account.id} → ` +
      `${path.basename(caminho)} (${modo})`
    );
    return { caminho, proprio: true };
  } catch (err) {
    console.log(
      `⚠️ [MidiaPorConta] conversão falhou para @${account.username || account.id}: ` +
      `${err.message} — publicando o original`
    );
    return { caminho: relativo, proprio: false };
  }
}

/**
 * A marca d'água numa imagem.
 *
 * Uma passada de ffmpeg, um frame, arquivo próprio por conta. Devolve `null`
 * quando não há marca a desenhar ou quando a passada falha — e aí quem chamou
 * publica o original: perder o post por causa de um enfeite seria troca ruim.
 *
 * ── Por que não reusa `convertImageForInstagram`
 *
 * Ela reformata para 1080×1080 (ou 1920 no story) e reaproveita a saída por um
 * nome SEM marca da conta — o mesmo cache que já era armadilha no vídeo. Usá-la
 * aqui mudaria o enquadramento do que é publicado hoje e faria a marca de uma
 * conta aparecer na foto de outra.
 *
 * @returns {Promise<{caminho: string, proprio: boolean}|null>}
 */
async function marcarImagem(absoluto, post, account, opcoes = {}) {
  const config = opcoes.marcaDagua || post.marcaDagua || null;
  if (!config) return null;

  /* A imagem não é 1080×1920 como o reel. O filtro usa `h` e `text_h` do
     ffmpeg para o centro, mas as posições superior e inferior são calculadas
     em pixels sobre a altura do reel — numa imagem quadrada elas cairiam fora.
     `alturaDaMidia` deixa o módulo da marca fazer a conta certa. */
  const { filtroDaMarca } = require('./marcaDagua');
  const filtro = filtroDaMarca(config, account.username, undefined, await alturaDaImagem(absoluto));
  if (!filtro) return null;

  const ext = path.extname(absoluto) || '.jpg';
  const marca = marcaDe(String(post.id), String(account.id), tokenDaPublicacao(opcoes));
  const saida = path.join(RAIZ_UPLOADS, 'processed', `${path.basename(absoluto, ext)}-c${marca}${ext}`);

  try {
    fs.mkdirSync(path.dirname(saida), { recursive: true });
    await new Promise((resolve, reject) => {
      require('fluent-ffmpeg')(absoluto)
        .outputOptions(['-vf', filtro, '-frames:v', '1', '-q:v', '1'])
        .on('end', resolve)
        .on('error', reject)
        .save(saida);
    });
    const rel = path.relative(RAIZ_UPLOADS, saida).split(path.sep).join('/');
    console.log(`🖼️ [MidiaPorConta] @${account.username || account.id} → ${path.basename(saida)} (marca d'água)`);
    return { caminho: rel.startsWith('..') ? saida : rel, proprio: true };
  } catch (err) {
    console.log(`⚠️ [MidiaPorConta] marca na imagem falhou para @${account.username || account.id}: ${err.message} — publicando o original`);
    return null;
  }
}

/** A altura da imagem, para a marca cair dentro dela. */
async function alturaDaImagem(absoluto) {
  try {
    const meta = await new Promise((resolve, reject) => {
      require('fluent-ffmpeg').ffprobe(absoluto, (e, m) => (e ? reject(e) : resolve(m)));
    });
    const h = meta?.streams?.find(s => s.codec_type === 'video')?.height;
    return Number.isFinite(h) && h > 0 ? h : null;
  } catch {
    /* Sem a altura, o módulo da marca usa a do reel. Numa imagem menor a
       posição inferior sobe para dentro do quadro em vez de sair dele. */
    return null;
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

module.exports = {
  prepararParaConta, descartar,
  criarAleatorio, sementeDe, marcaDe,
};
