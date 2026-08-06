'use strict';

/**
 * Script de limpeza da arquitetura legada — executar UMA VEZ após o deploy.
 *
 * O que faz:
 *   1. Arquiva Loops antigos (Loop model) com status 'ativo' → 'inativo'
 *   2. Cancela Posts pendentes/agendados que pertenciam à arquitetura antiga
 *   3. Cancela Posts travados em 'processando' há mais de 30 min
 *   4. Remove da fila BullMQ os jobs 'newPost' (antigos) em waiting/delayed
 *      cujo Post correspondente foi cancelado
 *
 * O que NÃO toca:
 *   - Posts com status 'concluido', 'parcial', 'erro' (histórico)
 *   - Contas, sessões, mídias, logs
 *   - BullMQ jobs com data.jobId (nova arquitetura)
 *   - Jobs enfileirados pelo insightController (também usam postId mas são legítimos —
 *     esses têm Posts com status 'pendente' criados há segundos; o script não toca Posts
 *     criados nos últimos 5 minutos para evitar cancelar repost recente)
 *
 * Uso:
 *   No VPS, a partir de /root/insta-automation:
 *   node backend/scripts/cleanup-legacy.js
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const mongoose = require('mongoose');
const { Queue } = require('bullmq');

const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://mongo:27017/instaflow';
const REDIS_HOST = process.env.REDIS_HOST || 'redis';
const REDIS_PORT = Number(process.env.REDIS_PORT || 6379);

async function main() {
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║  Limpeza da arquitetura legada — InstaFlow Job Engine ║');
  console.log('╚══════════════════════════════════════════════════════╝\n');

  // ── Conectar ao MongoDB ──────────────────────────────────────────────────
  await mongoose.connect(MONGO_URI);
  console.log('✅ MongoDB conectado\n');

  const Loop = require('../src/models/Loop');
  const Post = require('../src/models/Post');

  const MIGRATION_NOTE = '[MIGRADO] Arquitetura Job-based ativa — arquivado em ' + new Date().toISOString();

  // ── 1. Arquivar Loops antigos ativos ────────────────────────────────────
  console.log('── 1. Arquivando Loops legados ativos...');
  const loopsBefore = await Loop.countDocuments({ status: 'ativo' });
  const loopsResult = await Loop.updateMany(
    { status: 'ativo' },
    { $set: { status: 'inativo', lastError: MIGRATION_NOTE } }
  );
  console.log(`   Loops encontrados : ${loopsBefore}`);
  console.log(`   Loops arquivados  : ${loopsResult.modifiedCount}\n`);

  // ── 2. Cancelar Posts pendentes/agendados (arquitetura antiga) ───────────
  // Guarda: não cancela Posts criados nos últimos 5 min (podem ser de repost via insights)
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
  console.log('── 2. Cancelando Posts pendentes/agendados legados...');
  const pendingBefore = await Post.countDocuments({
    status: { $in: ['pendente', 'agendado'] },
    createdAt: { $lt: fiveMinAgo },
  });
  const pendingResult = await Post.updateMany(
    { status: { $in: ['pendente', 'agendado'] }, createdAt: { $lt: fiveMinAgo } },
    { $set: { status: 'cancelado', error: MIGRATION_NOTE } }
  );
  console.log(`   Posts encontrados : ${pendingBefore}`);
  console.log(`   Posts cancelados  : ${pendingResult.modifiedCount}\n`);

  // ── 3. Cancelar Posts travados em 'processando' há > 30 min ─────────────
  const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000);
  console.log('── 3. Cancelando Posts travados em "processando" (> 30 min)...');
  const stuckBefore = await Post.countDocuments({
    status: 'processando',
    updatedAt: { $lt: thirtyMinAgo },
  });
  const stuckResult = await Post.updateMany(
    { status: 'processando', updatedAt: { $lt: thirtyMinAgo } },
    { $set: { status: 'cancelado', error: MIGRATION_NOTE } }
  );
  console.log(`   Posts encontrados : ${stuckBefore}`);
  console.log(`   Posts cancelados  : ${stuckResult.modifiedCount}\n`);

  // ── 4. Limpar fila BullMQ — jobs antigos (data.postId sem data.jobId) ───
  console.log('── 4. Limpando fila BullMQ de jobs legados...');
  const connection = { host: REDIS_HOST, port: REDIS_PORT };
  const queue = new Queue('posts', { connection });

  const [delayed, waiting, waitingChildren] = await Promise.all([
    queue.getJobs(['delayed']),
    queue.getJobs(['waiting']),
    queue.getJobs(['waiting-children']).catch(() => []),
  ]);

  const allQueueJobs = [...delayed, ...waiting, ...waitingChildren];

  // Busca os IDs de Posts que foram cancelados agora
  const cancelledPostIds = new Set(
    (await Post.find({ status: 'cancelado' }).select('_id').lean())
      .map(p => String(p._id))
  );

  let removedFromQueue = 0;
  let skippedNewArch  = 0;

  for (const qJob of allQueueJobs) {
    const { jobId, postId } = qJob.data || {};

    if (jobId) {
      // Nova arquitetura — nunca remover
      skippedNewArch++;
      continue;
    }

    if (postId && cancelledPostIds.has(String(postId))) {
      // Antigo job cujo Post foi cancelado — pode remover
      try {
        await qJob.remove();
        removedFromQueue++;
      } catch {
        // job pode já ter sido processado; ignora
      }
    }
  }

  await queue.close();

  console.log(`   Jobs na fila analisados    : ${allQueueJobs.length}`);
  console.log(`   Jobs nova arquitetura (OK) : ${skippedNewArch}`);
  console.log(`   Jobs antigos removidos     : ${removedFromQueue}\n`);

  // ── Resumo final ─────────────────────────────────────────────────────────
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║  Limpeza concluída                                   ║');
  console.log('╠══════════════════════════════════════════════════════╣');
  console.log(`║  Loops arquivados    : ${String(loopsResult.modifiedCount).padEnd(28)}║`);
  console.log(`║  Posts cancelados    : ${String(pendingResult.modifiedCount + stuckResult.modifiedCount).padEnd(28)}║`);
  console.log(`║  Jobs BullMQ removidos: ${String(removedFromQueue).padEnd(27)}║`);
  console.log('╚══════════════════════════════════════════════════════╝\n');

  console.log('O ambiente está limpo. Novos Jobs usarão exclusivamente');
  console.log('a arquitetura Job-based (processJobRound).\n');

  await mongoose.disconnect();
  process.exit(0);
}

main().catch(err => {
  console.error('\n❌ Erro durante a limpeza:', err.message);
  console.error(err.stack);
  process.exit(1);
});
