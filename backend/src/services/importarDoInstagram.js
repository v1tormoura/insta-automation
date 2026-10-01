'use strict';

/**
 * Importar para a Biblioteca o que as CONTAS CONECTADAS já publicaram.
 *
 * Só pela API oficial: GET /{ig-user-id}/media lista as publicações da própria
 * conta, com `media_url` (o arquivo) e `children` nos carrosséis. A Meta só
 * entrega isso para contas autorizadas no app — perfis de terceiros não entram.
 *
 * O `media_url` expira em algumas horas, então a importação pede cada mídia
 * de novo na hora de baixar. Depois do download, a conversão opcional:
 *
 *   qualidade  original | 720 | 480 | 360   (menor lado do vídeo, sem ampliar)
 *              1080 | 2160 | 4320           (UPSCALE: re-renderiza maior, Lanczos +
 *                                            nitidez — não cria detalhe que não existe)
 *   formato    mp4 | webm | mp3             (mp3 = só o áudio)
 *
 * Imagens entram como vieram (JPEG). Roda na fila, mídia a mídia, avisando o
 * progresso pelo SSE ('media').
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ffmpeg = require('fluent-ffmpeg');
const { FFMPEG_BIN } = require('./ffmpegBin');
const { get } = require('./instagramAPI');

ffmpeg.setFfmpegPath(FFMPEG_BIN);

const UPLOADS = path.resolve(__dirname, '../../uploads');
const CAMPOS = 'id,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp,caption';
const QUALIDADES = ['original', '720', '480', '360', '1080', '2160', '4320'];
/** Resoluções que AMPLIAM o vídeo (a tela chama de upscale). */
const UPSCALE = ['1080', '2160', '4320'];
const FORMATOS = ['mp4', 'webm', 'mp3'];
/** Formato de saída das fotos (o `formato` acima vale para vídeo). */
const FORMATOS_FOTO = ['jpg', 'png', 'webp'];
const fotoValida = f => (FORMATOS_FOTO.includes(f) ? f : 'jpg');
/** Upscale de foto com IA: 'rapida' | 'maxima' (qualquer outra coisa = desligado). */
const iaValida = v => (['rapida', 'maxima'].includes(v) ? v : null);
const MIME = { mp4: 'video/mp4', webm: 'video/webm', mp3: 'audio/mpeg', jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
const MAX_POR_IMPORTACAO = 200;

function exigirConexao(conta) {
  if (!conta?.accessToken || !conta?.igUserId) {
    throw Object.assign(new Error(`@${conta?.username || '?'} não está conectada pela API oficial`), { status: 400 });
  }
}

const FILTROS = {
  reels: i => i.produto === 'REELS',
  fotos: i => i.tipo === 'IMAGE' || i.tipo === 'CAROUSEL_ALBUM',
};

/** Uma página das publicações da conta (`so`: 'reels' | 'fotos' — junta páginas até encher). */
async function listar(conta, { depois = null, limite = 24, somenteReels = false, so = somenteReels ? 'reels' : null } = {}) {
  exigirConexao(conta);
  const tamanho = Math.min(50, Math.max(1, Number(limite) || 24));
  const filtro = FILTROS[so];
  if (filtro) {
    const itens = [];
    let cursor = depois;
    for (let pagina = 0; pagina < 6; pagina++) {
      const r = await listar(conta, { depois: cursor, limite: 50 });
      itens.push(...r.itens.filter(filtro));
      cursor = r.depois;
      if (!cursor || itens.length >= tamanho) break;
    }
    return { itens, depois: cursor };
  }
  const d = await get(`/${conta.igUserId}/media`, {
    fields: `${CAMPOS},children{id,media_type,media_url,thumbnail_url}`,
    limit: tamanho,
    ...(depois ? { after: depois } : {}),
  }, conta.accessToken);
  const itens = (d?.data || []).map(m => ({
    id: String(m.id),
    tipo: m.media_type,                     // IMAGE | VIDEO | CAROUSEL_ALBUM
    produto: m.media_product_type || '',    // FEED | REELS | STORY
    miniatura: m.thumbnail_url || (m.media_type === 'IMAGE' ? m.media_url : '') || m.children?.data?.[0]?.thumbnail_url || m.children?.data?.[0]?.media_url || '',
    link: m.permalink || '',
    quando: m.timestamp || null,
    legenda: String(m.caption || '').slice(0, 140),
    itens: m.media_type === 'CAROUSEL_ALBUM' ? (m.children?.data?.length || 0) : 1,
  }));
  return { itens, depois: d?.paging?.next ? d?.paging?.cursors?.after || null : null };
}

/** Os arquivos de uma publicação (vários, se for carrossel), com URL fresca. */
async function arquivosDe(conta, mediaId) {
  const m = await get(`/${mediaId}`, { fields: `${CAMPOS},children{id,media_type,media_url}` }, conta.accessToken);
  if (m.media_type === 'CAROUSEL_ALBUM') {
    return (m.children?.data || []).filter(c => c.media_url).map((c, i) => ({ url: c.media_url, video: c.media_type === 'VIDEO', sufixo: `-${i + 1}` }));
  }
  return m.media_url ? [{ url: m.media_url, video: m.media_type === 'VIDEO', sufixo: '' }] : [];
}

async function baixar(url, destino) {
  const res = await fetch(url, { signal: AbortSignal.timeout(5 * 60_000) });
  if (!res.ok) throw new Error(`download recusado (HTTP ${res.status})`);
  fs.writeFileSync(destino, Buffer.from(await res.arrayBuffer()));
}

/**
 * Realce do upscale, na ordem que importa:
 *   1. hqdn3d  — tira o ruído e os blocos da compressão ANTES de ampliar
 *                (ampliado, o ruído vira mancha e a nitidez o realçaria);
 *   2. lanczos — amplia o menor lado até o alvo;
 *   3. cas     — nitidez adaptativa: reforça borda sem estourar o que já é nítido;
 *   4. eq      — um toque de contraste e cor, que é o que o olho lê como "mais definido".
 * Não inventa detalhe (isso só IA faz), mas o resultado fica visivelmente mais limpo e nítido.
 */
const REALCE_ANTES = 'hqdn3d=1.5:1.5:4:4';
const REALCE_DEPOIS = 'cas=0.7,eq=contrast=1.04:saturation=1.08';

/** Filtro de escala: o menor lado vira `alvo`, sem ampliar vídeo menor. */
function escala(alvo) {
  if (UPSCALE.includes(String(alvo))) {
    return `${REALCE_ANTES},scale='if(gt(iw,ih),-2,${alvo})':'if(gt(iw,ih),${alvo},-2)':flags=lanczos,${REALCE_DEPOIS}`;
  }
  return `scale='if(gt(iw,ih),-2,min(iw,${alvo}))':'if(gt(iw,ih),min(ih,${alvo}),-2)'`;
}

function converter(origem, destino, { qualidade, formato }) {
  return new Promise((resolve, reject) => {
    const cmd = ffmpeg(origem);
    if (formato === 'mp3') {
      cmd.noVideo().audioCodec('libmp3lame').audioBitrate('192k');
    } else {
      const opcoes = qualidade !== 'original' ? ['-vf', escala(qualidade)] : [];
      if (formato === 'webm') {
        cmd.videoCodec('libvpx-vp9').audioCodec('libopus')
          .outputOptions([...opcoes, '-b:v', '0', '-crf', '32', '-deadline', 'realtime', '-cpu-used', '8', '-row-mt', '1']);
      } else {
        cmd.videoCodec('libx264').audioCodec('aac')
          // No upscale, mais qualidade de codificação: o realce não pode ser comido pela compressão.
          .outputOptions([...opcoes, '-crf', UPSCALE.includes(String(qualidade)) ? '17' : '20',
            '-preset', UPSCALE.includes(String(qualidade)) && qualidade !== '4320' ? 'medium' : 'veryfast',
            '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
            ...(qualidade === '4320' ? ['-x264-params', 'level=6.2'] : [])]);
      }
    }
    cmd.on('end', resolve).on('error', reject).save(destino);
  });
}

/**
 * Importa as publicações escolhidas para a Biblioteca do usuário.
 * @returns {Promise<{importados: object[], erros: string[]}>}
 */
async function importar({ usuarioId, conta, ids, qualidade = 'original', formato = 'mp4', formatoFoto = 'jpg', ia = null, pasta = 'Importados', aoProgredir }) {
  formatoFoto = fotoValida(formatoFoto);
  ia = iaValida(ia);
  exigirConexao(conta);
  if (!QUALIDADES.includes(String(qualidade))) qualidade = 'original';
  if (!FORMATOS.includes(formato)) formato = 'mp4';
  const lista = [...new Set((ids || []).map(String))].slice(0, MAX_POR_IMPORTACAO);
  const { media } = require('../repos');
  const importados = [], erros = [];
  const dir = path.join(UPLOADS, 'importados');
  fs.mkdirSync(dir, { recursive: true });

  for (const [i, id] of lista.entries()) {
    try {
      for (const arq of await arquivosDe(conta, id)) {
        const base = `${conta.username}-${id}${arq.sufixo}-${crypto.randomBytes(3).toString('hex')}`;
        const bruto = path.join(dir, `${base}.${arq.video ? 'mp4' : 'jpg'}`);
        await baixar(arq.url, bruto);

        let final = bruto;
        if (arq.video && (qualidade !== 'original' || formato !== 'mp4')) {
          final = path.join(dir, `${base}-${formato === 'mp3' ? 'audio' : qualidade}.${formato}`);
          await converter(bruto, final, { qualidade, formato });
          fs.rmSync(bruto, { force: true });
        } else if (!arq.video && (qualidade !== 'original' || formatoFoto !== 'jpg' || ia)) {
          final = path.join(dir, `${base}-${ia ? 'ia-' : ''}${qualidade}.${formatoFoto}`);
          await tratarFoto(bruto, final, { qualidade, formatoFoto, ia });
          fs.rmSync(bruto, { force: true });
        }

        const nome = path.relative(UPLOADS, final).split(path.sep).join('/');
        const ext = path.extname(final).slice(1);
        const mime = MIME[ext] || 'application/octet-stream';
        const item = await media.de(usuarioId).insert({
          filename: nome, originalName: `@${conta.username} · ${id}${arq.sufixo}.${ext}`,
          path: nome, url: `/uploads/${nome}`, mimeType: mime, size: fs.statSync(final).size,
          type: mime.startsWith('video/') ? 'video' : mime.startsWith('image/') ? 'image' : 'other',
          folder: String(pasta || 'Importados').slice(0, 60),
        });
        importados.push(item);
        if (item.type === 'video') {
          require('./miniaturaDeVideo').garantirMiniatura(UPLOADS, nome).catch(() => {});
        }
      }
    } catch (err) {
      erros.push(`${id}: ${err.message}`);
      console.log(`⚠️ [Importar] @${conta.username} ${id}: ${err.message}`);
    }
    aoProgredir?.({ feitas: i + 1, total: lista.length, importados: importados.length, erros: erros.length });
  }
  return { importados, erros };
}

/* ── Um arquivo local → Biblioteca, com qualidade/upscale/formato ─────────── */

/**
 * A foto no tamanho e formato pedidos — com `ia`, a rede (Real-ESRGAN) faz a
 * ampliação/restauração e o ffmpeg só converte para o formato final.
 */
async function tratarFoto(origem, destino, { qualidade, formatoFoto, ia }) {
  if (!ia) return converterImagem(origem, destino, qualidade, formatoFoto);
  const tmp = `${destino}.ia.png`;
  try {
    await require('./upscaleIA').melhorar(origem, tmp, ia, qualidade === 'original' ? 'original' : qualidade);
    await converterImagem(tmp, destino, 'original', formatoFoto);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

/** Imagem: redimensiona (inclusive upscale) e salva em JPG, PNG ou WEBP. */
function converterImagem(origem, destino, qualidade, formatoFoto = 'jpg') {
  return new Promise((resolve, reject) => {
    const opcoes = qualidade !== 'original' ? ['-vf', escala(qualidade)] : [];
    const porFormato = { jpg: ['-q:v', '2'], png: ['-compression_level', '6'], webp: ['-c:v', 'libwebp', '-quality', '90'] }[formatoFoto] || [];
    ffmpeg(origem).outputOptions([...opcoes, '-frames:v', '1', ...porFormato]).on('end', resolve).on('error', reject).save(destino);
  });
}

/**
 * Processa um arquivo já no disco e grava na Biblioteca.
 * @returns {Promise<object>} a linha nova de `media`
 */
async function processar({ usuarioId, bruto, video, base, rotulo, qualidade, formato, formatoFoto = 'jpg', ia = null, pasta, pastaDisco = 'convertidos', manterBruto = false }) {
  formatoFoto = fotoValida(formatoFoto);
  ia = iaValida(ia);
  const dir = path.join(UPLOADS, pastaDisco);
  fs.mkdirSync(dir, { recursive: true });
  let final = bruto, ext;
  if (video) {
    if (qualidade !== 'original' || formato !== 'mp4' || !/\.mp4$/i.test(bruto)) {
      ext = formato;
      final = path.join(dir, `${base}-${formato === 'mp3' ? 'audio' : qualidade}-${crypto.randomBytes(3).toString('hex')}.${ext}`);
      await converter(bruto, final, { qualidade, formato });
    } else ext = 'mp4';
  } else {
    ext = formatoFoto;
    const jaNoFormato = formatoFoto === 'jpg' ? /\.jpe?g$/i.test(bruto) : bruto.toLowerCase().endsWith(`.${formatoFoto}`);
    if (qualidade !== 'original' || !jaNoFormato || ia) {
      final = path.join(dir, `${base}-${ia ? 'ia-' : ''}${qualidade}-${crypto.randomBytes(3).toString('hex')}.${formatoFoto}`);
      await tratarFoto(bruto, final, { qualidade, formatoFoto, ia });
    }
  }
  if (final === bruto && manterBruto) throw new Error('nada a converter — escolha outra qualidade ou formato');
  if (final !== bruto && !manterBruto) fs.rmSync(bruto, { force: true });
  const nome = path.relative(UPLOADS, final).split(path.sep).join('/');
  const mime = MIME[ext] || 'application/octet-stream';
  const { media } = require('../repos');
  const item = await media.de(usuarioId).insert({
    filename: nome, originalName: `${rotulo}.${ext}`, path: nome, url: `/uploads/${nome}`, mimeType: mime,
    size: fs.statSync(final).size,
    type: mime.startsWith('video/') ? 'video' : mime.startsWith('image/') ? 'image' : 'other',
    folder: String(pasta || 'Importados').slice(0, 60),
  });
  if (item.type === 'video') require('./miniaturaDeVideo').garantirMiniatura(UPLOADS, nome).catch(() => {});
  return item;
}

/* ── Por URL ────────────────────────────────────────────────────────────────
   Dois tipos de link, e só eles:
     • publicação de uma conta CONECTADA (instagram.com/p|reel/CÓDIGO) —
       achada na lista da própria conta, pela API oficial;
     • link DIRETO de um arquivo (resposta video/* ou image/*).
   Página de perfil ou post de terceiros não é raspada. */

const dns = require('dns').promises;
const net = require('net');

function ipPrivado(ip) {
  if (net.isIPv6(ip)) return ip === '::1' || /^f[cd]/i.test(ip) || /^fe80/i.test(ip) || ip.startsWith('::ffff:127.');
  const [a, b] = ip.split('.').map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

async function conferirDestino(url) {
  let u;
  try { u = new URL(url); } catch { throw new Error('URL inválida'); }
  if (!/^https?:$/.test(u.protocol)) throw new Error('Use um link http ou https');
  const ips = await dns.lookup(u.hostname, { all: true }).catch(() => []);
  if (!ips.length || ips.some(x => ipPrivado(x.address))) throw new Error('Endereço não permitido');
  return u;
}

/**
 * O @ de um link de perfil (instagram.com/fulano/), de "@fulano" ou de "fulano".
 * Link de publicação (/p/, /reel/…) ou de outra página não é perfil → null.
 */
function usernameDoPerfil(entrada) {
  const t = String(entrada || '').trim();
  const direto = /^@?([A-Za-z0-9._]{1,30})$/.exec(t);
  if (direto) return direto[1].toLowerCase();
  let u;
  try { u = new URL(/^https?:\/\//i.test(t) ? t : `https://${t}`); } catch { return null; }
  if (!/(^|\.)instagram\.com$/i.test(u.hostname)) return null;
  const partes = u.pathname.split('/').filter(Boolean);
  if (partes.length < 1 || partes.length > 2 || (partes[1] && !/^reels?$/i.test(partes[1]))) return null;
  const nome = partes[0];
  if (/^(p|reel|reels|tv|stories|explore|accounts|direct)$/i.test(nome) || !/^[A-Za-z0-9._]{1,30}$/.test(nome)) return null;
  return nome.toLowerCase();
}

/**
 * Perfil → conta que o app pode ler: só as conectadas pela API oficial (a do
 * próprio usuário ou a de quem autorizou pelo link guiado). Qualquer outro
 * perfil não é acessível e volta null.
 */
function contaDoPerfil(contas, entrada) {
  const nome = usernameDoPerfil(entrada);
  if (!nome) return { nome: null, conta: null };
  const conta = contas.find(c => String(c.username || '').toLowerCase() === nome && c.accessToken && c.igUserId) || null;
  return { nome, conta };
}

function codigoDoInstagram(url) {
  const m = /instagram\.com\/(?:[^/]+\/)?(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/i.exec(url);
  return m ? m[1] : null;
}

/** Acha a publicação pelo código do link nas contas conectadas do usuário. */
async function acharNasContas(contas, codigo) {
  for (const conta of contas.filter(c => c.accessToken && c.igUserId)) {
    let depois = null;
    for (let pagina = 0; pagina < 20; pagina++) {
      const d = await get(`/${conta.igUserId}/media`, { fields: 'id,permalink', limit: 50, ...(depois ? { after: depois } : {}) }, conta.accessToken).catch(() => null);
      const achada = (d?.data || []).find(m => String(m.permalink || '').includes(`/${codigo}`));
      if (achada) return { conta, mediaId: String(achada.id) };
      depois = d?.paging?.next ? d?.paging?.cursors?.after : null;
      if (!depois) break;
    }
  }
  return null;
}

async function importarUrl({ usuarioId, contas, url, qualidade = 'original', formato = 'mp4', formatoFoto = 'jpg', ia = null, pasta = 'Importados' }) {
  if (!QUALIDADES.includes(String(qualidade))) qualidade = 'original';
  if (!FORMATOS.includes(formato)) formato = 'mp4';
  const codigo = codigoDoInstagram(url);
  if (codigo) {
    const achado = await acharNasContas(contas, codigo);
    if (!achado) throw new Error('Essa publicação não é de nenhuma das suas contas conectadas.');
    return importar({ usuarioId, conta: achado.conta, ids: [achado.mediaId], qualidade, formato, formatoFoto, ia, pasta });
  }
  if (/instagram\.com|tiktok\.com|youtube\.com|youtu\.be|facebook\.com|fb\.watch|kwai|twitter\.com|x\.com/i.test(url)) {
    throw new Error('Link de página de rede social não é aceito. Use o link de uma publicação das suas contas conectadas ou o link direto do arquivo.');
  }
  await conferirDestino(url);
  const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(5 * 60_000) });
  if (!res.ok) throw new Error(`o link respondeu HTTP ${res.status}`);
  const tipo = String(res.headers.get('content-type') || '');
  const video = tipo.startsWith('video/'), imagem = tipo.startsWith('image/');
  if (!video && !imagem) throw new Error('O link não é de um vídeo ou de uma imagem.');
  const tamanho = Number(res.headers.get('content-length') || 0);
  if (tamanho > 500 * 1024 * 1024) throw new Error('Arquivo maior que 500 MB.');
  const dir = path.join(UPLOADS, 'importados');
  fs.mkdirSync(dir, { recursive: true });
  const base = `link-${crypto.randomBytes(4).toString('hex')}`;
  const bruto = path.join(dir, `${base}.${video ? (/webm/.test(tipo) ? 'webm' : /quicktime/.test(tipo) ? 'mov' : 'mp4') : (/png/.test(tipo) ? 'png' : /webp/.test(tipo) ? 'webp' : 'jpg')}`);
  fs.writeFileSync(bruto, Buffer.from(await res.arrayBuffer()));
  const nomeNoLink = decodeURIComponent(new URL(url).pathname.split('/').pop() || base).replace(/\.[^.]+$/, '').slice(0, 60) || base;
  const item = await processar({ usuarioId, bruto, video, base, rotulo: nomeNoLink, qualidade, formato, formatoFoto, ia, pasta, pastaDisco: 'importados' });
  return { importados: [item], erros: [] };
}

/**
 * Converte vídeos que JÁ estão na Biblioteca (aba "Converter vídeo" e
 * "Extrair áudio"): cada um vira um arquivo novo, o original fica.
 */
/** Tira um item da Biblioteca: a linha, o arquivo e a miniatura. */
async function removerDaBiblioteca(usuarioId, item) {
  const { media } = require('../repos');
  const { nomeDaMiniatura } = require('./miniaturaDeVideo');
  await media.de(usuarioId).remove(item.id);
  if (!item.filename || item.filename.startsWith('__folder_')) return;
  for (const nome of [item.filename, nomeDaMiniatura(item.filename)]) {
    const alvo = path.resolve(UPLOADS, nome);
    if (alvo.startsWith(UPLOADS + path.sep)) fs.rmSync(alvo, { force: true });
  }
}

/**
 * `substituir`: o convertido toma o lugar do original (upload + conversão —
 * não sobra o arquivo antigo na Biblioteca).
 */
async function converterDaBiblioteca({ usuarioId, ids, qualidade = 'original', formato = 'mp4', formatoFoto = 'jpg', ia = null, pasta = 'Convertidos', substituir = false, aoProgredir }) {
  formatoFoto = fotoValida(formatoFoto);
  ia = iaValida(ia);
  if (!QUALIDADES.includes(String(qualidade))) qualidade = 'original';
  if (!FORMATOS.includes(formato)) formato = 'mp4';
  const { media } = require('../repos');
  const convertidos = [], erros = [];
  const lista = [...new Set((ids || []).map(String))].slice(0, MAX_POR_IMPORTACAO);
  const dir = path.join(UPLOADS, 'convertidos');
  fs.mkdirSync(dir, { recursive: true });
  for (const [i, id] of lista.entries()) {
    try {
      const item = await media.de(usuarioId).findById(id);
      const ehVideo = item && (item.type === 'video' || /\.(mp4|mov|webm|m4v|mkv)$/i.test(item.filename));
      const ehFoto = item && !ehVideo && (item.type === 'image' || /\.(jpe?g|png|webp)$/i.test(item.filename));
      if (!item || (!ehVideo && !ehFoto)) throw new Error('não é um vídeo ou foto da sua Biblioteca');
      const origem = path.resolve(UPLOADS, item.filename);
      if (!origem.startsWith(UPLOADS + path.sep) || !fs.existsSync(origem)) throw new Error('arquivo não encontrado');
      const base = path.basename(item.filename).replace(/\.[^.]+$/, '');
      const nomeBase = (item.originalName || base).replace(/\.[^.]+$/, '');
      const sufixo = (ehVideo && formato === 'mp3' ? 'áudio' : qualidade === 'original' ? (ehVideo ? formato : formatoFoto).toUpperCase() : `${qualidade}p`)
        + (ia && ehFoto ? ' · IA' : '');
      let novo = null;
      try {
        novo = await processar({
          usuarioId, bruto: origem, video: ehVideo, base, rotulo: substituir ? nomeBase : `${nomeBase} (${sufixo})`,
          qualidade, formato, formatoFoto, ia, pasta: pasta || 'Convertidos', manterBruto: true,
        });
      } catch (err) {
        // Substituindo, "nada a converter" só quer dizer que o original já serve.
        if (!(substituir && /nada a converter/.test(err.message))) throw err;
      }
      if (novo && substituir) await removerDaBiblioteca(usuarioId, item);
      convertidos.push(novo || item);
    } catch (err) {
      erros.push(`${id}: ${err.message}`);
    }
    aoProgredir?.({ feitas: i + 1, total: lista.length, importados: convertidos.length, erros: erros.length });
  }
  return { importados: convertidos, erros };
}

module.exports = { listar, usernameDoPerfil, contaDoPerfil, importar, importarUrl, converterDaBiblioteca, removerDaBiblioteca, processar, codigoDoInstagram, _ipPrivado: ipPrivado, arquivosDe, escala, _converter: converter, QUALIDADES, UPSCALE, FORMATOS, FORMATOS_FOTO, MAX_POR_IMPORTACAO };
