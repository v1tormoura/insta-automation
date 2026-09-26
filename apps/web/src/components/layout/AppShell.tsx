import { LogOut, Menu, Monitor, Moon, PenSquare, Sun, UserRound } from 'lucide-react';
import { useState } from 'react';
import { Link, Outlet, useNavigate } from 'react-router';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { Hint } from '@/components/ui/tooltip';
import { useLogout, useMe } from '@/features/auth/session';
import { useRealtime, type RealtimeStatus } from '@/hooks/useRealtime';
import { useTheme } from '@/hooks/useTheme';
import { cn } from '@/lib/utils';
import { BrandMark } from './BrandMark';
import { NotificationBell } from './NotificationBell';
import { Sidebar, SidebarNav } from './Sidebar';

const LIVE: Record<RealtimeStatus, { label: string; dot: string }> = {
  live: { label: 'Tempo real ativo', dot: 'bg-success' },
  connecting: { label: 'Reconectando ao tempo real…', dot: 'bg-warning animate-pulse' },
  offline: { label: 'Tempo real indisponível — os dados atualizam ao recarregar', dot: 'bg-muted-foreground' },
};

function LiveIndicator({ status }: { status: RealtimeStatus }) {
  const s = LIVE[status];
  return (
    <Hint label={s.label}>
      <span className="hidden items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs text-muted-foreground sm:flex" role="status">
        <span className={cn('size-1.5 rounded-full', s.dot)} aria-hidden />
        {status === 'live' ? 'Ao vivo' : status === 'connecting' ? 'Conectando' : 'Offline'}
      </span>
    </Hint>
  );
}

function UserMenu() {
  const { data: user } = useMe();
  const logout = useLogout();
  const navigate = useNavigate();
  const { pref, setTheme } = useTheme();
  if (!user) return null;
  const ThemeIcon = pref === 'dark' ? Moon : pref === 'light' ? Sun : Monitor;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="gap-2 px-2" aria-label="Menu da conta">
          <span className="grid size-7 place-items-center rounded-full bg-gradient-to-br from-brand/40 to-brand-2/40 text-xs font-semibold uppercase">
            {user.name.slice(0, 1)}
          </span>
          <span className="hidden max-w-32 truncate text-sm md:inline">{user.name.split(' ')[0]}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="space-y-0.5">
          <p className="truncate text-sm font-medium text-foreground">{user.name}</p>
          <p className="truncate text-xs">{user.email}</p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => navigate('/settings')}>
          <UserRound /> Perfil e plano
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={(e) => {
          e.preventDefault();
          setTheme(pref === 'dark' ? 'light' : pref === 'light' ? 'system' : 'dark');
        }}>
          <ThemeIcon /> Tema: {pref === 'dark' ? 'escuro' : pref === 'light' ? 'claro' : 'do sistema'}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={() => logout.mutate(false, { onSettled: () => navigate('/login') })}>
          <LogOut /> Sair
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AppShell() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const status = useRealtime(true);

  return (
    <div className="flex min-h-dvh">
      <Sidebar />
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-72 p-0">
          <SheetTitle className="sr-only">Menu</SheetTitle>
          <div className="flex h-14 items-center px-5">
            <BrandMark />
          </div>
          <SidebarNav onNavigate={() => setMobileOpen(false)} />
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/80 px-4 backdrop-blur-md sm:px-6">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Abrir menu">
            <Menu />
          </Button>
          <BrandMark className="lg:hidden" compact />
          <div className="flex-1" />
          <LiveIndicator status={status} />
          <Button asChild size="sm" className="hidden sm:inline-flex">
            <Link to="/compose">
              <PenSquare /> Nova publicação
            </Link>
          </Button>
          <NotificationBell />
          <UserMenu />
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:py-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
