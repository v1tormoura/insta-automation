import { useEffect, useState } from 'react';
import api from '../services/api';
import { useServerEvents } from '../services/useServerEvents';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3000';

function timeAgo(d) {
  if (!d) return 'Nunca';
  const s = Math.floor((Date.now() - new Date(d)) / 1000);
  if (s < 5)  return 'agora';
  if (s < 60) return `${s}s atrás`;
  if (s < 3600) return `${Math.floor(s / 60)}min atrás`;
  if (s < 86400) return `${Math.floor(s / 3600)}h atrás`;
  return `${Math.floor(s / 86400)}d atrás`;
}

function statusCfg(level, healthStatus) {
  if (healthStatus === 'banida')        return { label: 'Banida',        bg: 'rgba(239,68,68,.15)',  color: '#f87171', dot: '#ef4444' };
  if (healthStatus === 'token_invalido') return { label: 'Reconectar',   bg: 'rgba(239,68,68,.15)',  color: '#f87171', dot: '#ef4444' };
  if (healthStatus === 'restrita')      return { label: 'Restrita',      bg: 'rgba(245,158,11,.12)', color: '#fbbf24', dot: '#f59e0b' };
  if (level === 'atencao')              return { label: 'Atenção',       bg: 'rgba(245,158,11,.12)', color: '#fbbf24', dot: '#f59e0b' };
  if (level === 'risco')                return { label: 'Risco',         bg: 'rgba(239,68,68,.12)',  color: '#f87171', dot: '#ef4444' };
  return                                       { label: 'Saudável',      bg: 'rgba(16,185,129,.12)', color: '#34d399', dot: '#10b981' };
}

function tokenBarColor(days) {
  if (days === null || days === undefined) return '#334155';
  if (days < 0)  return '#ef4444';
  if (days < 7)  return '#f59e0b';
  if (days < 20) return '#06b6d4';
  return '#06b6d4';
}

function tokenBarPct(days) {
  if (days === null || days === undefined) return 0;
  if (days <= 0) return 0;
  return Math.min(100, (days / 60) * 100);
}

function AccountCard({ account }) {
  const st = statusCfg(account.level, account.healthStatus);
  const tokenColor = tokenBarColor(account.tokenDaysLeft);
  const tokenPct   = tokenBarPct(account.tokenDaysLeft);

  const recentError = account.lastError && account.lastError.length > 0;

  return (
    <div style={{
      background: 'rgba(10,18,36,.85)',
      border: `1px solid rgba(51,65,85,.5)`,
      borderRadius: 16,
      overflow: 'hidden',
      transition: 'border-color .2s',
    }}
      onMouseEnter={e => e.currentTarget.style.borderColor = 'rgba(6,182,212,.3)'}
      onMouseLeave={e => e.currentTarget.style.borderColor = 'rgba(51,65,85,.5)'}
    >
      {/* ── Cabeçalho ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '16px 18px 14px' }}>
        <div style={{ position: 'relative', flexShrink: 0 }}>
          {account.avatar ? (
            <img
              src={account.avatar.startsWith('http')
                ? `${API}/image-proxy?url=${encodeURIComponent(account.avatar)}`
                : `${API}${account.avatar}`}
              alt=""
              onError={e => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }}
              style={{ width: 44, height: 44, borderRadius: 12, objectFit: 'cover', border: '2px solid rgba(6,182,212,.3)' }}
            />
          ) : null}
          <div style={{ width: 44, height: 44, borderRadius: 12, background: 'linear-gradient(135deg,#1e40af,#6366f1)', border: '2px solid rgba(99,102,241,.4)', display: account.avatar ? 'none' : 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17, fontWeight: 800, color: '#c7d2fe' }}>
            {account.username?.charAt(0)?.toUpperCase() || 'I'}
          </div>
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: '#f1f5f9' }}>@{account.username}</span>
            {account.accountType && (
              <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 5, background: 'rgba(6,182,212,.15)', color: '#67e8f9', border: '1px solid rgba(6,182,212,.25)', textTransform: 'uppercase', letterSpacing: .5 }}>
                {account.accountType}
              </span>
            )}
          </div>
          <div style={{ fontSize: 12, color: '#64748b', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{account.name || '—'}</div>
        </div>

        {/* Badge status */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, padding: '5px 11px', borderRadius: 20, background: st.bg, border: `1px solid ${st.color}33` }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: st.dot, display: 'inline-block', boxShadow: `0 0 6px ${st.dot}` }} />
          <span style={{ fontSize: 12, fontWeight: 700, color: st.color }}>{st.label}</span>
        </div>
      </div>

      {/* ── Status de conexão API ── */}
      <div style={{ padding: '0 18px 14px', display: 'flex', gap: 8 }}>
        {account.hasApiToken ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, flex: 1, padding: '8px 12px', borderRadius: 10, background: 'rgba(16,185,129,.08)', border: '1px solid rgba(16,185,129,.25)' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#10b981', boxShadow: '0 0 6px #10b981', flexShrink: 0, display: 'inline-block' }} />
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#34d399' }}>API Conectada</div>
              <div style={{ fontSize: 10, color: '#475569', marginTop: 1 }}>
                {account.healthStatus === 'token_invalido'
                  ? 'Token expirado — reconecte'
                  : account.tokenDaysLeft !== null
                    ? `Token válido · ${account.tokenDaysLeft} dias restantes`
                    : 'Meta API ativa'}
              </div>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, flex: 1, padding: '8px 12px', borderRadius: 10, background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.25)' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#ef4444', flexShrink: 0, display: 'inline-block' }} />
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#f87171' }}>API Desconectada</div>
              <div style={{ fontSize: 10, color: '#475569', marginTop: 1 }}>Conecte via 🔗 Contas → Conectar via API</div>
            </div>
          </div>
        )}
      </div>

      {/* ── Token de acesso (barra de progresso) ── */}
      {account.hasApiToken && (
        <div style={{ padding: '0 18px 12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontSize: 11, color: '#475569', fontWeight: 500 }}>Validade do token</span>
            <span style={{ fontSize: 11, fontWeight: 600, color: account.healthStatus === 'token_invalido' ? '#ef4444' : tokenColor }}>
              {account.healthStatus === 'token_invalido' ? 'Expirado / inválido' :
               account.tokenDaysLeft === null ? 'Sem data' :
               account.tokenDaysLeft <= 0    ? 'Expirado' :
               `${account.tokenDaysLeft} dias`}
            </span>
          </div>
          <div style={{ height: 3, background: 'rgba(51,65,85,.5)', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{
              height: '100%',
              width: account.healthStatus === 'token_invalido' ? '100%' : `${tokenPct}%`,
              borderRadius: 3,
              background: account.healthStatus === 'token_invalido'
                ? 'linear-gradient(90deg, #ef444499, #ef4444)'
                : `linear-gradient(90deg, ${tokenColor}99, ${tokenColor})`,
              boxShadow: tokenPct > 0 ? `0 0 8px ${tokenColor}66` : 'none',
              transition: 'width .4s ease',
            }} />
          </div>
        </div>
      )}

      {/* ── Separador ── */}
      <div style={{ height: 1, background: 'rgba(51,65,85,.3)', margin: '0 18px' }} />

      {/* ── Linhas de info ── */}
      <div style={{ padding: '12px 18px', display: 'flex', flexDirection: 'column', gap: 9 }}>

        {/* Última sincronização */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 12, color: '#475569' }}>Última sincronização</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: '#64748b' }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0118.8-4.3M22 12.5a10 10 0 01-18.8 4.2"/>
            </svg>
            {timeAgo(account.lastSync)}
          </span>
        </div>

        {/* Último erro da API */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
          <span style={{ fontSize: 12, color: '#475569', flexShrink: 0 }}>Último erro da API</span>
          {recentError ? (
            <span style={{ fontSize: 11, color: '#fb923c', textAlign: 'right', maxWidth: 200, lineHeight: 1.4 }} title={account.lastError}>
              {account.lastError.length > 60 ? account.lastError.slice(0, 60) + '…' : account.lastError}
            </span>
          ) : (
            <span style={{ fontSize: 12, color: '#22c55e' }}>Nenhum nas últimas 24h</span>
          )}
        </div>

        {/* Sinal de atividade */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 12, color: '#475569' }}>Sinal de atividade</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: '#64748b' }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#06b6d4" strokeWidth="2.5" strokeLinecap="round">
              <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
            </svg>
            Polling a cada minuto
          </span>
        </div>

      </div>
    </div>
  );
}

export default function Health() {
  const [data, setData]       = useState(null);
  const [filter, setFilter]   = useState('all');
  const [checking, setChecking] = useState(false);
  const [, setTick] = useState(0);

  async function load() {
    try { const res = await api.get('/health'); setData(res.data); }
    catch {}
  }

  useServerEvents(['accounts'], load);

  useEffect(() => {
    load();
    // Polling rápido: 10s para a página de saúde
    const t = setInterval(load, 10_000);
    // Re-render dos "X atrás" a cada 15s
    const tick = setInterval(() => setTick(n => n + 1), 15_000);
    return () => { clearInterval(t); clearInterval(tick); };
  }, []);

  async function checkNow() {
    setChecking(true);
    try {
      await api.post('/health/check-now');
      setTimeout(load, 2000); // recarrega após 2s para pegar primeiros resultados
    } catch {}
    finally { setChecking(false); }
  }

  if (!data) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200, color: '#475569', gap: 10 }}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ animation: 'spin 1s linear infinite' }}>
        <path d="M21 12a9 9 0 11-6.219-8.56"/>
      </svg>
      Carregando saúde das contas...
    </div>
  );

  const filtered = filter === 'all'
    ? data.accounts
    : data.accounts.filter(a =>
        filter === 'banida'  ? a.healthStatus === 'banida' :
        filter === 'atencao' ? (a.level === 'atencao' || a.healthStatus === 'restrita') :
        filter === 'risco'   ? a.level === 'risco' :
        a.level === filter
      );

  const summaryItems = [
    { label: 'Total',       value: data.summary.total,    color: '#6366f1' },
    { label: 'Saudáveis',   value: data.summary.saudavel, color: '#10b981' },
    { label: 'Atenção',     value: data.summary.atencao,  color: '#f59e0b' },
    { label: 'Risco',       value: data.summary.risco,    color: '#ef4444' },
    { label: 'Banidas',     value: data.summary.banida,   color: '#ef4444' },
    { label: 'Restritas',    value: data.accounts.filter(a => a.healthStatus === 'restrita').length, color: '#f59e0b' },
  ];

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <div className="page-header-left">
          <div className="eyebrow">Saúde</div>
          <h1>Saúde das contas</h1>
          <p>Sinais oficiais da API: validade do token, erros recentes, tipo de conta. Sem 'shadowban detector' — a Meta não expõe isso.</p>
        </div>
        <div className="page-header-right">
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#22c55e', background: 'rgba(34,197,94,.1)', border: '1px solid rgba(34,197,94,.2)', padding: '6px 12px', borderRadius: 20 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#22c55e', display: 'inline-block', boxShadow: '0 0 6px #22c55e' }} />
            Automação ativa
          </span>
          <button onClick={checkNow} disabled={checking} className="btn btn-primary btn-sm" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={checking ? { animation: 'spin 1s linear infinite' } : {}}>
              <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0118.8-4.3M22 12.5a10 10 0 01-18.8 4.2"/>
            </svg>
            {checking ? 'Verificando...' : 'Verificar agora'}
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="resp-grid-6" style={{ marginBottom: 20 }}>
        {summaryItems.map(s => (
          <div key={s.label} style={{
            background: 'rgba(15,23,42,.8)', border: `1px solid ${s.color}22`,
            borderRadius: 12, padding: '14px 12px', textAlign: 'center',
            boxShadow: `0 0 0 1px ${s.color}11`,
          }}>
            <div style={{ fontSize: 24, fontWeight: 800, color: s.color, letterSpacing: -1, lineHeight: 1 }}>{s.value}</div>
            <div style={{ fontSize: 11, color: '#475569', marginTop: 4 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 18, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: '#475569', marginRight: 4 }}>Filtrar:</span>
        {[
          { v: 'all',      l: 'Todas' },
          { v: 'saudavel', l: 'Saudáveis' },
          { v: 'atencao',  l: 'Atenção' },
          { v: 'risco',    l: 'Risco' },
          { v: 'banida',   l: 'Banidas' },
        ].map(f => (
          <button key={f.v} onClick={() => setFilter(f.v)} style={{
            fontSize: 12, padding: '6px 14px', borderRadius: 20, border: 'none', cursor: 'pointer', fontWeight: 600,
            background: filter === f.v ? '#6366f1' : 'rgba(51,65,85,.4)',
            color:      filter === f.v ? '#fff'    : '#94a3b8',
            transition: 'all .15s',
          }}>{f.l}</button>
        ))}
        <span style={{ marginLeft: 'auto', fontSize: 12, color: '#475569' }}>
          {filtered.length} de {data.accounts.length} conta(s) · atualiza a cada 10s
        </span>
      </div>

      {/* Cards grid */}
      {filtered.length > 0 ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(min(440px,100%),1fr))', gap: 14 }}>
          {filtered.map(acc => <AccountCard key={acc._id} account={acc} />)}
        </div>
      ) : (
        <div style={{ textAlign: 'center', padding: '48px 20px', color: '#475569', background: 'rgba(15,23,42,.5)', borderRadius: 14, border: '1px dashed rgba(51,65,85,.5)' }}>
          <div style={{ fontSize: 36, marginBottom: 10 }}>🩺</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#64748b' }}>Nenhuma conta nesse filtro</div>
        </div>
      )}

    </div>
  );
}
