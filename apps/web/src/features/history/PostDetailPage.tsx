import { PENDING_JOB_STATUSES } from '@nexora/shared';
import { ArrowLeft, Ban, Send, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { ErrorState } from '@/components/States';
import { PostStatusBadge } from '@/components/StatusBadge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { AccountSelector } from '@/features/compose/AccountSelector';
import { usePost, usePostAction, useSubmitDraft } from '@/features/compose/api';
import { SchedulePicker, defaultSchedule, type ScheduleValue } from '@/features/compose/SchedulePicker';
import { MediaTile } from '@/features/media/MediaTile';
import { JobRow } from '@/features/queue/JobRow';
import { errorMessage } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { POST_TYPE_LABEL } from '@/lib/labels';

function SubmitDraftDialog({ postId, initialAccounts, open, onOpenChange }: { postId: string; initialAccounts: string[]; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [accountIds, setAccountIds] = useState(initialAccounts);
  const [schedule, setSchedule] = useState<ScheduleValue>(defaultSchedule);
  const submit = useSubmitDraft();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Enviar rascunho para a fila</DialogTitle>
        </DialogHeader>
        <div className="space-y-5">
          <AccountSelector value={accountIds} onChange={setAccountIds} />
          <SchedulePicker value={schedule} onChange={setSchedule} accountIds={accountIds} allowDraft={false} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            disabled={!accountIds.length}
            loading={submit.isPending}
            onClick={() =>
              submit.mutate(
                {
                  id: postId,
                  accountIds,
                  accountStaggerMinutes: schedule.staggerMinutes,
                  schedule: schedule.mode === 'scheduled' ? { mode: 'scheduled', at: new Date(schedule.at) } : { mode: 'now' },
                },
                {
                  onSuccess: () => {
                    toast.success('Rascunho enviado para a fila.');
                    onOpenChange(false);
                  },
                  onError: (e) => toast.error(errorMessage(e)),
                },
              )
            }
          >
            <Send /> Enviar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function PostDetailPage() {
  const { id } = useParams();
  const { data: post, isLoading, error, refetch } = usePost(id);
  const action = usePostAction();
  const navigate = useNavigate();
  const [confirm, setConfirm] = useState<'cancel' | 'delete' | null>(null);
  const [submitOpen, setSubmitOpen] = useState(false);

  if (isLoading) return <Skeleton className="h-96 w-full rounded-xl" />;
  if (error || !post) return <ErrorState error={error ?? new Error('Publicação não encontrada.')} onRetry={() => void refetch()} />;

  const pending = post.jobs?.some((j) => PENDING_JOB_STATUSES.includes(j.status)) ?? false;
  const deletable = ['DRAFT', 'CANCELED', 'FAILED'].includes(post.status);
  const done = post.counts.published + post.counts.failed + post.counts.canceled;
  const pct = post.counts.total ? Math.round((done / post.counts.total) * 100) : 0;

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link to="/history">
          <ArrowLeft /> Histórico
        </Link>
      </Button>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{POST_TYPE_LABEL[post.type]}</h1>
            <PostStatusBadge status={post.status} />
          </div>
          <p className="text-sm text-muted-foreground">
            Criada {formatDateTime(post.createdAt)}
            {post.scheduledAt ? ` · início ${formatDateTime(post.scheduledAt)}` : ''}
            {post.campaignId && (
              <>
                {' · '}
                <Link to={`/campaigns/${post.campaignId}`} className="text-primary hover:underline">
                  parte de uma fila
                </Link>
              </>
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {post.status === 'DRAFT' && (
            <Button onClick={() => setSubmitOpen(true)}>
              <Send /> Publicar / agendar
            </Button>
          )}
          {pending && (
            <Button variant="outline" onClick={() => setConfirm('cancel')}>
              <Ban /> Cancelar pendentes
            </Button>
          )}
          {deletable && (
            <Button variant="outline" onClick={() => setConfirm('delete')}>
              <Trash2 /> Excluir
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card>
          <CardHeader>
            <CardTitle>Publicação por conta</CardTitle>
            <CardDescription>
              {post.counts.published} publicadas · {post.counts.failed} com falha · {post.counts.pending} pendentes
            </CardDescription>
            {post.counts.total > 0 && <Progress value={pct} className="mt-2" aria-label={`${pct}% concluído`} />}
          </CardHeader>
          <CardContent className="py-2">
            {post.jobs?.length ? (
              <div className="divide-y">{post.jobs.map((j) => <JobRow key={j.id} job={j} showPostLink={false} />)}</div>
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">Rascunho: ainda não enviado para nenhuma conta.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Conteúdo</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-3 gap-2">
              {post.media.map((m) => (
                <MediaTile key={m.id} media={m} />
              ))}
            </div>
            {post.cover && (
              <p className="text-xs text-muted-foreground">
                Capa: {post.cover.media ? 'imagem própria' : `quadro em ${((post.cover.thumbOffsetMs ?? 0) / 1000).toFixed(1)}s`}
              </p>
            )}
            <p className="text-sm whitespace-pre-line">{post.caption || <span className="text-muted-foreground">Sem legenda</span>}</p>
            {post.type === 'REEL' && <p className="text-xs text-muted-foreground">{post.shareToFeed ? 'Aparece também no feed.' : 'Somente na aba Reels.'}</p>}
          </CardContent>
        </Card>
      </div>

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(o) => !o && setConfirm(null)}
        destructive
        title={confirm === 'delete' ? 'Excluir esta publicação?' : 'Cancelar publicações pendentes?'}
        description={
          confirm === 'delete'
            ? 'Ela sai do histórico. Posts já publicados no Instagram não são afetados.'
            : 'As contas que ainda não publicaram não vão publicar. O que já foi publicado continua no Instagram.'
        }
        confirmLabel={confirm === 'delete' ? 'Excluir' : 'Cancelar pendentes'}
        loading={action.isPending}
        onConfirm={() =>
          action.mutate(
            { id: post.id, action: confirm === 'delete' ? 'delete' : 'cancel' },
            {
              onSuccess: () => {
                setConfirm(null);
                if (confirm === 'delete') navigate('/history');
                else toast.success('Pendentes cancelados.');
              },
              onError: (e) => toast.error(errorMessage(e)),
            },
          )
        }
      />
      {submitOpen && (
        <SubmitDraftDialog postId={post.id} initialAccounts={post.accountIds} open={submitOpen} onOpenChange={setSubmitOpen} />
      )}
    </div>
  );
}
