import { Types } from 'mongoose';
import sharp from 'sharp';
import { InstagramAccount } from '../../src/modules/accounts/account.model.js';
import { sealToken } from '../../src/modules/accounts/tokenVault.js';
import { User } from '../../src/modules/auth/user.model.js';
import { Media } from '../../src/modules/media/media.model.js';
import { fileStorage } from '../../src/modules/media/storage.js';

let seq = 0;

export async function makeUser(overrides: Partial<{ plan: 'free' | 'pro' | 'business'; email: string }> = {}) {
  seq++;
  return User.create({
    email: overrides.email ?? `user${seq}-${Date.now()}@test.local`,
    name: `Usuário ${seq}`,
    passwordHash: 'scrypt$1$1$1$AAAA$AAAA',
    plan: overrides.plan ?? 'pro',
  });
}

export async function makeAccount(userId: Types.ObjectId, overrides: Record<string, unknown> = {}) {
  seq++;
  return InstagramAccount.create({
    userId,
    igUserId: `1784${seq}0000${seq}`,
    username: `conta_${seq}`,
    status: 'CONNECTED',
    permissions: ['instagram_business_basic', 'instagram_business_content_publish', 'instagram_business_manage_insights'],
    token: sealToken(`IGAAtoken${seq}xxxxxxxxxxxxxxxxxxxxxxxx`),
    tokenExpiresAt: new Date(Date.now() + 50 * 86_400_000),
    tokenRefreshedAt: new Date(),
    settings: { paused: false, minIntervalSeconds: 0 },
    publishing: { quotaUsage: 0, quotaTotal: 100, checkedAt: new Date() },
    ...overrides,
  });
}

export async function makeImageMedia(userId: Types.ObjectId, size = { width: 1080, height: 1080 }) {
  const _id = new Types.ObjectId();
  const key = `users/${userId}/media/${_id}/original.jpg`;
  const buf = await sharp({ create: { ...size, channels: 3, background: '#0af' } }).jpeg().toBuffer();
  await fileStorage().putBuffer(key, buf);
  return Media.create({
    _id,
    userId,
    kind: 'image',
    mimeType: 'image/jpeg',
    originalName: 'foto.jpg',
    sizeBytes: buf.length,
    width: size.width,
    height: size.height,
    storageKey: key,
    checksum: `sum-${_id}`,
  });
}

export async function makeVideoMedia(userId: Types.ObjectId, durationSeconds = 20) {
  const _id = new Types.ObjectId();
  const key = `users/${userId}/media/${_id}/original.mp4`;
  await fileStorage().putBuffer(key, Buffer.from('fake-video'));
  return Media.create({
    _id,
    userId,
    kind: 'video',
    mimeType: 'video/mp4',
    originalName: 'video.mp4',
    sizeBytes: 10_000,
    width: 1080,
    height: 1920,
    durationSeconds,
    storageKey: key,
    checksum: `sum-${_id}`,
  });
}
