import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Pause, Ban, Clock, Loader2, Inbox } from 'lucide-react';
import {
  ContaAvatar, ConteudoThumb, Eyebrow, StatusBadge,
  quando, faltam, nomeConta, nomeConteudo,
} from './shared';

/**
 * Próxima publicação e próxima ação.
 *
 * A próxima publicação vem do backend (`nextPublication`), não do primeiro item
 * da página carregada: a listagem é paginada, e numa campanha grande as
 * primeiras linhas por horário podem estar todas publicadas — a tela diria
 * "nenhuma pendente" com dezenas na fila.
 *
 * Os textos exibidos são `resolvedCaption`/`resolvedComment`, materializados
 * pelo planner. Mostrar o template deixaria `{username}` visível no lugar do
 * texto que vai de fato ao Instagram.
 */

/**
 * Decide a próxima ação a partir do estado REAL.
 *
 * Ordem por urgência: o que exige intervenção humana vem antes do que o motor
 * resolve sozinho. Falhas ganham do "publicação em X min" porque só elas param
 * esperando alguém.
 *
 * @returns {{tom: 'erro'|'aviso'|'ok'|'neutro', Icone: Function, titulo: string, detalhe?: string}}
 */
export function proximaAcao({ campanha, estatisticas = {}, comentarios = {}, proxima, agora = Date.now() }) {
  const status = campanha?.status;
  const falhas = estatisticas.failed || 0;
  const comFalhos = comentarios.failed || 0;

  if (status === 'cancelled') {
    return { tom: 'neutro', Icone: Ban, titulo: 'Campanha cancelada',
      detalhe: 'As publicações que ainda não saíram foram canceladas.' };
  }
  if (status === 'paused') {
    const emAberto = (estatisticas.pending || 0) + (estatisticas.scheduled || 0);
    return { tom: 'aviso', Icone: Pause, titulo: 'Campanha pausada',
      detalhe: emAberto ? `${emAberto} publicaç${emAberto === 1 ? 'ão' : 'ões'} aguardando retomada.` : undefined };
  }
  if (falhas > 0) {
    return { tom: 'erro', Icone: AlertTriangle,
      titulo: `${falhas} publicaç${falhas === 1 ? 'ão' : 'ões'} com erro`,
      detalhe: 'Verifique em Problemas e reprocesse quando resolvido.' };
  }
  if (comFalhos > 0) {
    return { tom: 'erro', Icone: AlertTriangle,
      titulo: `${comFalhos} comentário${comFalhos === 1 ? '' : 's'} com erro`,
      detalhe: 'A publicação saiu; apenas o comentário falhou.' };
  }
  if (estatisticas.processing > 0) {
    return { tom: 'ok', Icone: Loader2,
      titulo: `${estatisticas.processing} publicando agora`,
      detalhe: 'Aguarde a conclusão.' };
  }
  if (proxima?.scheduledAt) {
    const restante = faltam(proxima.scheduledAt, agora);
    return { tom: 'ok', Icone: Clock,
      titulo: restante === 'agora' ? 'Próxima publicação a qualquer momento' : `Próxima publicação ${restante}`,
      detalhe: `${nomeConta(proxima.account)} · ${nomeConteudo(proxima.content)}` };
  }
  if (['completed', 'partial'].includes(status)) {
    return { tom: 'ok', Icone: CheckCircle2, titulo: 'Campanha concluída',
      detalhe: status === 'partial' ? 'Terminou com parte das publicações falhando.' : 'Todas as publicações saíram.' };
  }
  if (!estatisticas.total) {
    return { tom: 'neutro', Icone: Inbox, titulo: 'Nenhuma publicação planejada' };
  }
  return { tom: 'neutro', Icone: Inbox, titulo: 'Nada pendente' };
}

const TONS = {
  erro:   'border-[color-mix(in oklch, var(--mf-danger-500) 28%, transparent)]  bg-[color-mix(in oklch, var(--mf-danger-500) 6%, transparent)]  text-[var(--mf-danger-500)]',
  aviso:  'border-[color-mix(in oklch, var(--mf-warning-500) 28%, transparent)] bg-[color-mix(in oklch, var(--mf-warning-500) 6%, transparent)] text-[var(--mf-warning-500)]',
  ok:     'border-[color-mix(in oklch, var(--mf-mod-contas) 24%, transparent)]  bg-[color-mix(in oklch, var(--mf-mod-contas) 5%, transparent)]  text-[var(--mf-mod, var(--mf-accent-500))]',
  neutro: 'border-[var(--border)]        bg-[var(--mf-border-subtle)] text-[var(--mf-text-3)]',
};

export default function NextUp({ campanha, estatisticas, comentarios, proxima, onAbrir }) {
  // Relógio só para a contagem regressiva. Um minuto basta: o texto é "em 8
  // minutos", não segundos, e um tique por segundo re-renderizaria em vão.
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setAgora(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  const acao = proximaAcao({ campanha, estatisticas, comentarios, proxima, agora });
  const restante = proxima?.scheduledAt ? faltam(proxima.scheduledAt, agora) : null;

  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(300px, 100%), 1fr))' }}>

      {/* Próxima publicação */}
      <div className="rounded-[13px] border border-[var(--card-border)] bg-[var(--card)] p-4">
        <div className="flex items-center justify-between gap-2">
          <Eyebrow>Próxima publicação</Eyebrow>
          {restante && (
            <span className="font-mono text-[10.5px] font-bold tabular-nums text-[var(--mf-mod, var(--mf-accent-500))]">
              {restante}
            </span>
          )}
        </div>

        {!proxima ? (
          <p className="py-6 text-center text-[11.5px] text-[var(--mf-text-3)]">
            Não existem publicações pendentes.
          </p>
        ) : (
          <>
            <button
              type="button"
              onClick={() => onAbrir?.(proxima)}
              className="mt-3 flex w-full items-center gap-3 rounded-[9px] p-1 text-left transition-colors hover:bg-[var(--mf-border-subtle)] focus-visible:outline-2 focus-visible:outline-[var(--mf-mod, var(--mf-accent-500))]"
            >
              <ContaAvatar conta={proxima.account} size={34} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12.5px] font-bold text-[var(--mf-text)]">
                  {nomeConta(proxima.account)}
                </div>
                <div className="mt-0.5 flex items-center gap-1.5">
                  <ConteudoThumb conteudo={proxima.content} size={16} />
                  <span className="truncate text-[11px] text-[var(--mf-text-3)]">
                    {nomeConteudo(proxima.content)}
                  </span>
                </div>
              </div>
              <div className="shrink-0 text-right">
                <div className="font-mono text-[12px] font-bold tabular-nums text-[var(--mf-text-2)]">
                  {quando(proxima.scheduledAt)}
                </div>
                <div className="mt-1 flex justify-end">
                  <StatusBadge status={proxima.status} />
                </div>
              </div>
            </button>

            {proxima.resolvedCaption && (
              <div className="mt-3 border-t border-[var(--border)] pt-3">
                <Eyebrow>Legenda</Eyebrow>
                <p className="mt-1 line-clamp-3 whitespace-pre-wrap break-words text-[11.5px] leading-relaxed text-[var(--mf-text-2)]">
                  {proxima.resolvedCaption}
                </p>
              </div>
            )}

            {proxima.resolvedComment && (
              <div className="mt-2.5 border-t border-[var(--border)] pt-2.5">
                <Eyebrow>Comentário</Eyebrow>
                <p className="mt-1 line-clamp-2 whitespace-pre-wrap break-words text-[11.5px] leading-relaxed text-[var(--mf-text-2)]">
                  {proxima.resolvedComment}
                </p>
              </div>
            )}
          </>
        )}
      </div>

      {/* Próxima ação */}
      <div className="rounded-[13px] border border-[var(--card-border)] bg-[var(--card)] p-4">
        <Eyebrow>Próxima ação</Eyebrow>
        <div className={`mt-3 flex items-start gap-3 rounded-[10px] border p-3.5 ${TONS[acao.tom]}`}>
          <acao.Icone
            size={17}
            className={`mt-0.5 shrink-0 ${acao.Icone === Loader2 ? 'animate-spin' : ''}`}
          />
          <div className="min-w-0">
            <div className="text-[12.5px] font-bold leading-snug">{acao.titulo}</div>
            {acao.detalhe && (
              <div className="mt-1 text-[11px] leading-relaxed text-[var(--mf-text-3)]">
                {acao.detalhe}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
