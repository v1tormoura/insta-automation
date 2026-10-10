'use strict';

/**
 * Variações de Mídia (ver services/preparoDeMidia.js).
 *
 *   GET    /preparos/config               formatos, limites, se o ffmpeg está instalado
 *   POST   /preparos/arquivos             envia UM arquivo (multipart: arquivo, lote, config)
 *   GET    /preparos?pagina=              lista (o que ainda não expirou)
 *   GET    /preparos/historico            envios dos últimos 30 dias, por lote
 *   GET    /preparos/saidas/:id           baixa uma saída (?inline=1 para pré-visualizar)
 *   GET    /preparos/saidas/:id/miniatura miniatura de uma saída
 *   POST   /preparos/zip                  { saidas: [ids] } → { url } (vale 10 min)
 *   GET    /preparos/zip/:pedido          baixa o .zip
 *   POST   /preparos/biblioteca           { saidas: [ids] } — copia para a Biblioteca (pasta "Variações")
 *   POST   /preparos/cancelar             { ids: [ids] }
 *   DELETE /preparos                      { ids: [ids] } — exclui (e cancela antes)
 *
 * Tudo filtrado pelo usuário logado: um id de outra pessoa responde 404, igual
 * a um id que não existe.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const router = require('express').Router();
const multer = require('multer');
const archiver = require('archiver');
const { sql } = require('../db');
const preparo = require('../services/preparoDeMidia');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TMP = path.resolve(__dirname, '../../uploads/tmp/preparos');

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => { fs.mkdirSync(TMP, { recursive: true }); cb(null, TMP); },
    // Nome aleatório: nada do nome enviado chega ao disco.
    filename: (_req, _file, cb) => cb(null, `${crypto.randomUUID()}.tmp`),
  }),
  limits: {
    fileSize: Math.max(preparo.LIMITES.videoMb, preparo.LIMITES.imagemMb) * 1024 * 1024,
    files: 1, fields: 4, fieldSize: 16 * 1024,
  },
});

const idsDe = lista => [...new Set((Array.isArray(lista) ? lista : []).map(String))].filter(x => UUID.test(x)).slice(0, 500);

function formatar(r) {
  return {
    id: r.id, lote: r.lote, nomeOriginal: r.nomeOriginal, tipo: r.tipo, bytes: Number(r.bytes) || 0,
    status: r.status, erro: r.erro || '', criadoEm: r.criadoEm, expiraEm: r.expiraEm, config: r.config,
    info: { largura: r.info?.largura || 0, altura: r.info?.altura || 0, duracao: r.info?.duracao || 0, silencios: r.info?.silencios || null, ia: r.info?.ia || null },
    saidas: (r.saidas || []).map(s => ({
      id: s.id, formato: s.formato, rotulo: s.rotulo, nome: s.nome, ext: s.ext, bytes: s.bytes || 0,
      largura: s.largura || 0, altura: s.altura || 0, duracao: s.duracao || 0,
      miniatura: !!s.miniatura, baixadoEm: s.baixadoEm || null, erro: s.erro || '', naBiblioteca: !!s.naBiblioteca,
    })),
  };
}

router.get('/config', (_req, res) => {
  const L = preparo.LIMITES;
  res.json({
    ffmpeg: preparo.ffmpegDisponivel(),
    // A IA das fotos (Real-ESRGAN) é opcional no servidor: a tela avisa quando falta.
    ia: require('../services/upscaleIA').disponivel(),
    limites: { videoMb: L.videoMb, imagemMb: L.imagemMb, duracaoS: L.duracaoS, naFila: L.naFila, validadeH: L.validadeH },
    formatos: Object.entries(preparo.FORMATOS).map(([id, f]) => ({ id, rotulo: f.rotulo, largura: f.largura, altura: f.altura })),
  });
});

router.post('/arquivos', (req, res) => {
  upload.single('arquivo')(req, res, async err => {
    const temporario = req.file?.path;
    const descartar = () => { if (temporario) fs.rmSync(temporario, { force: true }); };
    try {
      if (err) {
        descartar();
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(413).json({ code: 'GRANDE_DEMAIS', error: `Arquivo grande demais (máximo ${preparo.LIMITES.videoMb} MB).` });
        }
        return res.status(400).json({ code: 'ENVIO_INVALIDO', error: 'Envio inválido. Mande um arquivo por vez.' });
      }
      if (!temporario) return res.status(400).json({ code: 'SEM_ARQUIVO', error: 'Nenhum arquivo recebido.' });
      if (!preparo.ffmpegDisponivel()) {
        descartar();
        return res.status(503).json({ code: 'SEM_FFMPEG', error: 'O processador de mídia (ffmpeg) não está instalado no servidor.' });
      }
      const cota = await preparo.conferirCota(req.user.id);
      if (cota) { descartar(); return res.status(429).json({ code: 'LIMITE', error: cota }); }

      const config = preparo.normalizarConfig(req.body?.config);
      let validado;
      try { validado = await preparo.validarArquivo(temporario, { aplicarEm: config.aplicarEm }); }
      catch (e) {
        descartar();
        if (e.invalido) return res.status(422).json({ code: 'ARQUIVO_INVALIDO', error: e.message });
        throw e;
      }
      const lote = UUID.test(String(req.body?.lote || '')) ? req.body.lote : crypto.randomUUID();
      const r = await preparo.criar({
        usuarioId: req.user.id, lote, nomeOriginal: req.file.originalname, temporario, validado, config,
      });
      res.status(201).json({ item: formatar(r) });
    } catch (e) {
      descartar();
      console.error('❌ [Variações] envio:', e.message);
      res.status(500).json({ code: 'ERRO', error: 'Não foi possível receber o arquivo. Tente de novo.' });
    }
  });
});

router.get('/', async (req, res) => {
  const porPagina = Math.min(100, Math.max(5, Number(req.query.porPagina) || 20));
  const pagina = Math.max(1, Number(req.query.pagina) || 1);
  /* Uma leva só — a tela recarrega a cada arquivo que termina. O lote mais
     recente vem por subconsulta em vez de esperar a lista. */
  const [[{ total }], linhas, doLote] = await Promise.all([
    sql`select count(*)::int as total from preparos_de_midia where usuario_id = ${req.user.id} and status <> 'expirado'`,
    sql`
      select * from preparos_de_midia where usuario_id = ${req.user.id} and status <> 'expirado'
      order by criado_em desc, nome_original limit ${porPagina} offset ${(pagina - 1) * porPagina}`,
    /* "Baixar o último envio": todas as saídas prontas do lote mais recente. */
    sql`
      select lote, saidas, status from preparos_de_midia
      where usuario_id = ${req.user.id} and status <> 'expirado' and lote = (
        select lote from preparos_de_midia where usuario_id = ${req.user.id} and status <> 'expirado'
        order by criado_em desc limit 1)`,
  ]);
  let ultimoLote = null;
  if (doLote.length) {
    const prontas = doLote.flatMap(l => (l.saidas || []).filter(s => !s.erro).map(s => s.id));
    ultimoLote = { lote: doLote[0].lote, saidas: prontas, emAndamento: doLote.filter(l => ['aguardando', 'processando'].includes(l.status)).length };
  }
  res.json({ itens: linhas.map(formatar), total, pagina, porPagina, ultimoLote, validadeH: preparo.LIMITES.validadeH });
});

router.get('/historico', async (req, res) => {
  const lotes = await sql`
    select lote, min(criado_em) as quando, max(expira_em) as expira,
           count(*)::int as arquivos,
           count(*) filter (where status = 'concluido')::int as concluidos,
           count(*) filter (where status = 'erro')::int as erros,
           count(*) filter (where status = 'cancelado')::int as cancelados,
           count(*) filter (where status = 'expirado')::int as expirados,
           count(*) filter (where status in ('aguardando', 'processando'))::int as "emAndamento",
           coalesce(sum(jsonb_array_length(saidas)), 0)::int as saidas,
           coalesce(sum(bytes), 0)::bigint as bytes
    from preparos_de_midia where usuario_id = ${req.user.id}
    group by lote order by quando desc limit 60`;
  res.json({ lotes: lotes.map(l => ({ ...l, bytes: Number(l.bytes) })), historicoDias: preparo.LIMITES.historicoDias });
});

const TIPOS = { mp4: 'video/mp4', jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
const nomeSeguro = n => String(n || 'arquivo').replace(/[^\p{L}\p{N} ._()-]+/gu, '_').slice(0, 120);

router.get('/saidas/:id', async (req, res) => {
  const s = await preparo.saidaDoUsuario(req.user.id, req.params.id);
  if (!s) return res.status(404).json({ error: 'Arquivo não encontrado ou já expirou.' });
  res.type(TIPOS[s.saida.ext] || 'application/octet-stream');
  if (req.query.inline === '1') {
    res.setHeader('Content-Disposition', 'inline');
    return res.sendFile(s.caminho, { headers: { 'Cache-Control': 'private, max-age=600' } });
  }
  await preparo.marcarBaixadas(req.user.id, [s.saida.id]);
  res.download(s.caminho, nomeSeguro(s.saida.nome));
});

router.get('/saidas/:id/miniatura', async (req, res) => {
  const s = await preparo.saidaDoUsuario(req.user.id, req.params.id);
  if (!s) return res.status(404).end();
  const alvo = fs.existsSync(s.miniatura) ? s.miniatura : s.linha.tipo === 'imagem' ? s.caminho : null;
  if (!alvo) return res.status(404).end();
  res.sendFile(alvo, { headers: { 'Cache-Control': 'private, max-age=3600' } });
});

/* Pedidos de .zip: o navegador baixa por um GET comum (sem montar o arquivo
   inteiro na memória), e a lista de ids não cabe numa URL — então ela fica
   aqui por 10 minutos, presa ao usuário que pediu. */
const PEDIDOS = new Map();
const VALIDADE_PEDIDO_MS = 10 * 60_000;

router.post('/zip', async (req, res) => {
  const ids = idsDe(req.body?.saidas);
  const validas = [];
  for (const id of ids) {
    const s = await preparo.saidaDoUsuario(req.user.id, id);
    if (s) validas.push(id);
  }
  if (!validas.length) return res.status(404).json({ error: 'Nenhum arquivo pronto entre os selecionados.' });
  const agora = Date.now();
  for (const [k, p] of PEDIDOS) if (p.expira < agora) PEDIDOS.delete(k);
  const pedido = crypto.randomBytes(18).toString('base64url');
  PEDIDOS.set(pedido, { usuarioId: req.user.id, ids: validas, expira: agora + VALIDADE_PEDIDO_MS });
  res.json({ url: `/preparos/zip/${pedido}`, arquivos: validas.length });
});

router.get('/zip/:pedido', async (req, res) => {
  const p = PEDIDOS.get(String(req.params.pedido));
  if (!p || p.expira < Date.now() || p.usuarioId !== req.user.id) {
    return res.status(404).json({ error: 'Este link de download expirou. Peça o .zip de novo.' });
  }
  const itens = [];
  for (const id of p.ids) {
    const s = await preparo.saidaDoUsuario(req.user.id, id);
    if (s) itens.push(s);
  }
  if (!itens.length) return res.status(404).json({ error: 'Os arquivos expiraram.' });

  const quando = new Date().toLocaleString('sv-SE', { timeZone: process.env.TZ || 'America/Sao_Paulo' }).slice(0, 16).replace(' ', '_').replace(':', '');
  res.attachment(`variacoes-${quando}.zip`);
  /* `store`: vídeo e foto já são comprimidos; comprimir de novo só gasta CPU. */
  const zip = archiver('zip', { store: true });
  zip.on('error', err => { console.error('❌ [Variações] zip:', err.message); res.destroy(err); });
  zip.pipe(res);
  const usados = new Set();
  for (const s of itens) {
    let nome = nomeSeguro(s.saida.nome);
    for (let n = 2; usados.has(nome.toLowerCase()); n++) nome = nomeSeguro(s.saida.nome).replace(/(\.[^.]+)?$/, ` (${n})$1`);
    usados.add(nome.toLowerCase());
    zip.file(s.caminho, { name: nome });
  }
  res.on('finish', () => preparo.marcarBaixadas(req.user.id, itens.map(s => s.saida.id)).catch(() => {}));
  zip.finalize();
});

router.post('/biblioteca', async (req, res) => {
  const ids = idsDe(req.body?.saidas).slice(0, 200);
  if (!ids.length) return res.status(400).json({ error: 'Escolha os arquivos.' });
  const r = await preparo.enviarParaBiblioteca(req.user.id, ids);
  res.json({ enviados: r.enviados.length, erros: r.erros.length });
});

router.post('/cancelar', async (req, res) => {
  const n = await preparo.cancelar(req.user.id, idsDe(req.body?.ids));
  res.json({ cancelados: n });
});

router.delete('/', async (req, res) => {
  const n = await preparo.excluir(req.user.id, idsDe(req.body?.ids));
  res.json({ excluidos: n });
});

module.exports = router;
module.exports._pedidos = PEDIDOS;
