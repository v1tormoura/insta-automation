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
  published:  { s: '✓', cor: 'text-[var(--green)] bg-[rgba(16,185,129,.1)]' },
  scheduled:  { s: '◷', cor: 'text-[var(--cyan)] bg-[rgba(0,212,255,.08)]' },
  pending:    { s: '◷', cor: 'text-[var(--text3)] bg-[rgba(255,255,255,.03)]' },
  processing: { s: '⚙', cor: 'text-[#60a5fa] bg-[rgba(96,165,250,.12)]' },
  failed:     { s: '✕', cor: 'text-[var(--red)] bg-[rgba(244,63,94,.1)]' },
  cancelled:  { s: '—', cor: 'text-[var(--text3)] bg-[rgba(255,255,255,.02)]' },
};

const NAO_PLANEJADO = { s: '·', cor: 'text-[var(--text3)] opacity-40' };

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
    <div className="rounded-[13px] border border-[var(--card-border)] bg-[var(--card)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Eyebrow>Matriz de distribuição</Eyebrow>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[9.5px] text-[var(--text3)]">
          <span><span className="text-[var(--green)]">✓</span> publicado</span>
          <span><span className="text-[var(--cyan)]">◷</span> agendado</span>
          <span><span className="text-[#60a5fa]">⚙</span> processando</span>
          <span><span className="text-[var(--red)]">✕</span> falhou</span>
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
                className="sticky left-0 z-10 bg-[var(--card)] pr-2 text-left text-[9.5px] font-bold uppercase tracking-[.06em] text-[var(--text3)]"
              >
                Conta
              </th>
              {conteudos.map(({ id, conteudo }) => (
                <th key={id} scope="col" className="px-1 pb-1">
                  <div
                    className="mx-auto max-w-[74px] truncate text-[10px] font-semibold text-[var(--text3)]"
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
                    <span className="max-w-[110px] truncate text-[11px] font-semibold text-[var(--text2)]">
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
                        className={`flex h-8 w-full min-w-[52px] items-center justify-center rounded-[6px] text-[13px] font-bold transition-transform ${marca.cor} ${
                          pub
                            ? 'cursor-pointer hover:scale-[1.12] focus-visible:outline-2 focus-visible:outline-[var(--cyan)]'
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
