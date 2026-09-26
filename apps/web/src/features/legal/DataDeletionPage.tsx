import { ShieldCheck } from 'lucide-react';
import { useSearchParams } from 'react-router';
import { BrandMark } from '@/components/layout/BrandMark';
import { Card } from '@/components/ui/card';

/**
 * Página de status exigida pelo Data Deletion Callback da Meta: a Meta mostra
 * este link à pessoa depois do pedido de exclusão. Pública, sem login.
 */
export function DataDeletionPage() {
  const [params] = useSearchParams();
  const code = params.get('code');
  return (
    <div className="grid min-h-dvh place-items-center px-4">
      <Card className="w-full max-w-md space-y-4 p-6">
        <BrandMark />
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 size-5 shrink-0 text-success" aria-hidden />
          <div className="space-y-2 text-sm">
            <h1 className="text-lg font-semibold">Pedido de exclusão recebido</h1>
            <p className="text-muted-foreground">
              Os dados vindos do Instagram para esta conta (token de acesso, métricas e histórico de seguidores) foram removidos do Nexora, e as
              publicações pendentes foram canceladas.
            </p>
            {code && (
              <p>
                Código de confirmação: <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{code}</code>
              </p>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}
