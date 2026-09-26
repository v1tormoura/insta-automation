import type { Types } from 'mongoose';
import { InstagramAccount } from '../accounts/account.model.js';
import { AccountSnapshot, MediaInsight } from '../insights/insight.models.js';
import { PublishJob } from '../posts/job.model.js';
import { removeQueuedPublish } from '../../queue/queues.js';

/**
 * Remove os dados vindos do Instagram de uma conta: token, métricas e
 * snapshots. Jobs pendentes são cancelados. O histórico de publicações do
 * cliente (conteúdo que ele mesmo criou no SaaS) permanece, sem vínculo de token.
 */
export async function purgeAccountData(userId: Types.ObjectId, accountId: Types.ObjectId): Promise<void> {
  const pending = await PublishJob.find({ userId, accountId, status: { $in: ['SCHEDULED', 'QUEUED'] } }).select('_id').lean();
  await PublishJob.updateMany(
    { userId, accountId, status: { $in: ['SCHEDULED', 'QUEUED'] } },
    { $set: { status: 'CANCELED', finishedAt: new Date() } },
  );
  await Promise.all(pending.map((j) => removeQueuedPublish(j._id)));
  await Promise.all([
    MediaInsight.deleteMany({ userId, accountId }),
    AccountSnapshot.deleteMany({ userId, accountId }),
    InstagramAccount.updateOne(
      { userId, _id: accountId },
      {
        $set: { status: 'DISCONNECTED', statusReason: 'Dados excluídos a pedido do titular', disconnectedAt: new Date(), name: null, profilePictureUrl: null },
        $unset: { token: 1 },
      },
    ),
  ]);
}
