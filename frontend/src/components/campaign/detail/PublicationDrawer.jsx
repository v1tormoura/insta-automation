import { RotateCcw, MessageSquare, AlertTriangle } from 'lucide-react';
import {
  Sheet, SheetContent, SheetHeader, SheetBody, SheetFooter, SheetTitle, SheetDescription,
} from '../../ui/sheet';
import { Button } from '../../ui/button';
import {
  ContaAvatar, ConteudoThumb, Eyebrow, StatusBadge, STATUS_COMENTARIO,
  ERROS_PUB, ERROS_COMENTARIO, descreverErro,
  quando, dataCurta, horaCurta, nomeConta, nomeConteudo,
} from './shared';

/**
 * Detalhe de uma publicação.
 *
 * Mostra os textos MATERIALIZADOS (`resolvedCaption`/`resolvedComment`) — o que
 * foi ou será publicado. O template bruto aparece separado e só quando difere,
 * porque é informação de configuração, não do resultado.
 *
 * Erro de publicação e erro de comentário são apresentados em blocos distintos:
 * um comentário que falhou não significa que o post falhou, e misturá-los levaria
 * a reprocessar a publicação de um post que já está no ar.
 */

/**
 * Etapas percorridas por esta publicação.
 *
 * Derivadas dos campos persistidos, sem inventar horário: uma etapa sem
 * timestamp aparece como alcançada mas sem hora, em vez de exibir um palpite.
 */
export function montarEtapas(pub) {
  if (!pub) return [];

  const etapas = [
    { chave: 'criada',    rotulo: 'Criada',    em: pub.createdAt || null, atingida: true },
    {
      chave: 'agendada', rotulo: 'Agendada', em: pub.scheduledAt || null,
      atingida: pub.status !== 'pending',
    },
    {
      chave: 'processando', rotulo: 'Processando', em: null,
      atingida: ['processing', 'published', 'failed'].includes(pub.status),
    },
  ];

  if (pub.status === 'failed') {
    etapas.push({ chave: 'falhou', rotulo: 'Falhou', em: null, atingida: true, erro: true });
  } else if (pub.status === 'cancelled') {
    etapas.push({ chave: 'cancelada', rotulo: 'Cancelada', em: null, atingida: true });
  } else {
    etapas.push({
      chave: 'publicada', rotulo: 'Publicada', em: pub.publishedAt || null,
      atingida: pub.status === 'published',
    });
  }

  // As etapas do comentário só entram se houver comentário nesta publicação.
  if (pub.commentStatus && pub.commentStatus !== 'none') {
    etapas.push({
      chave: 'comentario_agendado', rotulo: 'Comentário agendado', em: null,
      atingida: ['scheduled', 'posted', 'failed', 'cancelled'].includes(pub.commentStatus),
    });
    if (pub.commentStatus === 'failed') {
      etapas.push({ chave: 'comentario_falhou', rotulo: 'Comentário falhou', em: null, atingida: true, erro: true });
    } else {
      etapas.push({
        chave: 'comentario_publicado', rotulo: 'Comentário publicado',
        em: pub.commentPostedAt || null, atingida: pub.commentStatus === 'posted',
      });
    }
  }

  return etapas;
}

function Secao({ titulo, children, className = '' }) {
  return (
    <section className={`border-t border-[var(--border)] pt-3.5 ${className}`}>
      <Eyebrow>{titulo}</Eyebrow>
      <div className="mt-2">{children}</div>
    </section>
  );
}

function BlocoErro({ titulo, codigo, mensagem, tentativa, mapa }) {
  return (
    <div className="rounded-[9px] border border-[color-mix(in oklch, var(--mf-danger-500) 26%, transparent)] bg-[color-mix(in oklch, var(--mf-danger-500) 6%, transparent)] p-3">
      <div className="flex items-center gap-2">
        <AlertTriangle size={13} className="shrink-0 text-[var(--mf-danger-500)]" />
        <span className="text-[11.5px] font-bold text-[var(--mf-danger-500)]">{titulo}</span>
      </div>
      <div className="mt-1.5 font-mono text-[11px] font-bold text-[var(--mf-danger-500)]">
        {descreverErro(codigo, mapa)}
      </div>
      {mensagem && (
        <p className="mt-1.5 whitespace-pre-wrap break-words text-[11px] leading-relaxed text-[var(--mf-text-3)]">
          {mensagem}
        </p>
      )}
      {tentativa > 0 && (
        <div className="mt-1.5 font-mono text-[10px] tabular-nums text-[var(--mf-text-3)]">
          tentativa {tentativa}
        </div>
      )}
    </div>
  );
}

export default function PublicationDrawer({ pub, aberto, onFechar, onReprocessar, onReprocessarComentario, agindo }) {
  if (!pub) return null;

  const etapas = montarEtapas(pub);
  const temComentario = pub.commentStatus && pub.commentStatus !== 'none';
  const comentarioFalhou = pub.commentStatus === 'failed';
  const podeReprocessar = ['failed', 'cancelled'].includes(pub.status);

  return (
    <Sheet open={aberto} onOpenChange={v => !v && onFechar()}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>
            <span className="font-mono text-[var(--mf-text-3)]">#{pub.order}</span>{' '}
            {nomeConta(pub.account)}
          </SheetTitle>
          <SheetDescription>{nomeConteudo(pub.content)}</SheetDescription>
        </SheetHeader>

        <SheetBody className="flex flex-col gap-3.5">
          {/* Conta e conteúdo */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <ContaAvatar conta={pub.account} size={32} />
              <div className="min-w-0">
                <div className="truncate text-[12px] font-bold text-[var(--mf-text)]">
                  {nomeConta(pub.account)}
                </div>
                {pub.account?.name && (
                  <div className="truncate text-[10.5px] text-[var(--mf-text-3)]">{pub.account.name}</div>
                )}
              </div>
            </div>
            <div className="flex min-w-0 items-center gap-2">
              <ConteudoThumb conteudo={pub.content} size={32} />
              <div className="min-w-0">
                <div className="truncate text-[12px] font-semibold text-[var(--mf-text-2)]">
                  {nomeConteudo(pub.content)}
                </div>
                <div className="truncate font-mono text-[10px] text-[var(--mf-text-3)]">
                  {pub.content?.filename || ''}
                </div>
              </div>
            </div>
          </div>

          <Secao titulo="Agendamento">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
              <div>
                <div className="font-mono text-[12px] font-bold tabular-nums text-[var(--mf-text-2)]">
                  {dataCurta(pub.scheduledAt)} · {horaCurta(pub.scheduledAt)}
                </div>
                {pub.publishedAt && (
                  <div className="mt-0.5 text-[10.5px] text-[var(--mf-text-3)]">
                    Publicada {quando(pub.publishedAt)}
                  </div>
                )}
              </div>
              <StatusBadge status={pub.status} />
              {pub.attempts > 0 && (
                <span className="font-mono text-[10.5px] tabular-nums text-[var(--mf-text-3)]">
                  {pub.attempts} tentativa{pub.attempts === 1 ? '' : 's'}
                </span>
              )}
            </div>
          </Secao>

          <Secao titulo="Legenda final">
            {pub.resolvedCaption ? (
              <p className="whitespace-pre-wrap break-words rounded-[8px] border border-[var(--border)] bg-[var(--mf-border-subtle)] p-3 text-[11.5px] leading-relaxed text-[var(--mf-text-2)]">
                {pub.resolvedCaption}
              </p>
            ) : (
              <p className="text-[11.5px] italic text-[var(--mf-text-3)]">Sem legenda.</p>
            )}
            {/* O template só aparece quando difere — se for igual, repetir o
                mesmo texto duas vezes só ocupa espaço. */}
            {pub.captionTemplate && pub.captionTemplate !== pub.resolvedCaption && (
              <details className="mt-2">
                <summary className="cursor-pointer text-[10.5px] text-[var(--mf-text-3)] hover:text-[var(--mf-text-2)]">
                  Ver template com as marcações
                </summary>
                <p className="mt-1.5 whitespace-pre-wrap break-words font-mono text-[10.5px] leading-relaxed text-[var(--mf-text-3)]">
                  {pub.captionTemplate}
                </p>
              </details>
            )}
          </Secao>

          {temComentario && (
            <Secao titulo="Comentário">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={pub.commentStatus} mapa={STATUS_COMENTARIO} />
                {pub.commentPostedAt && (
                  <span className="font-mono text-[10.5px] tabular-nums text-[var(--mf-text-3)]">
                    {quando(pub.commentPostedAt)}
                  </span>
                )}
                {pub.commentAttempts > 0 && (
                  <span className="font-mono text-[10.5px] tabular-nums text-[var(--mf-text-3)]">
                    {pub.commentAttempts} tentativa{pub.commentAttempts === 1 ? '' : 's'}
                  </span>
                )}
                {pub.hasMediaLink && (
                  <span className="text-[10px] text-[var(--mf-text-3)]" title="O comentário vai para a mídia exata desta publicação">
                    vinculado à publicação
                  </span>
                )}
              </div>
              {pub.resolvedComment && (
                <p className="mt-2 whitespace-pre-wrap break-words rounded-[8px] border border-[var(--border)] bg-[var(--mf-border-subtle)] p-3 text-[11.5px] leading-relaxed text-[var(--mf-text-2)]">
                  {pub.resolvedComment}
                </p>
              )}
              {comentarioFalhou && (
                <div className="mt-2">
                  <BlocoErro
                    titulo="Erro do comentário — a publicação saiu normalmente"
                    codigo={pub.commentErrorCode}
                    mensagem={pub.commentError}
                    tentativa={pub.commentAttempts}
                    mapa={ERROS_COMENTARIO}
                  />
                </div>
              )}
            </Secao>
          )}

          {pub.status === 'failed' && (
            <Secao titulo="Erro da publicação">
              <BlocoErro
                titulo="A publicação não saiu"
                codigo={pub.errorCode}
                mensagem={pub.error}
                tentativa={pub.attempts}
                mapa={ERROS_PUB}
              />
            </Secao>
          )}

          <Secao titulo="Execução">
            <ol className="flex flex-col">
              {etapas.map((et, i) => (
                <li key={et.chave} className="flex gap-2.5">
                  {/* Trilho: ponto + linha, desenhados com div para não depender
                      de pseudo-elemento em lista. */}
                  <div className="flex flex-col items-center">
                    <span
                      className={`mt-1 h-2 w-2 shrink-0 rounded-full ${
                        et.erro    ? 'bg-[var(--mf-danger-500)]'
                        : et.atingida ? 'bg-[var(--mf-success-500)]'
                        : 'bg-[var(--mf-border-strong)]'
                      }`}
                    />
                    {i < etapas.length - 1 && (
                      <span className={`w-px flex-1 ${et.atingida ? 'bg-[color-mix(in oklch, var(--mf-success-500) 28%, transparent)]' : 'bg-[var(--mf-border)]'}`} />
                    )}
                  </div>
                  <div className={`pb-3 ${i === etapas.length - 1 ? 'pb-0' : ''}`}>
                    <div
                      className={`text-[11.5px] font-semibold ${
                        et.erro    ? 'text-[var(--mf-danger-500)]'
                        : et.atingida ? 'text-[var(--mf-text-2)]'
                        : 'text-[var(--mf-text-3)]'
                      }`}
                    >
                      {et.rotulo}
                    </div>
                    {et.em && (
                      <div className="font-mono text-[10px] tabular-nums text-[var(--mf-text-3)]">
                        {dataCurta(et.em)} · {horaCurta(et.em)}
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </Secao>
        </SheetBody>

        {(podeReprocessar || comentarioFalhou) && (
          <SheetFooter className="flex flex-wrap gap-2">
            {podeReprocessar && (
              <Button size="sm" disabled={agindo} onClick={() => onReprocessar(pub._id)}>
                <RotateCcw size={13} />
                Reprocessar publicação
              </Button>
            )}
            {comentarioFalhou && pub.hasMediaLink && (
              <Button size="sm" variant="outline" disabled={agindo} onClick={() => onReprocessarComentario(pub._id)}>
                <MessageSquare size={13} />
                Reprocessar comentário
              </Button>
            )}
          </SheetFooter>
        )}
      </SheetContent>
    </Sheet>
  );
}
