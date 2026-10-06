import { useCallback, useEffect, useMemo, useState } from 'react';
import { Tag, Check } from 'lucide-react';
import api from '../services/api';
import TituloDeCartao from './TituloDeCartao';

/**
 * Comparativo de conteúdo — o que funciona, com número.
 *
 * Cada envio ganha uma etiqueta ("Original", "Repost", um tema...) e os reels
 * dele entram no grupo da etiqueta. Por grupo: alcance MEDIANO (um viral não
 * distorce), retenção em % (tempo médio assistido ÷ duração), compartilhamentos
 * e salvos por mil views — o que o algoritmo usa para seguir distribuindo.
 *
 * Forma: tabela (poucos grupos × várias métricas), com uma barra de cor única
 * para o alcance (magnitude, não identidade). O melhor de cada coluna vai em
 * negrito — sem cor de status, que fica reservada.
 */

const DIAS = { '7d': 7, '30d': 30, '90d': 90 };
const SUGESTOES = ['Original', 'Repost', 'Licenciado', 'Teste'];
const fmt = n => n == null ? '—' : n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}K` : String(n);
const MINIMO = 3; // reels por grupo para a conclusão valer

const COLUNAS = [
  ['reachMediano', 'Alcance mediano', fmt],
  ['viewsMedio', 'Views/reel', fmt],
  ['retencao', 'Retenção', v => (v == null ? '—' : `${v}%`)],
  ['assistidoS', 'Assistido', v => (v == null ? '—' : `${v}s`)],
  ['sharesPor1k', 'Compart./1k', v => (v == null ? '—' : v)],
  ['savesPor1k', 'Salvos/1k', v => (v == null ? '—' : v)],
  /* Do Webhook (venda atribuída ao último Reel da conta antes do lead). */
  ['vendas', 'Vendas', v => (v == null ? '—' : v)],
  ['receita', 'Receita', v => (v == null ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }))],
];

export default function ComparativoDeConteudo({ period = '30d' }) {
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(null);

  const carregar = useCallback(() => {
    const dias = DIAS[period] || 30;
    return Promise.all([
      api.get(`/analytics/alcance-por-envio?dias=${dias}`),
      api.get('/funil/por-conteudo', { params: { dias } }).catch(() => ({ data: null })),
    ]).then(([a, v]) => {
      /* Vendas e receita por etiqueta entram na mesma linha do grupo. */
      const vendas = new Map((v.data?.porEtiqueta || []).map(e => [e.chave, e]));
      const temVendas = !!v.data?.porEtiqueta?.length;
      const etiquetas = (a.data?.etiquetas || []).map(g => ({
        ...g, vendas: temVendas ? (vendas.get(g.rotulo)?.vendas || 0) : null, receita: temVendas ? (vendas.get(g.rotulo)?.receita || 0) : null,
      }));
      setDados({ ...a.data, etiquetas }); setErro('');
    }).catch(e => setErro(e?.response?.data?.error || e.message));
  }, [period]);

  useEffect(() => { setDados(null); carregar(); }, [carregar]); // eslint-disable-line react-hooks/set-state-in-effect

  const grupos = useMemo(() => dados?.etiquetas || [], [dados]);
  const envios = useMemo(() => (dados?.envios || []).filter(e => e.jobId !== 'sem-envio'), [dados]);
  const maxAlcance = Math.max(1, ...grupos.map(g => g.reachMediano || 0));
  const melhor = useMemo(() => Object.fromEntries(COLUNAS.map(([k]) => {
    const validos = grupos.filter(g => g.reels >= MINIMO && g[k] != null);
    return [k, validos.length > 1 ? Math.max(...validos.map(g => g[k])) : null];
  })), [grupos]);

  /* A conclusão em uma frase: só com dois grupos etiquetados e dados suficientes. */
  const conclusao = useMemo(() => {
    const com = grupos.filter(g => g.rotulo && g.reels >= MINIMO && g.reachMediano > 0);
    if (com.length < 2) return null;
    const [a, b] = [com[0], com[com.length - 1]];
    const x = a.reachMediano / Math.max(1, b.reachMediano);
    const alcance = x >= 1.2
      ? `“${a.rotulo}” alcança ${x.toFixed(1).replace('.', ',')}× mais que “${b.rotulo}” (mediana por reel).`
      : `“${a.rotulo}” e “${b.rotulo}” estão empatados no alcance — compare a retenção.`;
    const real = v => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    const vendeu = com.filter(g => g.receita != null).sort((p, q) => q.receita - p.receita);
    return vendeu.length >= 2 && vendeu[0].receita > 0
      ? `${alcance} Em vendas: “${vendeu[0].rotulo}” ${real(vendeu[0].receita)} × “${vendeu.at(-1).rotulo}” ${real(vendeu.at(-1).receita)}.`
      : alcance;
  }, [grupos]);

  async function etiquetar(jobId, rotulo) {
    setSalvando(jobId);
    try { await api.patch(`/jobs/${jobId}/rotulo`, { rotulo }); await carregar(); }
    catch (e) { setErro(e?.response?.data?.error || e.message); }
    finally { setSalvando(null); }
  }

  const th = { textAlign: 'right', padding: '8px 10px', fontSize: 'var(--mf-t-nano)', fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--mf-text-3)', whiteSpace: 'nowrap' };
  const td = { textAlign: 'right', padding: '10px', fontSize: 'var(--mf-t-xs)', color: 'var(--mf-text-2)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', borderTop: '1px solid var(--mf-border-subtle)' };

  return (
    <section className="mf-card" style={{ padding: 0, overflow: 'hidden' }} data-comparativo>
      <div style={{ padding: 'var(--mf-3) var(--mf-4)', borderBottom: '1px solid var(--mf-border)' }}>
        <TituloDeCartao icone="midia" mod="auto">Comparativo de conteúdo</TituloDeCartao>
        <div style={{ fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text-3)', marginTop: 4, lineHeight: 1.6 }}>
          Etiquete cada envio (no Postar ou aqui embaixo) e compare os grupos. Alcance pela mediana; retenção = tempo médio assistido ÷ duração do vídeo.
        </div>
      </div>

      {erro && <div style={{ padding: 'var(--mf-3) var(--mf-4)', fontSize: 'var(--mf-t-xs)', color: 'var(--mf-danger-500)' }}>{erro}</div>}
      {!dados && !erro && <div style={{ padding: 'var(--mf-6)', textAlign: 'center', fontSize: 'var(--mf-t-xs)', color: 'var(--mf-text-3)' }}>Carregando…</div>}

      {dados && (
        <>
          {conclusao && (
            <div style={{ margin: 'var(--mf-3) var(--mf-4) 0', padding: '10px 12px', borderRadius: 'var(--mf-r-md)', fontSize: 'var(--mf-t-sm)', fontWeight: 650, color: 'var(--mf-text)',
              background: 'color-mix(in oklch, var(--mf-primary-500) 8%, var(--mf-surface-1))', border: '1px solid color-mix(in oklch, var(--mf-primary-500) 30%, transparent)' }}>
              {conclusao}
            </div>
          )}

          <div style={{ overflowX: 'auto', padding: '0 var(--mf-2)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 940 }}>
              <thead>
                <tr>
                  <th style={{ ...th, textAlign: 'left' }}>Etiqueta</th>
                  <th style={th}>Reels</th>
                  {COLUNAS.map(([k, rot]) => <th key={k} style={{ ...th, ...(k === 'reachMediano' ? { textAlign: 'left', width: '26%' } : {}) }}>{rot}</th>)}
                </tr>
              </thead>
              <tbody>
                {grupos.length === 0 && (
                  <tr><td colSpan={2 + COLUNAS.length} style={{ ...td, textAlign: 'center', color: 'var(--mf-text-3)', padding: 'var(--mf-6)' }}>
                    Nenhum reel com métricas no período.
                  </td></tr>
                )}
                {grupos.map(g => (
                  <tr key={g.rotulo || '_'}>
                    <td style={{ ...td, textAlign: 'left', color: 'var(--mf-text)', fontWeight: 700 }}>
                      {g.rotulo || <span style={{ color: 'var(--mf-text-3)', fontWeight: 500 }}>Sem etiqueta</span>}
                      <div style={{ fontSize: 'var(--mf-t-nano)', color: 'var(--mf-text-3)', fontWeight: 500, marginTop: 2 }}>
                        {g.envios} envio(s) · {g.contas} conta(s){g.reels < MINIMO ? ' · poucos dados' : ''}
                      </div>
                    </td>
                    <td style={td}>{g.reels}</td>
                    {COLUNAS.map(([k, rot, f]) => {
                      const destaque = melhor[k] != null && g[k] === melhor[k];
                      const texto = <span style={{ fontWeight: destaque ? 800 : 500, color: destaque ? 'var(--mf-text)' : undefined }}>{f(g[k])}</span>;
                      if (k !== 'reachMediano') return <td key={k} style={td}>{texto}</td>;
                      const pct = g[k] ? Math.max(2, Math.round((g[k] / maxAlcance) * 100)) : 0;
                      return (
                        <td key={k} style={{ ...td, textAlign: 'left' }} title={`${rot}: ${(g[k] || 0).toLocaleString('pt-BR')} (média ${(g.reachMedio || 0).toLocaleString('pt-BR')})`}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div style={{ flex: 1, height: 8, borderRadius: 4, background: 'color-mix(in oklch, var(--mf-border) 60%, transparent)', overflow: 'hidden' }}>
                              <div style={{ width: `${pct}%`, height: '100%', borderRadius: 4, background: 'var(--mf-primary-500)' }} />
                            </div>
                            <span style={{ minWidth: 44, textAlign: 'right' }}>{texto}</span>
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Etiquetar envios — inclusive os antigos. */}
          {envios.length > 0 && (
            <div style={{ padding: 'var(--mf-3) var(--mf-4) var(--mf-4)', borderTop: '1px solid var(--mf-border)', marginTop: 'var(--mf-2)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--mf-t-nano)', fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--mf-text-3)', marginBottom: 8 }}>
                <Tag size={12} /> Etiquetar envios
              </div>
              <div style={{ display: 'grid', gap: 6 }}>
                {envios.slice(0, 12).map(e => (
                  <LinhaDeEnvio key={e.jobId} envio={e} salvando={salvando === e.jobId} onSalvar={r => etiquetar(e.jobId, r)} />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function LinhaDeEnvio({ envio, salvando, onSalvar }) {
  const [valor, setValor] = useState(envio.rotulo || '');
  const mudou = valor.trim() !== (envio.rotulo || '');
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '6px 8px', borderRadius: 'var(--mf-r-sm)', background: 'var(--mf-surface-2)' }}>
      <div style={{ flex: '1 1 180px', minWidth: 0 }}>
        <div className="mf-trunc" style={{ fontSize: 'var(--mf-t-xs)', fontWeight: 650, color: 'var(--mf-text)' }}>{envio.jobName || 'Envio sem nome'}</div>
        <div style={{ fontSize: 'var(--mf-t-nano)', color: 'var(--mf-text-3)' }}>{envio.reels} reels · alcance médio {fmt(envio.reachMedio)}</div>
      </div>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {SUGESTOES.map(s => (
          <button key={s} type="button" onClick={() => setValor(s)} aria-pressed={valor === s}
            style={{ height: 26, padding: '0 9px', borderRadius: 'var(--mf-r-full)', cursor: 'pointer', fontSize: 'var(--mf-t-nano)', fontWeight: 700,
              background: valor === s ? 'color-mix(in oklch, var(--mf-primary-500) 14%, transparent)' : 'transparent',
              border: `1px solid ${valor === s ? 'color-mix(in oklch, var(--mf-primary-500) 50%, transparent)' : 'var(--mf-border)'}`,
              color: valor === s ? 'var(--mf-text)' : 'var(--mf-text-3)' }}>{s}</button>
        ))}
      </div>
      <input className="inp" value={valor} onChange={e => setValor(e.target.value)} placeholder="ou digite…" maxLength={40}
        aria-label={`Etiqueta de ${envio.jobName || 'envio'}`} style={{ width: 130, height: 30 }} />
      <button type="button" className="btn btn-ghost btn-sm" disabled={!mudou || salvando} onClick={() => onSalvar(valor.trim())} style={{ gap: 4 }}>
        <Check size={13} /> {salvando ? 'Salvando…' : 'Salvar'}
      </button>
    </div>
  );
}
