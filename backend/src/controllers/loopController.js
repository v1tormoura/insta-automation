'use strict';

/**
 * Loop: um envio (`jobs.type = 'loop'`) que volta à primeira mídia quando a
 * lista acaba. A tela de Loop recebe o envio no formato que ela já conhece.
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { sql, ehUuid } = require('../db');
const { jobs, comContas, accounts } = require('../repos');
const { agendarRodada } = require('../worker');
const fila = require('../queue');
const { broadcast } = require('../events/broadcaster');
const { ordenar } = require('../services/ordemDasMidias');
const { lerDoCorpo: lerMarcaDagua } = require('../services/marcaDagua');
const { lerDoCorpo: lerCapasPorConta } = require('../services/capaPorConta');
const { gerarMiniatura } = require('../services/miniaturaDeVideo');

const UPLOADS = path.resolve(__dirname, '../../uploads');
const ehVideo = nome => /\.(mp4|mov|webm|avi|mkv)$/i.test(nome || '');

const MODOS = ['sem_limpeza', 'limpeza_leve', 'ultra_clean', 'humanizador'];

const STATUS_DO_LOOP = {
  queued: 'ativo', running: 'ativo', waiting_interval: 'ativo',
  paused: 'pausado', completed: 'inativo', cancelled: 'inativo', failed: 'erro',
};

function jobToLoop(job) {
  return {
    ...job,
    type: job.postType || 'reel',
    coverFile: job.cover || '',
    folder: 'default',
    postsCount: job.roundsCompleted || 0,
    currentIndex: job.currentRound || 0,
    nextRunAt: job.nextRoundAt || null,
    lastRunAt: job.updatedAt || null,
    status: STATUS_DO_LOOP[job.status] || 'ativo',
    _jobStatus: job.status,
    _isJob: true,
  };
}

async function responderLoop(res, job) {
  await comContas(job);
  res.json(jobToLoop(job));
}

/** Upload de mídias para o loop (sem entrar na biblioteca), com miniatura dos vídeos. */
exports.uploadMedia = async (req, res) => {
  if (!req.files?.length) return res.status(400).json({ error: 'Nenhum arquivo enviado' });
  const files = await Promise.all(req.files.map(async f => {
    const video = ehVideo(f.filename);
    let thumbnail = null;
    if (video) {
      const thumbName = f.filename.replace(/\.[^.]+$/, '') + '.thumb.jpg';
      try {
        await gerarMiniatura(f.path, path.join(UPLOADS, thumbName));
        if (fs.existsSync(path.join(UPLOADS, thumbName))) thumbnail = thumbName;
      } catch (e) {
        console.warn('[thumbnail] falhou para', f.filename, e.message);
      }
    }
    return { filename: f.filename, thumbnail, type: video ? 'video' : 'image' };
  }));
  res.json({ files });
};

exports.list = async (req, res) => {
  const lista = await sql`select * from jobs where type = 'loop' and usuario_id = ${req.user.id} order by created_at desc`;
  await comContas(lista);
  res.json(lista.map(jobToLoop));
};

exports.create = async (req, res) => {
  const { name, mediaFiles, type, intervalMinutes, caption, coverFile, ctaComment, processMode } = req.body;
  const pedidas = [...new Set((req.body.accounts || []).map(String).filter(ehUuid))];
  const accountIds = (await accounts.de(req.user.id).porIds(pedidas)).map(c => c.id);

  if (!pedidas.length) return res.status(400).json({ error: 'Selecione ao menos uma conta' });
  if (accountIds.length !== pedidas.length) return res.status(400).json({ error: 'Conta não encontrada' });
  if (!mediaFiles?.length) return res.status(400).json({ error: 'Selecione ao menos uma mídia' });
  if (!intervalMinutes || intervalMinutes < 1) return res.status(400).json({ error: 'Intervalo mínimo: 1 minuto' });

  // O loop recebe nomes de arquivo, sem data: só "ordem escolhida" ou aleatória fazem sentido.
  const sementeDaOrdem = req.body.sementeDaOrdem || crypto.randomBytes(8).toString('hex');
  const midiasAleatorias = req.body.midiasAleatorias === true;
  const filaOrdenada = ordenar(mediaFiles.map(f => ({ filename: f, quando: null })), {
    ordem: 'selecao', aleatoria: midiasAleatorias, semente: sementeDaOrdem,
  }).map(x => x.filename);

  const job = await jobs.de(req.user.id).insert({
    name: name || `Loop ${new Date().toLocaleString('pt-BR')}`,
    type: 'loop',
    status: 'queued',
    accountIds,
    mediaFiles: filaOrdenada,
    ordemDasMidias: 'selecao',
    midiasAleatorias,
    sementeDaOrdem,
    marcaDagua: lerMarcaDagua(req.body.marcaDagua),
    capasPorConta: lerCapasPorConta(req.body.capasPorConta),
    postType: ['post', 'reel', 'story'].includes(type) ? type : 'reel',
    caption: caption || '',
    cover: coverFile || '',
    ctaComment: ctaComment || '',
    processMode: processMode || 'sem_limpeza',
    intervalMinutes: Number(intervalMinutes),
    simultaneousLimit: 1,
    totalRounds: filaOrdenada.length,
    postsTotal: 0,
  });

  await agendarRodada(job.id, 0);
  broadcast('accounts', { action: 'loop_created' }, req.user.id);
  await responderLoop(res, job);
};

exports.togglePause = async (req, res) => {
  const job = await jobs.de(req.user.id).findById(req.params.id);
  if (!job) return res.status(404).json({ error: 'Loop não encontrado' });

  let atualizado;
  if (job.status === 'paused') {
    atualizado = await jobs.update(job.id, { status: 'queued', nextRoundAt: new Date(), lastError: '' });
    await agendarRodada(job.id, 0);
  } else {
    atualizado = await jobs.update(job.id, { status: 'paused' });
    await fila.cancelarPorDados('job_round', 'jobId', job.id);
  }
  broadcast('accounts', { action: 'loop_updated' }, req.user.id);
  await responderLoop(res, atualizado);
};

exports.remove = async (req, res) => {
  if (!(await jobs.de(req.user.id).findById(req.params.id))) return res.status(404).json({ error: 'Loop não encontrado' });
  await fila.cancelarPorDados('job_round', 'jobId', req.params.id);
  await jobs.remove(req.params.id);
  broadcast('accounts', { action: 'loop_deleted' }, req.user.id);
  res.json({ success: true });
};

exports.update = async (req, res) => {
  const { name, intervalMinutes, caption, ctaComment, mediaFiles, processMode } = req.body;
  const patch = {};
  if (MODOS.includes(processMode)) patch.processMode = processMode;
  if (name !== undefined) patch.name = name;
  if (intervalMinutes !== undefined) patch.intervalMinutes = Math.max(1, Number(intervalMinutes) || 1);
  if (caption !== undefined) patch.caption = caption;
  if (ctaComment !== undefined) patch.ctaComment = ctaComment;
  if (Array.isArray(mediaFiles)) {
    patch.mediaFiles = mediaFiles;
    patch.totalRounds = mediaFiles.length;
  }
  const job = await jobs.de(req.user.id).update(req.params.id, patch);
  if (!job) return res.status(404).json({ error: 'Loop não encontrado' });
  broadcast('accounts', { action: 'loop_updated' }, req.user.id);
  await responderLoop(res, job);
};

/** Gera, em segundo plano, a miniatura dos vídeos de uploads/ que ainda não têm. */
exports.generateAllThumbs = async (req, res) => {
  const videos = fs.readdirSync(UPLOADS).filter(ehVideo);
  res.json({ message: `Processando ${videos.length} vídeos em background...`, total: videos.length });

  let gerados = 0, pulados = 0, falhas = 0;
  for (const nome of videos) {
    const thumb = path.join(UPLOADS, nome.replace(/\.[^.]+$/, '') + '.thumb.jpg');
    if (fs.existsSync(thumb)) { pulados++; continue; }
    await gerarMiniatura(path.join(UPLOADS, nome), thumb).catch(() => {});
    if (fs.existsSync(thumb)) gerados++; else falhas++;
  }
  console.log(`[Miniaturas] ${gerados} gerada(s), ${pulados} pulada(s), ${falhas} falha(s)`);
};

/** Últimas publicações do loop. */
exports.history = async (req, res) => {
  if (!ehUuid(req.params.id)) return res.status(404).json({ error: 'Loop não encontrado' });
  const lista = await sql`
    select * from posts where job_id = ${req.params.id} and usuario_id = ${req.user.id}
    order by created_at desc limit 50`;
  res.json(await comContas(lista, ['id', 'username']));
};
