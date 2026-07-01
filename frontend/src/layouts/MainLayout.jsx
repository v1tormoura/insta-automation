import { NavLink, useLocation } from 'react-router-dom';
import { useEffect, useState } from 'react';

const NAV_GROUPS = [
  {
    title: 'Visão geral',
    items: [
      { to: '/', label: 'Painel', icon: <svg viewBox="0 0 20 20" fill="currentColor"><path d="M2 11h7V2H2v9zm0 7h7v-5H2v5zm9 0h7v-9h-7v9zm0-16v5h7V2h-7z"/></svg> },
      { to: '/posts', label: 'Postagens', icon: <svg viewBox="0 0 20 20" fill="currentColor"><path d="M17 3H3a1 1 0 00-1 1v12a1 1 0 001 1h14a1 1 0 001-1V4a1 1 0 00-1-1zM9 14H5v-2h4v2zm6 0h-4v-2h4v2zm0-4H5V8h10v2z"/></svg> },
      { to: '/accounts', label: 'Contas', icon: <svg viewBox="0 0 20 20" fill="currentColor"><path d="M10 10a4 4 0 100-8 4 4 0 000 8zm-7 8a7 7 0 1114 0H3z"/></svg> },
      { to: '/media-library', label: 'Biblioteca', icon: <svg viewBox="0 0 20 20" fill="currentColor"><path d="M4 3h12a1 1 0 011 1v10a1 1 0 01-1 1H4a1 1 0 01-1-1V4a1 1 0 011-1zm1 9l3-3 2 2 3-4 3 5H5z"/></svg> },
      { to: '/scheduler', label: 'Agendador', icon: <svg viewBox="0 0 20 20" fill="currentColor"><path d="M6 2v2H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-2V2h-2v2H8V2H6zm-2 6h12v8H4V8z"/></svg> },
      { to: '/stories', label: 'Stories', icon: <svg viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm0-2a6 6 0 110-12 6 6 0 010 12zm0-9a1 1 0 011 1v3.586l2.121 2.121a1 1 0 01-1.414 1.414l-2.414-2.414A1 1 0 019 12V8a1 1 0 011-1z" clipRule="evenodd"/></svg> },
    ],
  },
  {
    title: 'Operação',
    items: [
      { to: '/warmup', label: 'Aquecimento', icon: <svg viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M12.395 2.553a1 1 0 00-1.45-.385c-.345.23-.614.558-.822.88-.214.33-.403.713-.57 1.116-.334.804-.614 1.768-.84 2.734a31.365 31.365 0 00-.613 3.58 2.64 2.64 0 01-.945-1.067c-.328-.68-.398-1.534-.398-2.654A1 1 0 005.05 6.05 6.981 6.981 0 003 11a7 7 0 1011.95-4.95c-.592-.591-.98-.985-1.348-1.467-.363-.476-.724-1.063-1.207-2.03zM12.12 15.12A3 3 0 017 13s.879.5 2.5.5c0-1 .5-4 1.25-4.5.5 1 .786 1.293 1.371 1.879A2.99 2.99 0 0113 13a2.99 2.99 0 01-.879 2.121z" clipRule="evenodd"/></svg> },
      { to: '/sessions', label: 'Sessões', icon: <svg viewBox="0 0 20 20" fill="currentColor"><path d="M10 1a5 5 0 015 5v2h1a2 2 0 012 2v7a2 2 0 01-2 2H4a2 2 0 01-2-2v-7a2 2 0 012-2h1V6a5 5 0 015-5zm0 2a3 3 0 00-3 3v2h6V6a3 3 0 00-3-3z"/></svg> },
      { to: '/health', label: 'Saúde', icon: <svg viewBox="0 0 20 20" fill="currentColor"><path d="M3.172 5.172a4 4 0 015.656 0L10 6.343l1.172-1.171a4 4 0 115.656 5.656L10 17.657l-6.828-6.829a4 4 0 010-5.656z"/></svg> },
      { to: '/proxies', label: 'Proxies', icon: <svg viewBox="0 0 20 20" fill="currentColor"><path d="M10 2a8 8 0 100 16A8 8 0 0010 2zm0 2c.95 0 1.86.2 2.68.55L4.55 12.68A6 6 0 0110 4zm0 12a6 6 0 01-2.68-.55l8.13-8.13A6 6 0 0110 16z"/></svg> },
      { to: '/legends', label: 'Legendas', icon: <svg viewBox="0 0 20 20" fill="currentColor"><path d="M4 4h12v2H4V4zm0 4h12v2H4V8zm0 4h8v2H4v-2z"/></svg> },
    ],
  },
  {
    title: 'Sistema',
    items: [
      { to: '/logs', label: 'Registros', icon: <svg viewBox="0 0 20 20" fill="currentColor"><path d="M3 4h14v2H3V4zm0 4h14v2H3V8zm0 4h10v2H3v-2z"/></svg> },
      { to: '/settings', label: 'Configurações', icon: <svg viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd"/></svg> },
    ],
  },
];

export default function MainLayout({ children }) {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('instaflow_sidebar') === 'collapsed');
  const [dark, setDark] = useState(() => localStorage.getItem('instaflow_theme') !== 'light');
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    localStorage.setItem('instaflow_theme', dark ? 'dark' : 'light');
  }, [dark]);

  useEffect(() => {
    localStorage.setItem('instaflow_sidebar', collapsed ? 'collapsed' : 'expanded');
  }, [collapsed]);

  useEffect(() => {
    setMobileOpen(false);
  }, [location]);

  return (
    <div className={`appShell${collapsed ? ' sb-collapsed' : ''}`}>
      <aside className={`sidebar${collapsed ? ' collapsed' : ''}${mobileOpen ? ' open' : ''}`}>
        {/* Brand */}
        <div className="sb-brand">
          <img src="/logo.png" alt="InstaFlow"
            style={{ width: 52, height: 52, objectFit: 'contain', flexShrink: 0 }}
          />
          {!collapsed && (
            <div className="sb-brand-text">
              <strong>InstaFlow</strong>
              <span>Automação</span>
            </div>
          )}
          {/* Collapse button */}
          <button
            className="sb-collapse-btn"
            style={{ marginLeft: collapsed ? 0 : 'auto' }}
            onClick={() => setCollapsed(v => !v)}
            title={collapsed ? 'Expandir menu' : 'Recolher menu'}
          >
            {collapsed ? (
              <svg viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd"/></svg>
            ) : (
              <svg viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd"/></svg>
            )}
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
                  <span>{item.label}</span>
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        {/* Footer */}
        <div className="sb-footer">
          {/* Theme toggle above user */}
          {!collapsed && (
            <button
              className="sb-theme-btn"
              style={{ width: '100%', borderRadius: 9, marginBottom: 8, height: 36 }}
              onClick={() => setDark(d => !d)}
              title="Alternar tema"
            >
              {dark ? (
                <>
                  <svg viewBox="0 0 20 20" fill="currentColor" style={{ width: 14, height: 14 }}><path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z"/></svg>
                  <span style={{ fontSize: 12 }}>Tema Escuro</span>
                </>
              ) : (
                <>
                  <svg viewBox="0 0 20 20" fill="currentColor" style={{ width: 14, height: 14 }}><path fillRule="evenodd" d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z" clipRule="evenodd"/></svg>
                  <span style={{ fontSize: 12 }}>Tema Claro</span>
                </>
              )}
            </button>
          )}
          {collapsed && (
            <button
              className="sb-collapse-btn"
              style={{ width: '100%', borderRadius: 9, height: 36, marginBottom: 8 }}
              onClick={() => setDark(d => !d)}
              title={dark ? 'Tema Claro' : 'Tema Escuro'}
            >
              {dark ? (
                <svg viewBox="0 0 20 20" fill="currentColor" style={{ width: 15, height: 15 }}><path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z"/></svg>
              ) : (
                <svg viewBox="0 0 20 20" fill="currentColor" style={{ width: 15, height: 15 }}><path fillRule="evenodd" d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zM4 11a1 1 0 100-2H3a1 1 0 000 2h1zm13 0a1 1 0 100-2h-1a1 1 0 100 2h1z" clipRule="evenodd"/></svg>
              )}
            </button>
          )}
          <div className="sb-user">
            <div className="sb-avatar">A</div>
            <div className="sb-user-info">
              <strong>Administrador</strong>
              <span><span className="sb-online-dot"></span>Online</span>
            </div>
          </div>
        </div>
      </aside>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 99 }}
          onClick={() => setMobileOpen(false)} />
      )}

      <main className="mainContent">
        {/* Mobile topbar */}
        <div className="mobile-topbar">
          <button onClick={() => setMobileOpen(v => !v)}
            style={{ background: 'none', border: 'none', color: 'var(--text)', padding: 4, cursor: 'pointer' }}>
            <svg width="22" height="22" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M3 5h14a1 1 0 010 2H3a1 1 0 010-2zm0 4h14a1 1 0 010 2H3a1 1 0 010-2zm0 4h14a1 1 0 010 2H3a1 1 0 010-2z" clipRule="evenodd"/>
            </svg>
          </button>
          <div style={{ fontWeight: 800, fontSize: 16, letterSpacing: '-.3px' }}>InstaFlow</div>
        </div>
        {location.pathname === '/' ? children : <div className="padded-page">{children}</div>}
      </main>
    </div>
  );
}
