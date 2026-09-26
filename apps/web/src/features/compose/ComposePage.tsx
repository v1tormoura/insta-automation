import { createPostSchema, type CreatePostInput } from '@nexora/shared';
import { AlertTriangle, Send } from 'lucide-react';
import { useReducer, useState } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { PageHeader } from '@/components/States';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAccounts } from '@/features/accounts/api';
import { errorMessage } from '@/lib/api';
import { AccountSelector } from './AccountSelector';
import { useCreatePost } from './api';
import { ContentEditor } from './ContentEditor';
import { contentProblems, contentReducer, emptyContent, toContentInput } from './contentState';
import { PostPreview } from './PostPreview';
import { SchedulePicker, defaultSchedule, type ScheduleValue } from './SchedulePicker';

export function buildCreatePostInput(
  content: ReturnType<typeof toContentInput>,
  accountIds: string[],
  schedule: ScheduleValue,
): CreatePostInput {
  return {
    content,
    accountIds,
    accountStaggerMinutes: schedule.staggerMinutes,
    schedule:
      schedule.mode === 'scheduled' ? { mode: 'scheduled', at: new Date(schedule.at) } : schedule.mode === 'now' ? { mode: 'now' } : { mode: 'draft' },
  };
}

export function ComposePage() {
  const [draft, dispatch] = useReducer(contentReducer, undefined, () => emptyContent('IMAGE'));
  const [accountIds, setAccountIds] = useState<string[]>([]);
  const [schedule, setSchedule] = useState<ScheduleValue>(defaultSchedule);
  const [attempted, setAttempted] = useState(false);
  const create = useCreatePost();
  const navigate = useNavigate();
  const { data: accounts } = useAccounts();

  const problems = [...contentProblems(draft), ...(accountIds.length ? [] : ['Selecione ao menos uma conta.'])];
  if (schedule.mode === 'scheduled' && new Date(schedule.at).getTime() < Date.now()) problems.push('O horário agendado já passou.');

  const submit = () => {
    setAttempted(true);
    if (problems.length) return;
    const input = buildCreatePostInput(toContentInput(draft), accountIds, schedule);
    const parsed = createPostSchema.safeParse(input);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]!.message);
      return;
    }
    create.mutate(input, {
      onSuccess: (post) => {
        toast.success(schedule.mode === 'draft' ? 'Rascunho salvo.' : schedule.mode === 'now' ? 'Publicação enviada para a fila.' : 'Publicação agendada.');
        navigate(`/posts/${post.id}`);
      },
      onError: (e) => toast.error(errorMessage(e)),
    });
  };

  const cta = schedule.mode === 'draft' ? 'Salvar rascunho' : schedule.mode === 'now' ? `Publicar${accountIds.length > 1 ? ` em ${accountIds.length} contas` : ''}` : 'Agendar';

  return (
    <div className="space-y-6">
      <PageHeader title="Nova publicação" description="Monte o conteúdo, escolha as contas e defina quando publicar." />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Conteúdo</CardTitle>
              <CardDescription>O formato define o que a API oficial aceita.</CardDescription>
            </CardHeader>
            <CardContent>
              <ContentEditor draft={draft} dispatch={dispatch} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Destino e horário</CardTitle>
              <CardDescription>Cada conta publica de forma independente.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <AccountSelector value={accountIds} onChange={setAccountIds} />
              <SchedulePicker value={schedule} onChange={setSchedule} accountIds={accountIds} />
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          <PostPreview draft={draft} account={accounts?.find((a) => a.id === accountIds[0])} />
          {attempted && problems.length > 0 && (
            <Alert variant="destructive">
              <AlertTriangle />
              <AlertDescription className="text-foreground">
                <ul className="list-disc space-y-0.5 pl-4">
                  {problems.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}
          <Button className="w-full" size="lg" onClick={submit} loading={create.isPending}>
            <Send /> {cta}
          </Button>
        </div>
      </div>
    </div>
  );
}
