import { NavLink, useLocation } from 'react-router-dom';
import { useEffect, useState } from 'react';

const S = { width: 17, height: 17, flexShrink: 0 };
const SW = 2;

const ICONS = {
  dashboard: <svg {...S} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={SW} strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>,
  posts:     <svg {...S} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={SW} strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>,
  accounts:  <svg {...S} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={SW} strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></svg>,
  media:     <svg {...S} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={SW} strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>,
  scheduler: <svg {...S} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={SW} strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>,
  stories:   <svg {...S} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={SW} strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>,
  warmup:    <svg {...S} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={SW} strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>,
  sessions:  <svg {...S} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={SW} strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="11" width="14" height="11" rx="2"/><path d="M8 11V7a4 4 0 018 0v4"/></svg>,
  health:    <svg {...S} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={SW} strokeLinecap="round" strokeLinejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>,
  proxies:   <svg {...S} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={SW} strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 010 20M12 2a15.3 15.3 0 000 20"/></svg>,
  legends:   <svg {...S} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={SW} strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>,
  logs:      <svg {...S} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={SW} strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/></svg>,
  settings:  <svg {...S} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={SW} strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>,
  chevron:   <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>,
};

const NAV_GROUPS = [
  {
    title: 'Visão Geral',
    items: [
      { to: '/', label: 'Painel', icon: ICONS.dashboard },
      { to: '/posts', label: 'Postagens', icon: ICONS.posts },
      { to: '/accounts', label: 'Contas', icon: ICONS.accounts },
      { to: '/media-library', label: 'Biblioteca', icon: ICONS.media },
      { to: '/scheduler', label: 'Agendador', icon: ICONS.scheduler },
      { to: '/stories', label: 'Stories', icon: ICONS.stories },
    ],
  },
  {
    title: 'Operação',
    items: [
      { to: '/warmup', label: 'Aquecimento', icon: ICONS.warmup },
      { to: '/sessions', label: 'Sessões', icon: ICONS.sessions },
      { to: '/health', label: 'Saúde', icon: ICONS.health },
      { to: '/proxies', label: 'Proxies', icon: ICONS.proxies },
      { to: '/legends', label: 'Legendas', icon: ICONS.legends },
    ],
  },
  {
    title: 'Sistema',
    items: [
      { to: '/logs', label: 'Registros', icon: ICONS.logs },
      { to: '/settings', label: 'Configurações', icon: ICONS.settings },
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
          <div className="sb-logo" style={{ fontSize: 18 }}>⚡</div>
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
