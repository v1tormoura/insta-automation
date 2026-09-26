import { POST_STATUSES, POST_TYPES, type PostStatus, type PostType } from '@nexora/shared';
import { Schema, model, type Types } from 'mongoose';
import { tenantGuard } from '../../infra/tenantGuard.js';

export interface JobCounts {
  total: number;
  published: number;
  failed: number;
  pending: number;
  canceled: number;
}

export const countsDefinition = {
  total: { type: Number, default: 0 },
  published: { type: Number, default: 0 },
  failed: { type: Number, default: 0 },
  pending: { type: Number, default: 0 },
  canceled: { type: Number, default: 0 },
};

export interface PostDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  campaignId?: Types.ObjectId | null;
  type: PostType;
  caption: string;
  mediaIds: Types.ObjectId[];
  cover?: { mediaId?: Types.ObjectId | null; thumbOffsetMs?: number | null } | null;
  shareToFeed: boolean;
  status: PostStatus;
  scheduledAt?: Date | null;
  accountIds: Types.ObjectId[];
  accountStaggerMinutes: number;
  counts: JobCounts;
  completedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const postSchema = new Schema<PostDoc>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    campaignId: { type: Schema.Types.ObjectId, ref: 'Campaign' },
    type: { type: String, enum: POST_TYPES, required: true },
    caption: { type: String, default: '' },
    mediaIds: [{ type: Schema.Types.ObjectId, ref: 'Media' }],
    cover: {
      mediaId: { type: Schema.Types.ObjectId, ref: 'Media' },
      thumbOffsetMs: Number,
    },
    shareToFeed: { type: Boolean, default: true },
    status: { type: String, enum: POST_STATUSES, default: 'DRAFT' },
    scheduledAt: Date,
    accountIds: [{ type: Schema.Types.ObjectId, ref: 'InstagramAccount' }],
    accountStaggerMinutes: { type: Number, default: 0 },
    counts: countsDefinition,
    completedAt: Date,
  },
  { timestamps: true },
);
postSchema.index({ userId: 1, createdAt: -1 });
postSchema.index({ userId: 1, status: 1, scheduledAt: 1 });
postSchema.index({ userId: 1, campaignId: 1 });
postSchema.index({ userId: 1, mediaIds: 1 });
postSchema.plugin(tenantGuard);

export const Post = model<PostDoc>('Post', postSchema);
