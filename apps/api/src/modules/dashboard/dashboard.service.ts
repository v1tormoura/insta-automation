import { ACCOUNT_STATUSES, ACTIVE_JOB_STATUSES, type AccountStatus, type DashboardDTO } from '@nexora/shared';
import type { Types } from 'mongoose';
import { DAY } from '../../lib/time.js';
import { InstagramAccount } from '../accounts/account.model.js';
import { PublishJob } from '../posts/job.model.js';
import { hydrateJobs } from '../posts/mappers.js';

function localDate(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

export async function getDashboard(userId: Types.ObjectId, timeZone: string): Promise<DashboardDTO> {
  const now = new Date();
  const since7d = new Date(now.getTime() - 7 * DAY);
  const since14d = new Date(now.getTime() - 14 * DAY);
  const today = localDate(now, timeZone);

  const [accounts, statusRows, upcoming, recent, daily] = await Promise.all([
    InstagramAccount.find({ userId }).lean(),
    PublishJob.aggregate<{ _id: string; n: number }>([
      { $match: { userId, $or: [{ status: { $in: ['SCHEDULED', ...ACTIVE_JOB_STATUSES] } }, { finishedAt: { $gte: since7d } }] } },
      {
        $group: {
          _id: {
            $cond: [{ $in: ['$status', ['PUBLISHED', 'FAILED', 'CANCELED']] }, { $concat: ['$status', '_7d'] }, '$status'],
          },
          n: { $sum: 1 },
        },
      },
    ]),
    PublishJob.find({ userId, status: { $in: ['SCHEDULED', ...ACTIVE_JOB_STATUSES] } }).sort({ runAt: 1 }).limit(6).lean(),
    PublishJob.find({ userId, status: { $in: ['PUBLISHED', 'FAILED'] } }).sort({ finishedAt: -1 }).limit(8).lean(),
    PublishJob.aggregate<{ _id: { date: string; status: string }; n: number }>([
      { $match: { userId, status: { $in: ['PUBLISHED', 'FAILED'] }, finishedAt: { $gte: since14d } } },
      { $group: { _id: { date: { $dateToString: { format: '%Y-%m-%d', date: '$finishedAt', timezone: timeZone } }, status: '$status' }, n: { $sum: 1 } } },
    ]),
  ]);

  const count = (k: string) => statusRows.find((r) => r._id === k)?.n ?? 0;
  const byStatus = Object.fromEntries(ACCOUNT_STATUSES.map((s) => [s, 0])) as Record<AccountStatus, number>;
  for (const a of accounts) byStatus[a.status]++;

  const days: DashboardDTO['daily'] = [];
  for (let i = 13; i >= 0; i--) {
    const date = localDate(new Date(now.getTime() - i * DAY), timeZone);
    days.push({
      date,
      published: daily.find((d) => d._id.date === date && d._id.status === 'PUBLISHED')?.n ?? 0,
      failed: daily.find((d) => d._id.date === date && d._id.status === 'FAILED')?.n ?? 0,
    });
  }

  const published7d = count('PUBLISHED_7d');
  const failed7d = count('FAILED_7d');
  const active = accounts.filter((a) => a.status !== 'DISCONNECTED');
  return {
    accounts: {
      total: active.length,
      byStatus,
      followers: active.reduce((sum, a) => sum + (a.followersCount ?? 0), 0),
    },
    jobs: {
      scheduled: count('SCHEDULED'),
      active: ACTIVE_JOB_STATUSES.reduce((sum, s) => sum + count(s), 0),
      publishedToday: days.find((d) => d.date === today)?.published ?? 0,
      published7d,
      failed7d,
      successRate7d: published7d + failed7d ? Math.round((published7d / (published7d + failed7d)) * 1000) / 10 : null,
    },
    daily: days,
    upcoming: await hydrateJobs(userId, upcoming),
    recent: await hydrateJobs(userId, recent),
    quotas: active.map((a) => ({
      accountId: a._id.toString(),
      username: a.username,
      usage: a.publishing?.quotaUsage ?? null,
      total: a.publishing?.quotaTotal ?? null,
    })),
  };
}
