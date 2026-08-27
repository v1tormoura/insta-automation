import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import api from '../services/api';
import { EsqueletoLista } from '../components/Estados';

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
  ok:       { label: 'Conectado',     bg: 'color-mix(in oklch, var(--mf-success-500) 15%, transparent)',  color: 'var(--mf-success-500)', dot: 'var(--mf-success-500)' },
  expiring: { label: 'Expira em breve', bg: 'color-mix(in oklch, var(--mf-warning-500) 15%, transparent)', color: 'var(--mf-warning-500)', dot: 'var(--mf-warning-500)' },
  expired:  { label: 'Expirado',      bg: 'color-mix(in oklch, var(--mf-danger-500) 15%, transparent)',color: 'var(--mf-danger-500)', dot: 'var(--mf-danger-500)' },
  missing:  { label: 'Sem token',     bg: 'color-mix(in oklch, var(--mf-danger-500) 12%, transparent)',color: 'var(--mf-danger-500)', dot: 'var(--mf-danger-500)' },
  none:     { label: 'Sem OAuth',     bg: 'var(--mf-border)',  color: 'var(--mf-text-3)', dot: 'var(--mf-text-3)' },
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
        width: 44, height: 44, borderRadius: 'var(--mf-r-full)', flexShrink: 0,
        background: 'oklch(0.25 0.05 270)', display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 'var(--mf-t-h1)', fontWeight: 700, color: 'var(--mf-text-2)',
      }}>
        {initials}
      </div>
    );
  }
  return (
    <img
      src={src} alt="" onError={() => setFailed(true)}
      style={{ width: 44, height: 44, borderRadius: 'var(--mf-r-full)', objectFit: 'cover', flexShrink: 0 }}
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
      background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--mf-r-lg)',
      padding: '16px 16px 14px', display: 'flex', flexDirection: 'column', gap: 12,
      transition: 'border-color var(--mf-fast) var(--mf-ease-out)', cursor: 'default',
    }}>
      {/* Row 1: avatar + identity + status badge */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <Avatar account={account} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 'var(--mf-t-sm)', fontWeight: 700, color: 'var(--mf-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              @{account.username}
            </span>
            {account.accountType && (
              <span style={{ fontSize: 'var(--mf-t-nano)', fontWeight: 700, letterSpacing: '.06em', padding: '2px 6px', borderRadius: 'var(--mf-r-xs)',
                background: account.accountType === 'BUSINESS' ? 'color-mix(in oklch, var(--mf-mod-contas) 12%, transparent)' : 'color-mix(in oklch, var(--mf-mod-publicar) 12%, transparent)',
                color: account.accountType === 'BUSINESS' ? 'var(--mf-mod, var(--mf-accent-500))' : '#c084fc',
                fontFamily: 'var(--mf-mono)', textTransform: 'uppercase',
              }}>
                {account.accountType === 'BUSINESS' ? 'Business' : account.accountType === 'CREATOR' ? 'Creator' : account.accountType}
              </span>
            )}
          </div>
          {account.name && account.name !== account.username && (
            <div style={{ fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text-3)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {account.name}
            </div>
          )}
          <div style={{ fontSize: 'var(--mf-t-nano)', color: 'var(--mf-text-3)', marginTop: 3, fontFamily: 'var(--mf-mono)' }}>
            {fmtFollowers(account.followers)} seguidores
          </div>
        </div>

        {/* Status badge */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '3px 8px', borderRadius: 'var(--mf-r-xl)', background: badge.bg }}>
            <div style={{ width: 6, height: 6, borderRadius: 'var(--mf-r-full)', background: badge.dot, flexShrink: 0 }} />
            <span style={{ fontSize: 'var(--mf-t-nano)', fontWeight: 600, color: badge.color, whiteSpace: 'nowrap' }}>{badge.label}</span>
          </div>
        </div>
      </div>

      {/* Row 2: token info */}
      {(account.igUserId || account.tokenExpiresAt) && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {account.igUserId && (
            <div style={{ fontSize: 'var(--mf-t-nano)', fontFamily: 'var(--mf-mono)', color: 'var(--mf-text-3)', background: 'var(--mf-border-subtle)', padding: '2px 6px', borderRadius: 'var(--mf-r-xs)' }}>
              ID: {account.igUserId.slice(0, 12)}…
            </div>
          )}
          {account.tokenExpiresAt && (
            <div style={{ fontSize: 'var(--mf-t-nano)', fontFamily: 'var(--mf-mono)', color: status === 'expired' ? 'var(--mf-danger-500)' : status === 'expiring' ? 'var(--mf-warning-500)' : 'var(--mf-text-3)', background: 'var(--mf-border-subtle)', padding: '2px 6px', borderRadius: 'var(--mf-r-xs)' }}>
              {expiry}
            </div>
          )}
        </div>
      )}

      {/* Row 3: action buttons */}
      <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
        {status === 'none' || status === 'missing' ? (
          <button onClick={() => handleConnect(false)} disabled={busy}
            style={{ flex: 1, padding: '7px 10px', borderRadius: 'var(--mf-r-sm)', border: '1px solid var(--mf-mod, var(--mf-accent-500))', background: 'color-mix(in oklch, var(--mf-mod-contas) 10%, transparent)', color: 'var(--mf-mod, var(--mf-accent-500))', cursor: busy ? 'wait' : 'pointer', fontSize: 'var(--mf-t-xs)', fontWeight: 600, transition: 'all var(--mf-fast) var(--mf-ease-out)' }}>
            {busy ? 'Aguarde…' : '🔗 Conectar'}
          </button>
        ) : status === 'expired' ? (
          <button onClick={() => handleConnect(true)} disabled={busy}
            style={{ flex: 1, padding: '7px 10px', borderRadius: 'var(--mf-r-sm)', border: '1px solid color-mix(in oklch, var(--mf-danger-500) 40%, transparent)', background: 'color-mix(in oklch, var(--mf-danger-500) 10%, transparent)', color: 'var(--mf-danger-500)', cursor: busy ? 'wait' : 'pointer', fontSize: 'var(--mf-t-xs)', fontWeight: 600, transition: 'all var(--mf-fast) var(--mf-ease-out)' }}>
            {busy ? 'Aguarde…' : '🔄 Reconectar'}
          </button>
        ) : status === 'expiring' ? (
          <button onClick={() => handleConnect(true)} disabled={busy}
            style={{ flex: 1, padding: '7px 10px', borderRadius: 'var(--mf-r-sm)', border: '1px solid color-mix(in oklch, var(--mf-warning-500) 30%, transparent)', background: 'color-mix(in oklch, var(--mf-warning-500) 8%, transparent)', color: 'var(--mf-warning-500)', cursor: busy ? 'wait' : 'pointer', fontSize: 'var(--mf-t-xs)', fontWeight: 600, transition: 'all var(--mf-fast) var(--mf-ease-out)' }}>
            {busy ? 'Aguarde…' : '🔄 Renovar'}
          </button>
        ) : (
          <button onClick={() => handleConnect(true)} disabled={busy}
            style={{ flex: 1, padding: '7px 10px', borderRadius: 'var(--mf-r-sm)', border: '1px solid var(--border)', background: 'transparent', color: 'var(--mf-text-2)', cursor: busy ? 'wait' : 'pointer', fontSize: 'var(--mf-t-xs)', fontWeight: 600, transition: 'all var(--mf-fast) var(--mf-ease-out)' }}>
            {busy ? 'Aguarde…' : '🔄 Reconectar'}
          </button>
        )}

        {account.igUserId && (
          <button onClick={handleDisconnect} disabled={busy} title="Desconectar da API"
            style={{ padding: '7px 10px', borderRadius: 'var(--mf-r-sm)', border: '1px solid var(--border)', background: 'transparent', color: 'var(--mf-text-3)', cursor: busy ? 'wait' : 'pointer', fontSize: 'var(--mf-t-xs)', transition: 'all var(--mf-fast) var(--mf-ease-out)' }}>
            ✕
          </button>
        )}
      </div>
    </div>
  );
}

// ── StatCard ─────────────────────────────────────────────────────────────────

function StatCard({ label, value, color = 'var(--mf-text)' }) {
  return (
    <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--mf-r-md)', padding: '14px 16px', flex: 1, minWidth: 100 }}>
      <div style={{ fontSize: 'var(--mf-t-h1)', fontWeight: 800, color, fontFamily: 'var(--mf-mono)', letterSpacing: '-1px' }}>{value}</div>
      <div style={{ fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text-3)', marginTop: 2 }}>{label}</div>
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
            <div style={{ width: 36, height: 36, borderRadius: 'var(--mf-r-md)', background: 'color-mix(in oklch, var(--mf-mod-contas) 10%, transparent)', border: '1px solid color-mix(in oklch, var(--mf-mod-contas) 20%, transparent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 'var(--mf-t-h1)' }}>🔗</div>
            <div>
              <h1 style={{ fontSize: 'var(--mf-t-h1)', fontWeight: 800, color: 'var(--mf-text)', margin: 0 }}>Conexões OAuth</h1>
              <p style={{ fontSize: 'var(--mf-t-xs)', color: 'var(--mf-text-3)', margin: 0 }}>Gerencie tokens da Instagram Graph API por conta</p>
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {metaApps.length > 1 && (
            <select value={selApp} onChange={e => setSelApp(e.target.value)}
              style={{ padding: '7px 10px', borderRadius: 'var(--mf-r-sm)', border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--mf-text-2)', fontSize: 'var(--mf-t-xs)', cursor: 'pointer' }}>
              {metaApps.map(a => <option key={a._id} value={a._id}>{a.name || a.appId || a._id}</option>)}
            </select>
          )}
          <button onClick={load} style={{ padding: '7px 12px', borderRadius: 'var(--mf-r-sm)', border: '1px solid var(--border)', background: 'transparent', color: 'var(--mf-text-2)', cursor: 'pointer', fontSize: 'var(--mf-t-xs)' }}>
            ↻ Atualizar
          </button>
          <button onClick={connectNew}
            style={{ padding: '7px 16px', borderRadius: 'var(--mf-r-sm)', border: 'none', background: 'var(--mf-mod, var(--mf-accent-500))', color: 'var(--mf-bg)', fontWeight: 700, cursor: 'pointer', fontSize: 'var(--mf-t-xs)' }}>
            + Conectar nova conta
          </button>
        </div>
      </div>

      {/* Stats */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
        <StatCard label="Total de contas" value={loading ? '—' : stats.total} />
        <StatCard label="Conectadas (API)"  value={loading ? '—' : stats.connected} color="var(--mf-success-500)" />
        <StatCard label="Sem OAuth"         value={loading ? '—' : stats.none}      color="var(--mf-text-3)" />
        <StatCard label="Com problema"      value={loading ? '—' : stats.problems}  color={stats.problems > 0 ? 'var(--mf-danger-500)' : 'var(--mf-text-3)'} />
      </div>

      {/* Meta info box */}
      <div style={{ background: 'color-mix(in oklch, var(--mf-mod-contas) 4%, transparent)', border: '1px solid color-mix(in oklch, var(--mf-mod-contas) 12%, transparent)', borderRadius: 'var(--mf-r-md)', padding: '10px 14px', marginBottom: 20, fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text-3)', lineHeight: 1.6 }}>
        <strong style={{ color: 'var(--mf-mod, var(--mf-accent-500))' }}>Requisitos da API oficial:</strong> A Instagram Graph API exige contas <strong>Business ou Creator</strong> vinculadas a uma Página do Facebook. Contas pessoais não são suportadas (Basic Display API foi descontinuada em Dez/2024). App Review obrigatório para mais de 25 usuários.
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <input
          type="text" placeholder="Buscar por @usuário ou nome..." value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ flex: 1, minWidth: 0, padding: '8px 12px', borderRadius: 'var(--mf-r-sm)', border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--mf-text)', fontSize: 'var(--mf-t-xs)' }}
        />
        <div className="pill-scroll-x" style={{ flex:'0 0 auto', maxWidth:'100%' }}>
          <div style={{ display: 'flex', gap: 4, width: 'max-content' }}>
            {FILTERS.map(f => (
              <button key={f.id} onClick={() => setFilter(f.id)}
                style={{ padding: '7px 12px', borderRadius: 'var(--mf-r-sm)', fontSize: 'var(--mf-t-xs)', fontWeight: filter === f.id ? 700 : 400, cursor: 'pointer', transition: 'all var(--mf-fast) var(--mf-ease-out)',
                  background: filter === f.id ? 'color-mix(in oklch, var(--mf-mod-contas) 15%, transparent)' : 'transparent',
                  border: filter === f.id ? '1px solid color-mix(in oklch, var(--mf-mod-contas) 30%, transparent)' : '1px solid var(--border)',
                  color: filter === f.id ? 'var(--mf-mod, var(--mf-accent-500))' : 'var(--mf-text-2)',
                }}>
                {f.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Grid */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--mf-text-3)', fontSize: 'var(--mf-t-sm)' }}>Carregando contas…</div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--mf-text-3)' }}>
          <div style={{ fontSize: 'var(--mf-t-display)', marginBottom: 10 }}>🔗</div>
          <div style={{ fontSize: 'var(--mf-t-body)' }}>{search ? 'Nenhuma conta encontrada.' : 'Nenhuma conta neste filtro.'}</div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
          {loading && !filtered.length && <EsqueletoLista itens={5} />}
          {filtered.map(acc => (
            <AccountCard key={acc._id} account={acc} metaAppId={selApp} onAction={load} />
          ))}
        </div>
      )}
    </div>
  );
}
