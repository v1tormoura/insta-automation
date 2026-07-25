import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import { removeToken } from '../services/auth';
import { useServerEvents } from '../services/useServerEvents';
import { pushNotification, clearNotifications, markRead, useNotifications } from '../services/useNotifications';

const ic = (children, w = 18) => (
  <svg width={w} height={w} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
    {children}
  </svg>
);

const ICONS = {
  dashboard: ic(<><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>),
  posts:     ic(<><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></>),
  accounts:  ic(<><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></>),
  media:     ic(<><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></>),
  scheduler: ic(<><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></>),
  stories:   ic(<><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></>),
  warmup:    ic(<><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></>),
  sessions:  ic(<><rect x="5" y="11" width="14" height="11" rx="2"/><path d="M8 11V7a4 4 0 018 0v4"/></>),
  health:    ic(<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>),
  proxies:   ic(<><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 010 20M12 2a15.3 15.3 0 000 20"/></>),
  legends:   ic(<path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>),
  loop:      ic(<><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 014-4h14M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 01-4 4H3"/></>),
  topposts:  ic(<><path d="M8.5 14.5A2.5 2.5 0 0011 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 11-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 002.5 3z"/></>),
  logs:      ic(<><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/></>),
  settings:  ic(<><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></>),
  logout:    ic(<><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></>),
  besttimes: ic(<><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></>),
  audio:     ic(<><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></>),
  abtest:    ic(<><rect x="3" y="3" width="8" height="18" rx="1"/><rect x="13" y="3" width="8" height="18" rx="1"/></>),
  repost:    ic(<><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 014-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 01-4 4H3"/></>),
  hunter:    ic(<><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></>),
  promo:     ic(<><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.8a19.79 19.79 0 01-3.07-8.68A2 2 0 012 0h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.09 7.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 14.92z"/></>),
  bell:      ic(<><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></>),
};

const NAV_GROUPS = [
  {
    title: 'VISÃO GERAL',
    items: [
      { to: '/', label: 'Dashboard', icon: ICONS.dashboard },
    ],
  },
  {
    title: 'PUBLICAÇÃO',
    items: [
      { to: '/posts',     label: 'Postar',       icon: ICONS.posts },
      { to: '/loop',      label: 'Loop',         icon: ICONS.loop },
      { to: '/stories',   label: 'Stories',      icon: ICONS.stories },
      { to: '/scheduler', label: 'Agendamentos', icon: ICONS.scheduler },
    ],
  },
  {
    title: 'CONTEÚDO',
    items: [
      { to: '/media-library', label: 'Biblioteca', icon: ICONS.media },
      { to: '/legends',       label: 'Legendas',   icon: ICONS.legends },
      { to: '/top-posts',     label: 'Top Posts',  icon: ICONS.topposts },
    ],
  },
  {
    title: 'CONFIGURAÇÃO',
    items: [
      { to: '/accounts', label: 'Contas',        icon: ICONS.accounts },
      { to: '/health',   label: 'Saúde',         icon: ICONS.health },
      { to: '/proxies',  label: 'Proxies',        icon: ICONS.proxies },
    ],
  },
  {
    title: 'VIRALIZAR',
    items: [
      { to: '/warmup',         label: 'Aquecimento',       icon: ICONS.warmup    },
      { to: '/best-times',     label: 'Melhores Horários', icon: ICONS.besttimes },
      { to: '/trending-audio', label: 'Áudio Trending',    icon: ICONS.audio     },
      { to: '/ab-test',        label: 'A/B Teste',         icon: ICONS.abtest    },
      { to: '/smart-repost',   label: 'Repost',            icon: ICONS.repost    },
      { to: '/viral-hunter',   label: 'Caçador de Virais', icon: ICONS.hunter    },
      { to: '/promo',           label: 'Divulgação',        icon: ICONS.promo     },
    ],
  },
  {
    title: 'ADMIN',
    items: [
      { to: '/logs', label: 'Histórico', icon: ICONS.logs },
    ],
  },
];

/* ── build notification from SSE event ── */
function buildNotif(data, event) {
  const a = data?.action || '';
  if (event === 'posts') {
    if (a === 'post_completed' || data?.status === 'concluido')
      return { type: 'success', msg: `✅ Post publicado${data.username ? ` @${data.username}` : ''}${data.caption ? ` — "${String(data.caption).slice(0,40)}"` : ''}` };
    if (a === 'post_failed' || data?.status === 'erro')
      return { type: 'error', msg: `❌ Falha ao publicar${data.username ? ` @${data.username}` : ''}${data.error ? `: ${String(data.error).slice(0,60)}` : ''}` };
    if (a === 'post_started')
      return { type: 'info', msg: `🚀 Publicação iniciada${data.username ? ` @${data.username}` : ''}` };
    if (data?.status) return null;
  }
  if (event === 'accounts') {
    if (a === 'oauth_connected')   return { type: 'success', msg: `🔗 ${data.username || 'Conta'} conectada via OAuth` };
    if (a === 'token_recovered')   return { type: 'success', msg: `🔑 Token renovado: @${data.username || ''}` };
    if (a === 'tokens_refreshed' && (data.refreshed || 0) > 0)
      return { type: 'success', msg: `🔑 ${data.refreshed} token(s) renovado(s)` };
    if (a === 'health_update' && data.healthStatus && data.healthStatus !== 'ativa')
      return { type: data.healthStatus === 'banida' ? 'error' : 'warn', msg: `⚠️ @${data.username || ''}: ${data.error || data.healthStatus}` };
    if (a === 'sync_done') return { type: 'info', msg: `🔄 Sincronização concluída${data.count ? ` — ${data.count} contas` : ''}` };
  }
  if (event === 'loop') {
    if (a === 'loop_started') return { type: 'info',    msg: '🔄 Loop de postagens iniciado' };
    if (a === 'loop_stopped') return { type: 'info',    msg: '⏹ Loop pausado' };
    if (a === 'loop_error')   return { type: 'error',   msg: `❌ Erro no loop${data.error ? `: ${String(data.error).slice(0,60)}` : ''}` };
    if (a === 'post_sent')    return { type: 'success', msg: `✅ Loop publicou${data.username ? ` @${data.username}` : ''}` };
  }
  if (event === 'insights' && a === 'sync_done')
    return { type: 'info', msg: `📊 Insights sincronizados${data.count ? ` (${data.count} posts)` : ''}` };
  if (event === 'warmup') {
    if (a === 'warmup_started') return { type: 'info',    msg: `🔥 Aquecimento iniciado${data.username ? ` — @${data.username}` : ''}` };
    if (a === 'warmup_stopped') return { type: 'info',    msg: `⏹ Aquecimento parado${data.username ? ` — @${data.username}` : ''}` };
    if (a === 'warmup_action')  return { type: 'success', msg: `💪 Ação de aquecimento: ${data.actionType || ''}${data.username ? ` @${data.username}` : ''}` };
  }
  return null;
}

/* ── NotificationBell ── */
function NotificationBell() {
  const { notifs, unread } = useNotifications();
  const [open, setOpen] = useState(false);
  const panelRef = useRef(null);

  const typeColor = { success: '#22c55e', error: '#f87171', warn: '#fbbf24', info: '#60a5fa' };

  useEffect(() => {
    if (!open) return;
    const h = e => { if (panelRef.current && !panelRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  return (
    <div ref={panelRef} style={{ position: 'relative' }}>
      <button
        onClick={() => { setOpen(v => !v); if (!open) markRead(); }}
        aria-label="Notificações"
        style={{
          position: 'relative', background: 'none', border: '1px solid var(--border)',
          borderRadius: 8, padding: '6px 8px', cursor: 'pointer', color: 'var(--text2)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: 'border-color .15s, color .15s',
        }}
      >
        {ICONS.bell}
        {unread > 0 && (
          <span style={{
            position: 'absolute', top: -5, right: -5, minWidth: 16, height: 16,
            fontSize: 9, fontWeight: 800, background: '#f43f5e', color: '#fff',
            borderRadius: 999, display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '0 3px', lineHeight: 1, boxShadow: '0 0 8px rgba(244,63,94,.6)',
          }}>
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 10px)', right: 0, zIndex: 9999,
          width: 340, maxHeight: 440, overflowY: 'auto',
          background: 'var(--bg2)', border: '1px solid var(--border)',
          borderRadius: 12, boxShadow: '0 16px 60px rgba(0,0,0,.5)', backdropFilter: 'blur(12px)',
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '12px 14px 10px', borderBottom: '1px solid var(--border)',
            position: 'sticky', top: 0, background: 'var(--bg2)',
          }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)', letterSpacing: '.08em' }}>
              NOTIFICAÇÕES {unread > 0 && <span style={{ color: '#f43f5e' }}>({unread})</span>}
            </span>
            {notifs.length > 0 && (
              <button onClick={() => { clearNotifications(); setOpen(false); }} style={{ fontSize: 10, color: 'var(--text3)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                Limpar tudo
              </button>
            )}
          </div>
          {notifs.length === 0 ? (
            <div style={{ padding: '32px 14px', textAlign: 'center', fontSize: 12, color: 'var(--text3)' }}>
              Nenhuma notificação ainda.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {notifs.map(n => (
                <div key={n.id} style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: typeColor[n.type] || '#60a5fa', flexShrink: 0, marginTop: 4, boxShadow: `0 0 6px ${typeColor[n.type] || '#60a5fa'}` }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.4, wordBreak: 'break-word' }}>{n.msg}</div>
                    <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 3 }}>
                      {n.time.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function MainLayout({ children }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const location  = useLocation();
  const navigate  = useNavigate();

  useEffect(() => { setDrawerOpen(false); }, [location]);

  /* SSE events → global notifications */
  useServerEvents(
    ['posts', 'accounts', 'loop', 'insights', 'warmup'],
    (data, event) => {
      const n = buildNotif(data, event);
      if (n) pushNotification(n);
    }
  );

  const isDash = location.pathname === '/';
  function logout() { removeToken(); navigate('/login'); }

  return (
    <div className="appShell">
      {/* Drawer overlay */}
      {drawerOpen && (
        <div
          onClick={() => setDrawerOpen(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.65)', zIndex: 99, backdropFilter: 'blur(4px)' }}
        />
      )}

      {/* Drawer sidebar */}
      <aside className={`drawer${drawerOpen ? ' drawer-open' : ''}`}>
        {/* Header inside drawer */}
        <div className="drawer-header">
          <button
            onClick={() => navigate('/')}
            style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
          >
            <img src="/mouraflow-icon.svg" alt="MouraFlow" style={{ width: 32, height: 32, objectFit: 'contain' }} />
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16, color: 'var(--text)' }}>MouraFlow</span>
          </button>
          <button
            className="drawer-close-btn"
            onClick={() => setDrawerOpen(false)}
            style={{ background: 'none', border: 'none', color: 'var(--text2)', cursor: 'pointer', padding: 4 }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>

        {/* Nav */}
        <nav className="drawer-nav">
          {NAV_GROUPS.map(group => (
            <div className="drawer-group" key={group.title}>
              <div className="drawer-group-label">{group.title}</div>
              {group.items.map(item => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === '/'}
                  className={({ isActive }) => `drawer-item${isActive ? ' active' : ''}`}
                >
                  {item.icon}
                  <span>{item.label}</span>
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        {/* Footer / user */}
        <div className="drawer-footer">
          <div className="drawer-user">
            <div className="drawer-avatar">VM</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Vitor Marcelo Moura</div>
              <div style={{ fontSize: 11, color: 'var(--green)', display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--green)', display: 'inline-block', boxShadow: '0 0 5px var(--green)' }} />
                Online
              </div>
            </div>
            <button onClick={logout} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text2)', padding: 4, display: 'flex', flexShrink: 0 }}>
              {ICONS.logout}
            </button>
          </div>
        </div>
      </aside>

      {/* Top header bar — always visible */}
      <header className="topbar">
        <button
          onClick={() => setDrawerOpen(v => !v)}
          className="topbar-hamburger"
          aria-label="Menu"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M3 12h18M3 6h18M3 18h18"/>
          </svg>
        </button>

        <button
          onClick={() => navigate('/')}
          className="topbar-logo"
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', gap: 8 }}
        >
          <img src="/mouraflow-icon.svg" alt="MouraFlow" style={{ width: 28, height: 28, objectFit: 'contain' }} />
          <span>MouraFlow</span>
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>
          <NotificationBell />
          <button className="topbar-cmd" aria-label="Atalhos">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 3a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3 3 3 0 0 0 3-3 3 3 0 0 0-3-3H6a3 3 0 0 0-3 3 3 3 0 0 0 3 3 3 3 0 0 0 3-3V6a3 3 0 0 0-3-3 3 3 0 0 0-3 3 3 3 0 0 0 3 3h12a3 3 0 0 0 3-3 3 3 0 0 0-3-3z"/>
            </svg>
          </button>
        </div>
      </header>

      {/* Page content */}
      <main className="mainContent">
        {isDash ? children : <div className="padded-page">{children}</div>}
      </main>
    </div>
  );
}
