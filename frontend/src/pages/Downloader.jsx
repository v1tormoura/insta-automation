import { useState, useEffect } from 'react';
import axios from 'axios';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3000';

function tok() { return localStorage.getItem('token') || ''; }
function auth() { return { headers: { Authorization: `Bearer ${tok()}` } }; }
function proxyImg(url) { return url ? `${API}/image-proxy?url=${encodeURIComponent(url)}` : ''; }

function fmtNum(n) {
  if (!n) return '0';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

async function dlFile(url, filename) {
  const res = await fetch(`${API}/downloader/file?url=${encodeURIComponent(url)}`, {
    headers: { Authorization: `Bearer ${tok()}` },
  });
  if (!res.ok) throw new Error('Falha no download');
  const blob = await res.blob();
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(blobUrl), 500);
}

const IC_DOWNLOAD = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
    <polyline points="7 10 12 15 17 10"/>
    <line x1="12" y1="15" x2="12" y2="3"/>
  </svg>
);

export default function Downloader() {
  const [accounts,     setAccounts]     = useState([]);
  const [accountId,    setAccountId]    = useState('');
  const [username,     setUsername]     = useState('');
  const [profile,      setProfile]      = useState(null);
  const [media,        setMedia]        = useState([]);
  const [hasMore,      setHasMore]      = useState(false);
  const [cursor,       setCursor]       = useState(null);
  const [loading,      setLoading]      = useState(false);
  const [loadingMore,  setLoadingMore]  = useState(false);
  const [error,        setError]        = useState('');
  const [selected,     setSelected]     = useState(new Set());
  const [downloading,  setDownloading]  = useState(false);
  const [dlProg,       setDlProg]       = useState({ done: 0, total: 0 });

  useEffect(() => {
    axios.get(`${API}/accounts`, auth())
      .then(r => {
        const list = r.data?.accounts || r.data || [];
        setAccounts(list);
        if (list.length) setAccountId(String(list[0]._id));
      })
      .catch(() => {});
  }, []);

  async function handleSearch() {
    if (!username.trim() || !accountId) return;
    setLoading(true);
    setError('');
    setProfile(null);
    setMedia([]);
    setSelected(new Set());
    setHasMore(false);
    setCursor(null);
    try {
      const clean = username.replace('@', '').trim();
      const r = await axios.get(`${API}/downloader/profile`, {
        ...auth(), params: { username: clean, accountId },
      });
      setProfile(r.data.profile);
      setMedia(r.data.media || []);
      setHasMore(r.data.has_more || false);
      setCursor(r.data.next_cursor || null);
    } catch (e) {
      setError(e.response?.data?.error || 'Erro ao buscar perfil');
    } finally {
      setLoading(false);
    }
  }

  async function loadMore() {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const clean = username.replace('@', '').trim();
      const r = await axios.get(`${API}/downloader/profile`, {
        ...auth(), params: { username: clean, accountId, cursor },
      });
      setMedia(p => [...p, ...(r.data.media || [])]);
      setHasMore(r.data.has_more || false);
      setCursor(r.data.next_cursor || null);
    } catch (e) {
      setError(e.response?.data?.error || 'Erro ao carregar mais');
    } finally {
      setLoadingMore(false);
    }
  }

  function toggleSel(id) {
    setSelected(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  function toggleAll() {
    if (selected.size === media.length) setSelected(new Set());
    else setSelected(new Set(media.map(m => m.id)));
  }

  async function downloadItem(item, stopProp) {
    if (stopProp) stopProp.stopPropagation();
    const user = profile?.username || 'ig';
    if (item.type === 'carousel' && item.items?.length) {
      for (let i = 0; i < item.items.length; i++) {
        const ci = item.items[i];
        const ext = ci.type === 'video' ? 'mp4' : 'jpg';
        await dlFile(ci.url, `${user}_${item.pk}_${i + 1}.${ext}`);
        if (i < item.items.length - 1) await new Promise(r => setTimeout(r, 200));
      }
      return;
    }
    const ext = item.type === 'video' ? 'mp4' : 'jpg';
    await dlFile(item.url, `${user}_${item.pk}.${ext}`);
  }

  async function downloadSelected() {
    const list = media.filter(m => selected.has(m.id));
    if (!list.length) return;
    setDownloading(true);
    setDlProg({ done: 0, total: list.length });
    for (let i = 0; i < list.length; i++) {
      try { await downloadItem(list[i]); } catch {}
      await new Promise(r => setTimeout(r, 350));
      setDlProg({ done: i + 1, total: list.length });
    }
    setDownloading(false);
  }

  const allSel = media.length > 0 && selected.size === media.length;

  const S = {
    page:      { maxWidth: 960, margin: '0 auto' },
    card:      { background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 12, padding: 20, marginBottom: 20 },
    btn:       { padding: '9px 18px', background: 'var(--cyan)', border: 'none', borderRadius: 8, color: '#000', fontWeight: 700, fontSize: 13, cursor: 'pointer' },
    btnGhost:  { padding: '8px 14px', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text2)', fontSize: 12, cursor: 'pointer' },
    input:     { flex: 1, minWidth: 200, padding: '9px 14px', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)', fontSize: 13, outline: 'none' },
    select:    { padding: '9px 12px', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)', fontSize: 13 },
    errBox:    { marginTop: 12, padding: '8px 12px', background: 'rgba(239,68,68,.12)', border: '1px solid rgba(239,68,68,.3)', borderRadius: 8, color: '#f87171', fontSize: 12 },
  };

  return (
    <div style={S.page}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: 'var(--text)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ color: 'var(--cyan)', display: 'flex' }}>{IC_DOWNLOAD}</span>
          Baixar Perfil
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text2)' }}>Baixe todas as mídias de qualquer perfil público sem perder qualidade</p>
      </div>

      {/* Search */}
      <div style={S.card}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 600, letterSpacing: .4 }}>SESSÃO (sua conta)</span>
            <select value={accountId} onChange={e => setAccountId(e.target.value)} style={S.select}>
              {accounts.length === 0
                ? <option>Nenhuma conta cadastrada</option>
                : accounts.map(a => <option key={a._id} value={a._id}>@{a.username}</option>)
              }
            </select>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 200 }}>
            <span style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 600, letterSpacing: .4 }}>PERFIL PARA BAIXAR (qualquer conta)</span>
            <input
              value={username}
              onChange={e => setUsername(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
              placeholder="@qualquer_perfil_publico"
              style={{ ...S.input, minWidth: 'unset' }}
            />
          </div>
          <button
            onClick={handleSearch}
            disabled={loading || !username.trim() || !accountId}
            style={{ ...S.btn, opacity: (loading || !username.trim() || !accountId) ? .5 : 1 }}
          >
            {loading ? 'Buscando…' : 'Buscar'}
          </button>
        </div>
        {error && <div style={S.errBox}>{error}</div>}
      </div>

      {/* Profile header */}
      {profile && (
        <div style={{ ...S.card, display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          <img
            src={proxyImg(profile.profile_pic_url)}
            alt={profile.username}
            style={{ width: 68, height: 68, borderRadius: '50%', objectFit: 'cover', border: '2px solid var(--cyan)', flexShrink: 0 }}
            onError={e => { e.target.style.background = 'var(--bg3)'; e.target.removeAttribute('src'); }}
          />
          <div style={{ flex: 1, minWidth: 180 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
              <span style={{ fontWeight: 800, fontSize: 16, color: 'var(--text)' }}>@{profile.username}</span>
              {profile.is_verified && <span style={{ color: '#60a5fa', fontSize: 11, fontWeight: 700 }}>✓ verificado</span>}
            </div>
            {profile.full_name && <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 6 }}>{profile.full_name}</div>}
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
              {[['seguidores', profile.follower_count], ['seguindo', profile.following_count], ['posts', profile.media_count]].map(([lbl, val]) => (
                <span key={lbl} style={{ fontSize: 12, color: 'var(--text3)' }}>
                  <strong style={{ color: 'var(--text)' }}>{fmtNum(val)}</strong> {lbl}
                </span>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, color: 'var(--text3)' }}>{media.length} carregados</span>
            <button onClick={toggleAll} style={{ ...S.btnGhost, color: allSel ? '#f87171' : 'var(--text2)' }}>
              {allSel ? 'Desmarcar todos' : 'Selecionar todos'}
            </button>
            {selected.size > 0 && (
              <button onClick={downloadSelected} disabled={downloading} style={{ ...S.btn, display: 'flex', alignItems: 'center', gap: 6, opacity: downloading ? .7 : 1 }}>
                {IC_DOWNLOAD}
                {downloading ? `${dlProg.done}/${dlProg.total}` : `Baixar ${selected.size}`}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Media grid */}
      {media.length > 0 && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(148px,1fr))', gap: 6, marginBottom: 20 }}>
            {media.map(item => (
              <MediaTile
                key={item.id}
                item={item}
                sel={selected.has(item.id)}
                onToggle={() => toggleSel(item.id)}
                onDownload={e => downloadItem(item, e)}
              />
            ))}
          </div>

          {hasMore && (
            <div style={{ textAlign: 'center', marginBottom: 24 }}>
              <button onClick={loadMore} disabled={loadingMore} style={{ ...S.btnGhost, padding: '10px 28px', fontSize: 13 }}>
                {loadingMore ? 'Carregando…' : 'Carregar mais'}
              </button>
            </div>
          )}
        </>
      )}

      {/* Empty state */}
      {!loading && profile && media.length === 0 && (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text3)' }}>
          <div style={{ fontSize: 36, marginBottom: 10 }}>📭</div>
          <p style={{ fontSize: 14 }}>Nenhuma mídia encontrada neste perfil</p>
        </div>
      )}
    </div>
  );
}

function MediaTile({ item, sel, onToggle, onDownload }) {
  const [hover, setHover] = useState(false);

  return (
    <div
      onClick={onToggle}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: 'relative',
        aspectRatio: '1',
        borderRadius: 8,
        overflow: 'hidden',
        cursor: 'pointer',
        border: sel ? '2px solid var(--cyan)' : '2px solid transparent',
        transition: 'border-color .12s',
        background: 'var(--bg3)',
      }}
    >
      {item.thumb && (
        <img
          src={`${API}/image-proxy?url=${encodeURIComponent(item.thumb)}`}
          alt=""
          loading="lazy"
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          onError={e => { e.target.style.display = 'none'; }}
        />
      )}

      {/* Type badge */}
      {item.type !== 'image' && (
        <div style={{
          position: 'absolute', top: 5, right: 5,
          background: 'rgba(0,0,0,.72)', backdropFilter: 'blur(4px)',
          borderRadius: 5, padding: '2px 6px',
          fontSize: 10, fontWeight: 700, color: '#fff',
        }}>
          {item.type === 'video' ? '▶ vídeo' : `⊕ ${item.count}`}
        </div>
      )}

      {/* Hover overlay + download btn */}
      <div style={{
        position: 'absolute', inset: 0,
        background: hover ? 'rgba(0,0,0,.42)' : 'rgba(0,0,0,0)',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'flex-end',
        padding: 6,
        transition: 'background .12s',
      }}>
        {hover && (
          <button
            onClick={onDownload}
            title="Baixar"
            style={{
              background: 'rgba(255,255,255,.9)', border: 'none',
              borderRadius: 7, padding: '5px 7px', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
          </button>
        )}
      </div>

      {/* Selected check */}
      {sel && (
        <div style={{
          position: 'absolute', top: 5, left: 5,
          width: 22, height: 22, borderRadius: '50%',
          background: 'var(--cyan)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#000', fontSize: 11, fontWeight: 900,
        }}>✓</div>
      )}
    </div>
  );
}
