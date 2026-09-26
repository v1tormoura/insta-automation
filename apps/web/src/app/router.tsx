import type * as React from 'react';
import { Compass } from 'lucide-react';
import { Link, Outlet, createBrowserRouter } from 'react-router';
import { AppShell } from '@/components/layout/AppShell';
import { EmptyState } from '@/components/States';
import { Button } from '@/components/ui/button';
import { LoginPage } from '@/features/auth/LoginPage';
import { RedirectIfAuthed, RequireAuth } from '@/features/auth/RequireAuth';
import { SignupPage } from '@/features/auth/SignupPage';

/** Cada tela vira um chunk próprio: gráficos só carregam onde são usados. */
function page<M extends Record<string, unknown>>(load: () => Promise<M>, name: keyof M & string) {
  return async () => ({ Component: (await load())[name] as React.ComponentType });
}

function NotFound() {
  return (
    <EmptyState
      icon={Compass}
      title="Página não encontrada"
      description="O endereço pode ter mudado ou não existe."
      action={
        <Button asChild>
          <Link to="/">Voltar ao dashboard</Link>
        </Button>
      }
      className="mt-16"
    />
  );
}

export const router = createBrowserRouter([
  { path: '/privacy/deletion', lazy: page(() => import('@/features/legal/DataDeletionPage'), 'DataDeletionPage') },
  {
    element: (
      <RedirectIfAuthed>
        <Outlet />
      </RedirectIfAuthed>
    ),
    children: [
      { path: '/login', element: <LoginPage /> },
      { path: '/signup', element: <SignupPage /> },
    ],
  },
  {
    element: (
      <RequireAuth>
        <AppShell />
      </RequireAuth>
    ),
    children: [
      { path: '/', lazy: page(() => import('@/features/dashboard/DashboardPage'), 'DashboardPage') },
      { path: '/accounts', lazy: page(() => import('@/features/accounts/AccountsPage'), 'AccountsPage') },
      { path: '/compose', lazy: page(() => import('@/features/compose/ComposePage'), 'ComposePage') },
      { path: '/queue', lazy: page(() => import('@/features/queue/QueuePage'), 'QueuePage') },
      { path: '/history', lazy: page(() => import('@/features/history/HistoryPage'), 'HistoryPage') },
      { path: '/posts/:id', lazy: page(() => import('@/features/history/PostDetailPage'), 'PostDetailPage') },
      { path: '/campaigns', lazy: page(() => import('@/features/campaigns/CampaignsPage'), 'CampaignsPage') },
      { path: '/campaigns/new', lazy: page(() => import('@/features/campaigns/NewCampaignPage'), 'NewCampaignPage') },
      { path: '/campaigns/:id', lazy: page(() => import('@/features/campaigns/CampaignDetailPage'), 'CampaignDetailPage') },
      { path: '/media', lazy: page(() => import('@/features/media/MediaLibraryPage'), 'MediaLibraryPage') },
      { path: '/insights', lazy: page(() => import('@/features/insights/InsightsPage'), 'InsightsPage') },
      { path: '/notifications', lazy: page(() => import('@/features/notifications/NotificationsPage'), 'NotificationsPage') },
      { path: '/settings', lazy: page(() => import('@/features/settings/SettingsPage'), 'SettingsPage') },
      { path: '*', element: <NotFound /> },
    ],
  },
]);
