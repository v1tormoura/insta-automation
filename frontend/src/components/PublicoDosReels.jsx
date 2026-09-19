import { useEffect, useState } from 'react';
import api from '../services/api';
import TituloDeCartao from './TituloDeCartao';

/**
 * Quem viu os reels — gênero, país, idade.
 *
 * Vem de `reached_audience_demographics` (quem o conteúdo alcançou, não quem
 * segue). O Instagram retém isso para conta pequena — devolve vazio, sem
 * erro, abaixo de ~100 seguidores — então a tela diz o motivo com o número
 * em vez de ficar em branco. A seção acende sozinha quando a conta passar.
 *
 * Cores: gênero são duas classes, então dois tons do MESMO azul com o rótulo
 * escrito — a identidade vem do texto, não da cor. País e idade são
 * magnitude: uma cor, barra proporcional, número ao lado.
 */

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000';
const avatarSrc = av => !av ? '' : av.startsWith('http') ? `${API_BASE}/image-proxy?url=${encodeURIComponent(av)}` : `${API_BASE}${av}`;
const fmt = n => !n ? '0' : n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}K` : String(n);
const mono = { fontSize: 'var(--mf-t-nano)', color: 'var(--mf-text-3)', fontFamily: 'var(--mf-mono)', textTransform: 'uppercase', letterSpacing: '.04em' };

const PERIODOS = [['this_week', 'esta semana'], ['last_30_days', '30 dias'], ['last_90_days', '90 dias']];
const PAIS = { BR: 'Brasil', US: 'Estados Unidos', PT: 'Portugal', AR: 'Argentina', MX: 'México', CO: 'Colômbia', ES: 'Espanha', IT: 'Itália', FR: 'França', DE: 'Alemanha', GB: 'Reino Unido', CL: 'Chile', PE: 'Peru', PY: 'Paraguai', UY: 'Uruguai', JP: 'Japão', IN: 'Índia', AO: 'Angola', MZ: 'Moçambique' };

/* Dois tons de um azul só: identidade pelo rótulo, não pela cor. */
const TOM_GENERO = { Mulheres: 'var(--mf-primary-500)', Homens: 'color-mix(in oklch, var(--mf-primary-500) 45%, var(--mf-surface-2))', 'Não informado': 'var(--mf-border-strong)' };

function BarraDividida({ partes }) {
  return (
    <div>
      <div style={{ display: 'flex', height: 12, borderRadius: 6, overflow: 'hidden', gap: 2, background: 'transparent' }}>
        {partes.map(p => (
          <div key={p.rotulo} title={`${p.rotulo}: ${p.pct}%`} style={{ width: `${p.pct}%`, background: TOM_GENERO[p.rotulo] || 'var(--mf-border-strong)', minWidth: p.pct > 0 ? 2 : 0 }} />
        ))}
      </div>
      <div style={{ display: 'flex', gap: 14, marginTop: 6, flexWrap: 'wrap' }}>
        {partes.map(p => (
          <span key={p.rotulo} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 'var(--mf-t-xs)', color: 'var(--mf-text-2)' }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: TOM_GENERO[p.rotulo] || 'var(--mf-border-strong)', display: 'inline-block' }} />
            {p.rotulo} <strong style={{ color: 'var(--mf-text)', fontVariantNumeric: 'tabular-nums' }}>{p.pct}%</strong>
          </span>
        ))}
      </div>
    </div>
  );
}

function Lista({ titulo, itens, rotular = x => x }) {
  if (!itens?.length) return null;
  const max = Math.max(...itens.map(i => i.pct));
  return (
    <div>
      <div style={{ ...mono, marginBottom: 6 }}>{titulo}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {itens.map(i => (
          <div key={i.chave} style={{ display: 'grid', gridTemplateColumns: '110px minmax(0, 1fr) 46px', gap: 8, alignItems: 'center' }} title={`${rotular(i.chave)}: ${i.valor.toLocaleString('pt-BR')} contas`}>
            <span style={{ fontSize: 'var(--mf-t-xs)', color: 'var(--mf-text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{rotular(i.chave)}</span>
            <div style={{ height: 8, background: 'color-mix(in oklch, var(--mf-border) 60%, transparent)', borderRadius: 4, overflow: 'hidden' }}>
              <div style={{ width: `${max ? Math.max(2, (i.pct / max) * 100) : 0}%`, height: '100%', background: 'var(--mf-primary-500)', borderRadius: 4 }} />
            </div>
            <span style={{ fontSize: 'var(--mf-t-xs)', fontWeight: 700, color: 'var(--mf-text)', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{i.pct}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Bloco({ dados }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 18 }}>
      <div>
        <div style={{ ...mono, marginBottom: 6 }}>gênero</div>
        {dados.genero?.length ? <BarraDividida partes={dados.genero} /> : <span style={{ fontSize: 'var(--mf-t-xs)', color: 'var(--mf-text-3)' }}>—</span>}
      </div>
      <Lista titulo="países" itens={dados.paises} rotular={c => PAIS[c] || c} />
      <Lista titulo="idade" itens={dados.idades} />
    </div>
  );
}

export default function PublicoDosReels({ cardStyle }) {
  const [timeframe, setTimeframe] = useState('last_30_days');
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState('');

  useEffect(() => {
    let vivo = true;
    setDados(null); setErro('');
    api.get(`/analytics/publico?timeframe=${timeframe}`)
      .then(r => { if (vivo) setDados(r.data); })
      .catch(e => { if (vivo) setErro(e?.response?.data?.error || e.message); });
    return () => { vivo = false; };
  }, [timeframe]);

  const contas = dados?.contas || [];
  const minimo = dados?.minimoSeguidores || 100;

  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--mf-border)', gap: 10, flexWrap: 'wrap' }}>
        <TituloDeCartao icone="contas" mod="auto">Quem viu seus reels</TituloDeCartao>
        <div style={{ display: 'flex', gap: 4 }}>
          {PERIODOS.map(([k, l]) => (
            <button key={k} onClick={() => setTimeframe(k)} style={{ padding: '4px 10px', borderRadius: 'var(--mf-r-sm)', border: '1px solid var(--mf-border)', background: timeframe === k ? 'var(--mf-mod, var(--mf-accent-500))' : 'transparent', color: timeframe === k ? 'var(--mf-bg)' : 'var(--mf-text-3)', fontSize: 'var(--mf-t-nano)', fontWeight: 700, cursor: 'pointer' }}>{l}</button>
          ))}
        </div>
      </div>

      {erro ? (
        <div style={{ padding: 16, fontSize: 'var(--mf-t-xs)', color: 'var(--mf-danger-500)' }}>{erro}</div>
      ) : !dados ? (
        <div style={{ padding: 16, fontSize: 'var(--mf-t-xs)', color: 'var(--mf-text-3)' }}>Consultando o Instagram…</div>
      ) : (
        <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {dados.agregado ? (
            <div>
              <div style={{ ...mono, marginBottom: 8 }}>todas as contas com dados ({dados.agregado.contas}) · quem foi alcançado</div>
              <Bloco dados={dados.agregado} />
            </div>
          ) : (
            <div style={{ fontSize: 'var(--mf-t-xs)', color: 'var(--mf-text-3)', lineHeight: 1.6, padding: '4px 0' }}>
              O Instagram <strong style={{ color: 'var(--mf-text-2)' }}>só libera gênero, país e idade a partir de ~{minimo} seguidores</strong> por conta. Abaixo disso a API devolve vazio — não é erro, é a regra deles. Esta seção acende sozinha quando uma conta passar da linha.
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {contas.map(c => (
              <div key={c.username} style={{ border: '1px solid var(--mf-border)', borderRadius: 'var(--mf-r-md)', padding: '10px 12px', background: 'color-mix(in oklch, var(--mf-bg) 50%, transparent)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: c.disponivel ? 10 : 0 }}>
                  <div style={{ width: 30, height: 30, borderRadius: 'var(--mf-r-full)', overflow: 'hidden', background: 'var(--mf-surface-2)', flexShrink: 0 }}>
                    {c.avatar && <img src={avatarSrc(c.avatar)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={ev => { ev.target.style.display = 'none'; }} />}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 'var(--mf-t-sm)', fontWeight: 700, color: 'var(--mf-text)' }}>@{c.username}</div>
                    <div style={{ ...mono, textTransform: 'none', letterSpacing: 0 }}>{fmt(c.followers)} seguidores</div>
                  </div>
                  {!c.disponivel && (
                    <span style={{ fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text-3)', textAlign: 'right', lineHeight: 1.4, maxWidth: 260 }}>
                      {c.motivo === 'poucos_seguidores'
                        ? <>sem público ainda — faltam <strong style={{ color: 'var(--mf-text-2)' }}>{Math.max(0, minimo - c.followers)}</strong> seguidores para o Instagram liberar</>
                        : c.motivo === 'sem_token' ? 'conta sem token da API' : 'sem dados no período'}
                    </span>
                  )}
                </div>
                {c.disponivel && <Bloco dados={c.alcancados} />}
              </div>
            ))}
            {contas.length === 0 && <div style={{ fontSize: 'var(--mf-t-xs)', color: 'var(--mf-text-3)' }}>Nenhuma conta conectada pela API.</div>}
          </div>
        </div>
      )}
    </div>
  );
}
