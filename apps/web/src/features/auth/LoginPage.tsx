import { loginSchema } from '@nexora/shared';
import { AlertTriangle } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { errorMessage } from '@/lib/api';
import { AuthLayout } from './AuthLayout';
import { FormField } from './FormField';
import { useLogin } from './session';

export function LoginPage() {
  const login = useLogin();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [errors, setErrors] = useState<Record<string, string>>({});

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const parsed = loginSchema.safeParse({ email: form.get('email'), password: form.get('password') });
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    setErrors({});
    const next = params.get('next');
    login.mutate(parsed.data, { onSuccess: () => navigate(next?.startsWith('/') ? next : '/', { replace: true }) });
  };

  return (
    <AuthLayout
      title="Entrar"
      subtitle="Acesse o painel das suas contas."
      footer={
        <>
          Ainda não tem conta?{' '}
          <Link to="/signup" className="font-medium text-primary hover:underline">
            Criar conta
          </Link>
        </>
      }
    >
      <form className="space-y-4" onSubmit={onSubmit} noValidate>
        {login.error && (
          <Alert variant="destructive">
            <AlertTriangle />
            <AlertDescription className="text-foreground">{errorMessage(login.error)}</AlertDescription>
          </Alert>
        )}
        <FormField id="email" label="E-mail" error={errors.email}>
          <Input id="email" name="email" type="email" autoComplete="email" required aria-invalid={Boolean(errors.email)} />
        </FormField>
        <FormField id="password" label="Senha" error={errors.password}>
          <Input id="password" name="password" type="password" autoComplete="current-password" required aria-invalid={Boolean(errors.password)} />
        </FormField>
        <Button type="submit" className="w-full" loading={login.isPending}>
          Entrar
        </Button>
      </form>
    </AuthLayout>
  );
}
