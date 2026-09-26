import type { NotificationDTO, NotificationKind, NotificationLevel, Paginated } from '@nexora/shared';
import { Types } from 'mongoose';
import { logger } from '../../lib/logger.js';
import { emit } from '../realtime/events.js';
import { Notification, type NotificationDoc } from './notification.model.js';

export interface NotifyInput {
  kind: NotificationKind;
  level: NotificationLevel;
  title: string;
  body?: string;
  link?: string | null;
  dedupeKey?: string;
}

export function toNotificationDTO(n: NotificationDoc): NotificationDTO {
  return {
    id: n._id.toString(),
    kind: n.kind,
    level: n.level,
    title: n.title,
    body: n.body,
    link: n.link ?? null,
    readAt: n.readAt?.toISOString() ?? null,
    createdAt: n.createdAt.toISOString(),
  };
}

export async function notify(userId: Types.ObjectId, input: NotifyInput): Promise<void> {
  try {
    const doc = await Notification.create({ userId, ...input, body: input.body ?? '' });
    await emit(userId, { type: 'notification.created', notification: toNotificationDTO(doc) });
  } catch (err) {
    // dedupeKey repetida = o mesmo evento já notificou; não é erro.
    if ((err as { code?: number }).code === 11000) return;
    logger.warn({ err, kind: input.kind }, 'notificação não registrada');
  }
}

export async function listNotifications(userId: Types.ObjectId, page: number, pageSize: number): Promise<Paginated<NotificationDTO> & { unread: number }> {
  const [items, total, unread] = await Promise.all([
    Notification.find({ userId }).sort({ createdAt: -1 }).skip((page - 1) * pageSize).limit(pageSize).lean(),
    Notification.countDocuments({ userId }),
    Notification.countDocuments({ userId, readAt: null }),
  ]);
  return { items: items.map(toNotificationDTO), page, pageSize, total, unread };
}

export async function markRead(userId: Types.ObjectId, target: { all: true } | { ids: string[] }): Promise<number> {
  const filter =
    'all' in target
      ? { userId, readAt: null }
      : { userId, readAt: null, _id: { $in: target.ids.map((id) => new Types.ObjectId(id)) } };
  const res = await Notification.updateMany(filter, { $set: { readAt: new Date() } });
  return res.modifiedCount;
}
