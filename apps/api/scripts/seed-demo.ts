/**
 * Dados de demonstração para desenvolvimento de interface.
 *
 *   npm run seed:demo --workspace @nexora/api
 *
 * Cria o usuário demo@nexora.dev (senha: demo-nexora-123) com contas,
 * mídias, histórico, agendamentos e métricas FICTÍCIOS. As contas não têm
 * token válido: nada aqui publica de verdade. Recusa rodar em produção.
 */
import { Types } from 'mongoose';
import sharp from 'sharp';
import { env } from '../src/config/env.js';
import { connectMongo, disconnectMongo, syncIndexes } from '../src/infra/mongo.js';
import { closeRedis } from '../src/infra/redis.js';
import { hashPassword } from '../src/lib/password.js';
import { isoDate } from '../src/lib/time.js';
import { InstagramAccount } from '../src/modules/accounts/account.model.js';
import { sealToken } from '../src/modules/accounts/tokenVault.js';
import { User } from '../src/modules/auth/user.model.js';
import { Campaign } from '../src/modules/campaigns/campaign.model.js';
import { AccountSnapshot, MediaInsight } from '../src/modules/insights/insight.models.js';
import { Media } from '../src/modules/media/media.model.js';
import { fileStorage } from '../src/modules/media/storage.js';
import { Notification } from '../src/modules/notifications/notification.model.js';
import { PublishJob } from '../src/modules/posts/job.model.js';
import { Post } from '../src/modules/posts/post.model.js';
import { recomputeCampaign, recomputePost } from '../src/modules/publishing/aggregate.js';

if (env.NODE_ENV === 'production') {
  console.error('seed-demo não roda em produção.');
  process.exit(1);
}

const DAY = 86_400_000;
const HOUR = 3_600_000;
const rand = (min: number, max: number) => Math.round(min + Math.random() * (max - min));
const pick = <T>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)]!;

const CAPTIONS = [
  'Nova coleção chegando ✨ Qual é a sua favorita? #moda #lancamento',
  'Bastidores do ensaio de hoje 📸 #bastidores',
  'Dica rápida: 3 formas de usar a mesma peça #dicas #estilo',
  'Promoção de fim de semana! Link na bio 🛍️',
  'Obrigado pelos 10 mil! ❤️ #comunidade',
  'Tutorial completo no Reel de hoje #tutorial',
];
const PALETTES = [
  ['#0ea5e9', '#6366f1'],
  ['#f97316', '#db2777'],
  ['#10b981', '#0ea5e9'],
  ['#8b5cf6', '#ec4899'],
  ['#f59e0b', '#ef4444'],
  ['#14b8a6', '#84cc16'],
];

async function makeImage(userId: Types.ObjectId, i: number) {
  const [a, b] = PALETTES[i % PALETTES.length]!;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><circle cx="780" cy="380" r="220" fill="white" fill-opacity="0.18"/><text x="80" y="1220" font-family="sans-serif" font-size="96" font-weight="700" fill="white" fill-opacity="0.9">Nexora #${i + 1}</text></svg>`;
  const buf = await sharp(Buffer.from(svg)).jpeg({ quality: 88 }).toBuffer();
  const _id = new Types.ObjectId();
  const key = `users/${userId}/media/${_id}/original.jpg`;
  const thumbKey = `users/${userId}/media/${_id}/thumb.webp`;
  await fileStorage().putBuffer(key, buf);
  await fileStorage().putBuffer(thumbKey, await sharp(buf).resize({ width: 480 }).webp().toBuffer());
  return Media.create({
    _id,
    userId,
    kind: 'image',
    mimeType: 'image/jpeg',
    originalName: `arte-${i + 1}.jpg`,
    sizeBytes: buf.length,
    width: 1080,
    height: 1350,
    storageKey: key,
    thumbnailKey: thumbKey,
    checksum: `demo-${_id}`,
  });
}

async function main() {
  await connectMongo();
  await syncIndexes();

  const existing = await User.findOne({ email: 'demo@nexora.dev' }).lean();
  if (existing) {
    const userId = existing._id;
    for (const model of [InstagramAccount, Media, Post, PublishJob, Campaign, Notification, AccountSnapshot, MediaInsight]) {
      await (model as unknown as typeof Post).deleteMany({ userId });
    }
    await User.deleteOne({ _id: userId });
  }
  const user = await User.create({ email: 'demo@nexora.dev', name: 'Marina Demo', passwordHash: await hashPassword('demo-nexora-123'), plan: 'pro' });
  const userId = user._id;

  const specs = [
    { username: 'loja.aurora', name: 'Aurora Moda', followers: 48_210, media: 812, status: 'CONNECTED' },
    { username: 'aurora.outlet', name: 'Aurora Outlet', followers: 12_940, media: 233, status: 'CONNECTED' },
    { username: 'studio.lumen', name: 'Studio Lumen', followers: 7_385, media: 144, status: 'CONNECTED' },
    { username: 'lumen.cursos', name: 'Lumen Cursos', followers: 2_110, media: 51, status: 'EXPIRED' },
  ] as const;
  const accounts = [];
  for (const [i, s] of specs.entries()) {
    accounts.push(
      await InstagramAccount.create({
        userId,
        igUserId: `178414000000${i}0000`,
        username: s.username,
        name: s.name,
        accountType: i === 2 ? 'MEDIA_CREATOR' : 'BUSINESS',
        followersCount: s.followers,
        followsCount: rand(100, 900),
        mediaCount: s.media,
        status: s.status,
        statusReason: s.status === 'EXPIRED' ? 'O acesso à conta expirou ou foi revogado. Reconecte a conta.' : null,
        permissions: i === 2
          ? ['instagram_business_basic', 'instagram_business_content_publish']
          : ['instagram_business_basic', 'instagram_business_content_publish', 'instagram_business_manage_insights'],
        token: sealToken(`demo-token-${i}-sem-validade`),
        tokenExpiresAt: new Date(Date.now() + (s.status === 'EXPIRED' ? -DAY : rand(20, 55) * DAY)),
        tokenRefreshedAt: new Date(Date.now() - 3 * DAY),
        lastSyncedAt: new Date(Date.now() - rand(5, 180) * 60_000),
        lastPublishedAt: new Date(Date.now() - rand(1, 20) * HOUR),
        settings: { paused: i === 1 && false, minIntervalSeconds: 300 },
        publishing: { quotaUsage: [12, 71, 4, 0][i], quotaTotal: 100, checkedAt: new Date() },
      }),
    );
    for (let d = 0; d < 30; d++) {
      await AccountSnapshot.create({
        userId,
        accountId: accounts[i]!._id,
        date: isoDate(new Date(Date.now() - d * DAY)),
        followersCount: Math.round(s.followers * (1 - d * 0.0035) + rand(-40, 40)),
        mediaCount: s.media - Math.floor(d / 2),
      });
    }
  }

  const media = [];
  for (let i = 0; i < 6; i++) media.push(await makeImage(userId, i));

  // Histórico: publicações dos últimos 14 dias.
  for (let d = 13; d >= 0; d--) {
    const perDay = rand(1, 3);
    for (let k = 0; k < perDay; k++) {
      const when = new Date(Date.now() - d * DAY - rand(1, 10) * HOUR);
      const targets = accounts.slice(0, rand(1, 3));
      const post = await Post.create({
        userId,
        type: 'IMAGE',
        caption: pick(CAPTIONS),
        mediaIds: [pick(media)._id],
        status: 'PUBLISHED',
        scheduledAt: when,
        accountIds: targets.map((a) => a._id),
        createdAt: new Date(when.getTime() - HOUR),
      });
      for (const a of targets) {
        const failed = Math.random() < 0.08;
        await PublishJob.create({
          userId,
          postId: post._id,
          accountId: a._id,
          postType: 'IMAGE',
          status: failed ? 'FAILED' : 'PUBLISHED',
          runAt: when,
          attempts: failed ? 3 : 1,
          startedAt: when,
          publishedAt: failed ? null : new Date(when.getTime() + 40_000),
          finishedAt: new Date(when.getTime() + 40_000),
          igMediaId: failed ? null : `demo_${new Types.ObjectId()}`,
          permalink: failed ? null : `https://www.instagram.com/${a.username}/`,
          error: failed
            ? { code: 'META_MEDIA', message: 'O Instagram não conseguiu baixar a mídia pela URL pública.', retryable: true, metaCode: 9, metaSubcode: 2207052 }
            : null,
          history: [{ at: when, status: failed ? 'FAILED' : 'PUBLISHED' }],
        });
      }
      await recomputePost(userId, post._id);
    }
  }

  // Uma fila em andamento, com itens agendados nos próximos dias (não entram no BullMQ).
  const start = new Date(Date.now() + 6 * HOUR);
  const campaign = await Campaign.create({
    userId,
    name: 'Lançamento coleção Primavera',
    accountIds: accounts.slice(0, 3).map((a) => a._id),
    startAt: start,
    endsAt: new Date(start.getTime() + 3 * 24 * HOUR + 10 * 60_000),
    intervalMinutes: 24 * 60,
    accountStaggerMinutes: 5,
  });
  const postIds = [];
  for (let i = 0; i < 4; i++) {
    const post = await Post.create({
      userId,
      campaignId: campaign._id,
      type: i === 2 ? 'CAROUSEL' : 'IMAGE',
      caption: CAPTIONS[i]!,
      mediaIds: i === 2 ? [media[0]!._id, media[1]!._id, media[2]!._id] : [media[i]!._id],
      status: 'SCHEDULED',
      scheduledAt: new Date(start.getTime() + i * DAY),
      accountIds: campaign.accountIds,
      accountStaggerMinutes: 5,
    });
    postIds.push(post._id);
    for (const [j, accountId] of campaign.accountIds.entries()) {
      await PublishJob.create({
        userId,
        postId: post._id,
        campaignId: campaign._id,
        accountId,
        postType: post.type,
        status: 'SCHEDULED',
        runAt: new Date(start.getTime() + i * DAY + j * 5 * 60_000),
        history: [{ at: new Date(), status: 'SCHEDULED' }],
      });
    }
  }
  await Campaign.updateOne({ userId, _id: campaign._id }, { $set: { postIds } });
  for (const id of postIds) await recomputePost(userId, id);
  await recomputeCampaign(userId, campaign._id);

  // Métricas de mídia sincronizadas.
  for (const [i, a] of accounts.slice(0, 2).entries()) {
    for (let k = 0; k < 8; k++) {
      const views = rand(800, 24_000) * (i === 0 ? 2 : 1);
      await MediaInsight.create({
        userId,
        accountId: a._id,
        igMediaId: `demo_media_${i}_${k}`,
        mediaType: k % 3 === 0 ? 'VIDEO' : 'IMAGE',
        productType: k % 3 === 0 ? 'REELS' : 'FEED',
        caption: pick(CAPTIONS),
        permalink: `https://www.instagram.com/${a.username}/`,
        timestamp: new Date(Date.now() - k * 1.7 * DAY),
        metrics: {
          views,
          reach: Math.round(views * 0.72),
          likes: Math.round(views * 0.06),
          comments: Math.round(views * 0.004),
          saved: Math.round(views * 0.01),
          shares: Math.round(views * 0.007),
          total_interactions: Math.round(views * 0.083),
        },
        unavailable: [],
        syncedAt: new Date(),
      });
    }
  }

  await Notification.create([
    { userId, kind: 'account.expired', level: 'warning', title: '@lumen.cursos precisa ser reconectada', body: 'O acesso à conta expirou ou foi revogado.', link: '/accounts' },
    { userId, kind: 'post.completed', level: 'success', title: 'Publicação concluída', body: 'Publicado em 3 de 3 contas.', link: '/history', readAt: new Date() },
  ]);

  console.log('Demo pronto: demo@nexora.dev / demo-nexora-123');
  await closeRedis();
  await disconnectMongo();
}

main().catch(async (err) => {
  console.error(err);
  await disconnectMongo();
  process.exit(1);
});
