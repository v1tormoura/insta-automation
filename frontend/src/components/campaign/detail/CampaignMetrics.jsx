import { Progress } from '../../ui/progress';
import { Eyebrow } from './shared';
import { cn } from '../../../lib/utils';

/**
 * Métricas da campanha.
 *
 * Todos os números vêm de contagens sobre CampaignPublication — nenhum é
 * `contas × conteúdos`. Com o limite diário ligado o planner gera menos
 * publicações do que o produto das listas, e esse produto descreveria uma
 * campanha que não existe.
 *
 * `contas` é derivado das publicações carregadas (a matriz já precisa de todas);
 * o resto vem das agregações do backend, corretas independentemente de paginação.
 */

function Cartao({ titulo, children, className }) {
  return (
    <div className={cn('rounded-[var(--mf-r-lg)] border border-[var(--card-border)] bg-[var(--card)] p-4', className)}>
      <Eyebrow>{titulo}</Eyebrow>
      <div className="mt-2.5">{children}</div>
    </div>
  );
}

/** Número grande com rótulo — a linha que o olho pega primeiro. */
function Numero({ valor, rotulo, cor }) {
  return (
    <div className="min-w-0">
      <div className={cn('font-mono text-[20px] font-extrabold leading-none tabular-nums', cor)}>
        {valor}
      </div>
      <div className="mt-1 truncate text-[var(--mf-t-nano)] uppercase tracking-[.05em] text-[var(--mf-text-3)]">
        {rotulo}
      </div>
    </div>
  );
}

export default function CampaignMetrics({ estatisticas, comentarios, contas, progresso }) {
  const e = estatisticas || {};
  const c = comentarios  || {};
  const pendentes = (e.pending || 0) + (e.scheduled || 0);

  return (
    <div
      className="grid gap-3"
      style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(240px, 100%), 1fr))' }}
    >
      {/* 1 — Publicações */}
      <Cartao titulo="Publicações">
        <div className="font-mono text-[26px] font-extrabold leading-none tabular-nums text-[var(--mf-text)]">
          {e.total ?? 0}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-y-2.5 sm:grid-cols-4">
          <Numero valor={e.published ?? 0}  rotulo="publicadas" cor="text-[var(--mf-success-500)]" />
          <Numero valor={pendentes}         rotulo="pendentes"  cor="text-[var(--mf-mod,_var(--mf-accent-500))]" />
          <Numero valor={e.processing ?? 0} rotulo="processando" cor="text-[var(--mf-info-500)]" />
          <Numero
            valor={e.failed ?? 0} rotulo="falhas"
            cor={e.failed ? 'text-[var(--mf-danger-500)]' : 'text-[var(--mf-text-3)]'}
          />
        </div>
        {e.cancelled > 0 && (
          <div className="mt-2.5 border-t border-[var(--border)] pt-2 text-[var(--mf-t-nano)] text-[var(--mf-text-3)]">
            {e.cancelled} cancelada{e.cancelled === 1 ? '' : 's'}
          </div>
        )}
      </Cartao>

      {/* 2 — Progresso */}
      <Cartao titulo="Progresso">
        <div className="flex items-end justify-between gap-2">
          <div className="font-mono text-[26px] font-extrabold leading-none tabular-nums text-[var(--mf-text)]">
            {progresso?.percentage ?? 0}%
          </div>
          <div className="font-mono text-[var(--mf-t-micro)] tabular-nums text-[var(--mf-text-3)]">
            {progresso?.done ?? 0}/{progresso?.total ?? 0}
          </div>
        </div>
        <Progress value={progresso?.percentage ?? 0} className="mt-3" />
        <p className="mt-2.5 text-[var(--mf-t-nano)] leading-relaxed text-[var(--mf-text-3)]">
          Conta publicadas, falhas e canceladas — tudo que chegou a um estado final.
        </p>
      </Cartao>

      {/* 3 — Contas */}
      <Cartao titulo="Contas">
        <div className="font-mono text-[26px] font-extrabold leading-none tabular-nums text-[var(--mf-text)]">
          {contas?.total ?? 0}
        </div>
        <div className="mt-3 grid grid-cols-3 gap-y-2.5">
          <Numero valor={contas?.concluidas ?? 0} rotulo="concluídas" cor="text-[var(--mf-success-500)]" />
          <Numero valor={contas?.pendentes ?? 0}  rotulo="pendentes"  cor="text-[var(--mf-mod,_var(--mf-accent-500))]" />
          <Numero
            valor={contas?.comErro ?? 0} rotulo="com erro"
            cor={contas?.comErro ? 'text-[var(--mf-danger-500)]' : 'text-[var(--mf-text-3)]'}
          />
        </div>
      </Cartao>

      {/* 4 — Comentários */}
      <Cartao titulo="Comentários">
        {c.total ? (
          <>
            <div className="font-mono text-[26px] font-extrabold leading-none tabular-nums text-[var(--mf-text)]">
              {c.total}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-y-2.5 sm:grid-cols-4">
              <Numero valor={c.posted ?? 0}    rotulo="publicados" cor="text-[var(--mf-success-500)]" />
              <Numero valor={c.scheduled ?? 0} rotulo="agendados"  cor="text-[var(--mf-mod,_var(--mf-accent-500))]" />
              {/* Configurados mas ainda sem agendamento: o post deles não saiu. */}
              <Numero valor={c.pending ?? 0}   rotulo="aguardando" cor="text-[var(--mf-text-3)]" />
              <Numero
                valor={c.failed ?? 0} rotulo="falhos"
                cor={c.failed ? 'text-[var(--mf-danger-500)]' : 'text-[var(--mf-text-3)]'}
              />
            </div>
            {c.cancelled > 0 && (
              <div className="mt-2.5 border-t border-[var(--border)] pt-2 text-[var(--mf-t-nano)] text-[var(--mf-text-3)]">
                {c.cancelled} cancelado{c.cancelled === 1 ? '' : 's'}
              </div>
            )}
          </>
        ) : (
          // Sem comentário configurado, "0 de 48" sugeriria 48 pendências.
          <p className="py-2 text-[var(--mf-t-micro)] text-[var(--mf-text-3)]">
            Esta campanha não publica comentários.
          </p>
        )}
      </Cartao>
    </div>
  );
}
