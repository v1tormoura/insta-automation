import { CAMPAIGN_STATUSES, type CampaignStatus } from '@nexora/shared';
import { Schema, model, type Types } from 'mongoose';
import { tenantGuard } from '../../infra/tenantGuard.js';
import { countsDefinition, type JobCounts } from '../posts/post.model.js';

/** Fila de publicação: vários conteúdos, várias contas, com intervalo. */
export interface CampaignDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  name: string;
  status: CampaignStatus;
  accountIds: Types.ObjectId[];
  postIds: Types.ObjectId[];
  startAt: Date;
  endsAt: Date;
  intervalMinutes: number;
  accountStaggerMinutes: number;
  counts: JobCounts;
  pausedAt?: Date | null;
  completedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const campaignSchema = new Schema<CampaignDoc>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true, trim: true },
    status: { type: String, enum: CAMPAIGN_STATUSES, default: 'ACTIVE' },
    accountIds: [{ type: Schema.Types.ObjectId, ref: 'InstagramAccount' }],
    postIds: [{ type: Schema.Types.ObjectId, ref: 'Post' }],
    startAt: { type: Date, required: true },
    endsAt: { type: Date, required: true },
    intervalMinutes: { type: Number, default: 0 },
    accountStaggerMinutes: { type: Number, default: 0 },
    counts: countsDefinition,
    pausedAt: Date,
    completedAt: Date,
  },
  { timestamps: true },
);
campaignSchema.index({ userId: 1, createdAt: -1 });
campaignSchema.plugin(tenantGuard);

export const Campaign = model<CampaignDoc>('Campaign', campaignSchema);
