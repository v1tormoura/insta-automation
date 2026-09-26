import { Schema, model, type Types } from 'mongoose';
import { tenantGuard } from '../../infra/tenantGuard.js';

/** Foto diária do perfil — é o que permite o gráfico de seguidores além dos 30 dias da API. */
export interface AccountSnapshotDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  accountId: Types.ObjectId;
  date: string;
  followersCount?: number | null;
  followsCount?: number | null;
  mediaCount?: number | null;
}

const snapshotSchema = new Schema<AccountSnapshotDoc>(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    accountId: { type: Schema.Types.ObjectId, required: true },
    date: { type: String, required: true },
    followersCount: Number,
    followsCount: Number,
    mediaCount: Number,
  },
  { timestamps: false },
);
snapshotSchema.index({ userId: 1, accountId: 1, date: 1 }, { unique: true });
snapshotSchema.plugin(tenantGuard);

export const AccountSnapshot = model<AccountSnapshotDoc>('AccountSnapshot', snapshotSchema, 'account_snapshots');

export interface MediaInsightDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  accountId: Types.ObjectId;
  igMediaId: string;
  mediaType?: string | null;
  productType?: string | null;
  caption: string;
  permalink?: string | null;
  thumbnailUrl?: string | null;
  timestamp?: Date | null;
  metrics: Record<string, number | null>;
  unavailable: { key: string; reason: string }[];
  syncedAt: Date;
}

const mediaInsightSchema = new Schema<MediaInsightDoc>(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    accountId: { type: Schema.Types.ObjectId, required: true },
    igMediaId: { type: String, required: true },
    mediaType: String,
    productType: String,
    caption: { type: String, default: '' },
    permalink: String,
    thumbnailUrl: String,
    timestamp: Date,
    metrics: { type: Schema.Types.Mixed, default: {} },
    unavailable: { type: [new Schema({ key: String, reason: String }, { _id: false })], default: [] },
    syncedAt: { type: Date, default: Date.now },
  },
  { timestamps: false, minimize: false },
);
mediaInsightSchema.index({ userId: 1, accountId: 1, igMediaId: 1 }, { unique: true });
mediaInsightSchema.index({ userId: 1, accountId: 1, timestamp: -1 });
mediaInsightSchema.plugin(tenantGuard);

export const MediaInsight = model<MediaInsightDoc>('MediaInsight', mediaInsightSchema, 'media_insights');
