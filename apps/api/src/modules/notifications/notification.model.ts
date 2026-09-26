import { NOTIFICATION_KINDS, NOTIFICATION_LEVELS, type NotificationKind, type NotificationLevel } from '@nexora/shared';
import { Schema, model, type Types } from 'mongoose';
import { tenantGuard } from '../../infra/tenantGuard.js';

export interface NotificationDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  kind: NotificationKind;
  level: NotificationLevel;
  title: string;
  body: string;
  link?: string | null;
  /** Um evento (ex.: "post X concluído") gera no máximo uma notificação, mesmo com retries. */
  dedupeKey?: string | null;
  readAt?: Date | null;
  createdAt: Date;
}

const notificationSchema = new Schema<NotificationDoc>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    kind: { type: String, enum: NOTIFICATION_KINDS, required: true },
    level: { type: String, enum: NOTIFICATION_LEVELS, required: true },
    title: { type: String, required: true },
    body: { type: String, default: '' },
    link: String,
    dedupeKey: String,
    readAt: Date,
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
notificationSchema.index({ userId: 1, createdAt: -1 });
notificationSchema.index({ userId: 1, readAt: 1 });
notificationSchema.index(
  { userId: 1, dedupeKey: 1 },
  { unique: true, partialFilterExpression: { dedupeKey: { $type: 'string' } } },
);
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 3600 });
notificationSchema.plugin(tenantGuard);

export const Notification = model<NotificationDoc>('Notification', notificationSchema);
