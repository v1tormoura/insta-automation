import { POST_STATUSES, POST_TYPES, type PostDTO, type PostStatus, type PostType } from '@nexora/shared';
import { History } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { Pagination } from '@/components/Pagination';
import { EmptyState, ErrorState, PageHeader } from '@/components/States';
import { PostStatusBadge } from '@/components/StatusBadge';
import { Card } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { AccountFilter } from '@/features/accounts/AccountFilter';
import { usePosts } from '@/features/compose/api';
import { JobThumb } from '@/features/queue/JobRow';
import { formatDateTime } from '@/lib/format';
import { POST_STATUS, POST_TYPE_LABEL } from '@/lib/labels';

const ALL = '__all__';

function PostRow({ post }: { post: PostDTO }) {
  const done = post.counts.published + post.counts.failed;
  return (
    <Link to={`/posts/${post.id}`} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/40">
      <JobThumb src={post.media[0]?.thumbnailUrl ?? null} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{POST_TYPE_LABEL[post.type]}</span>
          <PostStatusBadge status={post.status} />
          {post.campaignId && <span className="text-xs text-muted-foreground">· fila</span>}
        </div>
        <p className="line-clamp-1 text-sm text-muted-foreground">{post.caption || 'Sem legenda'}</p>
      </div>
      <div className="hidden shrink-0 text-right text-xs text-muted-foreground sm:block">
        <p className="tabular">
          {post.counts.published}/{post.counts.total - post.counts.canceled} contas
          {post.counts.failed ? <span className="text-destructive"> · {post.counts.failed} falha(s)</span> : null}
        </p>
        <p>{formatDateTime(post.scheduledAt ?? post.createdAt)}</p>
        {post.counts.pending > 0 && done > 0 && <p>em andamento</p>}
      </div>
    </Link>
  );
}

export function HistoryPage() {
  const [status, setStatus] = useState<PostStatus>();
  const [type, setType] = useState<PostType>();
  const [accountId, setAccountId] = useState<string>();
  const [page, setPage] = useState(1);
  const { data, isLoading, error, refetch } = usePosts({ status, type, accountId, page, pageSize: 20 });

  return (
    <div className="space-y-6">
      <PageHeader title="Histórico" description="Todas as publicações: rascunhos, agendadas, publicadas e com falha." />
      <div className="flex flex-wrap gap-2">
        <Select value={status ?? ALL} onValueChange={(v) => (setStatus(v === ALL ? undefined : (v as PostStatus)), setPage(1))}>
          <SelectTrigger className="w-44" aria-label="Filtrar por status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todos os status</SelectItem>
            {POST_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {POST_STATUS[s].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={type ?? ALL} onValueChange={(v) => (setType(v === ALL ? undefined : (v as PostType)), setPage(1))}>
          <SelectTrigger className="w-40" aria-label="Filtrar por tipo">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todos os tipos</SelectItem>
            {POST_TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                {POST_TYPE_LABEL[t]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <AccountFilter value={accountId} onChange={(id) => (setAccountId(id), setPage(1))} />
      </div>

      {error ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : (
        <Card className="overflow-hidden">
          {isLoading ? (
            <div className="space-y-3 p-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
          ) : data?.items.length ? (
            <div className="divide-y">{data.items.map((p) => <PostRow key={p.id} post={p} />)}</div>
          ) : (
            <EmptyState icon={History} title="Nenhuma publicação encontrada" description="Ajuste os filtros ou crie uma nova publicação." className="m-4 border-0" />
          )}
        </Card>
      )}
      {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
    </div>
  );
}
