'use strict';

/**
 * Variações de Mídia — converter e preparar vídeos e fotos da própria pessoa
 * para os formatos do Instagram, em lote.
 *
 * Cada arquivo enviado vira uma saída por FORMATO escolhido (9:16, 4:5, 1:1,
 * proporção original). Tudo o que muda no arquivo é escolhido na tela e dito
 * nela: enquadramento, qualidade, trecho, brilho/contraste/saturação/nitidez,
 * áudio. Nada é sorteado — a mesma entrada com a mesma configuração dá a mesma
 * saída. Não há ajuste "invisível" nem cópias quase iguais do mesmo arquivo.
 *
 * ── Onde ficam os arquivos
 *
 *   uploads/preparos/<usuário>/<preparo>/original.<ext>   (apagado ao terminar)
 *   uploads/preparos/<usuário>/<preparo>/<saída>.<ext>    (expira em VALIDADE_H)
 *
 * A pasta NÃO é servida por /uploads (app.js bloqueia): só sai pelas rotas de
 * download, que conferem o dono. Caminhos são montados só com ids gerados
 * aqui — nada do nome que a pessoa enviou entra no disco.
 *
 * ── ffmpeg
 *
 * Sempre `execFile` com argumentos separados (nunca uma linha de shell), com
 * tempo-limite e no máximo CONCORRENCIA processos ao mesmo tempo. Cancelar
 * mata o processo em andamento.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { sql } = require('../db');
const { FFMPEG_BIN } = require('./ffmpegBin');

const UPLOADS = path.resolve(__dirname, '../../uploads');
/* PREPAROS_DIR: os testes usam uma pasta própria — a limpeza de órfãos apagaria
   os arquivos de quem estiver usando o painel na mesma máquina. */
const PASTA = process.env.PREPAROS_DIR ? path.resolve(process.env.PREPAROS_DIR) : path.join(UPLOADS, 'preparos');
const FFPROBE_BIN = process.env.FFPROBE_PATH || (FFMPEG_BIN.endsWith('ffmpeg') ? FFMPEG_BIN.replace(/ffmpeg$/, 'ffprobe') : 'ffprobe');

const num = (v, padrao) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : padrao);
const LIMITES = {
  videoMb: num(process.env.PREPAROS_MAX_VIDEO_MB, 500),
  imagemMb: num(process.env.PREPAROS_MAX_IMAGEM_MB, 40),
  duracaoS: num(process.env.PREPAROS_MAX_DURACAO_S, 600),
  ladoMaximo: 8192,
  naFila: num(process.env.PREPAROS_MAX_NA_FILA, 60),
  porDia: num(process.env.PREPAROS_MAX_POR_DIA, 300),
  validadeH: num(process.env.PREPAROS_VALIDADE_H, 24),
  historicoDias: 30,
  concorrencia: num(process.env.PREPAROS_CONCORRENCIA, 2),
  discoLivreMb: num(process.env.PREPAROS_DISCO_LIVRE_MB, 2048),
};

/* ── Formatos de saída ──────────────────────────────────────────────────── */

const FORMATOS = {
  '9x16':     { rotulo: 'Reels / Stories 9:16', curto: '9x16', largura: 1080, altura: 1920 },
  '4x5':      { rotulo: 'Feed 4:5',             curto: '4x5',  largura: 1080, altura: 1350 },
  '1x1':      { rotulo: 'Quadrado 1:1',          curto: '1x1',  largura: 1080, altura: 1080 },
  original:   { rotulo: 'Proporção original',    curto: 'original', largura: null, altura: null },
};
const ENQUADRAMENTOS = ['cortar', 'barras', 'desfoque'];
const QUALIDADES = {
  alta:  { crf: 18, preset: 'faster',   jpg: 2, webp: 92, audio: '192k' },
  media: { crf: 22, preset: 'faster',   jpg: 4, webp: 82, audio: '160k' },
  leve:  { crf: 27, preset: 'veryfast', jpg: 7, webp: 70, audio: '128k' },
};
const FORMATOS_FOTO = ['jpg', 'png', 'webp'];
const LARGURAS_ORIGINAL = [1080, 1440, 0]; // 0 = manter o tamanho
const APLICAR_EM = ['tudo', 'video', 'imagem'];

/* Corte de silêncios (vídeos de fala): o que conta como pausa. `ruido` é o
   volume abaixo do qual é silêncio; `minimo`, quanto tempo calado conta como
   pausa. `folga` fica de cada lado da fala para não comer o fim das palavras. */
const SILENCIOS = {
  suave:  { ruido: -35, minimo: 1.0,  folga: 0.20 },
  normal: { ruido: -35, minimo: 0.6,  folga: 0.15 },
  forte:  { ruido: -33, minimo: 0.35, folga: 0.10 },
};
const POSICOES_TITULO = ['topo', 'centro', 'base'];
const CANTOS_LOGO = ['sup-esq', 'sup-dir', 'inf-esq', 'inf-dir'];
const TAMANHOS_LOGO = ['pequeno', 'medio', 'grande'];

const limitar = (v, min, max, padrao = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : padrao;
};

/**
 * A configuração que vale, a partir do que veio da tela. Tudo fora do
 * permitido volta ao padrão — nunca vira argumento do ffmpeg como chegou.
 */
function normalizarConfig(bruta = {}) {
  const c = typeof bruta === 'string' ? (() => { try { return JSON.parse(bruta); } catch { return {}; } })() : (bruta || {});
  const formatos = [...new Set((Array.isArray(c.formatos) ? c.formatos : []).map(String))].filter(f => FORMATOS[f]);
  const avancado = c.modo === 'avancado';
  const ajustes = c.ajustes || {};
  const trecho = c.trecho || {};
  return {
    modo: avancado ? 'avancado' : 'rapido',
    formatos: formatos.length ? formatos : ['9x16'],
    enquadramento: ENQUADRAMENTOS.includes(c.enquadramento) ? c.enquadramento : 'cortar',
    qualidade: QUALIDADES[c.qualidade] ? c.qualidade : 'alta',
    aplicarEm: APLICAR_EM.includes(c.aplicarEm) ? c.aplicarEm : 'tudo',
    /* O que segue só vale no modo avançado: no rápido fica no neutro, para a
       tela nunca aplicar algo que não está mostrando. */
    formatoFoto: avancado && FORMATOS_FOTO.includes(c.formatoFoto) ? c.formatoFoto : 'jpg',
    larguraOriginal: avancado && LARGURAS_ORIGINAL.includes(Number(c.larguraOriginal)) ? Number(c.larguraOriginal) : 1080,
    semAudio: avancado && c.semAudio === true,
    realce: avancado && c.realce === true,
    trecho: avancado ? {
      inicio: limitar(trecho.inicio, 0, LIMITES.duracaoS, 0),
      fim: trecho.fim === null || trecho.fim === '' || trecho.fim === undefined ? null : limitar(trecho.fim, 0, LIMITES.duracaoS, null),
    } : { inicio: 0, fim: null },
    ajustes: avancado ? {
      brilho: Math.round(limitar(ajustes.brilho, -20, 20)),
      contraste: Math.round(limitar(ajustes.contraste, -20, 20)),
      saturacao: Math.round(limitar(ajustes.saturacao, -50, 50)),
      nitidez: Math.round(limitar(ajustes.nitidez, 0, 100)),
    } : { brilho: 0, contraste: 0, saturacao: 0, nitidez: 0 },
    /* Valem nos dois modos: são escolhas à parte, visíveis na tela. O corte de
       silêncios vem LIGADO (normal) quando a tela não diz nada. */
    silencios: c.silencios === 'desligado' ? 'desligado' : SILENCIOS[c.silencios] ? c.silencios : 'normal',
    capa: {
      ativa: c.capa?.ativa === true,
      segundo: c.capa?.segundo === null || c.capa?.segundo === '' || c.capa?.segundo === undefined
        ? null : limitar(c.capa.segundo, 0, LIMITES.duracaoS, null),
      titulo: String(c.capa?.titulo || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 90),
      posicao: POSICOES_TITULO.includes(c.capa?.posicao) ? c.capa.posicao : 'centro',
    },
    logo: {
      ativa: c.logo?.ativa === true,
      canto: CANTOS_LOGO.includes(c.logo?.canto) ? c.logo.canto : 'sup-dir',
      tamanho: TAMANHOS_LOGO.includes(c.logo?.tamanho) ? c.logo.tamanho : 'medio',
      opacidade: Math.round(limitar(c.logo?.opacidade, 20, 100, 90)),
    },
  };
}

/* ── Validação do arquivo ───────────────────────────────────────────────── */

/** O tipo REAL pelo conteúdo (assinatura), não pela extensão. */
function tipoPeloConteudo(cabeca) {
  const b = Buffer.isBuffer(cabeca) ? cabeca : Buffer.from(cabeca || []);
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { tipo: 'imagem', ext: 'jpg' };
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { tipo: 'imagem', ext: 'png' };
  if (b.length >= 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return { tipo: 'imagem', ext: 'webp' };
  if (b.length >= 12) {
    const caixa = b.toString('latin1', 4, 8);
    if (caixa === 'ftyp') {
      const marca = b.toString('latin1', 8, 12);
      return { tipo: 'video', ext: marca === 'qt  ' ? 'mov' : 'mp4' };
    }
    if (['moov', 'mdat', 'wide', 'free', 'skip'].includes(caixa)) return { tipo: 'video', ext: 'mov' };
  }
  return null;
}

function lerCabeca(arquivo, n = 64) {
  const fd = fs.openSync(arquivo, 'r');
  try {
    const buf = Buffer.alloc(n);
    const lidos = fs.readSync(fd, buf, 0, n, 0);
    return buf.subarray(0, lidos);
  } finally { fs.closeSync(fd); }
}

/**
 * Orientação EXIF de um JPEG (1–8), ou 1. Lida aqui porque o ffmpeg do Debian
 * (5.x) não gira a foto sozinho e o mais novo gira — assim as duas versões dão
 * a mesma saída (entrada aberta com `-noautorotate` e girada por nós).
 */
function orientacaoExif(arquivo) {
  let buf;
  try { buf = lerCabeca(arquivo, 128 * 1024); } catch { return 1; }
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return 1;
  let i = 2;
  while (i + 4 < buf.length && buf[i] === 0xff) {
    const marcador = buf[i + 1];
    const tamanho = buf.readUInt16BE(i + 2);
    if (marcador === 0xe1 && buf.toString('latin1', i + 4, i + 10) === 'Exif\0\0') {
      const t = i + 10;
      const le = buf.toString('latin1', t, t + 2) === 'II';
      const u16 = o => (le ? buf.readUInt16LE(o) : buf.readUInt16BE(o));
      const u32 = o => (le ? buf.readUInt32LE(o) : buf.readUInt32BE(o));
      try {
        const ifd = t + u32(t + 4);
        const n = u16(ifd);
        for (let k = 0; k < n; k++) {
          const e = ifd + 2 + k * 12;
          if (u16(e) === 0x0112) { const v = u16(e + 8); return v >= 1 && v <= 8 ? v : 1; }
        }
      } catch { return 1; }
      return 1;
    }
    if (marcador === 0xda) break; // começo da imagem: não há mais cabeçalhos
    i += 2 + tamanho;
  }
  return 1;
}

const FILTRO_ORIENTACAO = {
  2: 'hflip', 3: 'hflip,vflip', 4: 'vflip', 5: 'transpose=0', 6: 'transpose=1', 7: 'transpose=3', 8: 'transpose=2',
};

function rodar(bin, args, { timeoutMs = 60_000, aoIniciar, saidaDeErro = false } = {}) {
  return new Promise((resolve, reject) => {
    const filho = execFile(bin, args, { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, killSignal: 'SIGKILL' }, (err, stdout, stderr) => {
      if (err) {
        const e = new Error(String(stderr || err.message).trim().split('\n').slice(-3).join(' ').slice(0, 300) || 'ffmpeg falhou');
        e.sinal = err.signal || null;
        e.tempoEsgotado = !!err.killed && err.signal === 'SIGKILL' && !filho._cancelado;
        e.cancelado = !!filho._cancelado;
        e.codigo = err.code;
        return reject(e);
      }
      resolve(saidaDeErro ? stderr : stdout);
    });
    aoIniciar?.(filho);
  });
}

/** Informações técnicas do arquivo (ffprobe). Lança se não for mídia válida. */
async function sondar(arquivo) {
  const saida = await rodar(FFPROBE_BIN, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', arquivo], { timeoutMs: 20_000 });
  const d = JSON.parse(saida || '{}');
  const video = (d.streams || []).find(s => s.codec_type === 'video');
  if (!video) throw Object.assign(new Error('O arquivo não tem imagem de vídeo/foto legível.'), { invalido: true });
  const rot = Number((video.side_data_list || []).find(x => x.rotation !== undefined)?.rotation ?? video.tags?.rotate ?? 0);
  const deitado = Math.abs(rot) % 180 === 90;
  const [n, dd] = String(video.avg_frame_rate || video.r_frame_rate || '0/1').split('/').map(Number);
  return {
    largura: deitado ? video.height : video.width,
    altura: deitado ? video.width : video.height,
    duracao: Number(d.format?.duration) || Number(video.duration) || 0,
    codec: video.codec_name || '',
    fps: dd ? Math.round((n / dd) * 100) / 100 : 0,
    temAudio: (d.streams || []).some(s => s.codec_type === 'audio'),
  };
}

/**
 * Confere o arquivo recebido: assinatura real, tamanho, que o ffprobe lê,
 * duração e dimensões. Devolve { tipo, ext, info } ou lança com `invalido`.
 */
async function validarArquivo(arquivo, { aplicarEm = 'tudo' } = {}) {
  const invalido = msg => Object.assign(new Error(msg), { invalido: true });
  const real = tipoPeloConteudo(lerCabeca(arquivo));
  if (!real) throw invalido('Formato não suportado. Envie MP4, MOV, JPG, PNG ou WEBP.');
  if (aplicarEm !== 'tudo' && real.tipo !== aplicarEm) {
    throw invalido(aplicarEm === 'video' ? 'Está configurado para processar só vídeos.' : 'Está configurado para processar só fotos.');
  }
  const bytes = fs.statSync(arquivo).size;
  const maxMb = real.tipo === 'video' ? LIMITES.videoMb : LIMITES.imagemMb;
  if (bytes > maxMb * 1024 * 1024) throw invalido(`Arquivo grande demais (máximo ${maxMb} MB para ${real.tipo === 'video' ? 'vídeo' : 'foto'}).`);
  let info;
  try { info = await sondar(arquivo); } catch (err) { throw invalido(err.invalido ? err.message : 'O arquivo está corrompido ou incompleto.'); }
  if (!info.largura || !info.altura) throw invalido('Não foi possível ler as dimensões.');
  if (Math.max(info.largura, info.altura) > LIMITES.ladoMaximo) throw invalido(`Resolução acima de ${LIMITES.ladoMaximo}px.`);
  if (real.tipo === 'video') {
    if (!(info.duracao > 0)) throw invalido('Vídeo sem duração — o arquivo parece incompleto.');
    if (info.duracao > LIMITES.duracaoS) throw invalido(`Vídeo com mais de ${Math.round(LIMITES.duracaoS / 60)} min.`);
  }
  if (real.tipo === 'imagem') info.orientacao = real.ext === 'jpg' ? orientacaoExif(arquivo) : 1;
  return { ...real, bytes, info };
}

/* ── Montagem do ffmpeg ─────────────────────────────────────────────────── */

const par = n => Math.max(2, Math.round(n / 2) * 2);

/*
 * Realce de qualidade (upscale), na ordem que importa:
 *   1. hqdn3d  — tira o ruído e os blocos da compressão ANTES de ampliar
 *                (ampliado, o ruído vira mancha e a nitidez o realçaria);
 *   2. lanczos — o redimensionamento passa a usar Lanczos (mais nítido que o bicúbico);
 *   3. cas     — nitidez adaptativa: reforça borda sem estourar o que já é nítido.
 * Não inventa detalhe (isso só IA faz), mas vídeo e foto pequenos ampliados
 * ficam visivelmente mais limpos.
 */
const REALCE_ANTES = 'hqdn3d=1.5:1.5:4:4';
const REALCE_DEPOIS = 'cas=0.6';

/** Filtros de vídeo (string do -vf ou do -filter_complex) para um formato. */
function filtros(config, formato, { tipo, orientacao = 1 } = {}) {
  const f = FORMATOS[formato];
  const realce = config.realce === true;
  const lanczos = realce ? ':flags=lanczos' : '';
  const antes = [];
  if (tipo === 'imagem' && FILTRO_ORIENTACAO[orientacao]) antes.push(FILTRO_ORIENTACAO[orientacao]);
  if (realce) antes.push(REALCE_ANTES);

  const depois = [];
  if (realce) depois.push(REALCE_DEPOIS);
  const { brilho, contraste, saturacao, nitidez } = config.ajustes;
  if (brilho || contraste || saturacao) {
    depois.push(`eq=brightness=${(brilho / 100).toFixed(3)}:contrast=${(1 + contraste / 100).toFixed(3)}:saturation=${(1 + saturacao / 100).toFixed(3)}`);
  }
  if (nitidez) depois.push(`unsharp=5:5:${(nitidez / 100).toFixed(2)}:5:5:0`);
  depois.push('setsar=1');
  if (tipo === 'video') depois.push('format=yuv420p');

  const pre = antes.length ? `${antes.join(',')},` : '';
  const pos = depois.join(',');

  if (!f.largura) {
    const max = config.larguraOriginal;
    /* Mantém a proporção e deixa par para o H.264. Sem realce só reduz; com
       realce a largura escolhida vale também para AMPLIAR o que é menor. */
    const escala = !max ? `scale=trunc(iw/2)*2:trunc(ih/2)*2${lanczos}`
      : realce ? `scale=${max}:-2${lanczos}` : `scale='min(iw,${max})':-2`;
    return { simples: `${pre}${escala},${pos}` };
  }
  const W = f.largura, H = f.altura;
  if (config.enquadramento === 'cortar') {
    return { simples: `${pre}scale=${W}:${H}:force_original_aspect_ratio=increase${lanczos},crop=${W}:${H},${pos}` };
  }
  if (config.enquadramento === 'barras') {
    return { simples: `${pre}scale=${W}:${H}:force_original_aspect_ratio=decrease${lanczos},pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black,${pos}` };
  }
  // desfoque: a própria imagem, ampliada e desfocada, preenche o fundo.
  return {
    complexo: `[0:v]${pre}split=2[a][b];`
      + `[a]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=20:2[fundo];`
      + `[b]scale=${W}:${H}:force_original_aspect_ratio=decrease${lanczos}[frente];`
      + `[fundo][frente]overlay=(W-w)/2:(H-h)/2,${pos}[v]`,
  };
}

/** Os argumentos do ffmpeg para uma saída. Pura: testável sem rodar nada. */
/** Largura × altura da saída de um formato (para posicionar o logo). */
function dimensoesDaSaida(config, formato, info = {}) {
  const f = FORMATOS[formato];
  if (f.largura) return { largura: f.largura, altura: f.altura };
  const iw = Number(info.largura) || 1080, ih = Number(info.altura) || 1920;
  const max = config.larguraOriginal;
  const w = max && (config.realce || iw > max) ? max : iw;
  return { largura: w, altura: Math.round((ih * w) / iw) };
}

function argumentos({ entrada, saida, config, formato, tipo, info = {}, logo = null }) {
  const q = QUALIDADES[config.qualidade];
  const f = filtros(config, formato, { tipo, orientacao: info.orientacao || 1 });
  if (logo?.arquivo) {
    /* O logo entra no fim da cadeia, pelo filtro `movie` (sem segunda entrada). */
    const { largura, altura } = dimensoesDaSaida(config, formato, info);
    const l = require('./marcaDagua').partesDoLogo({ arquivo: logo.arquivo, canto: logo.canto, tamanho: logo.tamanho, opacidade: logo.opacidade }, largura, altura);
    const base = f.complexo ? f.complexo.replace(/\[v\]$/, '[mfb]') : `[0:v]${f.simples}[mfb]`;
    f.complexo = `${base};${l.fonte}[mfl];[mfb][mfl]${l.overlay}[v]`;
    delete f.simples;
  }
  const args = ['-hide_banner', '-v', 'error', '-y'];
  if (tipo === 'imagem') args.push('-noautorotate');
  if (tipo === 'video' && config.trecho.inicio > 0) args.push('-ss', String(config.trecho.inicio));
  args.push('-i', entrada);
  if (tipo === 'video') {
    const fim = config.trecho.fim;
    if (fim !== null && fim > config.trecho.inicio) args.push('-t', String(Math.round((fim - config.trecho.inicio) * 1000) / 1000));
  }
  if (f.complexo) args.push('-filter_complex', f.complexo, '-map', '[v]');
  else args.push('-vf', f.simples, '-map', '0:v:0');

  if (tipo === 'video') {
    if (!config.semAudio) args.push('-map', '0:a:0?');
    /* -pix_fmt na saída: depois do logo (overlay com transparência) a imagem
       chega em formato com alfa, que o H.264 não aceita. */
    args.push('-c:v', 'libx264', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-crf', String(q.crf), '-preset', q.preset, '-threads', '2');
    if (info.fps > 60) args.push('-r', '60');
    if (config.semAudio) args.push('-an');
    else args.push('-c:a', 'aac', '-b:a', q.audio, '-ar', '44100', '-ac', '2');
    args.push('-movflags', '+faststart');
  } else {
    args.push('-frames:v', '1');
    if (config.formatoFoto === 'jpg') args.push('-q:v', String(q.jpg));
    if (config.formatoFoto === 'webp') args.push('-c:v', 'libwebp', '-quality', String(q.webp));
    if (config.formatoFoto === 'png') args.push('-compression_level', '6');
  }
  /* Sem os dados do aparelho e da localização (GPS) do original. */
  args.push('-map_metadata', '-1', saida);
  return args;
}

const extensaoDe = (tipo, config) => (tipo === 'video' ? 'mp4' : config.formatoFoto);

/* ── Corte de silêncios ─────────────────────────────────────────────────── */

/** O trecho escolhido, como argumentos de entrada (-ss antes do -i; -t depois). */
function argsDoTrecho(config, duracao) {
  const antes = config.trecho.inicio > 0 ? ['-ss', String(config.trecho.inicio)] : [];
  const fim = config.trecho.fim;
  const depois = fim !== null && fim > config.trecho.inicio
    ? ['-t', String(Math.round((Math.min(fim, duracao || fim) - config.trecho.inicio) * 1000) / 1000)] : [];
  return { antes, depois };
}

/**
 * As pausas do áudio (`silencedetect`), em segundos a partir do início do
 * trecho: [{ inicio, fim }]. Pausa até o fim do arquivo fecha em `duracao`.
 */
function lerSilencios(saidaDoFfmpeg, duracao) {
  const pausas = [];
  let aberta = null;
  for (const linha of String(saidaDoFfmpeg).split('\n')) {
    const ini = linha.match(/silence_start:\s*(-?[\d.]+)/);
    if (ini) { aberta = Math.max(0, Number(ini[1])); continue; }
    const fim = linha.match(/silence_end:\s*([\d.]+)/);
    if (fim && aberta !== null) { pausas.push({ inicio: aberta, fim: Number(fim[1]) }); aberta = null; }
  }
  if (aberta !== null && duracao > aberta) pausas.push({ inicio: aberta, fim: duracao });
  return pausas;
}

/**
 * O que FICA depois de tirar as pausas: [{ inicio, fim }] na ordem. Cada pausa
 * perde `folga` de cada lado (a respiração antes e depois da palavra fica).
 * `null` quando quase nada sairia — não vale recodificar por meio segundo.
 */
function trechosDeFala(pausas, duracao, { folga = 0.15, minimoRemovido = 0.4, maxTrechos = 150 } = {}) {
  let cortes = pausas
    .map(p => ({ inicio: p.inicio <= 0.01 ? 0 : p.inicio + folga, fim: p.fim >= duracao - 0.01 ? duracao : p.fim - folga }))
    .filter(p => p.fim - p.inicio >= 0.1);
  if (cortes.length >= maxTrechos) {
    // Pausas demais: ficam as maiores (cada uma vira um trecho no filtro).
    cortes = [...cortes].sort((a, b) => (b.fim - b.inicio) - (a.fim - a.inicio)).slice(0, maxTrechos - 1).sort((a, b) => a.inicio - b.inicio);
  }
  const removido = cortes.reduce((s, c) => s + (c.fim - c.inicio), 0);
  if (removido < minimoRemovido) return null;
  const fica = [];
  let cursor = 0;
  for (const c of cortes) {
    if (c.inicio - cursor >= 0.05) fica.push({ inicio: cursor, fim: c.inicio });
    cursor = Math.max(cursor, c.fim);
  }
  if (duracao - cursor >= 0.05) fica.push({ inicio: cursor, fim: duracao });
  if (!fica.length) return null; // o vídeo inteiro é silêncio: não corta nada
  return { trechos: fica, removido: Math.round(removido * 10) / 10 };
}

/** O filtro que junta os trechos de fala (vídeo e áudio cortados juntos). */
function grafoDosTrechos(trechos) {
  const n = trechos.length;
  const r = x => Math.round(x * 1000) / 1000;
  const v = trechos.map((_, i) => `[v${i}]`).join(''), a = trechos.map((_, i) => `[a${i}]`).join('');
  const partes = [`[0:v]split=${n}${v}`, `[0:a]asplit=${n}${a}`];
  trechos.forEach((t, i) => {
    partes.push(`[v${i}]trim=start=${r(t.inicio)}:end=${r(t.fim)},setpts=PTS-STARTPTS[vt${i}]`);
    partes.push(`[a${i}]atrim=start=${r(t.inicio)}:end=${r(t.fim)},asetpts=PTS-STARTPTS[at${i}]`);
  });
  partes.push(`${trechos.map((_, i) => `[vt${i}][at${i}]`).join('')}concat=n=${n}:v=1:a=1[vc][ac]`);
  return partes.join(';');
}

/**
 * Gera `destino` só com a fala (e já no trecho escolhido). Devolve
 * { removido, cortes } ou null quando não havia pausa que valesse cortar.
 */
async function cortarSilencios({ entrada, destino, config, info, aoIniciar }) {
  const p = SILENCIOS[config.silencios];
  if (!p || !info.temAudio) return null;
  const { antes, depois } = argsDoTrecho(config, info.duracao);
  const duracao = Math.max(0.1, (config.trecho.fim ?? info.duracao) - config.trecho.inicio);
  const deteccao = await rodar(FFMPEG_BIN, ['-hide_banner', '-nostats', ...antes, '-i', entrada, ...depois,
    '-vn', '-af', `silencedetect=noise=${p.ruido}dB:d=${p.minimo}`, '-f', 'null', '-'],
  { timeoutMs: 60_000 + duracao * 2000, aoIniciar, saidaDeErro: true });
  const fala = trechosDeFala(lerSilencios(deteccao, duracao), duracao, { folga: p.folga });
  if (!fala) return null;
  await rodar(FFMPEG_BIN, ['-hide_banner', '-v', 'error', '-y', ...antes, '-i', entrada, ...depois,
    '-filter_complex', grafoDosTrechos(fala.trechos), '-map', '[vc]', '-map', '[ac]',
    // Intermediário quase sem perda: os formatos são gerados a partir dele.
    '-c:v', 'libx264', '-crf', '14', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-threads', '2',
    '-c:a', 'aac', '-b:a', '256k', '-ar', '48000', '-map_metadata', '-1', destino],
  { timeoutMs: 120_000 + duracao * 10_000, aoIniciar });
  return { removido: fala.removido, cortes: fala.trechos.length - 1 };
}

/* ── Capa ───────────────────────────────────────────────────────────────── */

/** Quebra o título em linhas de até `max` caracteres, sem cortar palavra. */
function linhasDoTitulo(titulo, max = 16, maxLinhas = 4) {
  const linhas = [];
  for (const palavra of String(titulo || '').split(' ').filter(Boolean)) {
    const atual = linhas[linhas.length - 1];
    if (atual !== undefined && (atual + ' ' + palavra).length <= max) linhas[linhas.length - 1] = `${atual} ${palavra}`;
    else linhas.push(palavra.slice(0, max * 2));
  }
  return linhas.slice(0, maxLinhas);
}

/**
 * A capa 1080×1920 (JPG) a partir de um quadro do vídeo, com o título por
 * cima (uma linha por drawtext, centralizada; o texto vai por arquivo, então
 * nada do que a pessoa digitou vira sintaxe do filtro).
 */
async function gerarCapa({ entrada, destino, dir, config, duracao, aoIniciar }) {
  const capa = config.capa;
  const t = Math.min(Math.max(0, capa.segundo ?? Math.min(1, duracao * 0.1)), Math.max(0, duracao - 0.05));
  const filtrosCapa = ['scale=1080:1920:force_original_aspect_ratio=increase:flags=lanczos', 'crop=1080:1920'];
  const linhas = linhasDoTitulo(capa.titulo);
  const fonte = linhas.length ? require('./textoNoStory').acharFonte() : null;
  if (linhas.length && fonte) {
    const corpo = 96, entre = Math.round(corpo * 1.2), total = linhas.length * entre;
    const topo = capa.posicao === 'topo' ? 300 : capa.posicao === 'base' ? 1920 - 430 - total : Math.round((1920 - total) / 2);
    const esc = s => String(s).replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, '');
    linhas.forEach((linha, i) => {
      const arq = path.join(dir, `titulo-${i}.txt`);
      fs.writeFileSync(arq, linha);
      filtrosCapa.push(`drawtext=fontfile='${esc(fonte)}':textfile='${esc(arq)}':fontsize=${corpo}:fontcolor=white`
        + `:borderw=6:bordercolor=black@0.85:x=(w-text_w)/2:y=${topo + i * entre}`);
    });
  }
  try {
    await rodar(FFMPEG_BIN, ['-hide_banner', '-v', 'error', '-y', '-ss', String(Math.round(t * 1000) / 1000), '-i', entrada,
      '-frames:v', '1', '-vf', filtrosCapa.join(','), '-q:v', '2', '-map_metadata', '-1', destino],
    { timeoutMs: 60_000, aoIniciar });
  } finally {
    linhas.forEach((_, i) => fs.rmSync(path.join(dir, `titulo-${i}.txt`), { force: true }));
  }
}

/* ── Concorrência e cancelamento ────────────────────────────────────────── */

/* No máximo CONCORRENCIA arquivos processando ao mesmo tempo. Quem chega sem
   vaga volta para a fila com um atraso, em vez de ficar esperando DENTRO dela:
   a fila é a mesma das publicações, e trabalhos parados ocupariam as vagas de
   quem precisa publicar. */
let _ativos = 0;
const _emAndamento = new Map(); // preparoId → processo do ffmpeg
const ESPERA_SEM_VAGA_MS = 3000;

/* ── Banco ──────────────────────────────────────────────────────────────── */

const pastaDe = (usuarioId, id) => {
  const p = path.join(PASTA, String(usuarioId), String(id));
  if (!p.startsWith(PASTA + path.sep)) throw new Error('caminho inválido');
  return p;
};

function nomeBase(original) {
  const base = path.basename(String(original || 'arquivo')).replace(/\.[^.]+$/, '');
  return base.replace(/[\u0000-\u001f\u007f/\\:*?"<>|]+/g, '_').trim().slice(0, 80) || 'arquivo';
}

function avisar(usuarioId, dados) {
  try { require('../events/broadcaster').broadcast('preparos', dados, usuarioId); } catch { /* sem SSE nos testes */ }
}

async function porId(id) {
  const [r] = await sql`select * from preparos_de_midia where id = ${id}`;
  return r || null;
}

async function atualizar(id, campos) {
  const [r] = await sql`update preparos_de_midia set ${sql({ ...campos, atualizadoEm: new Date() })} where id = ${id} returning *`;
  return r || null;
}

/** O que a pessoa ainda pode enviar agora (fila e cota do dia). */
async function conferirCota(usuarioId) {
  const [{ naFila, hoje }] = await sql`
    select count(*) filter (where status in ('aguardando', 'processando'))::int as "naFila",
           count(*) filter (where criado_em > now() - interval '24 hours')::int as hoje
    from preparos_de_midia where usuario_id = ${usuarioId}`;
  if (naFila >= LIMITES.naFila) return `Já há ${naFila} arquivos na fila. Espere alguns terminarem.`;
  if (hoje >= LIMITES.porDia) return `Limite de ${LIMITES.porDia} arquivos em 24 horas atingido.`;
  try {
    fs.mkdirSync(PASTA, { recursive: true });
    const s = fs.statfsSync(PASTA);
    if (s.bavail * s.bsize < LIMITES.discoLivreMb * 1024 * 1024) return 'O servidor está sem espaço livre agora. Baixe e exclua resultados antigos, ou tente mais tarde.';
  } catch { /* statfs indisponível: segue */ }
  return null;
}

/**
 * Registra um arquivo já validado e o põe na fila. O arquivo temporário é
 * MOVIDO para a pasta do preparo.
 */
async function criar({ usuarioId, lote, nomeOriginal, temporario, validado, config }) {
  const id = crypto.randomUUID();
  const dir = pastaDe(usuarioId, id);
  fs.mkdirSync(dir, { recursive: true });
  const destino = path.join(dir, `original.${validado.ext}`);
  try { fs.renameSync(temporario, destino); }
  catch { fs.copyFileSync(temporario, destino); fs.rmSync(temporario, { force: true }); }

  const [r] = await sql`
    insert into preparos_de_midia ${sql({
      id, usuarioId, lote, nomeOriginal: String(nomeOriginal || 'arquivo').slice(0, 200), tipo: validado.tipo,
      bytes: validado.bytes, status: 'aguardando', info: sql.json({ ...validado.info, ext: validado.ext }),
      config: sql.json(config), expiraEm: new Date(Date.now() + LIMITES.validadeH * 3_600_000),
    })} returning *`;
  await require('../queue').enfileirar('preparo_midia', { id });
  avisar(usuarioId, { id, status: 'aguardando' });
  return r;
}

const recuperavel = err => !err.invalido && !err.cancelado && (err.sinal === 'SIGSEGV' || err.sinal === 'SIGBUS'
  || (err.sinal === 'SIGKILL' && !err.tempoEsgotado) || ['EAGAIN', 'ENOMEM', 'EMFILE'].includes(err.codigo));

/** O trabalho da fila: gera as saídas de um arquivo. */
async function processar({ id }) {
  if (_ativos >= LIMITES.concorrencia) {
    await require('../queue').enfileirar('preparo_midia', { id }, { atrasoMs: ESPERA_SEM_VAGA_MS });
    return;
  }
  _ativos++;
  try { await _processar(id); } finally { _ativos--; }
}

async function _processar(id) {
  let r = await porId(id);
  if (!r || !['aguardando', 'processando'].includes(r.status)) return;
  const dir = pastaDe(r.usuarioId, r.id);
  const original = path.join(dir, `original.${r.info.ext}`);
  if (!fs.existsSync(original)) {
    await atualizar(id, { status: 'erro', erro: 'O arquivo enviado não está mais no servidor. Envie de novo.' });
    return avisar(r.usuarioId, { id, status: 'erro' });
  }
  const config = normalizarConfig(r.config);
  const video = r.tipo === 'video';
  const fazCapa = video && config.capa.ativa;
  const total = config.formatos.length + (fazCapa ? 1 : 0);
  const saidas = [];
  r = await atualizar(id, { status: 'processando', erro: '', saidas: sql.json([]), tentativas: (r.tentativas || 0) + 1 });
  avisar(r.usuarioId, { id, status: 'processando', feitas: 0, total });
  const cancelado = async () => { const a = await porId(id); return !a || a.status === 'cancelado'; };
  const registrar = filho => _emAndamento.set(id, filho);

  /* O logo da pessoa (Minha Conta / esta tela), se ela pediu e tem um. */
  const logoRel = config.logo.ativa ? await require('./logoDoUsuario').ler(r.usuarioId) : null;
  const logo = logoRel ? { ...config.logo, arquivo: require('./logoDoUsuario').absoluto(logoRel) } : null;

  /* 1. Pausas fora (vídeo com fala). Os formatos saem do vídeo já cortado — e
        já no trecho escolhido, então o trecho não se aplica de novo. */
  let entrada = original, configDosFormatos = config, infoDosFormatos = r.info;
  const cortado = path.join(dir, 'sem-pausas.mp4');
  if (video && config.silencios !== 'desligado') {
    try {
      const corte = await cortarSilencios({ entrada: original, destino: cortado, config, info: r.info, aoIniciar: registrar });
      if (corte) {
        entrada = cortado;
        configDosFormatos = { ...config, trecho: { inicio: 0, fim: null } };
        const sonda = await sondar(cortado).catch(() => null);
        infoDosFormatos = { ...r.info, ...(sonda ? { duracao: sonda.duracao, fps: sonda.fps } : {}) };
        r = await atualizar(id, { info: sql.json({ ...r.info, silencios: corte }) });
      }
    } catch (err) {
      if (err.cancelado) return;
      // Sem o corte o vídeo sai inteiro — melhor que não sair.
      console.log(`⚠️  [Variações] ${id} corte de pausas falhou: ${err.message}`);
    } finally { _emAndamento.delete(id); }
    if (await cancelado()) return;
  }

  /* 2. Um arquivo por formato. */
  for (const [i, formato] of config.formatos.entries()) {
    if (await cancelado()) return;
    const saidaId = crypto.randomUUID();
    const ext = extensaoDe(r.tipo, config);
    const arquivo = path.join(dir, `${saidaId}.${ext}`);
    const args = argumentos({ entrada, saida: arquivo, config: configDosFormatos, formato, tipo: r.tipo, info: infoDosFormatos, logo });
    const duracao = video ? Math.max(0.1, (configDosFormatos.trecho.fim ?? infoDosFormatos.duracao) - configDosFormatos.trecho.inicio) : 0;
    const timeoutMs = video ? 120_000 + Math.ceil(duracao * 10_000) : 90_000;

    let erro = null;
    for (let tentativa = 1; tentativa <= 2; tentativa++) {
      try {
        await rodar(FFMPEG_BIN, args, { timeoutMs, aoIniciar: registrar });
        erro = null;
        break;
      } catch (err) {
        erro = err;
        if (err.cancelado || !recuperavel(err)) break;
      } finally {
        _emAndamento.delete(id);
      }
    }
    if (erro?.cancelado) return;

    const item = { id: saidaId, formato, rotulo: FORMATOS[formato].rotulo, ext, nome: `${nomeBase(r.nomeOriginal)} - ${FORMATOS[formato].curto}.${ext}` };
    if (erro) {
      fs.rmSync(arquivo, { force: true });
      item.erro = erro.tempoEsgotado ? 'Demorou demais para processar.' : 'Não foi possível gerar este formato.';
      console.log(`⚠️  [Variações] ${id} ${formato}: ${erro.message}`);
    } else {
      try {
        const info = await sondar(arquivo);
        Object.assign(item, { bytes: fs.statSync(arquivo).size, largura: info.largura, altura: info.altura, duracao: info.duracao });
      } catch { item.bytes = fs.existsSync(arquivo) ? fs.statSync(arquivo).size : 0; }
      if (video) {
        const mini = path.join(dir, `${saidaId}.mini.jpg`);
        if (await require('./miniaturaDeVideo').gerarMiniatura(arquivo, mini)) item.miniatura = true;
      }
    }
    saidas.push(item);
    await atualizar(id, { saidas: sql.json(saidas) });
    avisar(r.usuarioId, { id, status: 'processando', feitas: i + 1, total });
  }

  /* 3. A capa (opcional), do vídeo já cortado. */
  if (fazCapa && !(await cancelado())) {
    const saidaId = crypto.randomUUID();
    const arquivo = path.join(dir, `${saidaId}.jpg`);
    const item = { id: saidaId, formato: 'capa', rotulo: 'Capa 9:16', ext: 'jpg', nome: `${nomeBase(r.nomeOriginal)} - capa.jpg` };
    try {
      await gerarCapa({ entrada, destino: arquivo, dir, config, duracao: infoDosFormatos.duracao || 1, aoIniciar: registrar });
      Object.assign(item, { bytes: fs.statSync(arquivo).size, largura: 1080, altura: 1920 });
    } catch (err) {
      if (err.cancelado) return;
      fs.rmSync(arquivo, { force: true });
      item.erro = 'Não foi possível gerar a capa.';
      console.log(`⚠️  [Variações] ${id} capa: ${err.message}`);
    } finally { _emAndamento.delete(id); }
    saidas.push(item);
    await atualizar(id, { saidas: sql.json(saidas) });
    avisar(r.usuarioId, { id, status: 'processando', feitas: total, total });
  }

  const ok = saidas.filter(s => !s.erro).length;
  if (await cancelado()) return;
  fs.rmSync(original, { force: true }); // o original (e o intermediário) não são mais necessários
  fs.rmSync(cortado, { force: true });
  await atualizar(id, {
    status: ok ? 'concluido' : 'erro',
    erro: ok === saidas.length ? '' : ok ? `${saidas.length - ok} de ${saidas.length} arquivo(s) falharam.` : 'Nenhum formato pôde ser gerado.',
  });
  avisar(r.usuarioId, { id, status: ok ? 'concluido' : 'erro' });
}

/** Cancela o que ainda não terminou. Devolve quantos foram cancelados. */
async function cancelar(usuarioId, ids) {
  const linhas = await sql`
    select id from preparos_de_midia
    where usuario_id = ${usuarioId} and id = any(${ids}::uuid[]) and status in ('aguardando', 'processando')`;
  for (const { id } of linhas) {
    await sql`update preparos_de_midia set status = 'cancelado', erro = 'Cancelado.', atualizado_em = now() where id = ${id}`;
    await require('../queue').cancelarPorDados('preparo_midia', 'id', id);
    const filho = _emAndamento.get(id);
    if (filho) { filho._cancelado = true; try { filho.kill('SIGKILL'); } catch { /* já terminou */ } }
    fs.rmSync(pastaDe(usuarioId, id), { recursive: true, force: true });
    avisar(usuarioId, { id, status: 'cancelado' });
  }
  return linhas.length;
}

/** Exclui (cancela antes, se preciso) e apaga os arquivos. */
async function excluir(usuarioId, ids) {
  await cancelar(usuarioId, ids);
  const linhas = await sql`delete from preparos_de_midia where usuario_id = ${usuarioId} and id = any(${ids}::uuid[]) returning id`;
  for (const { id } of linhas) fs.rmSync(pastaDe(usuarioId, id), { recursive: true, force: true });
  if (linhas.length) avisar(usuarioId, { action: 'excluidos', ids: linhas.map(l => l.id) });
  return linhas.length;
}

/**
 * Uma saída da pessoa, pronta para baixar: { linha, saida, caminho } ou null.
 * Confere dono, validade e que o arquivo existe.
 */
async function saidaDoUsuario(usuarioId, saidaId) {
  if (!/^[0-9a-f-]{36}$/i.test(String(saidaId))) return null;
  const [linha] = await sql`
    select * from preparos_de_midia
    where usuario_id = ${usuarioId} and saidas @> ${sql.json([{ id: saidaId }])} and status <> 'expirado'`;
  if (!linha) return null;
  const saida = (linha.saidas || []).find(s => s.id === saidaId);
  if (!saida || saida.erro) return null;
  const caminho = path.join(pastaDe(usuarioId, linha.id), `${saida.id}.${saida.ext}`);
  if (!fs.existsSync(caminho)) return null;
  return { linha, saida, caminho, miniatura: path.join(pastaDe(usuarioId, linha.id), `${saida.id}.mini.jpg`) };
}

async function marcarBaixadas(usuarioId, saidaIds) {
  const ids = new Set(saidaIds);
  if (!ids.size) return;
  const linhas = await sql`
    select id, saidas from preparos_de_midia
    where usuario_id = ${usuarioId} and exists (
      select 1 from jsonb_array_elements(saidas) s where s->>'id' = any(${[...ids]}))`;
  const agora = new Date().toISOString();
  for (const l of linhas) {
    const novas = l.saidas.map(s => (ids.has(s.id) && !s.baixadoEm ? { ...s, baixadoEm: agora } : s));
    await sql`update preparos_de_midia set saidas = ${sql.json(novas)} where id = ${l.id}`;
  }
}

/**
 * Expira o que passou da validade (apaga os arquivos, a linha fica como
 * histórico) e apaga o histórico com mais de 30 dias e pastas sem dono.
 */
async function limpar({ agora = new Date() } = {}) {
  const vencidos = await sql`
    update preparos_de_midia set status = 'expirado', atualizado_em = now()
    where expira_em < ${agora} and status not in ('expirado', 'processando')
    returning id, usuario_id`;
  for (const v of vencidos) {
    await require('../queue').cancelarPorDados('preparo_midia', 'id', v.id).catch(() => {});
    try { fs.rmSync(pastaDe(v.usuarioId, v.id), { recursive: true, force: true }); }
    catch (err) { console.log(`⚠️  [Variações] não apagou ${v.id}: ${err.message}`); }
  }
  const limite = new Date(agora.getTime() - LIMITES.historicoDias * 86_400_000);
  const velhos = await sql`delete from preparos_de_midia where criado_em < ${limite} returning id, usuario_id`;
  for (const v of velhos) fs.rmSync(pastaDe(v.usuarioId, v.id), { recursive: true, force: true });

  /* Pastas sem linha (upload interrompido no meio, linha excluída à mão). */
  let orfas = 0;
  try {
    const conhecidos = new Set((await sql`select id::text from preparos_de_midia`).map(x => x.id));
    for (const u of fs.readdirSync(PASTA, { withFileTypes: true })) {
      if (!u.isDirectory()) continue;
      for (const p of fs.readdirSync(path.join(PASTA, u.name), { withFileTypes: true })) {
        if (!p.isDirectory() || conhecidos.has(p.name)) continue;
        const caminho = path.join(PASTA, u.name, p.name);
        if (agora.getTime() - fs.statSync(caminho).mtimeMs > 3_600_000) { fs.rmSync(caminho, { recursive: true, force: true }); orfas++; }
      }
    }
  } catch { /* pasta ainda não existe */ }
  if (vencidos.length || velhos.length || orfas) {
    console.log(`🧹 [Variações] ${vencidos.length} expirado(s), ${velhos.length} do histórico, ${orfas} pasta(s) órfã(s)`);
  }
  return { expirados: vencidos.length, historico: velhos.length, orfas };
}

let _timer = null;
function iniciarLimpeza() {
  if (_timer) return;
  const rodarLimpeza = () => limpar().catch(err => console.log('[Variações] limpeza falhou:', err.message));
  setTimeout(rodarLimpeza, 60_000);
  _timer = setInterval(rodarLimpeza, 15 * 60_000);
}

/**
 * Copia saídas prontas para a Biblioteca (pasta "Variações"), de onde o Postar
 * as usa — inclusive a capa, no seletor de capa. A cópia é da Biblioteca: não
 * expira junto com o resultado.
 * @returns {Promise<{enviados: object[], erros: string[]}>}
 */
async function enviarParaBiblioteca(usuarioId, saidaIds) {
  const { media } = require('../repos');
  const enviados = [], erros = [];
  const marcadas = new Set();
  for (const saidaId of saidaIds) {
    const s = await saidaDoUsuario(usuarioId, saidaId);
    if (!s) { erros.push(`${saidaId}: não encontrado ou expirado`); continue; }
    const nome = `variacao_${Date.now()}_${crypto.randomBytes(4).toString('hex')}.${s.saida.ext}`;
    fs.copyFileSync(s.caminho, path.join(UPLOADS, nome));
    const video = s.saida.ext === 'mp4';
    const item = await media.de(usuarioId).insert({
      filename: nome, originalName: s.saida.nome, path: nome, url: `/uploads/${nome}`,
      mimeType: { mp4: 'video/mp4', jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }[s.saida.ext] || 'application/octet-stream',
      size: fs.statSync(path.join(UPLOADS, nome)).size, type: video ? 'video' : 'image', folder: 'Variações',
    });
    if (video) require('./miniaturaDeVideo').garantirMiniatura(UPLOADS, nome).catch(() => {});
    enviados.push(item);
    marcadas.add(saidaId);
  }
  /* Marca na saída, para a tela mostrar "na Biblioteca ✓". */
  if (marcadas.size) {
    const linhas = await sql`
      select id, saidas from preparos_de_midia where usuario_id = ${usuarioId} and exists (
        select 1 from jsonb_array_elements(saidas) s where s->>'id' = any(${[...marcadas]}))`;
    for (const l of linhas) {
      await sql`update preparos_de_midia set saidas = ${sql.json(l.saidas.map(s => (marcadas.has(s.id) ? { ...s, naBiblioteca: true } : s)))} where id = ${l.id}`;
    }
  }
  if (enviados.length) {
    try { require('../events/broadcaster').broadcast('media', { action: 'adicionadas', n: enviados.length }, usuarioId); } catch { /* sem SSE */ }
  }
  return { enviados, erros };
}

let _ffmpegOk = null;
function ffmpegDisponivel() {
  if (_ffmpegOk === null) {
    try { require('child_process').execFileSync(FFMPEG_BIN, ['-version'], { stdio: 'ignore', timeout: 5000 }); _ffmpegOk = true; }
    catch { _ffmpegOk = false; }
  }
  return _ffmpegOk;
}

module.exports = {
  LIMITES, FORMATOS, ENQUADRAMENTOS, QUALIDADES, FORMATOS_FOTO, LARGURAS_ORIGINAL, PASTA,
  normalizarConfig, tipoPeloConteudo, orientacaoExif, validarArquivo, sondar, filtros, argumentos, nomeBase,
  conferirCota, criar, processar, cancelar, excluir, saidaDoUsuario, marcarBaixadas, limpar, iniciarLimpeza,
  lerSilencios, trechosDeFala, grafoDosTrechos, linhasDoTitulo, dimensoesDaSaida, enviarParaBiblioteca,
  ffmpegDisponivel, porId,
};
