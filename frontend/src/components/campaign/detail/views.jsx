import { useMemo, useState } from 'react';
import { ChevronRight, RotateCcw, MessageSquare, Search, AlertTriangle } from 'lucide-react';
import { Button } from '../../ui/button';
import { Progress } from '../../ui/progress';
import { Badge } from '../../ui/badge';
import {
  ContaAvatar, ConteudoThumb, Eyebrow, StatusBadge, Vazio,
  STATUS_PUB, STATUS_COMENTARIO, ERROS_PUB, ERROS_COMENTARIO, descreverErro,
  horaCurta, dataCurta, quando, nomeConta, nomeConteudo,
} from './shared';
import { cn } from '../../../lib/utils';

/**
 * Visões da campanha: timeline, agrupamentos, tabela, comentários e problemas.
 *
 * Todas leem a MESMA lista de publicações carregada pela página — nenhuma refaz
 * consulta nem recalcula estado. Agrupar e filtrar aqui é apresentação; o estado
 * de cada publicação continua vindo inteiro do backend.
 */

/* ── Agrupamentos ──────────────────────────────────────────────────────────── */

/** Rollup por conta, a partir das publicações reais. */
export function agruparPorConta(publicacoes) {
  const mapa = new Map();

  for (const p of publicacoes) {
    const id = String(p.account?._id ?? p.account ?? '');
    if (!id) continue;

    if (!mapa.has(id)) {
      mapa.set(id, {
        id, conta: p.account, itens: [],
        published: 0, failed: 0, pendentes: 0, processing: 0, cancelled: 0,
      });
    }
    const g = mapa.get(id);
    g.itens.push(p);
    if (p.status === 'published')       g.published++;
    else if (p.status === 'failed')     g.failed++;
    else if (p.status === 'processing') g.processing++;
    else if (p.status === 'cancelled')  g.cancelled++;
    else                               g.pendentes++;
  }

  for (const g of mapa.values()) {
    g.total = g.itens.length;
    g.pct = g.total ? Math.round((g.published / g.total) * 100) : 0;
    // Ordena por horário para "próxima" ser de fato a próxima.
    g.itens.sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt));
    g.proxima = g.itens.find(i => ['pending', 'scheduled'].includes(i.status)) || null;
  }

  return [...mapa.values()];
}

/** Rollup por conteúdo. */
export function agruparPorConteudo(publicacoes) {
  const mapa = new Map();

  for (const p of publicacoes) {
    const id = String(p.content?._id ?? p.content ?? '');
    if (!id) continue;

    if (!mapa.has(id)) {
      mapa.set(id, {
        id, conteudo: p.content, itens: [],
        published: 0, failed: 0, pendentes: 0, processing: 0, cancelled: 0,
      });
    }
    const g = mapa.get(id);
    g.itens.push(p);
    if (p.status === 'published')       g.published++;
    else if (p.status === 'failed')     g.failed++;
    else if (p.status === 'processing') g.processing++;
    else if (p.status === 'cancelled')  g.cancelled++;
    else                               g.pendentes++;
  }

  for (const g of mapa.values()) {
    g.total = g.itens.length;
    g.pct = g.total ? Math.round((g.published / g.total) * 100) : 0;
    g.itens.sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt));
  }

  return [...mapa.values()];
}

/** Resumo de contas para o cartão de métricas. */
export function resumoContas(publicacoes) {
  const grupos = agruparPorConta(publicacoes);
  return {
    total:      grupos.length,
    // "Concluída" = nada mais em aberto e ao menos uma publicada.
    concluidas: grupos.filter(g => g.pendentes + g.processing === 0 && g.published > 0).length,
    pendentes:  grupos.filter(g => g.pendentes + g.processing > 0).length,
    comErro:    grupos.filter(g => g.failed > 0).length,
  };
}

/* ── Linha de publicação (reusada em várias visões) ────────────────────────── */

export function LinhaPublicacao({ pub, onAbrir, mostrarData = false, compacta = false }) {
  const falhou = pub.status === 'failed';
  const comFalhou = pub.commentStatus === 'failed';

  return (
    <button
      type="button"
      onClick={() => onAbrir?.(pub)}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-[var(--mf-r-md)] border p-2.5 text-left transition-colors',
        'hover:bg-[var(--mf-border-subtle)] focus-visible:outline-2 focus-visible:outline-[var(--mf-mod,_var(--mf-accent-500))]',
        falhou || comFalhou
          ? 'border-[color-mix(in_oklch,_var(--mf-danger-500)_24%,_transparent)] bg-[color-mix(in_oklch,_var(--mf-danger-500)_3%,_transparent)]'
          : 'border-[var(--border)] bg-[var(--mf-border-subtle)]'
      )}
    >
      <span className="w-7 shrink-0 font-mono text-[var(--mf-t-nano)] tabular-nums text-[var(--mf-text-3)]">
        #{pub.order}
      </span>

      {!compacta && <ContaAvatar conta={pub.account} size={24} />}

      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          {!compacta && (
            <span className="truncate text-[var(--mf-t-micro)] font-bold text-[var(--mf-text)]">
              {nomeConta(pub.account)}
            </span>
          )}
          <ConteudoThumb conteudo={pub.content} size={16} />
          <span className="truncate text-[var(--mf-t-micro)] text-[var(--mf-text-3)]">
            {nomeConteudo(pub.content)}
          </span>
        </span>

        {(falhou || comFalhou) && (
          <span className="mt-1 block truncate text-[var(--mf-t-nano)] font-semibold text-[var(--mf-danger-500)]">
            {falhou
              ? descreverErro(pub.errorCode, ERROS_PUB)
              : `Comentário: ${descreverErro(pub.commentErrorCode, ERROS_COMENTARIO)}`}
          </span>
        )}
      </span>

      <span className="shrink-0 text-right">
        <span className="block font-mono text-[var(--mf-t-nano)] tabular-nums text-[var(--mf-text-3)]">
          {mostrarData && `${dataCurta(pub.scheduledAt)} · `}{horaCurta(pub.scheduledAt)}
        </span>
        {pub.attempts > 1 && (
          <span className="mt-0.5 block font-mono text-[var(--mf-t-nano)] tabular-nums text-[var(--mf-text-3)]">
            {pub.attempts}x
          </span>
        )}
      </span>

      <span className="hidden shrink-0 sm:block">
        <StatusBadge status={pub.status} />
      </span>

      <ChevronRight size={13} className="shrink-0 text-[var(--mf-text-3)]" />
    </button>
  );
}

/* ── Timeline ──────────────────────────────────────────────────────────────── */

export function TimelineView({ publicacoes, onAbrir }) {
  // Já vem ordenada por scheduledAt do backend; a ordenação aqui garante a
  // invariante mesmo se a origem mudar.
  const ordenadas = useMemo(
    () => [...publicacoes].sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt)),
    [publicacoes],
  );

  if (!ordenadas.length) return <Vazio>Nenhuma publicação nesta campanha.</Vazio>;

  // Cabeçalho por dia: uma campanha que atravessa dias fica ilegível só com hora.
  let diaAtual = null;

  return (
    <div className="flex flex-col gap-1.5">
      {ordenadas.map(p => {
        const dia = dataCurta(p.scheduledAt);
        const novoDia = dia !== diaAtual;
        diaAtual = dia;

        return (
          <div key={p._id}>
            {novoDia && (
              <div className="sticky top-0 z-10 -mx-1 bg-[var(--bg)] px-1 py-1.5">
                <Eyebrow>{dia}</Eyebrow>
              </div>
            )}
            <LinhaPublicacao pub={p} onAbrir={onAbrir} />
          </div>
        );
      })}
    </div>
  );
}

/* ── Por conta ─────────────────────────────────────────────────────────────── */

export function ByAccountView({ publicacoes, onAbrir }) {
  const grupos = useMemo(() => agruparPorConta(publicacoes), [publicacoes]);
  const [aberta, setAberta] = useState(null);

  if (!grupos.length) return <Vazio>Nenhuma conta com publicações.</Vazio>;

  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(320px, 100%), 1fr))' }}>
      {grupos.map(g => {
        const expandida = aberta === g.id;
        return (
          <div key={g.id} className="rounded-[var(--mf-r-md)] border border-[var(--card-border)] bg-[var(--card)] p-3.5">
            <button
              type="button"
              onClick={() => setAberta(expandida ? null : g.id)}
              aria-expanded={expandida}
              className="flex w-full items-center gap-2.5 text-left focus-visible:outline-2 focus-visible:outline-[var(--mf-mod,_var(--mf-accent-500))]"
            >
              <ContaAvatar conta={g.conta} size={30} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12.5px] font-bold text-[var(--mf-text)]">
                  {nomeConta(g.conta)}
                </span>
                <span className="block text-[var(--mf-t-nano)] text-[var(--mf-text-3)]">
                  {g.total} publicaç{g.total === 1 ? 'ão' : 'ões'}
                </span>
              </span>
              <span className="shrink-0 font-mono text-[var(--mf-t-body)] font-extrabold tabular-nums text-[var(--mf-text)]">
                {g.pct}%
              </span>
              <ChevronRight
                size={14}
                className={cn('shrink-0 text-[var(--mf-text-3)] transition-transform', expandida && 'rotate-90')}
              />
            </button>

            <Progress value={g.pct} className="mt-2.5" />

            <div className="mt-2.5 flex flex-wrap gap-x-3 gap-y-1 text-[var(--mf-t-nano)]">
              <span className="text-[var(--mf-success-500)]">{g.published} concluídas</span>
              {g.pendentes > 0  && <span className="text-[var(--mf-mod,_var(--mf-accent-500))]">{g.pendentes} pendentes</span>}
              {g.processing > 0 && <span className="text-[var(--mf-info-500)]">{g.processing} publicando</span>}
              {g.failed > 0     && <span className="text-[var(--mf-danger-500)]">{g.failed} falhas</span>}
              {g.cancelled > 0  && <span className="text-[var(--mf-text-3)]">{g.cancelled} canceladas</span>}
            </div>

            {g.proxima && (
              <div className="mt-2.5 border-t border-[var(--border)] pt-2.5">
                <Eyebrow>Próxima</Eyebrow>
                <div className="mt-1 truncate text-[var(--mf-t-micro)] text-[var(--mf-text-2)]">
                  {nomeConteudo(g.proxima.content)} — {quando(g.proxima.scheduledAt)}
                </div>
              </div>
            )}

            {expandida && (
              <div className="mt-3 flex flex-col gap-1.5 border-t border-[var(--border)] pt-3">
                {g.itens.map(p => (
                  <LinhaPublicacao key={p._id} pub={p} onAbrir={onAbrir} compacta />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ── Por conteúdo ──────────────────────────────────────────────────────────── */

export function ByContentView({ publicacoes, onAbrir }) {
  const grupos = useMemo(() => agruparPorConteudo(publicacoes), [publicacoes]);
  const [aberto, setAberto] = useState(null);

  if (!grupos.length) return <Vazio>Nenhum conteúdo com publicações.</Vazio>;

  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(320px, 100%), 1fr))' }}>
      {grupos.map(g => {
        const expandido = aberto === g.id;
        return (
          <div key={g.id} className="rounded-[var(--mf-r-md)] border border-[var(--card-border)] bg-[var(--card)] p-3.5">
            <button
              type="button"
              onClick={() => setAberto(expandido ? null : g.id)}
              aria-expanded={expandido}
              className="flex w-full items-center gap-2.5 text-left focus-visible:outline-2 focus-visible:outline-[var(--mf-mod,_var(--mf-accent-500))]"
            >
              <ConteudoThumb conteudo={g.conteudo} size={30} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12.5px] font-bold text-[var(--mf-text)]">
                  {nomeConteudo(g.conteudo)}
                </span>
                <span className="block text-[var(--mf-t-nano)] text-[var(--mf-text-3)]">
                  {g.total} cont{g.total === 1 ? 'a' : 'as'}
                </span>
              </span>
              <span className="shrink-0 font-mono text-[var(--mf-t-xs)] font-bold tabular-nums text-[var(--mf-text-2)]">
                {g.published}/{g.total}
              </span>
              <ChevronRight
                size={14}
                className={cn('shrink-0 text-[var(--mf-text-3)] transition-transform', expandido && 'rotate-90')}
              />
            </button>

            <Progress value={g.pct} className="mt-2.5" />

            <div className="mt-2.5 flex flex-wrap gap-x-3 gap-y-1 text-[var(--mf-t-nano)]">
              <span className="text-[var(--mf-success-500)]">{g.published} publicados</span>
              {g.pendentes > 0  && <span className="text-[var(--mf-mod,_var(--mf-accent-500))]">{g.pendentes} pendentes</span>}
              {g.processing > 0 && <span className="text-[var(--mf-info-500)]">{g.processing} processando</span>}
              {g.failed > 0     && <span className="text-[var(--mf-danger-500)]">{g.failed} falharam</span>}
              {g.cancelled > 0  && <span className="text-[var(--mf-text-3)]">{g.cancelled} canceladas</span>}
            </div>

            {expandido && (
              <div className="mt-3 flex flex-col gap-1.5 border-t border-[var(--border)] pt-3">
                {g.itens.map(p => (
                  <button
                    key={p._id}
                    type="button"
                    onClick={() => onAbrir?.(p)}
                    className="flex items-center gap-2 rounded-[var(--mf-r-sm)] p-1.5 text-left transition-colors hover:bg-[var(--mf-border-subtle)] focus-visible:outline-2 focus-visible:outline-[var(--mf-mod,_var(--mf-accent-500))]"
                  >
                    <ContaAvatar conta={p.account} size={20} />
                    <span className="min-w-0 flex-1 truncate text-[var(--mf-t-micro)] font-semibold text-[var(--mf-text-2)]">
                      {nomeConta(p.account)}
                    </span>
                    <span className="shrink-0 font-mono text-[var(--mf-t-nano)] tabular-nums text-[var(--mf-text-3)]">
                      {horaCurta(p.scheduledAt)}
                    </span>
                    <span className={cn('shrink-0 text-[var(--mf-t-xs)] font-bold', STATUS_PUB[p.status]?.cor)}>
                      {p.status === 'published' ? '✓'
                        : p.status === 'failed' ? '✕'
                        : p.status === 'processing' ? '⚙'
                        : p.status === 'cancelled' ? '—' : '◷'}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ── Tabela de publicações ─────────────────────────────────────────────────── */

export const FILTROS_PUB = [
  ['',                    'Todas'],
  ['scheduled',           'Agendadas'],
  ['processing',          'Processando'],
  ['published',           'Publicadas'],
  ['failed',              'Falhas'],
  ['comment_scheduled',   'Coment. pendentes'],
  ['comment_failed',      'Coment. falhos'],
];

const ORDENACOES = [
  ['horario',   'Horário'],
  ['conta',     'Conta'],
  ['conteudo',  'Conteúdo'],
  ['status',    'Status'],
  ['tentativas', 'Tentativas'],
];

/** Aplica filtro, busca e ordenação. Exportada para ser testada isolada. */
export function filtrarPublicacoes(publicacoes, { filtro = '', busca = '', ordem = 'horario' } = {}) {
  const termo = busca.trim().toLowerCase();

  let saida = publicacoes.filter(p => {
    if (filtro === 'comment_scheduled' && p.commentStatus !== 'scheduled') return false;
    if (filtro === 'comment_failed'    && p.commentStatus !== 'failed')    return false;
    if (filtro && !filtro.startsWith('comment_') && p.status !== filtro)   return false;

    if (termo) {
      const alvo = `${p.account?.username || ''} ${p.account?.name || ''} ${nomeConteudo(p.content)} ${p.content?.filename || ''}`.toLowerCase();
      if (!alvo.includes(termo)) return false;
    }
    return true;
  });

  const cmp = {
    horario:    (a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt),
    conta:      (a, b) => String(a.account?.username || '').localeCompare(String(b.account?.username || '')),
    conteudo:   (a, b) => nomeConteudo(a.content).localeCompare(nomeConteudo(b.content)),
    status:     (a, b) => String(a.status).localeCompare(String(b.status)),
    tentativas: (a, b) => (b.attempts || 0) - (a.attempts || 0),
  }[ordem] || null;

  if (cmp) saida = [...saida].sort(cmp);
  return saida;
}

export function PublicationsView({ publicacoes, onAbrir, contagem }) {
  const [filtro, setFiltro] = useState('');
  const [busca, setBusca]   = useState('');
  const [ordem, setOrdem]   = useState('horario');

  const visiveis = useMemo(
    () => filtrarPublicacoes(publicacoes, { filtro, busca, ordem }),
    [publicacoes, filtro, busca, ordem],
  );

  const contarFiltro = valor => {
    if (!valor) return publicacoes.length;
    if (valor === 'comment_scheduled') return publicacoes.filter(p => p.commentStatus === 'scheduled').length;
    if (valor === 'comment_failed')    return publicacoes.filter(p => p.commentStatus === 'failed').length;
    return contagem?.[valor] ?? publicacoes.filter(p => p.status === valor).length;
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Busca + ordenação */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[180px] flex-1">
          <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--mf-text-3)]" />
          <input
            type="search"
            value={busca}
            onChange={e => setBusca(e.target.value)}
            placeholder="Buscar conta ou conteúdo..."
            aria-label="Buscar conta ou conteúdo"
            className="h-8 w-full rounded-[var(--mf-r-sm)] border border-[var(--border)] bg-[var(--mf-border-subtle)] pl-8 pr-2.5 text-[var(--mf-t-micro)] text-[var(--mf-text)] placeholder:text-[var(--mf-text-3)] focus:border-[var(--border2)] focus:outline-none"
          />
        </div>
        <div className="flex items-center gap-1.5">
          <label htmlFor="ordem-pub" className="text-[var(--mf-t-nano)] text-[var(--mf-text-3)]">Ordenar</label>
          <select
            id="ordem-pub"
            value={ordem}
            onChange={e => setOrdem(e.target.value)}
            className="h-8 rounded-[var(--mf-r-sm)] border border-[var(--border)] bg-[var(--mf-border-subtle)] px-2 text-[var(--mf-t-micro)] text-[var(--mf-text)] focus:outline-none"
          >
            {ORDENACOES.map(([v, r]) => <option key={v} value={v}>{r}</option>)}
          </select>
        </div>
      </div>

      {/* Filtros — rolam na horizontal no celular */}
      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {FILTROS_PUB.map(([valor, rotulo]) => {
          const ativo = filtro === valor;
          return (
            <button
              key={valor || 'todas'}
              type="button"
              onClick={() => setFiltro(valor)}
              className={cn(
                'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[var(--mf-r-sm)] border px-2.5 py-1 text-[var(--mf-t-nano)] font-bold transition-colors',
                ativo
                  ? 'border-[color-mix(in_oklch,_var(--mf-mod-contas)_32%,_transparent)] bg-[color-mix(in_oklch,_var(--mf-mod-contas)_12%,_transparent)] text-[var(--mf-mod,_var(--mf-accent-500))]'
                  : 'border-[var(--border)] bg-[var(--mf-border-subtle)] text-[var(--mf-text-3)] hover:text-[var(--mf-text-2)]'
              )}
            >
              {rotulo}
              <span className="font-mono text-[var(--mf-t-nano)] tabular-nums opacity-75">{contarFiltro(valor)}</span>
            </button>
          );
        })}
      </div>

      {/* Lista — cartões em qualquer largura. Uma tabela real precisaria virar
          cartão no celular; a linha já é legível nas duas, então é uma só. */}
      {visiveis.length ? (
        <div className="flex flex-col gap-1.5">
          {visiveis.map(p => (
            <LinhaPublicacao key={p._id} pub={p} onAbrir={onAbrir} mostrarData />
          ))}
        </div>
      ) : (
        <Vazio>
          {publicacoes.length
            ? 'Nenhuma publicação com esses filtros.'
            : 'Esta campanha não tem publicações.'}
        </Vazio>
      )}
    </div>
  );
}

/* ── Comentários ───────────────────────────────────────────────────────────── */

export function CommentsView({ publicacoes, comentarios, onAbrir, onReprocessar, agindo }) {
  const comComentario = useMemo(
    () => publicacoes
      .filter(p => p.commentStatus && p.commentStatus !== 'none')
      .sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt)),
    [publicacoes],
  );

  if (!comComentario.length) {
    return <Vazio>Esta campanha não publica comentários.</Vazio>;
  }

  const c = comentarios || {};

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <Badge variant="secondary">{c.total ?? comComentario.length} total</Badge>
        <Badge variant="success">{c.posted ?? 0} publicados</Badge>
        <Badge variant="outline">{c.scheduled ?? 0} agendados</Badge>
        {(c.failed ?? 0) > 0 && <Badge variant="destructive">{c.failed} falhos</Badge>}
        {(c.cancelled ?? 0) > 0 && <Badge variant="secondary">{c.cancelled} cancelados</Badge>}
      </div>

      <div className="flex flex-col gap-1.5">
        {comComentario.map(p => {
          const falhou = p.commentStatus === 'failed';
          return (
            <div
              key={p._id}
              className={cn(
                'rounded-[var(--mf-r-md)] border p-3',
                falhou
                  ? 'border-[color-mix(in_oklch,_var(--mf-danger-500)_24%,_transparent)] bg-[color-mix(in_oklch,_var(--mf-danger-500)_3%,_transparent)]'
                  : 'border-[var(--border)] bg-[var(--mf-border-subtle)]'
              )}
            >
              <div className="flex flex-wrap items-center gap-2">
                <ContaAvatar conta={p.account} size={22} />
                <span className="text-[var(--mf-t-micro)] font-bold text-[var(--mf-text)]">{nomeConta(p.account)}</span>
                <span className="truncate text-[var(--mf-t-micro)] text-[var(--mf-text-3)]">{nomeConteudo(p.content)}</span>
                <span className="ml-auto shrink-0">
                  <StatusBadge status={p.commentStatus} mapa={STATUS_COMENTARIO} />
                </span>
              </div>

              {p.resolvedComment && (
                <p className="mt-2 line-clamp-2 whitespace-pre-wrap break-words text-[var(--mf-t-micro)] leading-relaxed text-[var(--mf-text-2)]">
                  “{p.resolvedComment}”
                </p>
              )}

              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <span className="font-mono text-[var(--mf-t-nano)] tabular-nums text-[var(--mf-text-3)]">
                  {p.commentPostedAt
                    ? `Publicado ${quando(p.commentPostedAt)}`
                    : `Agendado para depois de ${horaCurta(p.scheduledAt)}`}
                </span>
                {p.commentAttempts > 0 && (
                  <span className="font-mono text-[var(--mf-t-nano)] tabular-nums text-[var(--mf-text-3)]">
                    {p.commentAttempts} tentativa{p.commentAttempts === 1 ? '' : 's'}
                  </span>
                )}
                {falhou && (
                  <span className="text-[var(--mf-t-nano)] font-bold text-[var(--mf-danger-500)]">
                    {descreverErro(p.commentErrorCode, ERROS_COMENTARIO)}
                  </span>
                )}
                <span className="ml-auto flex shrink-0 gap-1.5">
                  <Button size="sm" variant="ghost" onClick={() => onAbrir?.(p)}>Detalhes</Button>
                  {falhou && p.hasMediaLink && (
                    <Button size="sm" variant="outline" disabled={agindo} onClick={() => onReprocessar(p._id)}>
                      <MessageSquare size={12} />
                      Reprocessar
                    </Button>
                  )}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── Problemas ─────────────────────────────────────────────────────────────── */

export function ProblemsView({ publicacoes, onAbrir, onReprocessar, onReprocessarComentario, agindo }) {
  const problemas = useMemo(
    () => publicacoes
      .filter(p => p.status === 'failed' || p.commentStatus === 'failed')
      .sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt)),
    [publicacoes],
  );

  if (!problemas.length) {
    return <Vazio>Nenhum problema — nada precisa de atenção agora.</Vazio>;
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-[var(--mf-t-micro)] text-[var(--mf-text-3)]">
        {problemas.length} {problemas.length === 1 ? 'item precisa' : 'itens precisam'} de atenção.
      </p>

      {problemas.map(p => {
        const pubFalhou = p.status === 'failed';
        const comFalhou = p.commentStatus === 'failed';

        return (
          <div
            key={p._id}
            className="rounded-[var(--mf-r-md)] border border-[color-mix(in_oklch,_var(--mf-danger-500)_26%,_transparent)] bg-[color-mix(in_oklch,_var(--mf-danger-500)_4%,_transparent)] p-3"
          >
            <div className="flex flex-wrap items-center gap-2">
              <AlertTriangle size={13} className="shrink-0 text-[var(--mf-danger-500)]" />
              <ContaAvatar conta={p.account} size={20} />
              <span className="text-[var(--mf-t-micro)] font-bold text-[var(--mf-text)]">{nomeConta(p.account)}</span>
              <span className="text-[var(--mf-text-3)]">·</span>
              <span className="truncate text-[var(--mf-t-micro)] text-[var(--mf-text-3)]">{nomeConteudo(p.content)}</span>
              <span className="ml-auto shrink-0 font-mono text-[var(--mf-t-nano)] tabular-nums text-[var(--mf-text-3)]">
                {dataCurta(p.scheduledAt)} · {horaCurta(p.scheduledAt)}
              </span>
            </div>

            {/* Publicação e comentário separados: reprocessar a publicação de um
                post que já está no ar publicaria de novo. */}
            {pubFalhou && (
              <div className="mt-2.5 flex flex-wrap items-center gap-2 border-t border-[color-mix(in_oklch,_var(--mf-danger-500)_16%,_transparent)] pt-2.5">
                <span className="text-[var(--mf-t-micro)] font-bold text-[var(--mf-danger-500)]">Publicação falhou</span>
                <span className="font-mono text-[var(--mf-t-nano)] text-[var(--mf-danger-500)]">
                  {descreverErro(p.errorCode, ERROS_PUB)}
                </span>
                <span className="font-mono text-[var(--mf-t-nano)] tabular-nums text-[var(--mf-text-3)]">
                  tentativa {p.attempts}
                </span>
                <span className="ml-auto flex gap-1.5">
                  <Button size="sm" variant="ghost" onClick={() => onAbrir?.(p)}>Detalhes</Button>
                  <Button size="sm" variant="outline" disabled={agindo} onClick={() => onReprocessar(p._id)}>
                    <RotateCcw size={12} />
                    Reprocessar
                  </Button>
                </span>
              </div>
            )}

            {comFalhou && (
              <div className="mt-2.5 flex flex-wrap items-center gap-2 border-t border-[color-mix(in_oklch,_var(--mf-danger-500)_16%,_transparent)] pt-2.5">
                <span className="text-[var(--mf-t-micro)] font-bold text-[var(--mf-danger-500)]">Comentário falhou</span>
                <span className="font-mono text-[var(--mf-t-nano)] text-[var(--mf-danger-500)]">
                  {descreverErro(p.commentErrorCode, ERROS_COMENTARIO)}
                </span>
                {p.status === 'published' && (
                  <span className="text-[var(--mf-t-nano)] text-[var(--mf-text-3)]">a publicação saiu normalmente</span>
                )}
                <span className="ml-auto flex gap-1.5">
                  {p.hasMediaLink ? (
                    <Button size="sm" variant="outline" disabled={agindo} onClick={() => onReprocessarComentario(p._id)}>
                      <MessageSquare size={12} />
                      Reprocessar comentário
                    </Button>
                  ) : (
                    <span className="text-[var(--mf-t-nano)] text-[var(--mf-text-3)]">
                      sem vínculo com a mídia — não é possível reprocessar
                    </span>
                  )}
                </span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ── Plano completo ────────────────────────────────────────────────────────── */

export function PlanoCompleto({ publicacoes, onAbrir }) {
  const ordenadas = useMemo(
    () => [...publicacoes].sort((a, b) => (a.order || 0) - (b.order || 0)),
    [publicacoes],
  );

  if (!ordenadas.length) return <Vazio>Nenhuma publicação no plano.</Vazio>;

  return (
    <div className="flex flex-col gap-1">
      <p className="mb-1 text-[var(--mf-t-micro)] leading-relaxed text-[var(--mf-text-3)]">
        Ordem gerada pelo planner. Contas e conteúdos aparecem intercalados conforme
        a estratégia configurada.
      </p>
      {ordenadas.map(p => (
        <button
          key={p._id}
          type="button"
          onClick={() => onAbrir?.(p)}
          className="flex items-center gap-2.5 rounded-[var(--mf-r-sm)] px-2 py-1.5 text-left transition-colors hover:bg-[var(--mf-border-subtle)] focus-visible:outline-2 focus-visible:outline-[var(--mf-mod,_var(--mf-accent-500))]"
        >
          <span className="w-7 shrink-0 font-mono text-[var(--mf-t-nano)] tabular-nums text-[var(--mf-text-3)]">
            {String(p.order).padStart(2, '0')}
          </span>
          <span className="w-24 shrink-0 font-mono text-[var(--mf-t-nano)] tabular-nums text-[var(--mf-text-3)]">
            {dataCurta(p.scheduledAt).slice(0, 5)} {horaCurta(p.scheduledAt)}
          </span>
          <span className="w-28 shrink-0 truncate text-[var(--mf-t-micro)] font-bold text-[var(--mf-text-2)]">
            {nomeConta(p.account)}
          </span>
          <span className="min-w-0 flex-1 truncate text-[var(--mf-t-micro)] text-[var(--mf-text-3)]">
            {nomeConteudo(p.content)}
          </span>
          <span className={cn('shrink-0 text-[var(--mf-t-xs)] font-bold', STATUS_PUB[p.status]?.cor)}>
            {p.status === 'published' ? '✓'
              : p.status === 'failed' ? '✕'
              : p.status === 'processing' ? '⚙'
              : p.status === 'cancelled' ? '—' : '◷'}
          </span>
        </button>
      ))}
    </div>
  );
}
