import {
  BarChart3,
  CalendarRange,
  History,
  Images,
  Camera as Instagram,
  LayoutDashboard,
  ListOrdered,
  PenSquare,
  Settings,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
}

export const NAV: { title: string; items: NavItem[] }[] = [
  { title: 'Visão geral', items: [{ to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true }] },
  {
    title: 'Publicar',
    items: [
      { to: '/compose', label: 'Nova publicação', icon: PenSquare },
      { to: '/campaigns', label: 'Filas de publicação', icon: CalendarRange },
      { to: '/queue', label: 'Em andamento', icon: ListOrdered },
      { to: '/history', label: 'Histórico', icon: History },
      { to: '/media', label: 'Biblioteca', icon: Images },
    ],
  },
  { title: 'Análise', items: [{ to: '/insights', label: 'Métricas', icon: BarChart3 }] },
  {
    title: 'Conta',
    items: [
      { to: '/accounts', label: 'Contas do Instagram', icon: Instagram },
      { to: '/settings', label: 'Configurações', icon: Settings },
    ],
  },
];
