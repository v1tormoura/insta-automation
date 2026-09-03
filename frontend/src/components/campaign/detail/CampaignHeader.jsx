import {
  Play, Pause, RotateCcw, Ban, Copy, Pencil, Users, Film,
  Layers, Shuffle, Timer, CalendarClock, Hash, Check,
} from 'lucide-react';
import { Button } from '../../ui/button';
import { ESTRATEGIAS, dataCurta, Eyebrow } from './shared';

/**
 * Configuração e ações da campanha.
 *
 * ── Por que o título saiu daqui
 *
 * O nome da campanha aparecia duas vezes na mesma tela, a 60px de distância:
 * uma no título da página, outra num `<h1>` deste cartão, com o botão de
 * voltar ao lado. Duas identidades para uma coisa só é o que fazia a tela
 * parecer montada em pedaços — e o botão de voltar duplicava a navegação que a
 * barra lateral já faz.
 *
 * Agora a identidade (nome, estado, ações) vive no topo da página, uma vez, e
 * este cartão responde uma pergunta só: como esta campanha está configurada.
 *
 * ── As ações são derivadas do estado
 *
 * Não listadas e desabilitadas: um botão "Iniciar" acinzentado numa campanha
 * concluída ainda sugere que existe algo a iniciar. A regra vive em `acoesPara`,
 * alinhada com a máquina de estados do backend (campaignState.js) — o servidor
 * continua sendo a autoridade, isto só evita oferecer o que ele vai recusar.
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

const BOTOES = {
  start:       { rotulo: 'Iniciar',  Icone: Play,      variant: 'default' },
  pause:       { rotulo: 'Pausar',   Icone: Pause,     variant: 'outline' },
  resume:      { rotulo: 'Retomar',  Icone: Play,      variant: 'default' },
  retryFailed: { rotulo: 'Reexecutar falhas', Icone: RotateCcw, variant: 'outline' },
  duplicate:   { rotulo: 'Duplicar', Icone: Copy,      variant: 'outline' },
  edit:        { rotulo: 'Editar',   Icone: Pencil,    variant: 'ghost' },
  cancel:      { rotulo: 'Cancelar', Icone: Ban,       variant: 'ghost' },
};

/**
 * As ações, para o topo da página.
 *
 * Exportado à parte porque o slot de ações do `PageShell` fica fora deste
 * componente — e passar o cartão inteiro para lá só para aproveitar os botões
 * levaria a configuração junto.
 */
export function CampaignActions({ status, falhas = 0, agindo = false, onAcao }) {
  return (
    <div className="flex flex-wrap gap-2">
      {acoesPara(status).map(acao => {
        if (acao === 'retryFailed' && !falhas) return null;
        const b = BOTOES[acao];
        const rotulo = acao === 'retryFailed'
          ? `Reexecutar ${falhas} falha${falhas === 1 ? '' : 's'}`
          : b.rotulo;
        return (
          <Button
            key={acao} variant={b.variant} size="sm" disabled={agindo}
            onClick={() => onAcao(acao)}
            className={acao === 'cancel'
              ? 'text-[var(--mf-danger-500)] hover:text-[var(--mf-danger-500)]'
              : undefined}
          >
            <b.Icone size={13} />
            {rotulo}
          </Button>
        );
      })}
    </div>
  );
}

/**
 * Um item da configuração.
 *
 * Rótulo em cima, valor embaixo — e não lado a lado como antes. Na horizontal,
 * seis pares `rótulo: valor` numa faixa viram um parágrafo de palavras soltas
 * onde nada ancora o olho; empilhado, a coluna de rótulos forma uma régua e o
 * valor pode crescer sem espremer o vizinho.
 */
function Item({ Icone, rotulo, valor, className }) {
  return (
    <div className={className}>
      <div className="flex items-center gap-1.5">
        <Icone size={11} className="shrink-0 text-[var(--mf-text-3)]" />
        <Eyebrow>{rotulo}</Eyebrow>
      </div>
      {/* Quebra em até duas linhas em vez de truncar. "Intercalado aleatório"
          numa coluna de 132px vira "Intercalado aleat…", e o valor cortado
          não diz qual estratégia é — que é a única coisa que ele existe para
          dizer. Duas linhas custam 14px; a reticência custa a informação. */}
      <div className="mt-1 line-clamp-2 text-[var(--mf-t-micro)] font-semibold leading-snug text-[var(--mf-text)]"
        title={String(valor)}>
        {valor}
      </div>
    </div>
  );
}

/**
 * Um agrupamento de campos com um título discreto.
 *
 * `gap-px` sobre um fundo de borda no pai desenha os divisores sem uma linha
 * extra por bloco — e sem o último divisor sobrando na ponta, que é o defeito
 * clássico de `border-right` em grade que reflui.
 */
function Bloco({ titulo, children }) {
  return (
    <div className="bg-[var(--card)] p-4 sm:p-5">
      <div className="text-[var(--mf-t-nano)] font-bold uppercase tracking-[.1em] text-[var(--mf-text-3)] opacity-70">
        {titulo}
      </div>
      <div className="mt-3 flex flex-col gap-3">{children}</div>
    </div>
  );
}

export default function CampaignHeader({ campanha, schedule, estatisticas }) {
  const s = schedule || campanha.schedule || {};
  const intervalo = s.useFixedInterval
    ? `${s.fixedIntervalMinutes ?? s.intervalMinMinutes} min · fixo`
    : `${s.intervalMinMinutes}–${s.intervalMaxMinutes} min`;
  const janela = s.windowStart && s.windowEnd
    ? `${s.windowStart} às ${s.windowEnd}`
    : 'Sem restrição';

  return (
    <section className="rounded-[var(--mf-r-lg)] border border-[var(--card-border)] bg-[var(--card)]">
      {campanha.description && (
        <p className="border-b border-[var(--border)] px-4 py-3 text-[var(--mf-t-micro)] leading-relaxed text-[var(--mf-text-2)] sm:px-5">
          {campanha.description}
        </p>
      )}

      {/* ── Três perguntas, três blocos ──────────────────────────────────

          Eram nove campos numa grade plana de auto-fit. Todos do mesmo
          tamanho, na mesma linha, sem nada dizendo que "Contas" e "Intervalo"
          respondem coisas diferentes — e com "Concluída" e "Semente" caindo
          sozinhas em linhas próprias, deixando buracos. Lia-se como uma
          parede de texto pequeno.

          Agrupados, cada bloco responde uma pergunta: o QUE a campanha
          alcança, COMO ela publica, QUANDO ela aconteceu. O divisor entre
          eles é o que transforma nove fatos soltos em três respostas. */}
      {/* Três colunas até lg, uma a partir dali.

          Parece invertido e não é: em lg este cartão passa a morar no trilho
          de 340px, onde três colunas dariam 110px cada e "Intercalado
          aleatório" voltaria a quebrar em quatro linhas. Abaixo de lg ele
          ocupa a largura toda e as três cabem folgadas. O breakpoint aqui
          descreve ONDE o componente está, não o tamanho da tela. */}
      <div className="grid gap-px bg-[var(--border)] sm:grid-cols-3 lg:grid-cols-1">
        <Bloco titulo="Escopo">
          <Item Icone={Users}  rotulo="Contas"     valor={(campanha.accountIds || []).length} />
          <Item Icone={Film}   rotulo="Conteúdos"  valor={(campanha.contentIds || []).length} />
          <Item Icone={Layers} rotulo="Publicações"
                valor={estatisticas?.total ?? campanha.totalPublications ?? 0} />
        </Bloco>

        <Bloco titulo="Ritmo">
          <Item Icone={Shuffle} rotulo="Estratégia"
                valor={ESTRATEGIAS[campanha.strategy?.mode] || campanha.strategy?.mode || '—'} />
          <Item Icone={Timer}   rotulo="Intervalo" valor={intervalo} />
          <Item Icone={CalendarClock} rotulo="Janela" valor={janela} />
        </Bloco>

        <Bloco titulo="Linha do tempo">
          <Item Icone={CalendarClock} rotulo="Criada" valor={dataCurta(campanha.createdAt)} />
          <Item Icone={Play} rotulo="Iniciada"
                valor={campanha.startedAt ? dataCurta(campanha.startedAt) : '—'} />
          <Item Icone={Check} rotulo="Concluída"
                valor={campanha.completedAt ? dataCurta(campanha.completedAt) : '—'} />
        </Bloco>
      </div>

      {campanha.strategy?.seed && (
        /* A semente é rodapé, não campo: ela não descreve a campanha, ela
           REPRODUZ a distribuição. Espremida numa coluna vira reticências —
           que é o mesmo que não mostrar, com o custo de ocupar espaço. */
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 border-t border-[var(--border)] px-4 py-2.5 sm:px-5">
          <span className="flex items-center gap-1.5">
            <Hash size={11} className="shrink-0 text-[var(--mf-text-3)]" />
            <Eyebrow>Semente</Eyebrow>
          </span>
          <span className="min-w-0 break-all font-mono text-[var(--mf-t-nano)] text-[var(--mf-text-2)]">
            {campanha.strategy.seed}
          </span>
        </div>
      )}
    </section>
  );
}
