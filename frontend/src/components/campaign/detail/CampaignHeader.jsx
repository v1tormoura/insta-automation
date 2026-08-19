import {
  ArrowLeft, Play, Pause, RotateCcw, Ban, Copy, Pencil, Users, Film,
  Layers, Shuffle, Timer, CalendarClock,
} from 'lucide-react';
import { Button } from '../../ui/button';
import { Badge } from '../../ui/badge';
import { STATUS_CAMPANHA, ESTRATEGIAS, dataCurta, Eyebrow } from './shared';

/**
 * Cabeçalho da campanha: identidade, configuração e ações.
 *
 * As ações são derivadas do STATUS, não listadas e desabilitadas. Um botão
 * "Iniciar" acinzentado numa campanha concluída ainda sugere que existe algo a
 * iniciar; melhor ele não estar lá. A regra vive em `acoesPara`, alinhada com a
 * máquina de estados do backend (campaignState.js) — o servidor continua sendo a
 * autoridade, isto só evita oferecer o que ele vai recusar.
 */

/**
 * @returns {string[]} ações permitidas neste estado, na ordem de exibição
 */
export function acoesPara(status) {
  switch (status) {
    case 'draft':
    case 'planning':
      return ['start', 'edit', 'cancel'];
    case 'scheduled':
    case 'running':
      return ['pause', 'cancel'];
    case 'paused':
      return ['resume', 'cancel'];
    case 'completed':
    case 'partial':
    case 'failed':
      return ['retryFailed', 'duplicate'];
    case 'cancelled':
      return ['duplicate'];
    default:
      return [];
  }
}

export default function CampaignHeader({
  campanha, schedule, settings, estatisticas,
  falhas = 0, agindo = false,
  onVoltar, onAcao,
}) {
  const st = STATUS_CAMPANHA[campanha.status] || STATUS_CAMPANHA.draft;
  const permitidas = acoesPara(campanha.status);

  const s = schedule || campanha.schedule || {};
  const intervalo = s.useFixedInterval
    ? `${s.fixedIntervalMinutes ?? s.intervalMinMinutes} min (fixo)`
    : `${s.intervalMinMinutes}–${s.intervalMaxMinutes} min`;
  const janela = s.windowStart && s.windowEnd ? `${s.windowStart}–${s.windowEnd}` : 'Sem restrição';

  const BOTOES = {
    start:       { rotulo: 'Iniciar',   Icone: Play,      variant: 'default' },
    pause:       { rotulo: 'Pausar',    Icone: Pause,     variant: 'outline' },
    resume:      { rotulo: 'Retomar',   Icone: Play,      variant: 'default' },
    // Só faz sentido com falhas de verdade — sem elas o botão sai da lista.
    retryFailed: { rotulo: `Reexecutar ${falhas} falha${falhas === 1 ? '' : 's'}`, Icone: RotateCcw, variant: 'outline' },
    duplicate:   { rotulo: 'Duplicar',  Icone: Copy,      variant: 'outline' },
    edit:        { rotulo: 'Editar',    Icone: Pencil,    variant: 'ghost' },
    cancel:      { rotulo: 'Cancelar',  Icone: Ban,       variant: 'ghost' },
  };

  const linha = (Icone, rotulo, valor) => (
    <div className="flex min-w-0 items-center gap-2">
      <Icone size={13} className="shrink-0 text-[var(--text3)]" />
      <span className="shrink-0 text-[10.5px] text-[var(--text3)]">{rotulo}</span>
      <span className="truncate text-[11.5px] font-semibold text-[var(--text2)]">{valor}</span>
    </div>
  );

  return (
    <header className="rounded-[14px] border border-[var(--card-border)] bg-[var(--card)] p-4 sm:p-5">
      {/* Identidade + ações */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <Button
            variant="ghost" size="icon" onClick={onVoltar}
            aria-label="Voltar para a lista de campanhas" className="mt-0.5 shrink-0"
          >
            <ArrowLeft size={16} />
          </Button>

          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-[17px] font-bold leading-tight text-[var(--text)] sm:text-[19px]">
                {campanha.name}
              </h1>
              <Badge variant={st.badge}>{st.rotulo}</Badge>
            </div>
            {campanha.description && (
              <p className="mt-1 line-clamp-2 max-w-[62ch] text-[11.5px] leading-relaxed text-[var(--text3)]">
                {campanha.description}
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {permitidas.map(acao => {
            if (acao === 'retryFailed' && !falhas) return null;
            const b = BOTOES[acao];
            return (
              <Button
                key={acao} variant={b.variant} size="sm" disabled={agindo}
                onClick={() => onAcao(acao)}
                className={acao === 'cancel' ? 'text-[var(--red)] hover:text-[var(--red)]' : undefined}
              >
                <b.Icone size={13} />
                {b.rotulo}
              </Button>
            );
          })}
        </div>
      </div>

      {/* Configuração — auto-fit para reorganizar sem media query */}
      <div
        className="mt-4 grid gap-x-5 gap-y-2.5 border-t border-[var(--border)] pt-4"
        style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(210px, 100%), 1fr))' }}
      >
        {linha(Users,  'Contas',     (campanha.accountIds || []).length)}
        {linha(Film,   'Conteúdos',  (campanha.contentIds || []).length)}
        {linha(Layers, 'Publicações', estatisticas?.total ?? campanha.totalPublications ?? 0)}
        {linha(Shuffle, 'Estratégia', ESTRATEGIAS[campanha.strategy?.mode] || campanha.strategy?.mode || '—')}
        {linha(Timer,  'Intervalo',  intervalo)}
        {linha(CalendarClock, 'Janela', janela)}
      </div>

      {/* Datas */}
      <div className="mt-3.5 flex flex-wrap gap-x-5 gap-y-1.5 border-t border-[var(--border)] pt-3.5">
        <div>
          <Eyebrow>Criada</Eyebrow>
          <div className="mt-0.5 font-mono text-[11px] tabular-nums text-[var(--text2)]">
            {dataCurta(campanha.createdAt)}
          </div>
        </div>
        <div>
          <Eyebrow>Iniciada</Eyebrow>
          <div className="mt-0.5 font-mono text-[11px] tabular-nums text-[var(--text2)]">
            {campanha.startedAt ? dataCurta(campanha.startedAt) : '—'}
          </div>
        </div>
        <div>
          <Eyebrow>Concluída</Eyebrow>
          <div className="mt-0.5 font-mono text-[11px] tabular-nums text-[var(--text2)]">
            {campanha.completedAt ? dataCurta(campanha.completedAt) : '—'}
          </div>
        </div>
        {campanha.strategy?.seed && (
          <div className="min-w-0">
            <Eyebrow>Semente</Eyebrow>
            <div className="mt-0.5 truncate font-mono text-[11px] text-[var(--text2)]">
              {campanha.strategy.seed}
            </div>
          </div>
        )}
      </div>
    </header>
  );
}
