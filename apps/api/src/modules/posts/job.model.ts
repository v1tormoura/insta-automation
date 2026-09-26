import { JOB_STATUSES, POST_TYPES, type JobStatus, type PostType } from '@nexora/shared';
import { Schema, model, type Types } from 'mongoose';
import { tenantGuard } from '../../infra/tenantGuard.js';

export interface JobError {
  code: string;
  message: string;
  retryable: boolean;
  metaCode?: number | null;
  metaSubcode?: number | null;
  fbtraceId?: string | null;
}

export interface JobHistoryEntry {
  at: Date;
  status: JobStatus;
  message?: string;
}

/**
 * Uma publicação de um post em UMA conta. É a unidade que a fila executa.
 * O Mongo é a fonte da verdade; o BullMQ só carrega o "quando executar".
 */
export interface PublishJobDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  postId: Types.ObjectId;
  campaignId?: Types.ObjectId | null;
  accountId: Types.ObjectId;
  postType: PostType;
  status: JobStatus;
  runAt: Date;
  attempts: number;
  /** Quantas vezes o job esperou por rate limit/cota da Meta (não conta como tentativa). */
  rateLimitWaits: number;
  waitReason?: string | null;
  /** Container principal (ou do carrossel) criado na Meta. */
  containerId?: string | null;
  containerCreatedAt?: Date | null;
  childContainerIds: string[];
  igMediaId?: string | null;
  permalink?: string | null;
  startedAt?: Date | null;
  publishedAt?: Date | null;
  finishedAt?: Date | null;
  error?: JobError | null;
  history: JobHistoryEntry[];
  createdAt: Date;
  updatedAt: Date;
}

const jobSchema = new Schema<PublishJobDoc>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    postId: { type: Schema.Types.ObjectId, ref: 'Post', required: true },
    campaignId: { type: Schema.Types.ObjectId, ref: 'Campaign' },
    accountId: { type: Schema.Types.ObjectId, ref: 'InstagramAccount', required: true },
    postType: { type: String, enum: POST_TYPES, required: true },
    status: { type: String, enum: JOB_STATUSES, default: 'SCHEDULED' },
    runAt: { type: Date, required: true },
    attempts: { type: Number, default: 0 },
    rateLimitWaits: { type: Number, default: 0 },
    waitReason: String,
    containerId: String,
    containerCreatedAt: Date,
    childContainerIds: { type: [String], default: [] },
    igMediaId: String,
    permalink: String,
    startedAt: Date,
    publishedAt: Date,
    finishedAt: Date,
    error: {
      type: new Schema(
        {
          code: String,
          message: String,
          retryable: Boolean,
          metaCode: Number,
          metaSubcode: Number,
          fbtraceId: String,
        },
        { _id: false },
      ),
      default: null,
    },
    history: {
      type: [new Schema({ at: Date, status: String, message: String }, { _id: false })],
      default: [],
    },
  },
  { timestamps: true },
);
jobSchema.index({ userId: 1, status: 1, runAt: 1 });
jobSchema.index({ userId: 1, updatedAt: -1 });
jobSchema.index({ userId: 1, postId: 1 });
jobSchema.index({ userId: 1, accountId: 1, status: 1 });
jobSchema.index({ userId: 1, campaignId: 1 });
// Varredura de recuperação (sistema): jobs vencidos que não andaram.
jobSchema.index({ status: 1, runAt: 1 });
jobSchema.index({ status: 1, updatedAt: 1 });
jobSchema.plugin(tenantGuard);

export const PublishJob = model<PublishJobDoc>('PublishJob', jobSchema, 'publish_jobs');
