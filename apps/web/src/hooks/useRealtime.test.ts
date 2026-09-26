import type { AccountDTO, JobDTO, Paginated, RealtimeEvent } from '@nexora/shared';
import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { qk } from '@/lib/queryKeys';
import { applyEvent } from './useRealtime';

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }) }));

const job = (over: Partial<JobDTO>): JobDTO => ({
  id: 'j1',
  postId: 'p1',
  campaignId: null,
  accountId: 'a1',
  account: null,
  postType: 'IMAGE',
  captionPreview: '',
  thumbnailUrl: null,
  status: 'QUEUED',
  progress: 10,
  runAt: new Date().toISOString(),
  attempts: 0,
  waitReason: null,
  startedAt: null,
  publishedAt: null,
  igMediaId: null,
  permalink: null,
  error: null,
  updatedAt: new Date().toISOString(),
  ...over,
});

describe('applyEvent', () => {
  it('atualiza o job em todas as listas em cache e agenda invalidação dos agregados', () => {
    const qc = new QueryClient();
    const key = qk.jobs({ status: 'QUEUED' });
    qc.setQueryData<Paginated<JobDTO>>(key, { items: [job({}), job({ id: 'j2' })], page: 1, pageSize: 20, total: 2 });
    const invalidate = vi.fn();
    applyEvent(qc, { type: 'job.updated', job: job({ status: 'PUBLISHED', progress: 100 }) }, invalidate);
    const list = qc.getQueryData<Paginated<JobDTO>>(key)!;
    expect(list.items[0]).toMatchObject({ id: 'j1', status: 'PUBLISHED' });
    expect(list.items[1]!.status).toBe('QUEUED');
    expect(invalidate).toHaveBeenCalledWith([...qk.jobsAll], [...qk.dashboard]);
  });

  it('conta nova entra na lista; conta existente é substituída', () => {
    const qc = new QueryClient();
    const base = { id: 'a1', username: 'x', status: 'CONNECTED' } as AccountDTO;
    qc.setQueryData(qk.accounts, { items: [base] });
    applyEvent(qc, { type: 'account.updated', account: { ...base, status: 'EXPIRED' } } as RealtimeEvent, vi.fn());
    applyEvent(qc, { type: 'account.updated', account: { ...base, id: 'a2' } } as RealtimeEvent, vi.fn());
    const items = qc.getQueryData<{ items: AccountDTO[] }>(qk.accounts)!.items;
    expect(items.map((a) => [a.id, a.status])).toEqual([
      ['a1', 'EXPIRED'],
      ['a2', 'CONNECTED'],
    ]);
  });

  it('notificação nova incrementa o contador de não lidas', () => {
    const qc = new QueryClient();
    qc.setQueryData(qk.notifications, { items: [], page: 1, pageSize: 50, total: 0, unread: 0 });
    applyEvent(
      qc,
      { type: 'notification.created', notification: { id: 'n1', kind: 'job.failed', level: 'error', title: 'Falhou', body: '', link: null, readAt: null, createdAt: '' } },
      vi.fn(),
    );
    expect(qc.getQueryData<{ unread: number; items: unknown[] }>(qk.notifications)).toMatchObject({ unread: 1, items: [{ id: 'n1' }] });
  });
});
