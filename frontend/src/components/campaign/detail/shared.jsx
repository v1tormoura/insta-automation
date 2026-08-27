import { CheckCircle2, Clock, Loader2, XCircle, MinusCircle, Circle } from 'lucide-react';
import { Badge } from '../../ui/badge';
import { cn } from '../../../lib/utils';

/**
 * Vocabulário compartilhado do painel da campanha.
 *
 * Os mapas de status espelham os enums do backend (CampaignPublication.status e
 * commentStatus) e os códigos de erro que campaignExecutor produz. Ficam num
 * lugar só porque a mesma publicação aparece na timeline, na tabela, na matriz e
 * no drawer — com cópias, um estado novo apareceria traduzido em algumas telas e
 * cru nas outras.
 */

/* ── Status da publicação ──────────────────────────────────────────────────── */

export const STATUS_PUB = {
  pending:    { rotulo: 'Pendente',   cor: 'text-[var(--mf-text-3)]', badge: 'secondary',   Icone: Circle },
  scheduled:  { rotulo: 'Agendada',   cor: 'text-[var(--mf-mod,_var(--mf-accent-500))]',  badge: 'outline',     Icone: Clock },
  processing: { rotulo: 'Publicando', cor: 'text-[var(--mf-info-500)]',      badge: 'purple',      Icone: Loader2 },
  published:  { rotulo: 'Publicado',  cor: 'text-[var(--mf-success-500)]', badge: 'success',     Icone: CheckCircle2 },
  failed:     { rotulo: 'Falhou',     cor: 'text-[var(--mf-danger-500)]',   badge: 'destructive', Icone: XCircle },
  cancelled:  { rotulo: 'Cancelada',  cor: 'text-[var(--mf-text-3)]', badge: 'secondary',   Icone: MinusCircle },
};

export const STATUS_COMENTARIO = {
  none:      { rotulo: 'Sem comentário',       cor: 'text-[var(--mf-text-3)]', badge: 'secondary' },
  scheduled: { rotulo: 'Comentário agendado',  cor: 'text-[var(--mf-mod,_var(--mf-accent-500))]',  badge: 'outline' },
  posted:    { rotulo: 'Comentado',            cor: 'text-[var(--mf-success-500)]', badge: 'success' },
  failed:    { rotulo: 'Comentário falhou',    cor: 'text-[var(--mf-danger-500)]',   badge: 'destructive' },
  cancelled: { rotulo: 'Comentário cancelado', cor: 'text-[var(--mf-text-3)]', badge: 'secondary' },
};

export const STATUS_CAMPANHA = {
  draft:     { rotulo: 'Rascunho',    badge: 'secondary' },
  planning:  { rotulo: 'Planejando',  badge: 'purple' },
  scheduled: { rotulo: 'Agendada',    badge: 'outline' },
  running:   { rotulo: 'Em execução', badge: 'success' },
  paused:    { rotulo: 'Pausada',     badge: 'warning' },
  completed: { rotulo: 'Concluída',   badge: 'success' },
  partial:   { rotulo: 'Parcial',     badge: 'warning' },
  failed:    { rotulo: 'Falhou',      badge: 'destructive' },
  cancelled: { rotulo: 'Cancelada',   badge: 'secondary' },
};

/* ── Erros ─────────────────────────────────────────────────────────────────── */

/** Códigos de campaignExecutor.classificarErro (publicação). */
export const ERROS_PUB = {
  SESSION_EXPIRED:      'Sessão expirada',
  ACCOUNT_CHALLENGE:    'Conta pediu verificação',
  ACCOUNT_RESTRICTED:   'Conta restrita',
  ACCOUNT_UNAVAILABLE:  'Conta indisponível',
  ACCOUNT_BUSY:         'Conta ocupada',
  RATE_LIMITED:         'Limite de requisições',
  DAILY_LIMIT:          'Limite diário da conta',
  NETWORK_ERROR:        'Erro de rede ou proxy',
  CONTENT_NOT_FOUND:    'Conteúdo não existe mais',
  PROVIDER_UNAVAILABLE: 'Serviço de publicação fora do ar',
  UNSUPPORTED_TYPE:     'Tipo não suportado',
  WORKER_RESTARTED:     'Interrompido por reinício',
  PUBLISH_ERROR:        'Erro na publicação',
};

/** Códigos de campaignExecutor.classificarErroComentario. */
export const ERROS_COMENTARIO = {
  COMMENT_NOT_SUPPORTED:   'Conta sem via de comentário',
  COMMENT_MEDIA_NOT_FOUND: 'Mídia não encontrada',
  COMMENT_FAILED:          'Falha ao comentar',
  SESSION_EXPIRED:         'Sessão expirada',
  RATE_LIMITED:            'Limite de requisições',
  NETWORK_ERROR:           'Erro de rede ou proxy',
  TIMEOUT:                 'Tempo esgotado',
  ACCOUNT_CHALLENGE:       'Conta pediu verificação',
  ACCOUNT_UNAVAILABLE:     'Conta indisponível',
  PROVIDER_UNAVAILABLE:    'Serviço fora do ar',
};

export const ESTRATEGIAS = {
  interleaved_random: 'Intercalado aleatório',
  sequential:         'Sequencial',
  round_robin:        'Round robin',
  account_first:      'Conta por conta',
  manual:             'Manual',
};

/* ── Formatação ────────────────────────────────────────────────────────────── */

const ehHoje = d => {
  const a = new Date(), b = new Date(d);
  return a.toDateString() === b.toDateString();
};

/** "Hoje às 19:42" / "18/08 às 19:42". Data absoluta — nada de "há 2 horas". */
export function quando(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return ehHoje(d) ? `Hoje às ${hora}` : `${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} às ${hora}`;
}

export function horaCurta(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

export function dataCurta(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/** "em 8 minutos" / "em 2h 15min" / "agora". */
export function faltam(iso, agora = Date.now()) {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - agora;
  if (Number.isNaN(ms)) return null;
  if (ms <= 0) return 'agora';

  const min = Math.round(ms / 60_000);
  if (min < 1)  return 'em menos de 1 minuto';
  if (min < 60) return `em ${min} ${min === 1 ? 'minuto' : 'minutos'}`;

  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h < 24) return m ? `em ${h}h ${m}min` : `em ${h}h`;

  const dias = Math.floor(h / 24);
  return `em ${dias} ${dias === 1 ? 'dia' : 'dias'}`;
}

export const nomeConteudo = c => c?.originalName || c?.filename || '—';
export const nomeConta    = a => (a?.username ? `@${a.username}` : '—');

/* ── Peças visuais ─────────────────────────────────────────────────────────── */

export function StatusBadge({ status, mapa = STATUS_PUB }) {
  const s = mapa[status] || mapa.pending || { rotulo: status, badge: 'secondary' };
  const Icone = s.Icone;
  return (
    <Badge variant={s.badge}>
      {Icone && <Icone size={10} className={status === 'processing' ? 'animate-spin' : undefined} />}
      {s.rotulo}
    </Badge>
  );
}

/**
 * Avatar da conta com inicial como reserva.
 *
 * A imagem cai com frequência (CDN do Instagram expira URL), então o fundo com
 * inicial fica sempre por baixo em vez de deixar um quadrado vazio.
 */
export function ContaAvatar({ conta, size = 26 }) {
  const inicial = (conta?.username || '?').charAt(0).toUpperCase();
  return (
    <span
      className="relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-[var(--border)] bg-[color-mix(in_oklch,_var(--mf-mod-contas)_10%,_transparent)] font-bold text-[var(--mf-mod,_var(--mf-accent-500))]"
      style={{ width: size, height: size, fontSize: size * 0.42 }}
      aria-hidden="true"
    >
      {inicial}
      {conta?.avatar && (
        <img
          src={conta.avatar}
          alt=""
          loading="lazy"
          className="absolute inset-0 h-full w-full object-cover"
          onError={e => { e.currentTarget.style.display = 'none'; }}
        />
      )}
    </span>
  );
}

/**
 * Miniatura do conteúdo.
 *
 * Vídeo não gera preview aqui: renderizar <video> em dezenas de linhas de lista
 * pesaria a página inteira. Mostra a extensão, que é o que identifica o arquivo.
 */
export function ConteudoThumb({ conteudo, size = 30 }) {
  const ehImagem = conteudo?.type === 'image';
  const ext = String(conteudo?.filename || '').split('.').pop()?.slice(0, 4).toUpperCase() || '?';

  return (
    <span
      className="inline-flex shrink-0 items-center justify-center overflow-hidden rounded-[var(--mf-r-sm)] border border-[var(--border)] bg-[var(--mf-border-subtle)] font-mono font-bold text-[var(--mf-text-3)]"
      style={{ width: size, height: size, fontSize: size * 0.28 }}
      aria-hidden="true"
    >
      {ehImagem && conteudo?.url ? (
        <img
          src={conteudo.url}
          alt=""
          loading="lazy"
          className="h-full w-full object-cover"
          onError={e => { e.currentTarget.replaceWith(document.createTextNode(ext)); }}
        />
      ) : ext}
    </span>
  );
}

/** Rótulo de seção — o eyebrow usado no topo dos cartões. */
export function Eyebrow({ children, className }) {
  return (
    <div className={cn('text-[var(--mf-t-nano)] font-bold uppercase tracking-[.08em] text-[var(--mf-text-3)]', className)}>
      {children}
    </div>
  );
}

/** Estado vazio: uma frase que diz o que aconteceu, sem ilustração. */
export function Vazio({ children, className }) {
  return (
    <div className={cn('py-8 text-center text-[var(--mf-t-micro)] text-[var(--mf-text-3)]', className)}>
      {children}
    </div>
  );
}

/** Texto do erro pronto para leitura, com o código entre parênteses. */
export function descreverErro(codigo, mapa = ERROS_PUB) {
  if (!codigo) return '';
  const amigavel = mapa[codigo];
  return amigavel ? `${amigavel} (${codigo})` : codigo;
}
