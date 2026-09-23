import { useEffect, useState } from 'react';
import api from '../services/api';
import TituloDeCartao from './TituloDeCartao';

/**
 * O que está subindo — alcance por envio.
 *
 * Cada envio do Postar é, na prática, um tipo de vídeo: um lote de material
 * parecido, mandado junto. Agrupar por envio é agrupar por tipo sem etiqueta.
 * A barra é uma só cor (alcance é magnitude, não identidade); o número vai
 * escrito ao lado, e a tabela de reels embaixo é a vista sem gráfico.
 */

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000';
const proxyImg = url => !url ? '' : url.startsWith('/uploads/') ? `${API_BASE}${url}` : `${API_BASE}/image-proxy?url=${encodeURIComponent(url)}`;
const fmt = n => !n ? '0' : n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}K` : String(n);
const fmtData = d => d ? new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) : '';
const DIAS = { '7d': 7, '30d': 30, '90d': 90 };

const mono = { fontSize: 'var(--mf-t-nano)', color: 'var(--mf-text-3)', fontFamily: 'var(--mf-mono)', textTransform: 'uppercase', letterSpacing: '.04em' };

function Barra({ valor, maximo, rotulo }) {
  const pct = maximo ? Math.max(2, Math.round((valor / maximo) * 100)) : 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }} title={`${rotulo}: ${valor.toLocaleString('pt-BR')}`}>
      <div style={{ flex: 1, height: 8, background: 'color-mix(in oklch, var(--mf-border) 60%, transparent)', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: 'var(--mf-primary-500)', borderRadius: 4, transition: 'width .3s' }} />
      </div>
      <span style={{ fontSize: 'var(--mf-t-xs)', fontWeight: 700, color: 'var(--mf-text)', fontVariantNumeric: 'tabular-nums', minWidth: 44, textAlign: 'right' }}>{fmt(valor)}</span>
    </div>
  );
}

/* O chão de uma conta: os últimos 10 alcances como barrinhas (mais antigo à
   esquerda), a mediana escrita, o pico, e o veredito. Uma cor só para as
   barras — é magnitude; o veredito vem no texto e num chip, não em cor. */
function ChaoDaConta({ c }) {
  const ultimos = c.ultimos || [];
  const max = Math.max(1, ...ultimos);
  const pronta = !!c.prontaParaTrocar;
  const poucos = ultimos.length < 5;
  const cor = pronta ? 'var(--mf-success-500)' : 'var(--mf-warning-500)';
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.1fr) minmax(0, 1.4fr) auto', gap: 14, alignItems: 'center', padding: '7px 0', borderTop: '1px solid var(--mf-border-subtle)' }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 'var(--mf-t-xs)', fontWeight: 700, color: 'var(--mf-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>@{c.username}</div>
        <div style={{ ...mono, textTransform: 'none', letterSpacing: 0, marginTop: 2 }}>
          chão <strong style={{ color: 'var(--mf-text-2)' }}>{fmt(c.piso)}</strong> · pico <strong style={{ color: 'var(--mf-text-2)' }}>{fmt(c.pico)}</strong> · {c.reels} reels
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 26 }} title={`últimos ${ultimos.length} reels, do mais antigo ao mais novo: ${ultimos.map(v => v.toLocaleString('pt-BR')).join(' · ')}`}>
        {ultimos.map((v, i) => (
          <span key={i} style={{ flex: 1, height: `${Math.max(6, Math.round((v / max) * 100))}%`, background: 'var(--mf-primary-500)', borderRadius: 2, opacity: .55 + (i / Math.max(1, ultimos.length - 1)) * .45 }} />
        ))}
        {ultimos.length === 0 && <span style={{ ...mono, textTransform: 'none' }}>sem reels no período</span>}
      </div>
      <span style={{ fontFamily: 'var(--mf-mono)', fontSize: 'var(--mf-t-nano)', fontWeight: 700, padding: '3px 8px', borderRadius: 'var(--mf-r-xl)', whiteSpace: 'nowrap', background: `color-mix(in oklch, ${cor} 12%, transparent)`, color: cor, border: `1px solid color-mix(in oklch, ${cor} 28%, transparent)` }}>
        {poucos ? 'poucos dados' : pronta ? 'pronta pra trocar' : 'aquecendo'}
      </span>
    </div>
  );
}

export default function AlcancePorEnvio({ period = '30d' }) {
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState('');
  const [aberto, setAberto] = useState(null);

  useEffect(() => {
    let vivo = true;
    setDados(null); setErro('');
    api.get(`/analytics/alcance-por-envio?dias=${DIAS[period] || 30}`)
      .then(r => { if (vivo) setDados(r.data); })
      .catch(e => { if (vivo) setErro(e?.response?.data?.error || e.message); });
    return () => { vivo = false; };
  }, [period]);

  const envios = dados?.envios || [];
  const maxMedio = Math.max(0, ...envios.map(e => e.reachMedio));

  return (
    <div className="mf-card">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--mf-border)' }}>
        <TituloDeCartao icone="midia" mod="auto">O que está subindo</TituloDeCartao>
        <span style={mono}>alcance médio por envio · clique para ver os reels</span>
      </div>

      {erro ? (
        <div style={{ padding: 16, fontSize: 'var(--mf-t-xs)', color: 'var(--mf-danger-500)' }}>{erro}</div>
      ) : !dados ? (
        <div style={{ padding: 16, fontSize: 'var(--mf-t-xs)', color: 'var(--mf-text-3)' }}>Carregando…</div>
      ) : envios.length === 0 ? (
        <div style={{ padding: '24px 16px', textAlign: 'center', fontSize: 'var(--mf-t-xs)', color: 'var(--mf-text-3)', lineHeight: 1.6 }}>
          Nenhum reel com métricas no período. Publique pelo Postar e sincronize os insights.
        </div>
      ) : (
        <div>
          <p style={{ margin: 0, padding: '10px 16px 4px', fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text-3)', lineHeight: 1.55 }}>
            Cada envio do Postar é um lote do mesmo tipo de vídeo. Se um envio alcança 10× outro nas <strong style={{ color: 'var(--mf-text-2)' }}>mesmas contas</strong>, a diferença é o vídeo — não a conta, não o IP. <strong style={{ color: 'var(--mf-text-2)' }}>Assistido</strong> é o tempo médio que a pessoa fica: é a retenção, o número que decide se o Instagram continua distribuindo.
          </p>

          {envios.map((e, i) => {
            const nome = e.jobName || (e.jobId === 'sem-envio' ? 'Fora de um envio' : `Envio ${e.jobId.slice(-6)}`);
            const estaAberto = aberto === e.jobId;
            return (
              <div key={e.jobId} style={{ borderTop: i === 0 ? 'none' : '1px solid var(--mf-border)' }}>
                <div
                  onClick={() => setAberto(estaAberto ? null : e.jobId)}
                  style={{ padding: '12px 16px', cursor: 'pointer', display: 'grid', gridTemplateColumns: 'minmax(0, 1.2fr) minmax(0, 2fr)', gap: 14, alignItems: 'center' }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 'var(--mf-t-sm)', fontWeight: 700, color: 'var(--mf-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={nome}>{nome}</div>
                    <div style={{ ...mono, marginTop: 3, textTransform: 'none', letterSpacing: 0 }}>
                      {e.reels} reel{e.reels === 1 ? '' : 's'} · {e.contas.length} conta{e.contas.length === 1 ? '' : 's'}
                      {e.primeiro ? ` · ${fmtData(e.primeiro)}${e.ultimo && fmtData(e.ultimo) !== fmtData(e.primeiro) ? `–${fmtData(e.ultimo)}` : ''}` : ''}
                    </div>
                  </div>
                  <div>
                    <Barra valor={e.reachMedio} maximo={maxMedio} rotulo="alcance médio" />
                    <div style={{ display: 'flex', gap: 12, marginTop: 5, ...mono, textTransform: 'none', letterSpacing: 0 }}>
                      <span>máx <strong style={{ color: 'var(--mf-text-2)' }}>{fmt(e.reachMax)}</strong></span>
                      <span>views <strong style={{ color: 'var(--mf-text-2)' }}>{fmt(e.views)}</strong></span>
                      <span>likes <strong style={{ color: 'var(--mf-text-2)' }}>{fmt(e.likes)}</strong></span>
                      {e.taxa != null && <span>taxa <strong style={{ color: 'var(--mf-text-2)' }}>{e.taxa}%</strong></span>}
                      {e.assistidoS != null && <span title="tempo médio assistido, ponderado por views">assistido <strong style={{ color: 'var(--mf-text-2)' }}>{e.assistidoS}s</strong></span>}
                    </div>
                  </div>
                </div>

                {estaAberto && (
                  <div style={{ padding: '0 16px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {e.top.map(r => (
                      <a key={r.igMediaId} href={r.permalink || '#'} target="_blank" rel="noreferrer"
                        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 8px', borderRadius: 'var(--mf-r-sm)', background: 'color-mix(in oklch, var(--mf-bg) 50%, transparent)', textDecoration: 'none', color: 'inherit' }}>
                        <div style={{ width: 34, height: 60, borderRadius: 4, overflow: 'hidden', background: 'var(--mf-surface-2)', flexShrink: 0 }}>
                          {r.thumbnailUrl && <img src={proxyImg(r.thumbnailUrl)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={ev => { ev.target.style.display = 'none'; }} />}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 'var(--mf-t-xs)', fontWeight: 600, color: 'var(--mf-text-2)' }}>@{r.username} <span style={{ ...mono, textTransform: 'none' }}>{fmtData(r.postedAt)}</span></div>
                          <div style={{ fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.caption || '(sem legenda)'}</div>
                        </div>
                        <div style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
                          <div style={{ fontSize: 'var(--mf-t-sm)', fontWeight: 800, color: 'var(--mf-text)' }}>{fmt(r.reach)}</div>
                          <div style={{ ...mono, textTransform: 'none', letterSpacing: 0 }}>{fmt(r.views)} views · {r.likes} likes{r.assistidoS != null ? ` · ${r.assistidoS}s assistidos` : ''}</div>
                        </div>
                      </a>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {dados.contas?.length > 0 && (
            <div style={{ borderTop: '1px solid var(--mf-border)', padding: '10px 16px 12px' }}>
              <div style={{ ...mono, marginBottom: 4 }}>chão por conta · mediana dos últimos 10 reels</div>
              <p style={{ margin: '0 0 10px', fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text-3)', lineHeight: 1.55 }}>
                O chão é o público-teste que o Instagram dá a cada reel novo — é o que o aquecimento constrói.
                Conta fria testa em ~100; aquecida, em milhares. Acima de <strong style={{ color: 'var(--mf-text-2)' }}>1.000</strong> ela está pronta pra receber o conteúdo que importa.
              </p>
              {dados.contas.map(c => <ChaoDaConta key={c.username} c={c} />)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
