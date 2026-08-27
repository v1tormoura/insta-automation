import { useMemo } from 'react';
import { Eyebrow, ContaAvatar, nomeConta, nomeConteudo, STATUS_PUB, Vazio } from './shared';

/**
 * Matriz conta × conteúdo.
 *
 * Cada célula é o par REAL (accountId, contentId) — a publicação é procurada por
 * chave composta, nunca inferida por posição. Contas e conteúdos podem entrar em
 * ordens diferentes, e uma campanha pode não ter todos os pares (o limite diário
 * corta publicações); ler a grade por índice mostraria o status da célula errada.
 *
 * Ausência de par é um estado próprio ("não planejado"), distinto de pendente.
 */

const SIMBOLO = {
  published:  { s: '✓', cor: 'text-[var(--mf-success-500)] bg-[color-mix(in_oklch,_var(--mf-success-500)_10%,_transparent)]' },
  scheduled:  { s: '◷', cor: 'text-[var(--mf-mod,_var(--mf-accent-500))] bg-[color-mix(in_oklch,_var(--mf-mod-contas)_8%,_transparent)]' },
  pending:    { s: '◷', cor: 'text-[var(--mf-text-3)] bg-[var(--mf-border-subtle)]' },
  processing: { s: '⚙', cor: 'text-[var(--mf-info-500)] bg-[color-mix(in_oklch,_var(--mf-info-500)_12%,_transparent)]' },
  failed:     { s: '✕', cor: 'text-[var(--mf-danger-500)] bg-[color-mix(in_oklch,_var(--mf-danger-500)_10%,_transparent)]' },
  cancelled:  { s: '—', cor: 'text-[var(--mf-text-3)] bg-[var(--mf-border-subtle)]' },
};

const NAO_PLANEJADO = { s: '·', cor: 'text-[var(--mf-text-3)] opacity-40' };

export default function DistributionMatrix({ publicacoes = [], onAbrir }) {
  const { contas, conteudos, porPar } = useMemo(() => {
    // Map com chave composta: é o que garante que a célula corresponda ao par.
    const porPar = new Map();
    const contas = new Map();
    const conteudos = new Map();

    for (const p of publicacoes) {
      const a = p.account?._id ?? p.account;
      const c = p.content?._id ?? p.content;
      if (!a || !c) continue;

      porPar.set(`${a}__${c}`, p);
      if (!contas.has(String(a)))    contas.set(String(a), p.account);
      if (!conteudos.has(String(c))) conteudos.set(String(c), p.content);
    }

    return {
      contas:    [...contas.entries()].map(([id, conta]) => ({ id, conta })),
      conteudos: [...conteudos.entries()].map(([id, conteudo]) => ({ id, conteudo })),
      porPar,
    };
  }, [publicacoes]);

  if (!publicacoes.length) {
    return <Vazio>Esta campanha não tem publicações para exibir na matriz.</Vazio>;
  }

  return (
    <div className="rounded-[var(--mf-r-lg)] border border-[var(--card-border)] bg-[var(--card)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Eyebrow>Matriz de distribuição</Eyebrow>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[var(--mf-t-nano)] text-[var(--mf-text-3)]">
          <span><span className="text-[var(--mf-success-500)]">✓</span> publicado</span>
          <span><span className="text-[var(--mf-mod,_var(--mf-accent-500))]">◷</span> agendado</span>
          <span><span className="text-[var(--mf-info-500)]">⚙</span> processando</span>
          <span><span className="text-[var(--mf-danger-500)]">✕</span> falhou</span>
          <span className="opacity-60">· não planejado</span>
        </div>
      </div>

      {/* Rolagem horizontal contida neste bloco — o corpo da página nunca rola
          de lado, mesmo com 20 conteúdos. */}
      <div className="mt-3 -mx-1 overflow-x-auto px-1">
        <table className="w-max border-separate border-spacing-1">
          <thead>
            <tr>
              <th
                scope="col"
                className="sticky left-0 z-10 bg-[var(--card)] pr-2 text-left text-[var(--mf-t-nano)] font-bold uppercase tracking-[.06em] text-[var(--mf-text-3)]"
              >
                Conta
              </th>
              {conteudos.map(({ id, conteudo }) => (
                <th key={id} scope="col" className="px-1 pb-1">
                  <div
                    className="mx-auto max-w-[74px] truncate text-[var(--mf-t-nano)] font-semibold text-[var(--mf-text-3)]"
                    title={nomeConteudo(conteudo)}
                  >
                    {nomeConteudo(conteudo)}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {contas.map(({ id: idConta, conta }) => (
              <tr key={idConta}>
                {/* Coluna fixa: com muitos conteúdos, sem isso o usuário perde a
                    referência de qual conta está lendo ao rolar. */}
                <th
                  scope="row"
                  className="sticky left-0 z-10 bg-[var(--card)] pr-3 text-left font-normal"
                >
                  <span className="flex items-center gap-1.5">
                    <ContaAvatar conta={conta} size={18} />
                    <span className="max-w-[110px] truncate text-[var(--mf-t-micro)] font-semibold text-[var(--mf-text-2)]">
                      {nomeConta(conta)}
                    </span>
                  </span>
                </th>

                {conteudos.map(({ id: idConteudo, conteudo }) => {
                  const pub = porPar.get(`${idConta}__${idConteudo}`);
                  const marca = pub ? (SIMBOLO[pub.status] || SIMBOLO.pending) : NAO_PLANEJADO;
                  const rotulo = pub
                    ? `${nomeConta(conta)} · ${nomeConteudo(conteudo)} — ${STATUS_PUB[pub.status]?.rotulo || pub.status}`
                    : `${nomeConta(conta)} · ${nomeConteudo(conteudo)} — não planejado`;

                  return (
                    <td key={idConteudo} className="p-0">
                      <button
                        type="button"
                        disabled={!pub}
                        onClick={() => pub && onAbrir?.(pub)}
                        title={rotulo}
                        aria-label={rotulo}
                        className={`flex h-8 w-full min-w-[52px] items-center justify-center rounded-[var(--mf-r-sm)] text-[var(--mf-t-sm)] font-bold transition-transform ${marca.cor} ${
                          pub
                            ? 'cursor-pointer hover:scale-[1.12] focus-visible:outline-2 focus-visible:outline-[var(--mf-mod,_var(--mf-accent-500))]'
                            : 'cursor-default'
                        }`}
                      >
                        {marca.s}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
