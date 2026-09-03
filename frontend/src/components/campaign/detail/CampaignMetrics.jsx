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
 * ── Por que a decomposição é uma lista, e não uma grade
 *
 * Era uma grade de 4 colunas dentro de um cartão de 240px: ~55px por coluna,
 * com o rótulo truncado. Na tela lia-se "PUBLICADA…", "PROCESSA…",
 * "AGENDADO…", "AGUARDAN…" — quatro palavras cortadas em quatro cartões, que
 * é o que fazia o painel inteiro parecer sujo.
 *
 * O problema não era o espaçamento nem a cor: era a forma. Uma decomposição
 * de 3 ou 4 estados com nome é uma legenda, não uma tabela — e legenda se lê
 * em coluna. Assim o rótulo cabe inteiro em qualquer largura, os números
 * alinham à direita numa régua só, e o ponto colorido carrega o estado sem
 * gastar largura.
 */

function Cartao({ titulo, children, className }) {
  return (
    <div className={cn(
      'flex flex-col rounded-[var(--mf-r-lg)] border border-[var(--card-border)]',
      'bg-[var(--card)] p-4',
      className,
    )}>
      <Eyebrow>{titulo}</Eyebrow>
      <div className="mt-2.5 flex min-h-0 flex-1 flex-col">{children}</div>
    </div>
  );
}

/** O número que o olho pega primeiro. */
function Destaque({ valor, sufixo }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="font-mono text-[28px] font-extrabold leading-none tabular-nums text-[var(--mf-text)]">
        {valor}
      </span>
      {sufixo && (
        <span className="font-mono text-[var(--mf-t-micro)] tabular-nums text-[var(--mf-text-3)]">
          {sufixo}
        </span>
      )}
    </div>
  );
}

/**
 * Uma linha da decomposição: ponto, rótulo, número.
 *
 * O número vai à direita com `tabular-nums` para as linhas formarem uma
 * coluna — é o que permite comparar 12 com 3 sem ler, só olhando.
 *
 * Linha com valor zero fica apagada em vez de sumir: a lista de estados é a
 * mesma em toda campanha, e uma que muda de tamanho conforme os números
 * obriga a reler a cada atualização para saber o que está sendo mostrado.
 */
function Linha({ valor, rotulo, cor }) {
  const vazio = !valor;
  return (
    <div className="flex items-center gap-2 py-[3px]">
      <span
        className={cn('size-[7px] shrink-0 rounded-full', cor)}
        style={vazio ? { opacity: 0.28 } : undefined}
        aria-hidden
      />
      <span className={cn(
        'min-w-0 flex-1 truncate text-[var(--mf-t-micro)]',
        vazio ? 'text-[var(--mf-text-3)]' : 'text-[var(--mf-text-2)]',
      )}>
        {rotulo}
      </span>
      <span className={cn(
        'font-mono text-[var(--mf-t-micro)] font-bold tabular-nums',
        vazio ? 'text-[var(--mf-text-3)]' : 'text-[var(--mf-text)]',
      )}>
        {valor ?? 0}
      </span>
    </div>
  );
}

/** Rodapé discreto — o que existe mas não merece uma linha na legenda. */
function Nota({ children }) {
  return (
    <div className="mt-auto border-t border-[var(--border)] pt-2 text-[var(--mf-t-nano)] text-[var(--mf-text-3)]">
      {children}
    </div>
  );
}

export default function CampaignMetrics({ estatisticas, comentarios, contas, progresso }) {
  const e = estatisticas || {};
  const c = comentarios  || {};
  const pendentes = (e.pending || 0) + (e.scheduled || 0);

  return (
    <div
      className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1"
      /* Sem `auto-fit`: em lg estes cartões moram no trilho de 340px, e o
         auto-fit tentaria encaixar dois de 170px — largura em que o rótulo
         volta a truncar, que era o defeito original. Uma coluna a partir de
         lg, duas abaixo (onde o bloco ocupa a largura toda). */
      style={undefined}
    >
      <Cartao titulo="Publicações">
        <Destaque valor={e.total ?? 0} sufixo="no total" />
        <div className="mt-3">
          <Linha valor={e.published ?? 0}  rotulo="Publicadas"  cor="bg-[var(--mf-success-500)]" />
          <Linha valor={pendentes}         rotulo="Pendentes"   cor="bg-[var(--mf-primary-500)]" />
          <Linha valor={e.processing ?? 0} rotulo="Processando" cor="bg-[var(--mf-info-500)]" />
          <Linha valor={e.failed ?? 0}     rotulo="Falhas"      cor="bg-[var(--mf-danger-500)]" />
        </div>
        {e.cancelled > 0 && (
          <Nota>{e.cancelled} cancelada{e.cancelled === 1 ? '' : 's'}</Nota>
        )}
      </Cartao>

      <Cartao titulo="Progresso">
        <Destaque
          valor={`${progresso?.percentage ?? 0}%`}
          sufixo={`${progresso?.done ?? 0} de ${progresso?.total ?? 0}`}
        />
        <Progress value={progresso?.percentage ?? 0} className="mt-3" />
        <p className="mt-3 text-[var(--mf-t-nano)] leading-relaxed text-[var(--mf-text-3)]">
          Conta publicadas, falhas e canceladas — tudo que chegou a um estado
          final.
        </p>
      </Cartao>

      <Cartao titulo="Contas">
        <Destaque valor={contas?.total ?? 0} sufixo="na campanha" />
        <div className="mt-3">
          <Linha valor={contas?.concluidas ?? 0} rotulo="Concluídas" cor="bg-[var(--mf-success-500)]" />
          <Linha valor={contas?.pendentes ?? 0}  rotulo="Pendentes"  cor="bg-[var(--mf-primary-500)]" />
          <Linha valor={contas?.comErro ?? 0}    rotulo="Com erro"   cor="bg-[var(--mf-danger-500)]" />
        </div>
      </Cartao>

      <Cartao titulo="Comentários">
        {c.total ? (
          <>
            <Destaque valor={c.total} sufixo="programados" />
            <div className="mt-3">
              <Linha valor={c.posted ?? 0}    rotulo="Publicados" cor="bg-[var(--mf-success-500)]" />
              <Linha valor={c.scheduled ?? 0} rotulo="Agendados"  cor="bg-[var(--mf-primary-500)]" />
              {/* Configurados mas ainda sem agendamento: o post deles não saiu. */}
              <Linha valor={c.pending ?? 0}   rotulo="Aguardando" cor="bg-[var(--mf-text-3)]" />
              <Linha valor={c.failed ?? 0}    rotulo="Falhos"     cor="bg-[var(--mf-danger-500)]" />
            </div>
            {c.cancelled > 0 && (
              <Nota>{c.cancelled} cancelado{c.cancelled === 1 ? '' : 's'}</Nota>
            )}
          </>
        ) : (
          // Sem comentário configurado, "0 de 48" sugeriria 48 pendências.
          <p className="py-2 text-[var(--mf-t-micro)] leading-relaxed text-[var(--mf-text-3)]">
            Esta campanha não publica comentários.
          </p>
        )}
      </Cartao>
    </div>
  );
}
