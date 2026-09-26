import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type * as React from 'react';
import { Toaster } from 'sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ApiError, setUnauthenticatedHandler } from '@/lib/api';
import { qk } from '@/lib/queryKeys';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: true,
      retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
    },
  },
  mutationCache: new MutationCache(),
});

// Sessão expirou no meio do uso: zera o usuário e o guard leva ao login.
setUnauthenticatedHandler(() => queryClient.setQueryData(qk.me, null));

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={200}>
        {children}
        <Toaster position="bottom-right" richColors closeButton theme="system" toastOptions={{ className: 'font-sans' }} />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
