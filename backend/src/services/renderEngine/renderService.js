'use strict';
const path      = require('path');
const fsExtra   = require('fs-extra');
const ffmpeg    = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');
const { buildFilterComplex } = require('./filterBuilder');
const VideoRenderJob = require('../../models/VideoRenderJob');
const VideoBatch     = require('../../models/VideoBatch');
const { broadcast }  = require('../../events/broadcaster');

ffmpeg.setFfmpegPath(ffmpegStatic);

const RENDERS_DIR = path.resolve('uploads/renders');

async function ensureRenderDir(batchId, jobId) {
  const dir = path.join(RENDERS_DIR, String(batchId), String(jobId));
  await fsExtra.ensureDir(dir);
  return dir;
}

async function renderVideo(renderJob, template) {
  const jobId    = String(renderJob._id);
  const batchId  = String(renderJob.batchId);
  const startTs  = Date.now();

  const renderDir  = await ensureRenderDir(batchId, jobId);
  const outputPath = path.join(renderDir, 'output.mp4');

  const resolvedVars = Object.assign({}, renderJob.variables || {});
  resolvedVars['VIDEO'] = renderJob.inputPath;

  const { inputs, filterComplex, videoMap, audioMap, hasOriginalAudio } =
    buildFilterComplex(template, resolvedVars);

  const preset = template.output?.preset || 'medium';
  const crf    = String(template.output?.crf ?? 20);

  return new Promise((resolve, reject) => {
    const trimStart = Number(template.trim?.startTime) || 0;
    const trimEnd   = template.trim?.endTime ?? null;

    let cmd = ffmpeg();

    for (let i = 0; i < inputs.length; i++) {
      cmd = cmd.input(inputs[i]);
      if (i === 0) {
        const iOpts = [];
        if (trimStart > 0)   iOpts.push(`-ss ${trimStart}`);
        if (trimEnd != null) iOpts.push(`-to ${trimEnd}`);
        if (iOpts.length)    cmd = cmd.inputOptions(iOpts);
      }
    }

    const outputOpts = [
      '-filter_complex', filterComplex,
      '-map', videoMap,
      hasOriginalAudio ? '-map' : '-an',
      ...(hasOriginalAudio ? [audioMap] : []),
      '-c:v', 'libx264',
      '-profile:v', 'high',
      '-level', '4.1',
      '-crf', crf,
      '-preset', preset,
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      '-c:a', 'aac',
      '-b:a', '192k',
      '-ar', '44100',
      '-ac', '2',
      ...(template.output?.removeMetadata !== false
        ? ['-map_metadata', '-1', '-map_chapters', '-1', '-fflags', '+bitexact']
        : []),
    ];

    cmd
      .outputOptions(outputOpts)
      .output(outputPath)
      .on('stderr', line => {
        if (/frame=|fps=|time=/.test(line)) {
          broadcast('render-progress', { jobId, batchId, line: line.trim() });
        }
      })
      .on('error', async err => {
        console.error(`[RenderEngine] job ${jobId} falhou:`, err.message);
        await VideoRenderJob.findByIdAndUpdate(jobId, {
          status:      'failed',
          error:       err.message,
          completedAt: new Date(),
          $push: { logs: { message: `Erro: ${err.message}`, level: 'error' } },
        }).catch(() => {});
        await updateBatchStats(batchId);
        reject(err);
      })
      .on('end', async () => {
        const duration = Date.now() - startTs;
        let outputSize = 0;
        try { outputSize = (await fsExtra.stat(outputPath)).size; } catch {}

        await VideoRenderJob.findByIdAndUpdate(jobId, {
          status:      'completed',
          outputPath,
          completedAt: new Date(),
          duration,
          'metrics.renderDuration': duration,
          'metrics.outputSize':     outputSize,
          $push: { logs: { message: `Concluído em ${(duration / 1000).toFixed(1)}s — ${(outputSize / 1024 / 1024).toFixed(1)} MB`, level: 'info' } },
        }).catch(() => {});

        await updateBatchStats(batchId);
        broadcast('render-complete', { jobId, batchId, duration, outputSize });
        resolve({ outputPath, duration, outputSize });
      })
      .run();
  });
}

async function updateBatchStats(batchId) {
  const [completed, failed, processing, pending, total] = await Promise.all([
    VideoRenderJob.countDocuments({ batchId, status: 'completed' }),
    VideoRenderJob.countDocuments({ batchId, status: 'failed' }),
    VideoRenderJob.countDocuments({ batchId, status: 'processing' }),
    VideoRenderJob.countDocuments({ batchId, status: { $in: ['pending', 'queued'] } }),
    VideoRenderJob.countDocuments({ batchId }),
  ]);

  const done = completed + failed;
  let status = 'processing';
  if (done >= total && total > 0) {
    status = completed === total ? 'completed' : (completed > 0 ? 'completed' : 'failed');
  }

  const update = { completedJobs: completed, failedJobs: failed, processingJobs: processing, pendingJobs: pending };
  if (status !== 'processing') {
    update.status = status;
    update.completedAt = new Date();
  }

  await VideoBatch.findByIdAndUpdate(batchId, update).catch(() => {});
  broadcast('batch-update', { batchId, completedJobs: completed, failedJobs: failed, processingJobs: processing, pendingJobs: pending, status });
}

module.exports = { renderVideo, updateBatchStats, RENDERS_DIR };
