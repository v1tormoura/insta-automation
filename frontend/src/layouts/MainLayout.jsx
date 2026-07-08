import { NavLink, useLocation } from 'react-router-dom';
import { useEffect, useState } from 'react';

const ic = (children, w=17) => (
  <svg width={w} height={w} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{flexShrink:0}}>
    {children}
  </svg>
);

const ICONS = {
  dashboard: ic(<><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></>),
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
  chevron:   ic(<path d="M15 18l-6-6 6-6"/>, 14),
};

const NAV_GROUPS = [
  {
    title: '',
    items: [
      { to: '/', label: 'Dashboard', icon: ICONS.dashboard },
    ],
  },
  {
    title: 'Publicação',
    items: [
      { to: '/posts',     label: 'Postar',       icon: ICONS.posts },
      { to: '/loop',      label: 'Loop',         icon: ICONS.loop },
      { to: '/stories',   label: 'Stories',      icon: ICONS.stories },
      { to: '/scheduler', label: 'Agendamentos', icon: ICONS.scheduler },
    ],
  },
  {
    title: 'Conteúdo',
    items: [
      { to: '/media-library', label: 'Biblioteca', icon: ICONS.media },
      { to: '/legends',       label: 'Legendas',   icon: ICONS.legends },
      { to: '/top-posts',     label: 'Top Posts',  icon: ICONS.topposts },
    ],
  },
  {
    title: 'Configuração',
    items: [
      { to: '/accounts', label: 'Contas',         icon: ICONS.accounts },
      { to: '/health',   label: 'Saúde',          icon: ICONS.health },
      { to: '/proxies',  label: 'Proxies',        icon: ICONS.proxies },
      { to: '/settings', label: 'Configurações',  icon: ICONS.settings },
    ],
  },
  {
    title: 'Admin',
    items: [
      { to: '/logs', label: 'Histórico', icon: ICONS.logs },
    ],
  },
];

export default function MainLayout({ children }) {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('instaflow_sidebar') === 'collapsed');
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    localStorage.setItem('instaflow_sidebar', collapsed ? 'collapsed' : 'expanded');
  }, [collapsed]);

  useEffect(() => {
    setMobileOpen(false);
  }, [location]);

  const isDash = location.pathname === '/';

  return (
    <div className="appShell">
      {mobileOpen && (
        <div onClick={() => setMobileOpen(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', zIndex: 99, backdropFilter: 'blur(4px)' }} />
      )}

      <aside className={`sidebar${collapsed ? ' collapsed' : ''}${mobileOpen ? ' open' : ''}`}>
        {/* Brand */}
        <div className="sb-brand">
          <div className="sb-logo" style={{ padding: 0, overflow: 'hidden', background: 'none', border: 'none' }}>
            <img src="/instaflow-app-icon.svg" alt="logo" style={{ width: 34, height: 34, objectFit: 'contain' }} />
          </div>
          <div className="sb-brand-text">
            <strong>InstaFlow</strong>
            <span>Automação Pro</span>
          </div>
          <button className="sb-collapse-btn" onClick={() => setCollapsed(v => !v)} title={collapsed ? 'Expandir' : 'Recolher'}>
            <div style={{ transform: collapsed ? 'rotate(180deg)' : 'none', transition: 'transform .25s', display: 'flex' }}>
              {ICONS.chevron}
            </div>
          </button>
        </div>

        {/* Nav */}
        <nav className="sb-nav">
          {NAV_GROUPS.map(group => (
            <div className="sb-group" key={group.title}>
              <div className="sb-group-label">{group.title}</div>
              {group.items.map(item => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === '/'}
                  className={({ isActive }) => `sb-item${isActive ? ' active' : ''}`}
                  title={collapsed ? item.label : undefined}
                >
                  {item.icon}
                  <span className="sb-item-txt">{item.label}</span>
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        {/* Footer */}
        <div className="sb-footer">
          <div className="sb-user">
            <div className="sb-avatar">A</div>
            <div className="sb-user-info">
              <strong>Administrador</strong>
              <span><span className="sb-online-dot" /> Online</span>
            </div>
          </div>
        </div>
      </aside>

      <main className="mainContent">
        {/* Mobile topbar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderBottom: '1px solid var(--border)', background: 'rgba(6,13,30,.9)', position: 'sticky', top: 0, zIndex: 50 }}
          className="mobile-topbar">
          <button onClick={() => setMobileOpen(v => !v)}
            style={{ background: 'none', border: 'none', color: 'var(--text)', padding: 4, cursor: 'pointer', display: 'flex' }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M3 12h18M3 6h18M3 18h18"/>
            </svg>
          </button>
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16 }}>InstaFlow</span>
        </div>

        {isDash ? children : <div className="padded-page">{children}</div>}
      </main>
    </div>
  );
}
