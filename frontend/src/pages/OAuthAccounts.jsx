import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import api from '../services/api';

// ── helpers ──────────────────────────────────────────────────────────────────

function tokenStatus(acc) {
  if (!acc.igUserId && !acc.hasApiToken) return 'none';
  if (acc.healthStatus === 'sessao_expirada' || acc.healthStatus === 'token_invalido') return 'expired';
  if (!acc.hasApiToken) return 'missing';
  if (acc.tokenExpiresAt) {
    const daysLeft = (new Date(acc.tokenExpiresAt) - Date.now()) / 86_400_000;
    if (daysLeft < 0) return 'expired';
    if (daysLeft < 7) return 'expiring';
  }
  return 'ok';
}

const STATUS_LABEL = {
  ok:       { label: 'Conectado',     bg: 'rgba(34,197,94,.15)',  color: '#4ade80', dot: '#22c55e' },
  expiring: { label: 'Expira em breve', bg: 'rgba(251,191,36,.15)', color: '#fcd34d', dot: '#f59e0b' },
  expired:  { label: 'Expirado',      bg: 'rgba(248,113,113,.15)',color: '#f87171', dot: '#ef4444' },
  missing:  { label: 'Sem token',     bg: 'rgba(248,113,113,.12)',color: '#f87171', dot: '#ef4444' },
  none:     { label: 'Sem OAuth',     bg: 'oklch(1 0 0 / 0.06)',  color: 'var(--text3)', dot: 'var(--text3)' },
};

function daysLeft(dateStr) {
  if (!dateStr) return null;
  const d = Math.round((new Date(dateStr) - Date.now()) / 86_400_000);
  if (d < 0) return 'Expirado';
  if (d === 0) return 'Expira hoje';
  return `${d}d restantes`;
}

function fmtFollowers(n) {
  if (!n) return '—';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000)     return (n / 1_000).toFixed(1) + 'k';
  return String(n);
}

function Avatar({ account }) {
  const [failed, setFailed] = useState(false);
  const API = import.meta.env.VITE_API_URL || 'http://localhost:3000';
  const src = account.avatar ? `${API}/proxy-avatar?url=${encodeURIComponent(account.avatar)}` : null;
  const initials = (account.username || '?')[0].toUpperCase();

  if (!src || failed) {
    return (
      <div style={{
        width: 44, height: 44, borderRadius: '50%', flexShrink: 0,
        background: 'oklch(0.25 0.05 270)', display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 18, fontWeight: 700, color: 'var(--text2)',
      }}>
        {initials}
      </div>
    );
  }
  return (
    <img
      src={src} alt="" onError={() => setFailed(true)}
      style={{ width: 44, height: 44, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }}
    />
  );
}

// ── AccountCard ───────────────────────────────────────────────────────────────

function AccountCard({ account, metaAppId, onAction }) {
  const status = tokenStatus(account);
  const badge  = STATUS_LABEL[status];
  const expiry = daysLeft(account.tokenExpiresAt);
  const [busy, setBusy] = useState(false);

  async function handleConnect(reconnect = false) {
    setBusy(true);
    try {
      const params = new URLSearchParams({ accountId: account._id });
      if (metaAppId) params.set('metaAppId', metaAppId);
      const r = await api.get(`/oauth/url?${params}`);
      const oauthWin = window.open(r.data.url, '_blank', 'noopener,noreferrer');
      toast.info(`Janela OAuth aberta para @${account.username}. Complete a autorização e volte aqui.`);
      // Poll for window close then refresh
      const poll = setInterval(() => {
        if (oauthWin?.closed) { clearInterval(poll); onAction(); }
      }, 1000);
    } catch (e) {
      toast.error(e?.response?.data?.error || e.message || 'Erro ao gerar URL OAuth');
    } finally { setBusy(false); }
  }

  async function handleDisconnect() {
    if (!confirm(`Desconectar @${account.username} da API Instagram?`)) return;
    setBusy(true);
    try {
      await api.delete(`/oauth/disconnect/${account._id}`);
      toast.success(`@${account.username} desconectada`);
      onAction();
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Erro ao desconectar');
    } finally { setBusy(false); }
  }

  return (
    <div style={{
      background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 14,
      padding: '16px 16px 14px', display: 'flex', flexDirection: 'column', gap: 12,
      transition: 'border-color .15s', cursor: 'default',
    }}>
      {/* Row 1: avatar + identity + status badge */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <Avatar account={account} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              @{account.username}
            </span>
            {account.accountType && (
              <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.06em', padding: '2px 6px', borderRadius: 5,
                background: account.accountType === 'BUSINESS' ? 'rgba(0,212,255,.12)' : 'rgba(168,85,247,.12)',
                color: account.accountType === 'BUSINESS' ? 'var(--cyan)' : '#c084fc',
                fontFamily: 'var(--font-mono)', textTransform: 'uppercase',
              }}>
                {account.accountType === 'BUSINESS' ? 'Business' : account.accountType === 'CREATOR' ? 'Creator' : account.accountType}
              </span>
            )}
          </div>
          {account.name && account.name !== account.username && (
            <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {account.name}
            </div>
          )}
          <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 3, fontFamily: 'var(--font-mono)' }}>
            {fmtFollowers(account.followers)} seguidores
          </div>
        </div>

        {/* Status badge */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '3px 8px', borderRadius: 20, background: badge.bg }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: badge.dot, flexShrink: 0 }} />
            <span style={{ fontSize: 10, fontWeight: 600, color: badge.color, whiteSpace: 'nowrap' }}>{badge.label}</span>
          </div>
        </div>
      </div>

      {/* Row 2: token info */}
      {(account.igUserId || account.tokenExpiresAt) && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {account.igUserId && (
            <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text3)', background: 'oklch(1 0 0 / 0.04)', padding: '2px 6px', borderRadius: 4 }}>
              ID: {account.igUserId.slice(0, 12)}…
            </div>
          )}
          {account.tokenExpiresAt && (
            <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: status === 'expired' ? '#f87171' : status === 'expiring' ? '#fcd34d' : 'var(--text3)', background: 'oklch(1 0 0 / 0.04)', padding: '2px 6px', borderRadius: 4 }}>
              {expiry}
            </div>
          )}
        </div>
      )}

      {/* Row 3: action buttons */}
      <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
        {status === 'none' || status === 'missing' ? (
          <button onClick={() => handleConnect(false)} disabled={busy}
            style={{ flex: 1, padding: '7px 10px', borderRadius: 8, border: '1px solid var(--cyan)', background: 'rgba(0,212,255,.1)', color: 'var(--cyan)', cursor: busy ? 'wait' : 'pointer', fontSize: 12, fontWeight: 600, transition: '.15s' }}>
            {busy ? 'Aguarde…' : '🔗 Conectar'}
          </button>
        ) : status === 'expired' ? (
          <button onClick={() => handleConnect(true)} disabled={busy}
            style={{ flex: 1, padding: '7px 10px', borderRadius: 8, border: '1px solid rgba(248,113,113,.4)', background: 'rgba(248,113,113,.1)', color: '#f87171', cursor: busy ? 'wait' : 'pointer', fontSize: 12, fontWeight: 600, transition: '.15s' }}>
            {busy ? 'Aguarde…' : '🔄 Reconectar'}
          </button>
        ) : status === 'expiring' ? (
          <button onClick={() => handleConnect(true)} disabled={busy}
            style={{ flex: 1, padding: '7px 10px', borderRadius: 8, border: '1px solid rgba(251,191,36,.3)', background: 'rgba(251,191,36,.08)', color: '#fcd34d', cursor: busy ? 'wait' : 'pointer', fontSize: 12, fontWeight: 600, transition: '.15s' }}>
            {busy ? 'Aguarde…' : '🔄 Renovar'}
          </button>
        ) : (
          <button onClick={() => handleConnect(true)} disabled={busy}
            style={{ flex: 1, padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text2)', cursor: busy ? 'wait' : 'pointer', fontSize: 12, fontWeight: 600, transition: '.15s' }}>
            {busy ? 'Aguarde…' : '🔄 Reconectar'}
          </button>
        )}

        {account.igUserId && (
          <button onClick={handleDisconnect} disabled={busy} title="Desconectar da API"
            style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text3)', cursor: busy ? 'wait' : 'pointer', fontSize: 12, transition: '.15s' }}>
            ✕
          </button>
        )}
      </div>
    </div>
  );
}

// ── StatCard ─────────────────────────────────────────────────────────────────

function StatCard({ label, value, color = 'var(--text)' }) {
  return (
    <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 12, padding: '14px 16px', flex: 1, minWidth: 100 }}>
      <div style={{ fontSize: 22, fontWeight: 800, color, fontFamily: 'var(--font-mono)', letterSpacing: '-1px' }}>{value}</div>
      <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>{label}</div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

const FILTERS = [
  { id: 'all',       label: 'Todas'       },
  { id: 'connected', label: 'Conectadas'  },
  { id: 'none',      label: 'Sem OAuth'   },
  { id: 'problem',   label: 'Com problema'},
];

export default function OAuthAccounts() {
  const [accounts,   setAccounts]   = useState([]);
  const [metaApps,   setMetaApps]   = useState([]);
  const [selApp,     setSelApp]      = useState('');
  const [loading,    setLoading]     = useState(true);
  const [filter,     setFilter]      = useState('all');
  const [search,     setSearch]      = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [accR, appR] = await Promise.all([
        api.get('/accounts?limit=500'),
        api.get('/meta-apps').catch(() => ({ data: [] })),
      ]);
      const allAccs = accR.data?.accounts || accR.data || [];
      setAccounts(allAccs);
      const apps = appR.data || [];
      setMetaApps(apps);
      if (!selApp && apps.length > 0) {
        const def = apps.find(a => a.isDefault) || apps[0];
        setSelApp(def._id);
      }
    } catch (e) {
      toast.error('Erro ao carregar contas');
    } finally { setLoading(false); }
  }, []); // eslint-disable-line

  useEffect(() => { load(); }, [load]);

  const filtered = accounts.filter(a => {
    if (search) {
      const q = search.toLowerCase();
      if (!a.username?.toLowerCase().includes(q) && !a.name?.toLowerCase().includes(q)) return false;
    }
    const s = tokenStatus(a);
    if (filter === 'connected') return s === 'ok' || s === 'expiring';
    if (filter === 'none')      return s === 'none';
    if (filter === 'problem')   return s === 'expired' || s === 'missing';
    return true;
  });

  const stats = {
    total:     accounts.length,
    connected: accounts.filter(a => tokenStatus(a) === 'ok' || tokenStatus(a) === 'expiring').length,
    none:      accounts.filter(a => tokenStatus(a) === 'none').length,
    problems:  accounts.filter(a => tokenStatus(a) === 'expired' || tokenStatus(a) === 'missing').length,
  };

  async function connectNew() {
    try {
      const params = new URLSearchParams({ accountId: 'new' });
      if (selApp) params.set('metaAppId', selApp);
      const r = await api.get(`/oauth/url?${params}`);
      const win = window.open(r.data.url, '_blank', 'noopener,noreferrer');
      toast.info('Complete a autorização na janela que abriu e volte aqui.');
      const poll = setInterval(() => { if (win?.closed) { clearInterval(poll); load(); } }, 1000);
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Erro ao gerar URL de conexão');
    }
  }

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 24 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(0,212,255,.1)', border: '1px solid rgba(0,212,255,.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>🔗</div>
            <div>
              <h1 style={{ fontSize: 20, fontWeight: 800, color: 'var(--text)', margin: 0 }}>Conexões OAuth</h1>
              <p style={{ fontSize: 12, color: 'var(--text3)', margin: 0 }}>Gerencie tokens da Instagram Graph API por conta</p>
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {metaApps.length > 1 && (
            <select value={selApp} onChange={e => setSelApp(e.target.value)}
              style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text2)', fontSize: 12, cursor: 'pointer' }}>
              {metaApps.map(a => <option key={a._id} value={a._id}>{a.name || a.appId || a._id}</option>)}
            </select>
          )}
          <button onClick={load} style={{ padding: '7px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text2)', cursor: 'pointer', fontSize: 12 }}>
            ↻ Atualizar
          </button>
          <button onClick={connectNew}
            style={{ padding: '7px 16px', borderRadius: 8, border: 'none', background: 'var(--cyan)', color: '#040e1c', fontWeight: 700, cursor: 'pointer', fontSize: 12 }}>
            + Conectar nova conta
          </button>
        </div>
      </div>

      {/* Stats */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
        <StatCard label="Total de contas" value={loading ? '—' : stats.total} />
        <StatCard label="Conectadas (API)"  value={loading ? '—' : stats.connected} color="#4ade80" />
        <StatCard label="Sem OAuth"         value={loading ? '—' : stats.none}      color="var(--text3)" />
        <StatCard label="Com problema"      value={loading ? '—' : stats.problems}  color={stats.problems > 0 ? '#f87171' : 'var(--text3)'} />
      </div>

      {/* Meta info box */}
      <div style={{ background: 'rgba(0,212,255,.04)', border: '1px solid rgba(0,212,255,.12)', borderRadius: 10, padding: '10px 14px', marginBottom: 20, fontSize: 11, color: 'var(--text3)', lineHeight: 1.6 }}>
        <strong style={{ color: 'var(--cyan)' }}>Requisitos da API oficial:</strong> A Instagram Graph API exige contas <strong>Business ou Creator</strong> vinculadas a uma Página do Facebook. Contas pessoais não são suportadas (Basic Display API foi descontinuada em Dez/2024). App Review obrigatório para mais de 25 usuários.
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <input
          type="text" placeholder="Buscar por @usuário ou nome..." value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ flex: 1, minWidth: 180, padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text)', fontSize: 12 }}
        />
        <div style={{ display: 'flex', gap: 4 }}>
          {FILTERS.map(f => (
            <button key={f.id} onClick={() => setFilter(f.id)}
              style={{ padding: '7px 12px', borderRadius: 8, fontSize: 12, fontWeight: filter === f.id ? 700 : 400, cursor: 'pointer', transition: '.15s',
                background: filter === f.id ? 'rgba(0,212,255,.15)' : 'transparent',
                border: filter === f.id ? '1px solid rgba(0,212,255,.3)' : '1px solid var(--border)',
                color: filter === f.id ? 'var(--cyan)' : 'var(--text2)',
              }}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Grid */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--text3)', fontSize: 13 }}>Carregando contas…</div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--text3)' }}>
          <div style={{ fontSize: 32, marginBottom: 10 }}>🔗</div>
          <div style={{ fontSize: 14 }}>{search ? 'Nenhuma conta encontrada.' : 'Nenhuma conta neste filtro.'}</div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
          {filtered.map(acc => (
            <AccountCard key={acc._id} account={acc} metaAppId={selApp} onAction={load} />
          ))}
        </div>
      )}
    </div>
  );
}
