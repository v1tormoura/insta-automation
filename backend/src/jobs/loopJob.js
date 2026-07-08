'use strict';

/**
 * Loop Job — roda a cada 30 segundos.
 * Para cada loop ativo cujo nextRunAt <= agora:
 *   1. Pega a próxima mídia da fila (currentIndex)
 *   2. Cria um Post para TODAS as contas do loop
 *   3. Enfileira o job no BullMQ (delay 0 = imediato)
 *   4. Avança currentIndex (volta ao 0 quando chega no fim)
 *   5. Atualiza nextRunAt = agora + intervalMinutes
 */

const Loop      = require('../models/Loop');
const Post      = require('../models/Post');
const postQueue = require('../queue/postQueue');
const { broadcast } = require('../events/broadcaster');

const delay = ms => new Promise(r => setTimeout(r, ms));

let running = false;

async function runLoops() {
  if (running) return;
  running = true;

  try {
    const now   = new Date();
    const loops = await Loop.find({
      status:    'ativo',
      nextRunAt: { $lte: now },
      $expr:     { $gt: [{ $size: '$mediaFiles' }, 0] },
      $expr:     { $gt: [{ $size: '$accounts'   }, 0] },
    }).populate('accounts', '_id username accessToken igSession healthStatus isBusy');

    for (const loop of loops) {
      try {
        // Filtra contas OK (não banidas, não ocupadas)
        const validAccounts = loop.accounts.filter(a =>
          a.healthStatus !== 'banida' && !a.isBusy
        );

        if (!validAccounts.length) {
          const allBanned = loop.accounts.every(a => a.healthStatus === 'banida');
          loop.lastError = allBanned
            ? 'Todas as contas estão banidas'
            : 'Todas as contas estão ocupadas — aguardando';
          loop.nextRunAt = new Date(Date.now() + loop.intervalMinutes * 60 * 1000);
          await loop.save();
          continue;
        }

        // Pega a próxima mídia
        const idx       = loop.currentIndex % loop.mediaFiles.length;
        const mediaFile = loop.mediaFiles[idx];

        // Detecta tipo pela extensão
        const isVideo = /\.(mp4|mov|webm|avi|mkv)$/i.test(mediaFile);
        const mediaType = isVideo ? 'video' : 'image';
        let postType = loop.type;
        if (postType === 'reel' && !isVideo) postType = 'post';

        // Verifica se conta tem token expirado — alerta mas não bloqueia se tem private api
        const accountsWithIssue = loop.accounts.filter(a =>
          a.healthStatus === 'sessao_expirada' || a.healthStatus === 'erro_login'
        );
        const errNote = accountsWithIssue.length
          ? `Conta token_expired — loop em espera` : '';

        // Cria o post para todas as contas válidas
        const post = await Post.create({
          media:    mediaFile,
          mediaType,
          postType,
          caption:  loop.caption || '',
          accounts: validAccounts.map(a => a._id),
          status:   'pendente',
          scheduledAt: new Date(),
        });

        await postQueue.add('newPost', { postId: post._id }, { delay: 0 });

        // Avança índice
        loop.currentIndex = (idx + 1) % loop.mediaFiles.length;
        loop.postsCount   = (loop.postsCount || 0) + 1;
        loop.lastRunAt    = now;
        loop.nextRunAt    = new Date(Date.now() + loop.intervalMinutes * 60 * 1000);
        loop.lastError    = errNote;
        loop.status       = 'ativo';

        await loop.save();

        console.log(`🔁 [Loop] "${loop.name}" → ${mediaFile} para ${validAccounts.length} conta(s) | próximo em ${loop.intervalMinutes}min`);
        broadcast('posts', { action: 'loop_posted', loopId: loop._id });

      } catch (err) {
        console.log(`💥 [Loop] "${loop.name}": ${err.message}`);
        try {
          loop.lastError = err.message.slice(0, 200);
          loop.nextRunAt = new Date(Date.now() + loop.intervalMinutes * 60 * 1000);
          await loop.save();
        } catch {}
      }

      await delay(500); // pausa gentil entre loops
    }
  } catch (err) {
    console.log('💥 [LoopJob] Erro geral:', err.message);
  } finally {
    running = false;
  }
}

function startLoopJob() {
  // Roda a cada 30 segundos para precisão de ±30s no intervalo
  setInterval(runLoops, 30_000);
  console.log('🔁 [LoopJob] Iniciado — verificando loops a cada 30s');
}

module.exports = { startLoopJob, runLoops };
