import type * as React from 'react';
import { BrandMark } from '@/components/layout/BrandMark';

export function AuthLayout({ title, subtitle, children, footer }: { title: string; subtitle: string; children: React.ReactNode; footer: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      <div className="relative hidden overflow-hidden border-r bg-card lg:block">
        <div className="brand-glow absolute inset-0" aria-hidden />
        <div className="relative flex h-full flex-col justify-between p-10">
          <BrandMark />
          <div className="max-w-md space-y-5">
            <h2 className="text-3xl leading-tight font-semibold tracking-tight">
              Publique em várias contas do Camera as Instagram, <span className="text-brand">no ritmo certo</span>.
            </h2>
            <ul className="space-y-3 text-sm text-muted-foreground">
              <li>• Conexão oficial via Meta — sem senha, sem cookies, sem robô de navegador.</li>
              <li>• Filas com intervalo entre contas e conteúdos, agendamento e acompanhamento ao vivo.</li>
              <li>• Cada conta anda sozinha: uma com problema não trava as outras.</li>
              <li>• Métricas de alcance, visualizações e engajamento por conta e por post.</li>
            </ul>
          </div>
          <p className="text-xs text-muted-foreground">Instagram é marca da Meta Platforms. O Nexora usa apenas APIs oficiais.</p>
        </div>
      </div>
      <div className="flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm space-y-6">
          <BrandMark className="lg:hidden" />
          <div className="space-y-1.5">
            <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
            <p className="text-sm text-muted-foreground">{subtitle}</p>
          </div>
          {children}
          <p className="text-center text-sm text-muted-foreground">{footer}</p>
        </div>
      </div>
    </div>
  );
}
