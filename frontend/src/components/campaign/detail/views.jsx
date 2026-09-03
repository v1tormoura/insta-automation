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
    /* ── Conta removida ────────────────────────────────────────────────────

       Quando a conta é excluída depois da campanha ter sido montada, o
       `populate` do backend não acha o documento e `account` chega nulo.

       Antes a publicação era DESCARTADA aqui (`if (!id) continue`). O
       resultado na tela: a configuração dizia "1 conta" (lê o array de ids
       da campanha, que ainda tem o id), as métricas diziam "0 contas" (leem
       este agrupamento) e a matriz de distribuição vinha vazia. Três
       números do mesmo produto discordando, e nenhum deles mencionando uma
       conta excluída.

       Agora as órfãs vão para um balde próprio, rótulado. A publicação
       aconteceu — sumir com ela do painel não desfaz isso, só esconde. */
    const id = String(p.account?._id ?? p.account ?? '') || '__removida__';

    if (!mapa.has(id)) {
      mapa.set(id, {
        id, conta: p.account, removida: id === '__removida__', itens: [],
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

/* ── Linha de publicação (reusada em várias visões) ────────────────── */

/**
 * Uma publicação na lista.
 *
 * ── O que estava errado
 *
 * A linha era: `#1 [avatar] **Conta removida** — [thumb] arquivo.mp4 …… 22:39
 * [Publicado] ›`, e abaixo, em vermelho negrito, `Erro na publicação
 * (PUBLISH_ERROR)`.
 *
 * Num painel de doze linhas, o texto de MAIOR contraste era o nome da conta —
 * repetido doze vezes, idêntico. O nome do arquivo, longo e com prefixo comum,
 * ocupava metade da largura. O selo de status se repetia doze vezes. E o erro
 * vinha em vermelho negrito oito vezes, formando uma parede.
 *
 * Tudo que se repete em toda linha é ruído: não distingue nada, e ainda assim
 * consome o contraste que deveria estar no que difere. O resultado é o que se
 * vê de longe — texto jogado.
 *
 * ── O que muda
 *
 * A hora vira o eixo, à esquerda, em coluna fixa. É uma linha do TEMPO: o
 * horário é a única coisa que ordena, e ele estava perdido à direita.
 *
 * O status vira uma faixa vertical de 3px na borda. Cor comunica estado de
 * relance melhor que uma palavra, e não custa largura nem se repete como texto.
 * O selo escrito fica só onde o estado não é óbvio — falha.
 *
 * O nome do conteúdo vira o texto principal: é o que difere entre as linhas.
 * Cortado no MEIO, não no fim — `vazadosfree4-2090…126-01.mp4` — porque o começo
 * e o fim distinguem, e o miolo é o mesmo em todos.
 *
 * A conta desce para linha secundária, pequena. O erro vira uma marca curta com
 * só o código, alinhada à direita: oito frases vermelhas iguais viram oito
 * marcas discretas, e a que importa continua legível.
 */

/** Corta pelo meio: o começo e o fim distinguem, o miolo repete. */
function encurtarNome(nome, max = 42) {
  const s = String(nome || '—');
  if (s.length <= max) return s;
  const cabeca = Math.ceil((max - 1) / 2);
  const cauda = Math.floor((max - 1) / 2);
  return `${s.slice(0, cabeca)}…${s.slice(-cauda)}`;
}

/** A cor da faixa de estado. */
const FAIXA = {
  published:  'bg-[var(--mf-success-500)]',
  processing: 'bg-[var(--mf-info-500)]',
  failed:     'bg-[var(--mf-danger-500)]',
  cancelled:  'bg-[var(--mf-text-3)]',
  scheduled:  'bg-[var(--mf-primary-500)]',
  pending:    'bg-[var(--mf-border-strong)]',
};

export function LinhaPublicacao({ pub, onAbrir, mostrarData = false, compacta = false }) {
  const falhou = pub.status === 'failed';
  const comFalhou = pub.commentStatus === 'failed';
  const problema = falhou || comFalhou;

  return (
    <button
      type="button"
      onClick={() => onAbrir?.(pub)}
      className={cn(
        'group relative flex w-full items-center gap-3 rounded-[var(--mf-r-md)] py-2 pl-3 pr-2.5 text-left',
        'transition-colors hover:bg-[var(--mf-border-subtle)]',
        'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--mf-primary-500)]',
      )}
    >
      {/* A faixa de estado. Cor no lugar de uma palavra repetida doze vezes. */}
      <span
        aria-hidden
        className={cn(
          'absolute inset-y-1.5 left-0 w-[3px] rounded-full',
          FAIXA[pub.status] || FAIXA.pending,
          pub.status === 'pending' && 'opacity-50',
        )}
      />

      {/* O eixo: hora à esquerda, tabular, para as linhas formarem uma régua. */}
      <span className="w-[52px] shrink-0 text-right font-mono text-[var(--mf-t-micro)] tabular-nums text-[var(--mf-text-2)]">
        {horaCurta(pub.scheduledAt)}
        {mostrarData && (
          <span className="block text-[var(--mf-t-nano)] text-[var(--mf-text-3)]">
            {dataCurta(pub.scheduledAt)}
          </span>
        )}
      </span>

      <ConteudoThumb conteudo={pub.content} size={28} />

      <span className="min-w-0 flex-1">
        {/* O que difere entre as linhas fica no topo, com o contraste. */}
        <span className="block truncate text-[var(--mf-t-micro)] font-semibold text-[var(--mf-text)]">
          {encurtarNome(nomeConteudo(pub.content))}
        </span>

        {/* Segunda linha: conta, motivo da falha, tentativas — tudo junto.

            O código do erro era um selo alinhado à direita da linha. Com o
            nome do arquivo terminando no meio da largura, sobrava um vazio de
            300px entre o que falhou e o porquê, e o selo lia-se como um
            elemento solto de outra coluna. Aqui ele fica encostado no que
            descreve. */}
        <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[var(--mf-t-nano)] text-[var(--mf-text-3)]">
          {!compacta && (
            <>
              <ContaAvatar conta={pub.account} size={13} />
              <span className="shrink-0">{nomeConta(pub.account)}</span>
            </>
          )}
          {problema && (
            <span className="min-w-0 truncate font-mono font-semibold text-[var(--mf-danger-500)]">
              {!compacta && '· '}
              {falhou
                ? (pub.errorCode || 'ERRO')
                : `comentário: ${pub.commentErrorCode || 'ERRO'}`}
            </span>
          )}
          {pub.attempts > 1 && (
            <span className="shrink-0 font-mono">· {pub.attempts}x</span>
          )}
        </span>
      </span>

      <ChevronRight
        size={13}
        className="shrink-0 text-[var(--mf-text-3)] opacity-0 transition-opacity group-hover:opacity-100"
      />
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

  /* Agrupa por dia ANTES de renderizar, em vez de comparar com a linha
     anterior durante o map.

     A versão antiga usava uma variável mutada dentro do `map` — funciona, mas
     só enquanto o array vier ordenado, e um dia com uma publicação fora de
     ordem imprimiria o cabeçalho duas vezes. Agrupado, o dia é uma estrutura,
     não um efeito colateral da iteração — e cada dia pode ganhar sua própria
     moldura, que é o que dá ritmo à lista. */
  const dias = useMemo(() => {
    const mapa = new Map();
    for (const p of ordenadas) {
      const dia = dataCurta(p.scheduledAt);
      if (!mapa.has(dia)) mapa.set(dia, []);
      mapa.get(dia).push(p);
    }
    return [...mapa.entries()];
  }, [ordenadas]);

  /* A saída antecipada vem DEPOIS dos hooks: `useMemo` acima de um `return`
     condicional muda a ordem dos hooks entre renders, e o React lança. */
  if (!ordenadas.length) return <Vazio>Nenhuma publicação nesta campanha.</Vazio>;

  return (
    <div className="flex flex-col gap-3">
      {dias.map(([dia, doDia]) => (
        <section
          key={dia}
          className="overflow-hidden rounded-[var(--mf-r-lg)] border border-[var(--card-border)] bg-[var(--card)]"
        >
          {/* O cabeçalho do dia é parte do cartão, não um rótulo solto flutuando
              entre linhas. `sticky` para a data continuar visível enquanto se
              rola por um dia com trinta publicações. */}
          <header className="sticky top-0 z-10 flex items-baseline justify-between gap-3 border-b border-[var(--border)] bg-[var(--card)] px-3 py-2">
            <span className="font-mono text-[var(--mf-t-micro)] font-bold tabular-nums text-[var(--mf-text-2)]">
              {dia}
            </span>
            <span className="text-[var(--mf-t-nano)] text-[var(--mf-text-3)]">
              {doDia.length} {doDia.length === 1 ? 'publicação' : 'publicações'}
            </span>
          </header>

          {/* Divisores entre linhas, e não uma borda em volta de cada uma:
              doze caixas empilhadas desenham vinte e quatro linhas horizontais
              onde onze bastam. */}
          <div className="divide-y divide-[var(--border)] p-1">
            {doDia.map(p => (
              <LinhaPublicacao key={p._id} pub={p} onAbrir={onAbrir} />
            ))}
          </div>
        </section>
      ))}
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

/* ── Eventos ────────────────────────────────────────────────────────────────
   A aba "Problemas" mostra o ESTADO de cada publicação; esta mostra o CAMINHO.
   São perguntas diferentes: uma responde "o que está errado agora", a outra
   "o que aconteceu para chegar aqui".

   A segunda é a que faltava. Quando uma campanha inteira falhava, o estado
   final dizia "falhou" — o resultado, escondendo se nenhuma chegou a tentar ou
   se três publicaram e a quarta pegou 407. */

const TOM_DO_EVENTO = (evento) => {
  if (/FAILED|ERROR|CANCEL/i.test(evento)) return 'var(--mf-danger-500)';
  if (/OK|PUBLISHED|COMPLETED/i.test(evento)) return 'var(--mf-success-500)';
  if (/SCHEDULED|STARTED|RETRY/i.test(evento)) return 'var(--mf-mod-jobs)';
  return 'var(--mf-text-3)';
};

const hora = (iso) => {
  try {
    return new Date(iso).toLocaleString('pt-BR', {
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
  } catch { return ''; }
};

export function EventosView({ dados }) {
  if (!dados) {
    return <div className="mf-skel" style={{ height: 180, borderRadius: 'var(--mf-r-md)' }} />;
  }

  if (!dados.itens?.length) {
    return (
      <div className="mf-empty">
        <div className="mf-empty__t">Nenhum evento registrado</div>
        <div className="mf-empty__d">
          Os eventos aparecem conforme a campanha executa. Campanhas que rodaram
          antes desta versão não têm histórico — ele começa a partir de agora.
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--mf-4)' }}>

      {/* O resumo por código vem primeiro porque é ele que aponta a causa:
          quinze eventos com PROXY_ERROR são UMA frase; quinze linhas para ler
          uma a uma, não. */}
      {dados.erros?.length > 0 && (
        <div style={{
          border: '1px solid color-mix(in oklch, var(--mf-danger-500) 26%, transparent)',
          background: 'var(--mf-danger-bg)', borderRadius: 'var(--mf-r-md)',
          padding: 'var(--mf-4) var(--mf-5)',
        }}>
          <div className="mf-mono" style={{
            fontSize: 'var(--mf-t-nano)', letterSpacing: '.1em', textTransform: 'uppercase',
            color: 'var(--mf-danger-500)', marginBottom: 'var(--mf-3)',
          }}>
            Erros por causa
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--mf-2)' }}>
            {dados.erros.map(e => (
              <div key={e.codigo} style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--mf-3)' }}>
                <span className="mf-mono" style={{ fontSize: 'var(--mf-t-xs)', color: 'var(--mf-text)' }}>
                  {e.codigo}
                </span>
                <span style={{ fontSize: 'var(--mf-t-xs)', color: 'var(--mf-text-3)' }}>
                  {e.ocorrencias}× · último {hora(e.ultimo)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {dados.itens.map(ev => (
          <div key={ev._id} style={{
            display: 'grid', gridTemplateColumns: '8px minmax(0,1fr) auto',
            gap: 'var(--mf-4)', alignItems: 'start',
            padding: 'var(--mf-3) 0',
            borderBottom: '1px solid var(--mf-border-subtle)',
          }}>
            <span style={{
              width: 6, height: 6, borderRadius: 'var(--mf-r-full)', marginTop: 7,
              background: TOM_DO_EVENTO(ev.evento),
            }} />
            <div style={{ minWidth: 0 }}>
              <span className="mf-mono" style={{
                fontSize: 'var(--mf-t-xs)', color: 'var(--mf-text)', fontWeight: 500,
              }}>
                {ev.evento}
              </span>
              {ev.errorCode && (
                <span className="mf-mono" style={{
                  marginLeft: 'var(--mf-3)', fontSize: 'var(--mf-t-nano)',
                  color: 'var(--mf-danger-500)',
                }}>
                  {ev.errorCode}
                </span>
              )}
              {ev.error && (
                <div style={{
                  fontSize: 'var(--mf-t-xs)', color: 'var(--mf-text-2)',
                  marginTop: 3, lineHeight: 1.5, overflowWrap: 'anywhere',
                }}>
                  {ev.error}
                </div>
              )}
              {(ev.attempt > 1 || ev.durationMs > 0) && (
                <div className="mf-mono" style={{
                  fontSize: 'var(--mf-t-nano)', color: 'var(--mf-text-3)', marginTop: 3,
                }}>
                  {ev.attempt > 1 ? `tentativa ${ev.attempt}` : ''}
                  {ev.attempt > 1 && ev.durationMs > 0 ? ' · ' : ''}
                  {ev.durationMs > 0 ? `${ev.durationMs} ms` : ''}
                </div>
              )}
            </div>
            <span className="mf-mono" style={{
              fontSize: 'var(--mf-t-nano)', color: 'var(--mf-text-3)',
              whiteSpace: 'nowrap', paddingTop: 2,
            }}>
              {hora(ev.criadoEm)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
