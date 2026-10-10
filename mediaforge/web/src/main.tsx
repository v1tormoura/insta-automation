import { QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { KeyRound } from 'lucide-react';
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { z } from 'zod';
import { App } from './App';
import { Button } from './components/ui/Button';
import { Field, TextInput } from './components/ui/controls';
import { Spinner } from './components/ui/feedback';
import { ToastProvider } from './components/ui/toast';
import { api, ApiError } from './lib/api';
import { queryClient, useSession } from './lib/queries';
import { WorkspaceProvider } from './state/workspace';
import './styles/index.css';

z.config(z.locales.ptBR());

function Login() {
  const qc = useQueryClient();
  const [key, setKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="grid min-h-screen place-items-center p-4">
      <form
        className="w-full max-w-sm rounded-[var(--radius-panel)] border border-line bg-surface p-5"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await api.login(key);
            await qc.invalidateQueries();
          } catch (err) {
            setError(err instanceof ApiError ? err.message : String(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <h1 className="mb-1 flex items-center gap-2 text-[15px] font-semibold">
          <KeyRound size={16} className="text-accent-soft" /> MediaForge
        </h1>
        <p className="mb-4 text-[12px] text-ink-3">Esta instalação exige a chave de acesso definida em ACCESS_KEY.</p>
        <Field label="Chave de acesso">
          <TextInput value={key} onChange={setKey} />
        </Field>
        {error && <p className="mt-2 text-[12px] text-bad">{error}</p>}
        <Button type="submit" variant="primary" className="mt-4 w-full" loading={busy} disabled={!key}>
          Entrar
        </Button>
      </form>
    </div>
  );
}

function SessionGate() {
  const { data: session, error, isLoading } = useSession();
  if (isLoading)
    return (
      <div className="grid min-h-screen place-items-center">
        <Spinner size={20} />
      </div>
    );
  if (error instanceof ApiError && error.status === 401) return <Login />;
  if (!session)
    return (
      <div className="grid min-h-screen place-items-center p-6 text-center text-[13px] text-bad">
        Não foi possível conectar ao servidor do MediaForge. Verifique se ele está em execução.
      </div>
    );
  return (
    <WorkspaceProvider sessionId={session.id}>
      <App />
    </WorkspaceProvider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <SessionGate />
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
);
