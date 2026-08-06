import { useState, useMemo } from 'react';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3000';

const STATUS_COLOR = {
  ativa:           '#34d399',
  ativo:           '#34d399',
  restrita:        '#fbbf24',
  banida:          '#f87171',
  banido:          '#f87171',
  sessao_expirada: '#fb923c',
  erro_login:      '#fb923c',
  token_invalido:  '#f87171',
};

function avatarUrl(acc) {
  if (!acc?.avatar) return null;
  if (acc.avatar.startsWith('http')) return `${API}/image-proxy?url=${encodeURIComponent(acc.avatar)}`;
  return `${API}${acc.avatar}`;
}

const TABS = [
  { key: 'all',     label: 'Todas'      },
  { key: 'ativa',   label: 'Ativas'     },
  { key: 'session', label: 'Com sessão' },
];

/**
 * AccountPicker — seletor de contas compartilhado.
 *
 * Props:
 *   accounts  — array de objetos de conta vindos da API
 *   selected  — string[] de IDs selecionados
 *   onChange  — (ids: string[]) => void
 */
export default function AccountPicker({ accounts = [], selected = [], onChange }) {
  const [search,    setSearch]    = useState('');
  const [statusTab, setStatusTab] = useState('all');

  const filtered = useMemo(() => accounts.filter(acc => {
    if (search && !acc.username?.toLowerCase().includes(search.toLowerCase())) return false;
    if (statusTab === 'ativa'   && acc.healthStatus !== 'ativa') return false;
    if (statusTab === 'session' && !acc.accessToken && !acc.igSession) return false;
    return true;
  }), [accounts, search, statusTab]);

  const selSet = useMemo(() => new Set(selected.map(String)), [selected]);
  const allSel = filtered.length > 0 && filtered.every(a => selSet.has(String(a._id)));

  function toggleOne(id) {
    const sid = String(id);
    onChange(selSet.has(sid)
      ? selected.filter(x => String(x) !== sid)
      : [...selected, sid]);
  }

  function toggleFiltered() {
    const fids = filtered.map(a => String(a._id));
    if (allSel) {
      const fset = new Set(fids);
      onChange(selected.filter(x => !fset.has(String(x))));
    } else {
      onChange([...new Set([...selected.map(String), ...fids])]);
    }
  }

  return (
    <div>
      {/* Busca + botão selecionar */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <div style={{ position: 'relative', flex: 1 }}>
          <svg
            style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', opacity: .4, pointerEvents: 'none' }}
            width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
          </svg>
          <input
            type="text"
            placeholder="Buscar @conta..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              width: '100%', boxSizing: 'border-box',
              padding: '6px 10px 6px 28px',
              background: 'oklch(0.10 0.03 235 / 0.8)',
              border: '1px solid oklch(1 0 0 / 0.1)',
              borderRadius: 8, fontSize: 12, color: 'var(--text)', outline: 'none',
            }}
          />
        </div>
        <button
          type="button"
          onClick={toggleFiltered}
          style={{
            flexShrink: 0, fontSize: 11, fontWeight: 700, padding: '5px 11px', borderRadius: 7,
            background:   allSel ? 'rgba(248,113,113,.1)' : 'rgba(59,130,246,.1)',
            color:        allSel ? '#f87171'               : '#60a5fa',
            border:       `1px solid ${allSel ? 'rgba(248,113,113,.3)' : 'rgba(59,130,246,.3)'}`,
            cursor: 'pointer', whiteSpace: 'nowrap', fontFamily: 'var(--font-mono)',
            transition: '.15s',
          }}
        >
          {allSel ? 'Desmarcar' : 'Selecionar'}{' '}
          {filtered.length < accounts.length ? filtered.length : 'todas'}
        </button>
      </div>

      {/* Filtro de status + contador */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 10, alignItems: 'center' }}>
        {TABS.map(t => (
          <button
            key={t.key}
            type="button"
            onClick={() => setStatusTab(t.key)}
            style={{
              fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 6,
              border:       `1px solid ${statusTab === t.key ? 'rgba(99,102,241,.5)' : 'oklch(1 0 0 / 0.08)'}`,
              background:   statusTab === t.key ? 'rgba(99,102,241,.15)' : 'transparent',
              color:        statusTab === t.key ? '#818cf8' : 'var(--text3)',
              cursor: 'pointer', transition: '.15s', fontFamily: 'var(--font-mono)',
            }}
          >
            {t.label}
          </button>
        ))}
        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text3)', fontFamily: 'var(--font-mono)' }}>
          <strong style={{ color: 'var(--cyan)' }}>{selected.length}</strong> sel.
        </span>
      </div>

      {/* Grade de contas */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))',
        gap: 6,
        maxHeight: 264,
        overflowY: 'auto',
        paddingRight: 2,
      }}>
        {filtered.length === 0 && (
          <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: '28px 0', color: 'var(--text3)', fontSize: 12 }}>
            {search ? 'Nenhuma conta encontrada' : 'Nenhuma conta disponível'}
          </div>
        )}

        {filtered.map(acc => {
          const isSel  = selSet.has(String(acc._id));
          const dotClr = STATUS_COLOR[acc.healthStatus] || '#6b7280';
          const init   = (acc.username || '?').slice(0, 2).toUpperCase();
          const src    = avatarUrl(acc);

          return (
            <button
              key={acc._id}
              type="button"
              onClick={() => toggleOne(acc._id)}
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                gap: 5, padding: '10px 6px 8px', borderRadius: 10, position: 'relative',
                border:     `1px solid ${isSel ? 'rgba(99,102,241,.5)' : 'oklch(1 0 0 / 0.08)'}`,
                background: isSel ? 'rgba(99,102,241,.12)' : 'oklch(0.10 0.03 235 / 0.6)',
                cursor: 'pointer', transition: 'all .15s', textAlign: 'center', outline: 'none',
                boxShadow: isSel ? '0 0 0 1px rgba(99,102,241,.25)' : 'none',
              }}
            >
              {/* Badge de seleção */}
              {isSel && (
                <div style={{
                  position: 'absolute', top: 5, right: 5,
                  width: 14, height: 14, borderRadius: '50%',
                  background: '#818cf8', display: 'grid', placeItems: 'center',
                }}>
                  <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                </div>
              )}

              {/* Avatar */}
              <div style={{ position: 'relative', flexShrink: 0 }}>
                {src && (
                  <img
                    src={src} alt=""
                    style={{
                      width: 38, height: 38, borderRadius: '50%', objectFit: 'cover', display: 'block',
                      border: `2px solid ${isSel ? '#818cf8' : 'oklch(1 0 0 / 0.1)'}`,
                    }}
                    onError={e => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'grid'; }}
                  />
                )}
                <div style={{
                  width: 38, height: 38, borderRadius: '50%',
                  background: 'oklch(0.45 0.22 295)',
                  display: src ? 'none' : 'grid',
                  placeItems: 'center', fontSize: 13, fontWeight: 800, color: '#fff',
                  border: `2px solid ${isSel ? '#818cf8' : 'oklch(1 0 0 / 0.08)'}`,
                }}>{init}</div>
                {/* Dot de status */}
                <div style={{
                  position: 'absolute', right: -1, bottom: -1,
                  width: 10, height: 10, borderRadius: '50%',
                  background: dotClr, border: '2px solid oklch(0.12 0.04 235)',
                }} />
              </div>

              {/* Username */}
              <div style={{
                fontSize: 11, fontWeight: 600, lineHeight: 1.2,
                color: isSel ? '#c7d2fe' : 'var(--text)',
                width: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>@{acc.username}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
