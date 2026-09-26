import { NavLink } from 'react-router';
import { cn } from '@/lib/utils';
import { BrandMark } from './BrandMark';
import { NAV } from './nav';

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="flex flex-col gap-5 px-3" aria-label="Navegação principal">
      {NAV.map((group) => (
        <div key={group.title} className="space-y-1">
          <p className="px-2 pb-1 text-[11px] font-medium tracking-wider text-muted-foreground/80 uppercase">{group.title}</p>
          {group.items.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              onClick={onNavigate}
              className={({ isActive }) =>
                cn(
                  'group relative flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
                  isActive && 'bg-accent font-medium text-foreground',
                )
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && <span className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-brand" aria-hidden />}
                  <Icon className={cn('size-4', isActive ? 'text-brand' : 'text-muted-foreground group-hover:text-foreground')} aria-hidden />
                  {label}
                </>
              )}
            </NavLink>
          ))}
        </div>
      ))}
    </nav>
  );
}

export function Sidebar() {
  return (
    <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar lg:flex">
      <div className="flex h-14 items-center px-5">
        <BrandMark />
      </div>
      <div className="scrollbar-thin flex-1 overflow-y-auto py-3">
        <SidebarNav />
      </div>
      <div className="m-3 rounded-lg border bg-gradient-to-br from-brand/8 to-brand-2/8 p-3 text-xs text-muted-foreground">
        Publicação 100% pela <span className="font-medium text-foreground">API oficial da Meta</span>. Sem senha, sem automação de navegador.
      </div>
    </aside>
  );
}
