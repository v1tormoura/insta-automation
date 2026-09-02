import { useState, useMemo } from 'react';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3000';

const STATUS_COLOR = {
  ativa:           'var(--mf-success-500)',
  ativo:           'var(--mf-success-500)',
  restrita:        'var(--mf-warning-500)',
  banida:          'var(--mf-danger-500)',
  banido:          'var(--mf-danger-500)',
  sessao_expirada: 'var(--mf-warning-500)',
  erro_login:      'var(--mf-warning-500)',
  token_invalido:  'var(--mf-danger-500)',
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
              padding: '4px 8px 4px 24px',
              background: 'color-mix(in oklch, var(--mf-bg) 80%, transparent)',
              border: '1px solid var(--mf-border)',
              borderRadius: 'var(--mf-r-sm)', fontSize: 'var(--mf-t-xs)', color: 'var(--mf-text)', outline: 'none',
            }}
          />
        </div>
        <button
          type="button"
          onClick={toggleFiltered}
          style={{
            flexShrink: 0, fontSize: 'var(--mf-t-micro)', fontWeight: 700, padding: '4px 12px', borderRadius: 'var(--mf-r-sm)',
            background:   allSel ? 'color-mix(in oklch, var(--mf-danger-500) 10%, transparent)' : 'color-mix(in oklch, var(--mf-info-500) 10%, transparent)',
            color:        allSel ? 'var(--mf-danger-500)'               : 'var(--mf-info-500)',
            border:       `1px solid ${allSel ? 'color-mix(in oklch, var(--mf-danger-500) 30%, transparent)' : 'color-mix(in oklch, var(--mf-info-500) 30%, transparent)'}`,
            cursor: 'pointer', whiteSpace: 'nowrap', fontFamily: 'var(--mf-mono)',
            transition: 'all var(--mf-fast) var(--mf-ease-out)',
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
              fontSize: 'var(--mf-t-micro)', fontWeight: 600, padding: '4px 8px', borderRadius: 'var(--mf-r-sm)',
              border:       `1px solid ${statusTab === t.key ? 'color-mix(in oklch, var(--mf-primary-500) 50%, transparent)' : 'var(--mf-border)'}`,
              background:   statusTab === t.key ? 'color-mix(in oklch, var(--mf-primary-500) 15%, transparent)' : 'transparent',
              color:        statusTab === t.key ? 'var(--mf-primary-300)' : 'var(--mf-text-3)',
              cursor: 'pointer', transition: 'all var(--mf-fast) var(--mf-ease-out)', fontFamily: 'var(--mf-mono)',
            }}
          >
            {t.label}
          </button>
        ))}
        <span style={{ marginLeft: 'auto', fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text-3)', fontFamily: 'var(--mf-mono)' }}>
          <strong style={{ color: 'var(--mf-mod, var(--mf-accent-500))' }}>{selected.length}</strong> sel.
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
        overscrollBehavior: 'contain',
        WebkitOverflowScrolling: 'touch',
      }}>
        {filtered.length === 0 && (
          <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: '24px 0', color: 'var(--mf-text-3)', fontSize: 'var(--mf-t-xs)' }}>
            {search ? 'Nenhuma conta encontrada' : 'Nenhuma conta disponível'}
          </div>
        )}

        {filtered.map(acc => {
          const isSel  = selSet.has(String(acc._id));
          const dotClr = STATUS_COLOR[acc.healthStatus] || 'var(--mf-text-3)';
          const init   = (acc.username || '?').slice(0, 2).toUpperCase();
          const src    = avatarUrl(acc);

          return (
            <button
              key={acc._id}
              type="button"
              onClick={() => toggleOne(acc._id)}
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                gap: 5, padding: '8px 4px 8px', borderRadius: 'var(--mf-r-md)', position: 'relative',
                border:     `1px solid ${isSel ? 'color-mix(in oklch, var(--mf-primary-500) 50%, transparent)' : 'var(--mf-border)'}`,
                background: isSel ? 'color-mix(in oklch, var(--mf-primary-500) 12%, transparent)' : 'color-mix(in oklch, var(--mf-bg) 60%, transparent)',
                cursor: 'pointer', transition: 'all var(--mf-fast) var(--mf-ease-out)', textAlign: 'center', outline: 'none',
                boxShadow: isSel ? '0 0 0 1px color-mix(in oklch, var(--mf-primary-500) 25%, transparent)' : 'none',
              }}
            >
              {/* Badge de seleção */}
              {isSel && (
                <div style={{
                  position: 'absolute', top: 5, right: 5,
                  width: 14, height: 14, borderRadius: 'var(--mf-r-full)',
                  background: 'var(--mf-primary-300)', display: 'grid', placeItems: 'center',
                }}>
                  <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="var(--mf-text)" strokeWidth="3.5" strokeLinecap="round">
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
                      width: 38, height: 38, borderRadius: 'var(--mf-r-full)', objectFit: 'cover', display: 'block',
                      border: `2px solid ${isSel ? 'var(--mf-primary-300)' : 'var(--mf-border)'}`,
                    }}
                    onError={e => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'grid'; }}
                  />
                )}
                <div style={{
                  width: 38, height: 38, borderRadius: 'var(--mf-r-full)',
                  background: 'var(--mf-primary-600)',
                  display: src ? 'none' : 'grid',
                  placeItems: 'center', fontSize: 'var(--mf-t-sm)', fontWeight: 800, color: 'var(--mf-text)',
                  border: `2px solid ${isSel ? 'var(--mf-primary-300)' : 'var(--mf-border)'}`,
                }}>{init}</div>
                {/* Dot de status */}
                <div style={{
                  position: 'absolute', right: -1, bottom: -1,
                  width: 10, height: 10, borderRadius: 'var(--mf-r-full)',
                  background: dotClr, border: '2px solid var(--mf-bg)',
                }} />
              </div>

              {/* Username */}
              <div style={{
                fontSize: 'var(--mf-t-micro)', fontWeight: 600, lineHeight: 1.2,
                color: isSel ? 'var(--mf-primary-300)' : 'var(--mf-text)',
                width: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>@{acc.username}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
