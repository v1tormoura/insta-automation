'use strict';

/** Postar: cria o envio, lista as publicações, a fila e o reprocessamento. */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { sql, ehUuid } = require('../db');
const { jobs, posts, comContas, accounts } = require('../repos');
const fila = require('../queue');
const filaDePostagens = require('../services/filaDePostagens');
const { agendarRodada } = require('../worker');
const { broadcast } = require('../events/broadcaster');
const { ordenar, naOrdemDosIds, ORDENS, ORDEM_PADRAO } = require('../services/ordemDasMidias');
const { lerDoCorpo: lerMarcaDagua } = require('../services/marcaDagua');
const { lerDoCorpo: lerVariacaoEdicao } = require('../services/variacaoDeEdicao');
const { lerDoCorpo: lerTrilha } = require('../services/trilhaPorConta');
const { lerDoCorpo: lerLegendaAleatoria } = require('../services/legendaAleatoria');
const { lerDoCorpo: lerCapasPorConta } = require('../services/capaPorConta');
const { aplicarNasContas: aplicarTetoDiario } = require('../services/tetoDiario');

const UPLOADS = path.resolve(__dirname, '../../uploads');
const ehVideo = nome => /\.(mp4|mov|webm|avi|mkv)$/i.test(nome || '');
const sim = v => v === true || v === 'true';

function lerJson(valor, padrao) {
  if (Array.isArray(valor)) return valor;
  try { return JSON.parse(valor || ''); } catch { return padrao; }
}

exports.createPost = async (req, res) => {
  const uid = req.user.id;
  const arquivos = req.files || [];
  const enviados = arquivos.filter(f => f.fieldname === 'media');
  const capa = arquivos.find(f => f.fieldname === 'cover') || null;

  // Mídias da biblioteca, na ordem em que foram escolhidas.
  const mediaIds = lerJson(req.body.mediaIds, []).map(String).filter(ehUuid);
  let daBiblioteca = [];
  if (mediaIds.length) {
    const docs = await sql`select id, filename, created_at from media where id = any(${mediaIds}::uuid[]) and usuario_id = ${uid}`;
    daBiblioteca = naOrdemDosIds(docs, mediaIds).map(d => ({ filename: d.filename, quando: d.createdAt }));
  }

  const midias = [...enviados, ...daBiblioteca];
  if (!midias.length) return res.status(400).json({ error: 'Nenhuma mídia enviada' });

  const pedidas = [...new Set(lerJson(req.body.accounts, []).map(String).filter(ehUuid))];
  if (!pedidas.length) return res.status(400).json({ error: 'Nenhuma conta selecionada' });
  // Só contas do usuário: um id de outra pessoa é tratado como inexistente.
  const minhas = new Set((await accounts.de(uid).porIds(pedidas)).map(c => c.id));
  const accountIds = pedidas.filter(id => minhas.has(id));
  if (accountIds.length !== pedidas.length) return res.status(400).json({ error: 'Conta não encontrada' });

  // Piso de 1 minuto: com 0 as rodadas emendariam uma na outra.
  const intervalMinutes = Number(req.body.intervalMinutes || 0);
  if (!intervalMinutes || intervalMinutes < 1) {
    return res.status(400).json({ error: 'Intervalo mínimo entre rodadas: 1 minuto' });
  }
  const simultaneousLimit = Math.max(1, Number(req.body.simultaneousLimit) || 1);

  let postType = req.body.postType || 'reel';
  if (postType === 'auto') postType = ehVideo(midias[0].filename) ? 'reel' : 'post';
  if (!['post', 'reel', 'story'].includes(postType)) postType = 'reel';

  // A ordem é decidida uma vez e gravada; a semente torna a ordem aleatória reproduzível.
  const sementeDaOrdem = req.body.sementeDaOrdem || crypto.randomBytes(8).toString('hex');
  const midiasAleatorias = sim(req.body.midiasAleatorias);
  const ordemDasMidias = ORDENS.includes(req.body.ordemDasMidias) ? req.body.ordemDasMidias : ORDEM_PADRAO;
  const mediaFiles = ordenar(midias, { ordem: ordemDasMidias, aleatoria: midiasAleatorias, semente: sementeDaOrdem })
    .map(f => f.filename);

  const loopInfinito = sim(req.body.loopInfinito);
  const totalRounds = Math.ceil(mediaFiles.length / simultaneousLimit);

  // Grava o teto em cada conta antes da primeira rodada consultar.
  const tetoAplicado = await aplicarTetoDiario(accountIds, req.body.postsPor24h);

  const job = await jobs.de(uid).insert({
    name: req.body.name || `Post ${new Date().toLocaleString('pt-BR')}`,
    type: loopInfinito ? 'loop' : 'post',
    status: 'queued',
    accountIds,
    mediaFiles,
    ordemDasMidias,
    midiasAleatorias,
    sementeDaOrdem,
    marcaDagua: lerMarcaDagua(req.body.marcaDagua),
    variacaoEdicao: lerVariacaoEdicao(req.body.variacaoEdicao),
    trilha: lerTrilha(req.body.trilha),
    legendaAleatoria: lerLegendaAleatoria(req.body.legendaAleatoria),
    capasPorConta: lerCapasPorConta(req.body.capasPorConta, arquivos.filter(f => f.fieldname === 'capas')),
    rodizioDeMidias: sim(req.body.rodizioDeMidias),
    postType,
    caption: req.body.caption || '',
    cover: capa ? capa.filename : (req.body.coverFilename || ''),
    ctaComment: req.body.ctaComment || '',
    processMode: req.body.processMode || 'sem_limpeza',
    intervalMinutes,
    simultaneousLimit,
    totalRounds,
    // Loop infinito não tem total: qualquer número seria uma meta falsa na barra.
    postsTotal: loopInfinito ? 0 : totalRounds * accountIds.length,
  });

  const atraso = req.body.scheduledAt ? Math.max(new Date(req.body.scheduledAt).getTime() - Date.now(), 0) : 0;
  await agendarRodada(job.id, atraso || 0);

  broadcast('posts', { action: 'created' }, uid);
  res.json({ success: true, job: await comContas(job), tetoAplicado });
};

exports.getPosts = async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
  const meus = posts.de(req.user.id);
  const [lista, total] = await Promise.all([
    meus.findMany({}, { orderBy: 'updated_at desc', limit, offset: (page - 1) * limit }),
    meus.count(),
  ]);
  res.json({
    posts: await comContas(lista),
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  });
};

/** A fila de postagens, com filtros e paginação. */
exports.filaDePostagens = async (req, res) => {
  const onde = sql`usuario_id = ${req.user.id} and ${filaDePostagens.ondeSql(sql, filaDePostagens.montarConsulta(req.query))}`;
  const { pagina, porPagina, pular } = filaDePostagens.montarPaginacao(req.query);

  const [lista, [{ total }], envios] = await Promise.all([
    sql`select * from posts where ${onde}
        order by scheduled_at desc nulls last, created_at desc
        limit ${porPagina} offset ${pular}`,
    sql`select count(*) as total from posts where ${onde}`,
    sql`select job_id as id, max(job_name) as nome, max(created_at) as quando
        from posts where job_id is not null and usuario_id = ${req.user.id}
        group by job_id order by quando desc limit 50`,
  ]);
  await comContas(lista, ['id', 'username', 'avatar']);
  const views = await filaDePostagens.viewsPorMidia(lista);

  res.json({
    itens: lista.map(p => filaDePostagens.montarLinha(p, views)),
    paginacao: {
      pagina, porPagina, total,
      paginas: Math.max(1, Math.ceil(total / porPagina)),
      de: total === 0 ? 0 : pular + 1,
      ate: Math.min(pular + porPagina, total),
    },
    envios: envios.map(e => ({ id: e.id, nome: e.nome || 'Sem nome' })),
    status: filaDePostagens.STATUS,
    formatos: filaDePostagens.FORMATOS,
  });
};

/** Apaga erros e cancelados. `parcial` fica: apagá-lo perderia o registro do que saiu. */
exports.limparFila = async (req, res) => {
  const r = await sql`delete from posts where usuario_id = ${req.user.id} and status = any(${filaDePostagens.LIMPAVEIS})`;
  console.log(`🧹 [Fila] ${r.count} publicação(ões) interrompida(s)/cancelada(s) removida(s)`);
  res.json({ ok: true, removidas: r.count });
};

exports.deletePost = async (req, res) => {
  const post = await posts.de(req.user.id).findById(req.params.id);
  if (!post) return res.status(404).json({ error: 'Post não encontrado' });

  const [emUso] = await sql`
    select name from jobs
    where ${post.media} = any(media_files) and status in ('queued', 'running', 'waiting_interval')
      and usuario_id = ${req.user.id}
    limit 1`;
  if (emUso) {
    return res.status(400).json({ error: `Mídia em uso pelo envio "${emUso.name}" — cancele o envio antes de apagar` });
  }

  // A mídia só sai do disco se nenhum item da biblioteca a referencia.
  const [naBiblioteca] = await sql`select 1 from media where filename = ${post.media} limit 1`;
  for (const arquivo of [naBiblioteca ? null : post.media, post.cover]) {
    if (!arquivo) continue;
    const alvo = path.resolve(UPLOADS, arquivo);
    if (alvo.startsWith(UPLOADS + path.sep)) fs.rmSync(alvo, { force: true });
  }

  await posts.remove(post.id);
  broadcast('posts', { action: 'deleted' }, req.user.id);
  res.json({ success: true });
};

exports.cancelPost = async (req, res) => {
  const post = await posts.de(req.user.id).update(req.params.id, { status: 'cancelado' });
  if (!post) return res.status(404).json({ error: 'Post não encontrado' });
  await fila.cancelarPorDados('post', 'postId', post.id);
  res.json(post);
};

async function reenfileirar(post) {
  await posts.update(post.id, { status: 'pendente', error: '' });
  await fila.enfileirar('post', { postId: post.id }, { chave: `post:${post.id}` });
}

exports.retryPost = async (req, res) => {
  const post = await posts.de(req.user.id).findById(req.params.id);
  if (!post) return res.status(404).json({ error: 'Post não encontrado' });
  if (!['erro', 'parcial', 'cancelado'].includes(post.status)) {
    return res.status(400).json({ error: 'Só é possível reprocessar posts com erro, parcial ou cancelado' });
  }
  await reenfileirar(post);
  res.json({ success: true, post: { ...post, status: 'pendente', error: '' } });
};

exports.retryAllErrors = async (req, res) => {
  const lista = await sql`select * from posts where usuario_id = ${req.user.id} and status in ('erro', 'parcial')`;
  if (!lista.length) return res.json({ success: true, total: 0, message: 'Nenhum post com erro encontrado' });
  for (const post of lista) await reenfileirar(post);
  res.json({ success: true, total: lista.length });
};
