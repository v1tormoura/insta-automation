import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import api from '../services/api';
import { useServerEvents } from '../services/useServerEvents';
import PageShell from '../components/PageShell';
import { EsqueletoMetricas, EsqueletoLista, Falha } from '../components/Estados';

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
  if (healthStatus === 'banida')        return { label: 'Banida',        bg: 'color-mix(in oklch, var(--mf-danger-500) 15%, transparent)',  color: 'var(--mf-danger-500)', dot: 'var(--mf-danger-500)' };
  if (healthStatus === 'token_invalido') return { label: 'Reconectar',   bg: 'color-mix(in oklch, var(--mf-danger-500) 15%, transparent)',  color: 'var(--mf-danger-500)', dot: 'var(--mf-danger-500)' };
  if (healthStatus === 'restrita')      return { label: 'Restrita',      bg: 'color-mix(in oklch, var(--mf-warning-500) 12%, transparent)', color: 'var(--mf-warning-500)', dot: 'var(--mf-warning-500)' };
  if (level === 'atencao')              return { label: 'Atenção',       bg: 'color-mix(in oklch, var(--mf-warning-500) 12%, transparent)', color: 'var(--mf-warning-500)', dot: 'var(--mf-warning-500)' };
  if (level === 'risco')                return { label: 'Risco',         bg: 'color-mix(in oklch, var(--mf-danger-500) 12%, transparent)',  color: 'var(--mf-danger-500)', dot: 'var(--mf-danger-500)' };
  return                                       { label: 'Saudável',      bg: 'color-mix(in oklch, var(--mf-success-500) 12%, transparent)', color: 'var(--mf-success-500)', dot: 'var(--mf-success-500)' };
}

function tokenBarColor(days) {
  if (days === null || days === undefined) return 'var(--mf-border-strong)';
  if (days < 0)  return 'var(--mf-danger-500)';
  if (days < 7)  return 'var(--mf-warning-500)';
  if (days < 20) return 'var(--mf-mod-contas)';
  return 'var(--mf-mod-contas)';
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

  // True se a conta usa API Mobile (instagrapi) — detectado por provider, sessionStatus ou sessão armazenada
  const isMobileAccount = account.provider === 'instagrapi'
    || account.sessionStatus === 'VALID'
    || account.hasMobileSession;

  return (
    <div style={{
      background: 'var(--mf-surface-1)',
      border: `1px solid color-mix(in oklch, var(--mf-border-strong) 50%, transparent)`,
      borderRadius: 'var(--mf-r-lg)',
      overflow: 'hidden',
      transition: 'border-color var(--mf-normal) var(--mf-ease-out)',
    }}
      onMouseEnter={e => e.currentTarget.style.borderColor = 'color-mix(in oklch, var(--mf-mod-contas) 30%, transparent)'}
      onMouseLeave={e => e.currentTarget.style.borderColor = 'color-mix(in oklch, var(--mf-border-strong) 50%, transparent)'}
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
              style={{ width: 44, height: 44, borderRadius: 'var(--mf-r-md)', objectFit: 'cover', border: '2px solid color-mix(in oklch, var(--mf-mod-contas) 30%, transparent)' }}
            />
          ) : null}
          <div style={{ width: 44, height: 44, borderRadius: 'var(--mf-r-md)', background: 'linear-gradient(135deg,var(--mf-info-500),var(--mf-primary-500))', border: '2px solid color-mix(in oklch, var(--mf-primary-500) 40%, transparent)', display: account.avatar ? 'none' : 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 'var(--mf-t-h2)', fontWeight: 800, color: 'var(--mf-primary-300)' }}>
            {account.username?.charAt(0)?.toUpperCase() || 'I'}
          </div>
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 'var(--mf-t-body)', fontWeight: 700, color: 'var(--mf-text)' }}>@{account.username}</span>
            {account.accountType && (
              <span style={{ fontSize: 'var(--mf-t-nano)', fontWeight: 700, padding: '2px 7px', borderRadius: 'var(--mf-r-xs)', background: 'color-mix(in oklch, var(--mf-mod-contas) 15%, transparent)', color: 'var(--mf-mod-contas)', border: '1px solid color-mix(in oklch, var(--mf-mod-contas) 25%, transparent)', textTransform: 'uppercase', letterSpacing: .5 }}>
                {account.accountType}
              </span>
            )}
          </div>
          <div style={{ fontSize: 'var(--mf-t-xs)', color: 'var(--mf-text-3)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{account.name || '—'}</div>
        </div>

        {/* Badge status */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, padding: '5px 11px', borderRadius: 'var(--mf-r-xl)', background: st.bg, border: `1px solid ${st.color}33` }}>
          <span style={{ width: 6, height: 6, borderRadius: 'var(--mf-r-full)', background: st.dot, display: 'inline-block', boxShadow: `0 0 6px ${st.dot}` }} />
          <span style={{ fontSize: 'var(--mf-t-xs)', fontWeight: 700, color: st.color }}>{st.label}</span>
        </div>
      </div>

      {/* ── Status de conexão API ── */}
      {(() => {
        const tokenExpired = account.tokenDaysLeft !== null && account.tokenDaysLeft <= 0;
        const tokenInvalid = account.healthStatus === 'token_invalido' || tokenExpired;
        const apiOk = (account.hasApiToken && !tokenInvalid) || isMobileAccount;
        return (
          <div style={{ padding: '0 18px 14px', display: 'flex', gap: 8 }}>
            {apiOk ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, flex: 1, padding: '8px 12px', borderRadius: 'var(--mf-r-md)', background: 'color-mix(in oklch, var(--mf-success-500) 8%, transparent)', border: '1px solid color-mix(in oklch, var(--mf-success-500) 25%, transparent)' }}>
                <span style={{ width: 8, height: 8, borderRadius: 'var(--mf-r-full)', background: 'var(--mf-success-500)', boxShadow: '0 0 6px var(--mf-success-500)', flexShrink: 0, display: 'inline-block' }} />
                <div>
                  <div style={{ fontSize: 'var(--mf-t-xs)', fontWeight: 700, color: 'var(--mf-success-500)' }}>
                    {isMobileAccount ? 'API Mobile Ativa' : 'API Conectada'}
                  </div>
                  <div style={{ fontSize: 'var(--mf-t-nano)', color: '#475569', marginTop: 1 }}>
                    {isMobileAccount
                      ? 'Sessão instagrapi ativa'
                      : account.tokenDaysLeft !== null ? `Token válido · ${account.tokenDaysLeft} dias restantes` : 'Meta API ativa'}
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, flex: 1, padding: '8px 12px', borderRadius: 'var(--mf-r-md)', background: 'color-mix(in oklch, var(--mf-danger-500) 8%, transparent)', border: '1px solid color-mix(in oklch, var(--mf-danger-500) 25%, transparent)' }}>
                <span style={{ width: 8, height: 8, borderRadius: 'var(--mf-r-full)', background: 'var(--mf-danger-500)', flexShrink: 0, display: 'inline-block' }} />
                <div>
                  <div style={{ fontSize: 'var(--mf-t-xs)', fontWeight: 700, color: 'var(--mf-danger-500)' }}>
                    {account.hasApiToken ? 'Token Expirado / Inválido' : 'API Desconectada'}
                  </div>
                  <div style={{ fontSize: 'var(--mf-t-nano)', color: '#475569', marginTop: 1 }}>
                    {account.hasApiToken
                      ? 'Vá em Contas → Reconectar para obter novo token'
                      : 'Conecte via Contas → Conectar via API'}
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {/* ── Token de acesso (barra de progresso) ── */}
      {account.hasApiToken && (
        <div style={{ padding: '0 18px 12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontSize: 'var(--mf-t-micro)', color: '#475569', fontWeight: 500 }}>Validade do token</span>
            <span style={{ fontSize: 'var(--mf-t-micro)', fontWeight: 600, color: account.healthStatus === 'token_invalido' ? 'var(--mf-danger-500)' : tokenColor }}>
              {account.healthStatus === 'token_invalido' ? 'Expirado / inválido' :
               account.tokenDaysLeft === null ? 'Sem data' :
               account.tokenDaysLeft <= 0    ? 'Expirado' :
               `${account.tokenDaysLeft} dias`}
            </span>
          </div>
          <div style={{ height: 3, background: 'color-mix(in oklch, var(--mf-border-strong) 50%, transparent)', borderRadius: 'var(--mf-r-xs)', overflow: 'hidden' }}>
            <div style={{
              height: '100%',
              width: account.healthStatus === 'token_invalido' ? '100%' : `${tokenPct}%`,
              borderRadius: 'var(--mf-r-xs)',
              background: account.healthStatus === 'token_invalido'
                ? 'linear-gradient(90deg, #ef444499, var(--mf-danger-500))'
                : `linear-gradient(90deg, ${tokenColor}99, ${tokenColor})`,
              boxShadow: tokenPct > 0 ? `0 0 8px ${tokenColor}66` : 'none',
              transition: 'width .4s ease',
            }} />
          </div>
        </div>
      )}

      {/* ── Separador ── */}
      <div style={{ height: 1, background: 'color-mix(in oklch, var(--mf-border-strong) 30%, transparent)', margin: '0 18px' }} />

      {/* ── Linhas de info ── */}
      <div style={{ padding: '12px 18px', display: 'flex', flexDirection: 'column', gap: 9 }}>

        {/* Última sincronização / último login */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 'var(--mf-t-xs)', color: '#475569' }}>
            {isMobileAccount ? 'Último login' : 'Última sincronização'}
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 'var(--mf-t-xs)', color: 'var(--mf-text-3)' }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0118.8-4.3M22 12.5a10 10 0 01-18.8 4.2"/>
            </svg>
            {timeAgo(isMobileAccount
              ? (account.lastLoginAt || account.lastValidatedAt)
              : account.lastSync)}
          </span>
        </div>

        {/* Último erro da API */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
          <span style={{ fontSize: 'var(--mf-t-xs)', color: '#475569', flexShrink: 0 }}>Último erro da API</span>
          {recentError ? (
            <span style={{ fontSize: 'var(--mf-t-micro)', color: 'var(--mf-warning-500)', textAlign: 'right', maxWidth: 200, lineHeight: 1.4 }} title={account.lastError}>
              {account.lastError.length > 60 ? account.lastError.slice(0, 60) + '…' : account.lastError}
            </span>
          ) : (
            <span style={{ fontSize: 'var(--mf-t-xs)', color: 'var(--mf-success-500)' }}>Nenhum nas últimas 24h</span>
          )}
        </div>

        {/* Sinal de atividade */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 'var(--mf-t-xs)', color: '#475569' }}>Sinal de atividade</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 'var(--mf-t-xs)', color: 'var(--mf-text-3)' }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--mf-mod-contas)" strokeWidth="2.5" strokeLinecap="round">
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
  const [error, setError]     = useState(null);
  const [filter, setFilter]   = useState('all');
  const [checking, setChecking] = useState(false);
  const [, setTick] = useState(0);

  async function load() {
    try {
      const res = await api.get('/health');
      setData(res.data);
      setError(null);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Erro ao carregar saúde das contas');
    }
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
    <PageShell title="Saúde das contas" subtitle="Diagnóstico e sessões" accent="green">
      {error ? (
        <Falha
          titulo="Não foi possível carregar o diagnóstico"
          descricao="O servidor não respondeu à checagem de saúde."
          detalhe={error}
          onTentar={load}
        />
      ) : (
        /* A tela é um resumo em cima e uma lista de contas embaixo. O
           esqueleto reproduz os dois, para o layout não saltar. */
        <div style={{ display:'flex', flexDirection:'column', gap:'var(--mf-4)' }}>
          <EsqueletoMetricas quantas={4} />
          <EsqueletoLista itens={5} />
        </div>
      )}
    </PageShell>
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
    { label: 'Total',       value: data.summary.total,    color: 'var(--mf-primary-500)' },
    { label: 'Saudáveis',   value: data.summary.saudavel, color: 'var(--mf-success-500)' },
    { label: 'Atenção',     value: data.summary.atencao,  color: 'var(--mf-warning-500)' },
    { label: 'Risco',       value: data.summary.risco,    color: 'var(--mf-danger-500)' },
    { label: 'Banidas',     value: data.summary.banida,   color: 'var(--mf-danger-500)' },
    { label: 'Restritas',    value: data.accounts.filter(a => a.healthStatus === 'restrita').length, color: 'var(--mf-warning-500)' },
  ];

  const pageIcon = (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
    </svg>
  );

  const pageActions = (
    <>
      <span style={{ display:'inline-flex', alignItems:'center', gap:5, padding:'5px 10px', borderRadius: 'var(--mf-r-sm)', background:'color-mix(in oklch, var(--mf-success-500) 8%, transparent)', border:'1px solid color-mix(in oklch, var(--mf-success-500) 20%, transparent)', fontSize: 'var(--mf-t-micro)', color:'var(--mf-success-500)', fontWeight:700 }}>
        <span style={{ width:6, height:6, borderRadius: 'var(--mf-r-full)', background:'var(--mf-success-500)', display:'inline-block', boxShadow:'0 0 6px var(--mf-success-500)' }} />
        Automação ativa
      </span>
      <button onClick={checkNow} disabled={checking} className="btn-primary" style={{ display:'flex', alignItems:'center', gap:6, padding:'7px 14px', borderRadius: 'var(--mf-r-sm)', fontSize: 'var(--mf-t-sm)' }}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={checking ? { animation:'spin 1s linear infinite' } : {}}>
          <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0118.8-4.3M22 12.5a10 10 0 01-18.8 4.2"/>
        </svg>
        {checking ? 'Verificando...' : 'Verificar agora'}
      </button>
    </>
  );

  return (
    <PageShell
      icon={pageIcon}
      title="Saúde das Contas"
      subtitle="Sinais oficiais da API: validade do token, erros recentes, tipo de conta"
      accent="green"
      actions={pageActions}
    >
      {/* Stats */}
      <div className="resp-grid-6" style={{ marginBottom: 20 }}>
        {summaryItems.map((s, i) => (
          <motion.div
            key={s.label}
            initial={{ opacity:0, y:8 }}
            animate={{ opacity:1, y:0 }}
            transition={{ delay: i * 0.04, duration: 0.22 }}
            style={{
              background:`${s.color}0d`, border:`1px solid ${s.color}2a`,
              borderRadius: 'var(--mf-r-md)', padding:'14px 12px', textAlign:'center',
              backdropFilter:'blur(12px)',
            }}
          >
            <div style={{ fontSize: 'var(--mf-t-display)', fontWeight:800, color:s.color, letterSpacing:-1, lineHeight:1, fontVariantNumeric:'tabular-nums' }}>{s.value}</div>
            <div style={{ fontSize: 'var(--mf-t-micro)', color:'var(--mf-text-3)', marginTop:4, fontFamily:'var(--mf-mono)', textTransform:'uppercase', letterSpacing:'.05em' }}>{s.label}</div>
          </motion.div>
        ))}
      </div>

      {/* Filters */}
      <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:18, flexWrap:'wrap' }}>
        <div className="pill-scroll-x" style={{ flex:1, minWidth:0 }}>
          <div style={{ display:'flex', gap:4, background:'color-mix(in oklch, var(--mf-bg) 60%, transparent)', border:'1px solid var(--mf-border)', borderRadius: 'var(--mf-r-md)', padding:3, width:'max-content' }}>
            {[
              { v:'all',      l:'Todas' },
              { v:'saudavel', l:'Saudáveis' },
              { v:'atencao',  l:'Atenção' },
              { v:'risco',    l:'Risco' },
              { v:'banida',   l:'Banidas' },
            ].map(f => (
              <button key={f.v} onClick={() => setFilter(f.v)} style={{
                height:28, padding:'0 12px', borderRadius: 'var(--mf-r-sm)', border:'none', cursor:'pointer', fontWeight:600, fontSize: 'var(--mf-t-xs)',
                background: filter === f.v ? 'var(--mf-primary-500)' : 'transparent',
                color:      filter === f.v ? 'var(--mf-text)'    : 'var(--mf-text-3)',
                transition: 'all var(--mf-fast) var(--mf-ease-out)',
              }}>{f.l}</button>
            ))}
          </div>
        </div>
        <span style={{ flexShrink:0, fontSize: 'var(--mf-t-micro)', color:'var(--mf-text-3)', fontFamily:'var(--mf-mono)' }}>
          {filtered.length}/{data.accounts.length} · 10s
        </span>
      </div>

      {/* Cards grid */}
      {filtered.length > 0 ? (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(min(440px,100%),1fr))', gap:14 }}>
          {filtered.map(acc => <AccountCard key={acc._id} account={acc} />)}
        </div>
      ) : (
        <div style={{ textAlign:'center', padding:'48px 20px', color:'var(--mf-text-3)', background:'color-mix(in oklch, var(--mf-surface-1) 50%, transparent)', borderRadius: 'var(--mf-r-lg)', border:'1px dashed var(--mf-border)' }}>
          <div style={{ fontSize: 'var(--mf-t-display)', marginBottom:10 }}>🩺</div>
          <div style={{ fontSize: 'var(--mf-t-body)', fontWeight:600, color:'var(--mf-text-3)' }}>Nenhuma conta nesse filtro</div>
        </div>
      )}
    </PageShell>
  );
}
