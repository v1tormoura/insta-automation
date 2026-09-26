import { ACTIVE_JOB_STATUSES, type JobDTO } from '@nexora/shared';
import { ExternalLink, MoreHorizontal, Play, RotateCcw, XCircle, Zap } from 'lucide-react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { AccountAvatar } from '@/components/AccountAvatar';
import { JobStatusBadge } from '@/components/StatusBadge';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Progress } from '@/components/ui/progress';
import { useJobAction } from '@/features/compose/api';
import { errorMessage } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { POST_TYPE_LABEL } from '@/lib/labels';
import { cn } from '@/lib/utils';

export function JobThumb({ src, className }: { src: string | null; className?: string }) {
  return (
    <div className={cn('size-11 shrink-0 overflow-hidden rounded-lg border bg-muted', className)}>
      {src ? <img src={src} alt="" className="size-full object-cover" loading="lazy" /> : null}
    </div>
  );
}

export function JobRow({ job, showPostLink = true, compact }: { job: JobDTO; showPostLink?: boolean; compact?: boolean }) {
  const action = useJobAction();
  const active = ACTIVE_JOB_STATUSES.includes(job.status);
  const run = (a: 'cancel' | 'retry' | 'run-now', ok: string) =>
    action.mutate({ id: job.id, action: a }, { onSuccess: () => toast.success(ok), onError: (e) => toast.error(errorMessage(e)) });

  const canCancel = ['SCHEDULED', 'QUEUED', 'CREATING', 'PROCESSING'].includes(job.status);
  const when = job.status === 'PUBLISHED' ? job.publishedAt : job.status === 'SCHEDULED' ? job.runAt : job.updatedAt;

  return (
    <div className="flex items-start gap-3 py-3">
      <JobThumb src={job.thumbnailUrl} />
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {job.account && (
            <span className="flex items-center gap-1.5 text-sm font-medium">
              <AccountAvatar username={job.account.username} src={job.account.profilePictureUrl} className="size-5" />@{job.account.username}
            </span>
          )}
          <span className="text-xs text-muted-foreground">· {POST_TYPE_LABEL[job.postType]}</span>
          <JobStatusBadge status={job.status} />
        </div>
        {!compact && job.captionPreview && <p className="line-clamp-1 text-sm text-muted-foreground">{job.captionPreview}</p>}
        {active && <Progress value={job.progress} className="h-1 max-w-sm" aria-label={`Progresso ${job.progress}%`} />}
        {job.waitReason && job.status !== 'FAILED' && <p className="text-xs text-warning">{job.waitReason}</p>}
        {job.error && job.status === 'FAILED' && (
          <p className="text-xs text-destructive">
            {job.error.message}
            {job.error.metaSubcode ? <span className="text-muted-foreground"> (código {job.error.metaSubcode})</span> : null}
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          {job.status === 'SCHEDULED' ? 'Agendado para ' : job.status === 'PUBLISHED' ? 'Publicado ' : 'Atualizado '}
          {formatDateTime(when)}
          {job.attempts > 0 && job.status !== 'PUBLISHED' ? ` · ${job.attempts} tentativa${job.attempts > 1 ? 's' : ''}` : ''}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {job.permalink && (
          <Button asChild variant="ghost" size="icon-sm" aria-label="Abrir no Instagram">
            <a href={job.permalink} target="_blank" rel="noreferrer">
              <ExternalLink />
            </a>
          </Button>
        )}
        {job.status === 'FAILED' && (
          <Button variant="outline" size="sm" loading={action.isPending} onClick={() => run('retry', 'Nova tentativa na fila.')}>
            <RotateCcw /> Tentar de novo
          </Button>
        )}
        {(canCancel || job.status === 'SCHEDULED' || showPostLink) && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Ações">
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {showPostLink && (
                <DropdownMenuItem asChild>
                  <Link to={`/posts/${job.postId}`}>
                    <Play /> Ver publicação
                  </Link>
                </DropdownMenuItem>
              )}
              {job.status === 'SCHEDULED' && (
                <DropdownMenuItem onSelect={() => run('run-now', 'Publicação antecipada.')}>
                  <Zap /> Publicar agora
                </DropdownMenuItem>
              )}
              {canCancel && (
                <DropdownMenuItem variant="destructive" onSelect={() => run('cancel', 'Publicação cancelada.')}>
                  <XCircle /> Cancelar nesta conta
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  );
}
