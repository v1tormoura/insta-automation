import { createCampaignSchema, planSchedule, type CreateCampaignInput } from '@nexora/shared';
import { AlertTriangle, ChevronDown, ChevronUp, Copy, Plus, Rocket, Trash2 } from 'lucide-react';
import { useMemo, useReducer, useState } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { PageHeader } from '@/components/States';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAccounts } from '@/features/accounts/api';
import { AccountSelector } from '@/features/compose/AccountSelector';
import { ContentEditor } from '@/features/compose/ContentEditor';
import { contentProblems, contentReducer, emptyContent, toContentInput, type ContentAction, type ContentDraft } from '@/features/compose/contentState';
import { MinutesInput } from '@/features/compose/SchedulePicker';
import { errorMessage } from '@/lib/api';
import { formatDateTime, toLocalInputValue } from '@/lib/format';
import { POST_TYPE_LABEL } from '@/lib/labels';
import { cn } from '@/lib/utils';
import { useCreateCampaign } from './api';

interface Item {
  key: string;
  draft: ContentDraft;
}

type ItemsAction =
  | { type: 'add'; draft?: ContentDraft }
  | { type: 'remove'; key: string }
  | { type: 'move'; key: string; delta: -1 | 1 }
  | { type: 'edit'; key: string; action: ContentAction };

const newKey = () => Math.random().toString(36).slice(2);

function itemsReducer(items: Item[], a: ItemsAction): Item[] {
  switch (a.type) {
    case 'add':
      return [...items, { key: newKey(), draft: a.draft ?? emptyContent(items.at(-1)?.draft.type ?? 'IMAGE') }];
    case 'remove':
      return items.length > 1 ? items.filter((i) => i.key !== a.key) : items;
    case 'move': {
      const i = items.findIndex((x) => x.key === a.key);
      const j = i + a.delta;
      if (i < 0 || j < 0 || j >= items.length) return items;
      const next = [...items];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    }
    case 'edit':
      return items.map((i) => (i.key === a.key ? { ...i, draft: contentReducer(i.draft, a.action) } : i));
  }
}

export function NewCampaignPage() {
  const [name, setName] = useState('');
  const [items, dispatch] = useReducer(itemsReducer, undefined, () => [{ key: newKey(), draft: emptyContent('IMAGE') }]);
  const [open, setOpen] = useState(items[0]!.key);
  const [accountIds, setAccountIds] = useState<string[]>([]);
  const [startMode, setStartMode] = useState<'now' | 'at'>('at');
  const [startAt, setStartAt] = useState(toLocalInputValue(new Date(Date.now() + 30 * 60_000)));
  const [interval, setIntervalMinutes] = useState(60);
  const [stagger, setStagger] = useState(5);
  const [attempted, setAttempted] = useState(false);
  const create = useCreateCampaign();
  const navigate = useNavigate();
  const { data: accounts } = useAccounts();
  const names = new Map(accounts?.map((a) => [a.id, a.username]));

  const start = startMode === 'now' ? new Date() : new Date(startAt);
  const plan = useMemo(
    () =>
      accountIds.length && !Number.isNaN(start.getTime())
        ? planSchedule({ startAt: start, itemCount: items.length, accountIds, intervalMinutes: interval, accountStaggerMinutes: stagger })
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [accountIds.join(','), items.length, startMode, startAt, interval, stagger],
  );

  const problems: string[] = [];
  if (!name.trim()) problems.push('Dê um nome à fila.');
  if (!accountIds.length) problems.push('Selecione ao menos uma conta.');
  items.forEach((it, i) => contentProblems(it.draft).forEach((p) => problems.push(`Conteúdo ${i + 1}: ${p}`)));
  if (startMode === 'at' && start.getTime() < Date.now()) problems.push('O início agendado já passou.');

  const submit = () => {
    setAttempted(true);
    if (problems.length) return;
    const input: CreateCampaignInput = {
      name: name.trim(),
      accountIds,
      items: items.map((i) => toContentInput(i.draft)),
      startAt: startMode === 'now' ? 'now' : start,
      intervalMinutes: interval,
      accountStaggerMinutes: stagger,
    };
    const parsed = createCampaignSchema.safeParse(input);
    if (!parsed.success) return void toast.error(parsed.error.issues[0]!.message);
    create.mutate(input, {
      onSuccess: (c) => {
        toast.success(`Fila criada: ${c.counts.total} publicações programadas.`);
        navigate(`/campaigns/${c.id}`);
      },
      onError: (e) => toast.error(errorMessage(e)),
    });
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Nova fila de publicação" description="Cada conta publica os conteúdos na ordem, respeitando o intervalo. Entre contas, o mesmo conteúdo é espaçado." />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-6">
          <Card>
            <CardContent className="space-y-2 pt-5">
              <Label htmlFor="campaign-name">Nome da fila</Label>
              <Input id="campaign-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Lançamento da coleção de outubro" maxLength={120} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Conteúdos ({items.length})</CardTitle>
              <CardDescription>Publicados nesta ordem.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {items.map((it, i) => {
                const expanded = open === it.key;
                const issues = contentProblems(it.draft);
                return (
                  <div key={it.key} className={cn('rounded-xl border', expanded && 'border-primary/40')}>
                    <div className="flex items-center gap-2 p-3">
                      <button type="button" className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => setOpen(expanded ? '' : it.key)} aria-expanded={expanded}>
                        <span className="grid size-7 shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold">{i + 1}</span>
                        <span className="min-w-0">
                          <span className="block text-sm font-medium">
                            {POST_TYPE_LABEL[it.draft.type]} · {it.draft.media.length} mídia(s)
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">{it.draft.caption || (issues.length ? issues[0] : 'Sem legenda')}</span>
                        </span>
                      </button>
                      <div className="flex shrink-0 gap-0.5">
                        <Button type="button" variant="ghost" size="icon-sm" disabled={i === 0} onClick={() => dispatch({ type: 'move', key: it.key, delta: -1 })} aria-label="Subir">
                          <ChevronUp />
                        </Button>
                        <Button type="button" variant="ghost" size="icon-sm" disabled={i === items.length - 1} onClick={() => dispatch({ type: 'move', key: it.key, delta: 1 })} aria-label="Descer">
                          <ChevronDown />
                        </Button>
                        <Button type="button" variant="ghost" size="icon-sm" onClick={() => dispatch({ type: 'add', draft: { ...it.draft, media: [...it.draft.media] } })} aria-label="Duplicar">
                          <Copy />
                        </Button>
                        <Button type="button" variant="ghost" size="icon-sm" disabled={items.length === 1} onClick={() => dispatch({ type: 'remove', key: it.key })} aria-label="Remover">
                          <Trash2 />
                        </Button>
                      </div>
                    </div>
                    {expanded && (
                      <div className="border-t p-4">
                        <ContentEditor draft={it.draft} dispatch={(action) => dispatch({ type: 'edit', key: it.key, action })} compact />
                      </div>
                    )}
                  </div>
                );
              })}
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => {
                  dispatch({ type: 'add' });
                  setOpen('');
                }}
              >
                <Plus /> Adicionar conteúdo
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Contas e ritmo</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <AccountSelector value={accountIds} onChange={setAccountIds} />
              <div className="space-y-2">
                <Label>Início</Label>
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="button" variant={startMode === 'now' ? 'default' : 'outline'} size="sm" onClick={() => setStartMode('now')}>
                    Agora
                  </Button>
                  <Button type="button" variant={startMode === 'at' ? 'default' : 'outline'} size="sm" onClick={() => setStartMode('at')}>
                    Em data e hora
                  </Button>
                  {startMode === 'at' && (
                    <Input type="datetime-local" value={startAt} min={toLocalInputValue(new Date())} onChange={(e) => setStartAt(e.target.value)} className="w-56" aria-label="Início da fila" />
                  )}
                </div>
              </div>
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                <MinutesInput id="interval" label="Intervalo entre conteúdos" value={interval} onChange={setIntervalMinutes} hint="Tempo entre um post e o próximo na mesma conta." />
                <MinutesInput id="stagger" label="Intervalo entre contas" value={stagger} onChange={setStagger} hint="Espaça o mesmo post entre as contas." />
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          <Card>
            <CardHeader>
              <CardTitle>Linha do tempo</CardTitle>
              <CardDescription>
                {plan.length ? `${plan.length} publicações até ${formatDateTime(plan.at(-1)!.runAt.toISOString())}` : 'Selecione contas para ver a prévia.'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ol className="scrollbar-thin max-h-80 space-y-1.5 overflow-y-auto text-sm">
                {plan.slice(0, 60).map((s) => (
                  <li key={`${s.itemIndex}-${s.accountId}`} className="flex items-center justify-between gap-3">
                    <span className="truncate">
                      <span className="text-muted-foreground">#{s.itemIndex + 1}</span> @{names.get(s.accountId) ?? '…'}
                    </span>
                    <span className="tabular shrink-0 text-xs text-muted-foreground">{formatDateTime(s.runAt.toISOString())}</span>
                  </li>
                ))}
                {plan.length > 60 && <li className="text-xs text-muted-foreground">… e mais {plan.length - 60}</li>}
              </ol>
            </CardContent>
          </Card>
          {attempted && problems.length > 0 && (
            <Alert variant="destructive">
              <AlertTriangle />
              <AlertDescription className="text-foreground">
                <ul className="list-disc space-y-0.5 pl-4">
                  {problems.slice(0, 6).map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}
          <Button className="w-full" size="lg" onClick={submit} loading={create.isPending}>
            <Rocket /> Criar fila
          </Button>
        </div>
      </div>
    </div>
  );
}
