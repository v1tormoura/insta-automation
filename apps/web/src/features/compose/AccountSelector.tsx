import type { AccountDTO } from '@nexora/shared';
import { Camera as Instagram, Check } from 'lucide-react';
import { Link } from 'react-router';
import { AccountAvatar } from '@/components/AccountAvatar';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useAccounts } from '@/features/accounts/api';
import { formatCompact } from '@/lib/format';
import { ACCOUNT_STATUS } from '@/lib/labels';
import { cn } from '@/lib/utils';

export const isPublishable = (a: AccountDTO) => a.status === 'CONNECTED' || a.status === 'SYNCING' || a.status === 'ERROR';

/** Seleção de contas de destino, na ordem em que o usuário marca (define o escalonamento). */
export function AccountSelector({ value, onChange }: { value: string[]; onChange: (ids: string[]) => void }) {
  const { data: accounts, isLoading } = useAccounts();
  const usable = accounts?.filter((a) => a.status !== 'DISCONNECTED') ?? [];
  const publishable = usable.filter(isPublishable);
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);

  if (isLoading) return <Skeleton className="h-24 w-full" />;
  if (!usable.length) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed p-6 text-center">
        <p className="text-sm text-muted-foreground">Conecte uma conta do Instagram para publicar.</p>
        <Button asChild size="sm">
          <Link to="/accounts">
            <Instagram /> Conectar conta
          </Link>
        </Button>
      </div>
    );
  }

  const all = publishable.length > 0 && publishable.every((a) => value.includes(a.id));
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>
          Contas <span className="font-normal text-muted-foreground">({value.length} selecionada{value.length === 1 ? '' : 's'})</span>
        </Label>
        {publishable.length > 1 && (
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange(all ? [] : publishable.map((a) => a.id))}>
            {all ? 'Limpar' : 'Selecionar todas'}
          </Button>
        )}
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {usable.map((a) => {
          const selected = value.includes(a.id);
          const order = value.indexOf(a.id);
          const disabled = !isPublishable(a);
          return (
            <button
              key={a.id}
              type="button"
              disabled={disabled}
              onClick={() => toggle(a.id)}
              aria-pressed={selected}
              className={cn(
                'flex items-center gap-3 rounded-xl border p-2.5 text-left transition-colors focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50',
                selected ? 'border-primary/60 bg-primary/8' : 'hover:bg-accent/50',
              )}
            >
              <AccountAvatar username={a.username} src={a.profilePictureUrl} className="size-9" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">@{a.username}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {disabled ? ACCOUNT_STATUS[a.status].hint : `${formatCompact(a.followersCount)} seguidores${a.settings.paused ? ' · pausada' : ''}`}
                </p>
              </div>
              <span
                className={cn(
                  'grid size-5 shrink-0 place-items-center rounded-full border text-[10px] font-semibold',
                  selected ? 'border-primary bg-primary text-primary-foreground' : 'border-input',
                )}
                aria-hidden
              >
                {selected ? value.length > 1 ? order + 1 : <Check className="size-3" /> : null}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
