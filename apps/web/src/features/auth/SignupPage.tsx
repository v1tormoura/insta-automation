import { signupSchema } from '@nexora/shared';
import { AlertTriangle } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { errorMessage } from '@/lib/api';
import { AuthLayout } from './AuthLayout';
import { FormField } from './FormField';
import { useSignup } from './session';

export function SignupPage() {
  const signup = useSignup();
  const navigate = useNavigate();
  const [errors, setErrors] = useState<Record<string, string>>({});

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const parsed = signupSchema.safeParse({ name: form.get('name'), email: form.get('email'), password: form.get('password') });
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    setErrors({});
    signup.mutate(parsed.data, { onSuccess: () => navigate('/accounts?welcome=1', { replace: true }) });
  };

  return (
    <AuthLayout
      title="Criar conta"
      subtitle="Leva um minuto. Depois é só conectar o Instagram."
      footer={
        <>
          Já tem conta?{' '}
          <Link to="/login" className="font-medium text-primary hover:underline">
            Entrar
          </Link>
        </>
      }
    >
      <form className="space-y-4" onSubmit={onSubmit} noValidate>
        {signup.error && (
          <Alert variant="destructive">
            <AlertTriangle />
            <AlertDescription className="text-foreground">{errorMessage(signup.error)}</AlertDescription>
          </Alert>
        )}
        <FormField id="name" label="Nome" error={errors.name}>
          <Input id="name" name="name" autoComplete="name" required aria-invalid={Boolean(errors.name)} />
        </FormField>
        <FormField id="email" label="E-mail" error={errors.email}>
          <Input id="email" name="email" type="email" autoComplete="email" required aria-invalid={Boolean(errors.email)} />
        </FormField>
        <FormField id="password" label="Senha" error={errors.password} hint="Mínimo de 10 caracteres.">
          <Input id="password" name="password" type="password" autoComplete="new-password" required aria-invalid={Boolean(errors.password)} />
        </FormField>
        <Button type="submit" className="w-full" loading={signup.isPending}>
          Criar conta
        </Button>
      </form>
    </AuthLayout>
  );
}
