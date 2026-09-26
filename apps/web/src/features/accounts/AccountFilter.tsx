import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAccounts } from './api';

const ALL = '__all__';

export function AccountFilter({ value, onChange, className }: { value?: string; onChange: (id: string | undefined) => void; className?: string }) {
  const { data: accounts } = useAccounts();
  return (
    <Select value={value ?? ALL} onValueChange={(v) => onChange(v === ALL ? undefined : v)}>
      <SelectTrigger className={className ?? 'w-52'} aria-label="Filtrar por conta">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>Todas as contas</SelectItem>
        {accounts?.map((a) => (
          <SelectItem key={a.id} value={a.id}>
            @{a.username}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
