import type * as React from 'react';
import { Navigate, useLocation } from 'react-router';
import { ErrorState } from '@/components/States';
import { useMe } from './session';

export function FullScreenLoader() {
  return (
    <div className="grid min-h-dvh place-items-center" role="status" aria-label="Carregando">
      <img src="/brand/nexora-icon.png" alt="" className="size-12 animate-pulse rounded-xl" />
    </div>
  );
}

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { data: user, isLoading, error, refetch } = useMe();
  const location = useLocation();
  if (isLoading) return <FullScreenLoader />;
  if (error) {
    return (
      <div className="grid min-h-dvh place-items-center p-6">
        <ErrorState error={error} onRetry={() => void refetch()} />
      </div>
    );
  }
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  return children;
}

export function RedirectIfAuthed({ children }: { children: React.ReactNode }) {
  const { data: user, isLoading } = useMe();
  if (isLoading) return <FullScreenLoader />;
  if (user) return <Navigate to="/" replace />;
  return children;
}
