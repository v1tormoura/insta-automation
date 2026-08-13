'use strict';
require('dotenv').config();

const { Worker }     = require('bullmq');
const connection     = require('./connection');
const connectDB      = require('../config/db');
const VideoRenderJob = require('../models/VideoRenderJob');
const VideoTemplate  = require('../models/VideoTemplate');
const { renderVideo } = require('../services/renderEngine/renderService');

connectDB();

async function recoverStuckRenderJobs() {
  const videoRenderQueue = require('./videoRenderQueue');
  const cutoff = new Date(Date.now() - 10 * 60 * 1000);

  const stuck = await VideoRenderJob.find({ status: 'processing', updatedAt: { $lt: cutoff } });
  for (const job of stuck) {
    try {
      await VideoRenderJob.findByIdAndUpdate(job._id, {
        status: 'queued',
        $push: { logs: { message: 'Re-enfileirado após restart do worker', level: 'warn' } },
      });
      const bullJob = await videoRenderQueue.add('render_job', { renderJobId: String(job._id) });
      await VideoRenderJob.findByIdAndUpdate(job._id, { bullMqJobId: String(bullJob.id) });
      console.log(`♻️  [VideoRender] job ${job._id} re-enfileirado após restart`);
    } catch (e) {
      console.error(`[VideoRender] Falha ao recuperar job ${job._id}:`, e.message);
    }
  }
}

recoverStuckRenderJobs().catch(e => console.error('[VideoRender] recoverStuck:', e.message));
setInterval(() => recoverStuckRenderJobs().catch(() => {}), 5 * 60_000);

const CONCURRENCY = parseInt(process.env.VIDEO_RENDER_CONCURRENCY || '2', 10);

const worker = new Worker('video-renders', async bullJob => {
  const { renderJobId } = bullJob.data;

  const renderJob = await VideoRenderJob.findById(renderJobId);
  if (!renderJob) {
    console.warn(`[VideoRender] renderJob ${renderJobId} não encontrado`);
    return;
  }
  if (renderJob.status === 'cancelled') {
    console.log(`[VideoRender] renderJob ${renderJobId} já cancelado — ignorado`);
    return;
  }

  await VideoRenderJob.findByIdAndUpdate(renderJobId, {
    status:    'processing',
    startedAt: new Date(),
    $push: { logs: { message: 'Renderização iniciada', level: 'info' } },
  });

  const template = await VideoTemplate.findById(renderJob.templateId).lean();
  if (!template) {
    await VideoRenderJob.findByIdAndUpdate(renderJobId, {
      status: 'failed',
      error:  'Template não encontrado',
      completedAt: new Date(),
    });
    return;
  }

  await renderVideo(renderJob, template);
}, { connection, concurrency: CONCURRENCY });

worker.on('failed', async (bullJob, err) => {
  const { renderJobId } = bullJob?.data || {};
  if (renderJobId) {
    await VideoRenderJob.findByIdAndUpdate(renderJobId, {
      status:      'failed',
      error:       err.message,
      completedAt: new Date(),
      $push: { logs: { message: `Worker error: ${err.message}`, level: 'error' } },
    }).catch(() => {});
  }
  console.error(`[VideoRender] bullJob ${bullJob?.id} falhou:`, err.message);
});

console.log(`[VideoRender] Worker iniciado — concorrência: ${CONCURRENCY}`);
