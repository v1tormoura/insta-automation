import { LogOut } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { PageHeader } from '@/components/States';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useLogout, useMe, useUpdateProfile } from '@/features/auth/session';
import { errorMessage } from '@/lib/api';
import { formatNumber } from '@/lib/format';

export function SettingsPage() {
  const { data: user } = useMe();
  const update = useUpdateProfile();
  const logout = useLogout();
  const navigate = useNavigate();
  const [name, setName] = useState(user?.name ?? '');
  const [timezone, setTimezone] = useState(user?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
  if (!user) return null;
  const limits = user.limits;

  return (
    <div className="space-y-6">
      <PageHeader title="Configurações" description="Seu perfil, plano e sessões." />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Perfil</CardTitle>
            <CardDescription>{user.email}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Nome</Label>
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tz">Fuso horário</Label>
              <Input id="tz" value={timezone} onChange={(e) => setTimezone(e.target.value)} placeholder="America/Sao_Paulo" />
              <p className="text-xs text-muted-foreground">Usado nos relatórios diários do dashboard.</p>
            </div>
          </CardContent>
          <CardFooter className="justify-end">
            <Button
              loading={update.isPending}
              onClick={() => update.mutate({ name, timezone }, { onSuccess: () => toast.success('Perfil atualizado.'), onError: (e) => toast.error(errorMessage(e)) })}
            >
              Salvar
            </Button>
          </CardFooter>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Plano {limits.label}</CardTitle>
            <CardDescription>Limites aplicados à sua conta.</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-4 text-sm">
              {[
                ['Contas conectadas', formatNumber(limits.maxAccounts)],
                ['Publicações pendentes', formatNumber(limits.maxPendingJobs)],
                ['Contas publicando ao mesmo tempo', formatNumber(limits.maxConcurrentPublishes)],
                ['Armazenamento', `${formatNumber(Math.round(limits.storageMb / 1024))} GB`],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className="text-lg font-semibold">{v}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Sessões</CardTitle>
            <CardDescription>Encerre o acesso em todos os navegadores e dispositivos.</CardDescription>
          </CardHeader>
          <CardFooter className="justify-end">
            <Button variant="outline" loading={logout.isPending} onClick={() => logout.mutate(true, { onSettled: () => navigate('/login') })}>
              <LogOut /> Sair de todos os dispositivos
            </Button>
          </CardFooter>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Sobre a integração</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>O Nexora usa exclusivamente a Instagram API with Instagram Login (Meta): Content Publishing para publicar e Insights para métricas.</p>
            <p>Os tokens de acesso ficam cifrados no servidor e nunca chegam ao navegador. Você pode revogar o acesso a qualquer momento em Instagram → Configurações → Apps e sites.</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
