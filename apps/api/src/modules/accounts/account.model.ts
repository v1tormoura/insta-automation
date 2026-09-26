import { ACCOUNT_STATUSES, DEFAULT_ACCOUNT_MIN_INTERVAL_SECONDS, type AccountStatus } from '@nexora/shared';
import { Schema, model, type Types } from 'mongoose';
import { tenantGuard } from '../../infra/tenantGuard.js';
import type { SealedSecret } from '../../lib/crypto.js';

export interface InstagramAccountDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  /** ID da conta profissional no Instagram (`user_id` do /me) — usado nos endpoints de publicação. */
  igUserId: string;
  /** ID com escopo do app (`id` do /me). */
  appScopedId?: string;
  username: string;
  name?: string | null;
  profilePictureUrl?: string | null;
  accountType?: string | null;
  followersCount?: number | null;
  followsCount?: number | null;
  mediaCount?: number | null;
  status: AccountStatus;
  statusReason?: string | null;
  permissions: string[];
  token?: SealedSecret;
  tokenExpiresAt?: Date | null;
  tokenRefreshedAt?: Date | null;
  lastSyncedAt?: Date | null;
  lastPublishedAt?: Date | null;
  settings: { paused: boolean; minIntervalSeconds: number };
  publishing: { quotaUsage?: number | null; quotaTotal?: number | null; checkedAt?: Date | null };
  connectedAt: Date;
  disconnectedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const sealedSchema = new Schema<SealedSecret>(
  { keyId: String, iv: String, tag: String, data: String },
  { _id: false },
);

const accountSchema = new Schema<InstagramAccountDoc>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    igUserId: { type: String, required: true },
    appScopedId: String,
    username: { type: String, required: true },
    name: String,
    profilePictureUrl: String,
    accountType: String,
    followersCount: Number,
    followsCount: Number,
    mediaCount: Number,
    status: { type: String, enum: ACCOUNT_STATUSES, default: 'CONNECTED' },
    statusReason: String,
    permissions: { type: [String], default: [] },
    // Nunca sai do banco por acidente: só volta com .select('+token').
    token: { type: sealedSchema, select: false },
    tokenExpiresAt: Date,
    tokenRefreshedAt: Date,
    lastSyncedAt: Date,
    lastPublishedAt: Date,
    settings: {
      paused: { type: Boolean, default: false },
      minIntervalSeconds: { type: Number, default: DEFAULT_ACCOUNT_MIN_INTERVAL_SECONDS },
    },
    publishing: { quotaUsage: Number, quotaTotal: Number, checkedAt: Date },
    connectedAt: { type: Date, default: Date.now },
    disconnectedAt: Date,
  },
  { timestamps: true },
);
accountSchema.index({ userId: 1, igUserId: 1 }, { unique: true });
accountSchema.index({ userId: 1, status: 1 });
accountSchema.index({ status: 1, tokenExpiresAt: 1 });
accountSchema.index({ igUserId: 1 });
accountSchema.plugin(tenantGuard);

export const InstagramAccount = model<InstagramAccountDoc>('InstagramAccount', accountSchema, 'instagram_accounts');
