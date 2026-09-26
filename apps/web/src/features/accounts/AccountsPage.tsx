import type { AccountDTO, AccountStatus } from '@nexora/shared';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  ExternalLink,
  Image as ImageIcon,
  Camera as Instagram,
  KeyRound,
  MoreHorizontal,
  Pause,
  Play,
  RefreshCw,
  ShieldCheck,
  Timer,
  Unplug,
  Users,
} from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { AccountAvatar } from '@/components/AccountAvatar';
import { QuotaMeter } from '@/components/charts/QuotaMeter';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { EmptyState, ErrorState, PageHeader } from '@/components/States';
import { AccountStatusBadge } from '@/components/StatusBadge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Hint } from '@/components/ui/tooltip';
import { errorMessage } from '@/lib/api';
import { formatDate, formatNumber, formatRelative } from '@/lib/format';
import { oauthErrorMessage } from '@/lib/labels';
import { cn } from '@/lib/utils';
import { useAccounts, useConnectInstagram, useDisconnectAccount, useSyncAccount, useUpdateAccountSettings } from './api';

const PERMISSION_LABEL: Record<string, string> = {
  instagram_business_basic: 'Perfil',
  instagram_business_content_publish: 'Publicação',
  instagram_business_manage_insights: 'Métricas',
};

type Filter = 'all' | 'ok' | 'attention' | 'off';
const FILTERS: { id: Filter; label: string; match: (s: AccountStatus) => boolean }[] = [
  { id: 'all', label: 'Todas', match: () => true },
  { id: 'ok', label: 'Conectadas', match: (s) => s === 'CONNECTED' || s === 'SYNCING' },
  { id: 'attention', label: 'Precisam de atenção', match: (s) => s === 'EXPIRED' || s === 'ERROR' },
  { id: 'off', label: 'Desconectadas', match: (s) => s === 'DISCONNECTED' },
];

function IntervalDialog({ account, open, onOpenChange }: { account: AccountDTO; open: boolean; onOpenChange: (o: boolean) => void }) {
  const update = useUpdateAccountSettings();
  const [minutes, setMinutes] = useState(String(Math.round(account.settings.minIntervalSeconds / 60)));
  const value = Number(minutes);
  const valid = Number.isInteger(value) && value >= 0 && value <= 1440;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Intervalo mínimo de @{account.username}</DialogTitle>
          <DialogDescription>
            Tempo mínimo entre duas publicações desta conta. Se uma fila tentar publicar antes, a publicação espera — sem afetar as outras contas.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="min-interval">Minutos</Label>
          <Input id="min-interval" type="number" min={0} max={1440} value={minutes} onChange={(e) => setMinutes(e.target.value)} aria-invalid={!valid} />
          <p className="text-xs text-muted-foreground">0 desativa. Recomendado: 1 a 30 minutos.</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            disabled={!valid}
            loading={update.isPending}
            onClick={() =>
              update.mutate(
                { id: account.id, minIntervalSeconds: value * 60 },
                {
                  onSuccess: () => {
                    toast.success('Intervalo atualizado.');
                    onOpenChange(false);
                  },
                  onError: (e) => toast.error(errorMessage(e)),
                },
              )
            }
          >
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Fact({ icon: Icon, label, value }: { icon: typeof Users; label: string; value: ReactNode }) {
  return (
    <div className="space-y-0.5">
      <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
        <Icon className="size-3" aria-hidden /> {label}
      </p>
      <p className="text-sm font-medium">{value}</p>
    </div>
  );
}

function AccountCard({ account }: { account: AccountDTO }) {
  const sync = useSyncAccount();
  const connect = useConnectInstagram();
  const disconnect = useDisconnectAccount();
  const settings = useUpdateAccountSettings();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [intervalOpen, setIntervalOpen] = useState(false);

  const needsReconnect = account.status === 'EXPIRED' || account.status === 'DISCONNECTED' || account.status === 'ERROR';
  const off = account.status === 'DISCONNECTED';
  const onError = (e: unknown) => toast.error(errorMessage(e));

  return (
    <Card className={cn('flex flex-col gap-4 p-5', off && 'opacity-75')}>
      <div className="flex items-start gap-3">
        <AccountAvatar username={account.username} src={account.profilePictureUrl} className="size-12" ring={account.status === 'CONNECTED'} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <a
              href={`https://instagram.com/${account.username}`}
              target="_blank"
              rel="noreferrer"
              className="truncate font-semibold hover:underline"
            >
              @{account.username}
            </a>
            <ExternalLink className="size-3 shrink-0 text-muted-foreground" aria-hidden />
          </div>
          <p className="truncate text-sm text-muted-foreground">{account.name ?? '—'}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <AccountStatusBadge status={account.status} />
            {account.settings.paused && !off && (
              <span className="inline-flex items-center gap-1 rounded-md bg-warning/14 px-2 py-0.5 text-xs font-medium text-warning">
                <Pause className="size-3" aria-hidden /> Pausada
              </span>
            )}
            {account.accountType && <span className="text-xs text-muted-foreground">{account.accountType === 'MEDIA_CREATOR' ? 'Criador' : 'Empresa'}</span>}
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={`Ações de @${account.username}`}>
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            {!needsReconnect && (
              <DropdownMenuItem onSelect={() => sync.mutate(account.id, { onSuccess: () => toast.success('Sincronização iniciada.'), onError })}>
                <RefreshCw /> Sincronizar agora
              </DropdownMenuItem>
            )}
            {!off && (
              <DropdownMenuItem
                onSelect={() =>
                  settings.mutate(
                    { id: account.id, paused: !account.settings.paused },
                    { onSuccess: () => toast.success(account.settings.paused ? 'Conta retomada.' : 'Conta pausada: publicações ficam aguardando.'), onError },
                  )
                }
              >
                {account.settings.paused ? <Play /> : <Pause />} {account.settings.paused ? 'Retomar publicações' : 'Pausar publicações'}
              </DropdownMenuItem>
            )}
            {!off && (
              <DropdownMenuItem onSelect={() => setIntervalOpen(true)}>
                <Timer /> Intervalo mínimo…
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onSelect={() => connect.mutate(undefined, { onError })}>
              <KeyRound /> Reautorizar
            </DropdownMenuItem>
            {!off && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={() => setConfirmOpen(true)}>
                  <Unplug /> Desconectar
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {account.statusReason && account.status !== 'CONNECTED' && (
        <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">{account.statusReason}</p>
      )}

      <div className="grid grid-cols-3 gap-3">
        <Fact icon={Users} label="Seguidores" value={formatNumber(account.followersCount)} />
        <Fact icon={ImageIcon} label="Posts" value={formatNumber(account.mediaCount)} />
        <Fact icon={Clock} label="Sincronizada" value={account.lastSyncedAt ? formatRelative(account.lastSyncedAt) : '—'} />
      </div>

      {!off && <QuotaMeter usage={account.publishing.quotaUsage} total={account.publishing.quotaTotal} />}

      <div className="flex flex-wrap items-center gap-1.5">
        {Object.entries(PERMISSION_LABEL).map(([scope, label]) => {
          const granted = account.permissions.includes(scope);
          return (
            <Hint key={scope} label={granted ? `Permissão ${scope} concedida` : `Permissão ${scope} não concedida — reautorize para liberar`}>
              <span
                className={cn(
                  'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px]',
                  granted ? 'text-muted-foreground' : 'border-warning/40 text-warning',
                )}
              >
                {granted ? <ShieldCheck className="size-3" aria-hidden /> : <AlertTriangle className="size-3" aria-hidden />}
                {label}
              </span>
            </Hint>
          );
        })}
        {account.tokenExpiresAt && !off && (
          <span className="ml-auto text-[11px] text-muted-foreground">Acesso válido até {formatDate(account.tokenExpiresAt)}</span>
        )}
      </div>

      {needsReconnect && (
        <Button variant={off ? 'outline' : 'default'} loading={connect.isPending} onClick={() => connect.mutate(undefined, { onError })}>
          <Instagram /> {off ? 'Conectar novamente' : 'Reconectar conta'}
        </Button>
      )}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        destructive
        title={`Desconectar @${account.username}?`}
        description={
          <div className="space-y-2">
            <p>O token de acesso é apagado imediatamente. Publicações agendadas desta conta serão canceladas.</p>
            <p>O histórico e as métricas já coletadas continuam disponíveis. Para revogar também no Camera as Instagram, remova o app em Configurações → Apps e sites.</p>
          </div>
        }
        confirmLabel="Desconectar"
        loading={disconnect.isPending}
        onConfirm={() =>
          disconnect.mutate(account.id, {
            onSuccess: (r) => {
              toast.success(r.canceledJobs ? `Conta desconectada. ${r.canceledJobs} publicações canceladas.` : 'Conta desconectada.');
              setConfirmOpen(false);
            },
            onError,
          })
        }
      />
      {intervalOpen && <IntervalDialog account={account} open={intervalOpen} onOpenChange={setIntervalOpen} />}
    </Card>
  );
}

export function AccountsPage() {
  const { data: accounts, isLoading, error, refetch } = useAccounts();
  const connect = useConnectInstagram();
  const [params, setParams] = useSearchParams();
  const [filter, setFilter] = useState<Filter>('all');
  const [oauthError, setOauthError] = useState<string | null>(null);

  // Resultado do OAuth chega pela URL; mostramos uma vez e limpamos a query.
  useEffect(() => {
    const connected = params.get('connected');
    const err = params.get('oauth_error');
    if (!connected && !err) return;
    if (connected) toast.success(`@${connected} conectada com sucesso.`);
    if (err) setOauthError(oauthErrorMessage(err));
    const next = new URLSearchParams(params);
    next.delete('connected');
    next.delete('oauth_error');
    setParams(next, { replace: true });
  }, [params, setParams]);

  const counts = useMemo(
    () => Object.fromEntries(FILTERS.map((f) => [f.id, accounts?.filter((a) => f.match(a.status)).length ?? 0])) as Record<Filter, number>,
    [accounts],
  );
  const visible = accounts?.filter((a) => FILTERS.find((f) => f.id === filter)!.match(a.status)) ?? [];
  const onConnect = () => connect.mutate(undefined, { onError: (e) => toast.error(errorMessage(e)) });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Contas do Instagram"
        description="Cada conta é conectada pela Meta (OAuth oficial) e publica de forma independente."
        actions={
          <Button onClick={onConnect} loading={connect.isPending}>
            <Instagram /> Conectar Instagram
          </Button>
        }
      />

      {params.get('welcome') && !accounts?.length && (
        <Alert variant="info">
          <CheckCircle2 />
          <AlertTitle>Conta criada! Agora conecte seu Instagram.</AlertTitle>
          <AlertDescription>Você será levado ao Instagram para autorizar e depois volta para cá.</AlertDescription>
        </Alert>
      )}

      {oauthError && (
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle>Não foi possível conectar</AlertTitle>
          <AlertDescription>{oauthError}</AlertDescription>
        </Alert>
      )}

      {accounts && accounts.length > 0 && (
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Filtrar contas">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              role="tab"
              aria-selected={filter === f.id}
              onClick={() => setFilter(f.id)}
              disabled={f.id !== 'all' && counts[f.id] === 0}
              className={cn(
                'rounded-full border px-3 py-1 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40',
                filter === f.id ? 'border-primary/40 bg-primary/10 text-foreground' : 'text-muted-foreground hover:bg-accent',
              )}
            >
              {f.label} <span className="tabular text-muted-foreground">{counts[f.id]}</span>
            </button>
          ))}
        </div>
      )}

      {error && <ErrorState error={error} onRetry={() => void refetch()} />}

      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-72 rounded-xl" />
          ))}
        </div>
      ) : accounts?.length === 0 ? (
        <EmptyState
          icon={Instagram}
          title="Nenhuma conta conectada"
          description="Conecte uma conta profissional (Empresa ou Criador). Você autoriza no Instagram; nunca pedimos sua senha."
          action={
            <Button onClick={onConnect} loading={connect.isPending}>
              <Instagram /> Conectar Instagram
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visible.map((a) => (
            <AccountCard key={a.id} account={a} />
          ))}
        </div>
      )}

      <Card className="grid grid-cols-1 gap-4 p-5 text-sm md:grid-cols-3">
        {[
          ['Conta profissional', 'A API oficial só publica em contas Empresa ou Criador de conteúdo. Contas pessoais não são suportadas pela Meta.'],
          ['Acesso de 60 dias', 'O acesso é renovado automaticamente. Se expirar ou for revogado, a conta fica como "Expirada" e basta reconectar.'],
          ['Limites da Meta', 'Cada conta pode publicar até o limite de 24h informado pela Meta (hoje, 100 posts via API). A fila respeita isso sozinha.'],
        ].map(([title, text]) => (
          <div key={title} className="space-y-1">
            <p className="font-medium">{title}</p>
            <p className="text-muted-foreground">{text}</p>
          </div>
        ))}
      </Card>
    </div>
  );
}
