import { useState } from 'react';
import api from '../services/api';

const fmtK = v => { const n = Number(v||0); return n>=1e6?(n/1e6).toFixed(1)+'M':n>=1e3?(n/1e3).toFixed(1)+'K':String(n); };

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000';
const proxyImg = url => {
  if (!url) return '';
  if (url.startsWith('/uploads/')) return `${API_BASE}${url}`;
  return `${API_BASE}/image-proxy?url=${encodeURIComponent(url)}`;
};

export default function ViralHunter() {
  const [items,       setItems]       = useState([]);
  const [hashtag,     setHashtag]     = useState('hot');
  const [type,        setType]        = useState('top');
  const [loading,     setLoading]     = useState(false);
  const [searched,    setSearched]    = useState(false);
  const [error,       setError]       = useState('');
  const [downloading, setDownloading] = useState(null);
  const [done,        setDone]        = useState({});
  const [meta,        setMeta]        = useState(null);

  async function search(e) {
    e?.preventDefault();
    if (!hashtag.trim()) return;
    setLoading(true); setSearched(true); setError(''); setItems([]); setMeta(null);
    try {
      const tag = hashtag.replace(/^#/, '').trim();
      const r = await api.get('/viral/search', { params: { hashtag: tag, type, limit: 12 } });
      setItems(r.data.items || []);
      setMeta({ hashtag: r.data.hashtag, total: r.data.total, videos: r.data.videos });
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleDownload(item) {
    if (downloading || done[item.igMediaId]) return;
    setDownloading(item.igMediaId);
    try {
      const r = await api.post('/viral/download', {
        igMediaId: item.igMediaId,
        mediaUrl:  item.mediaUrl || '',
        permalink: item.permalink,
      });
      setDone(d => ({ ...d, [item.igMediaId]: r.data.url }));
    } catch (e) {
      alert(e.response?.data?.error || 'Erro ao baixar. A URL do CDN pode ter expirado — busque novamente.');
    } finally {
      setDownloading(null);
    }
  }

  return (
    <>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--cyan)', textTransform: 'uppercase', letterSpacing: '.8px', marginBottom: 4 }}>Viralizar</div>
        <h1>Caçador de Virais</h1>
        <p style={{ color: 'var(--text2)', fontSize: 13, marginTop: 4 }}>
          Mine os vídeos mais virais do seu nicho direto da API do Instagram — download em qualidade original
        </p>
      </div>

      {/* Search bar */}
      <form onSubmit={search} className="card card-p" style={{ marginBottom: 18 }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          {/* Hashtag input */}
          <div style={{ flex: 1, minWidth: 200, position: 'relative' }}>
            <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--cyan)', fontSize: 16, fontWeight: 700, pointerEvents: 'none' }}>#</span>
            <input
              className="input"
              style={{ paddingLeft: 28, fontWeight: 600 }}
              placeholder="hot"
              value={hashtag}
              onChange={e => setHashtag(e.target.value.replace(/^#/, ''))}
            />
          </div>

          {/* Top / Recent toggle */}
          <div className="tabs" style={{ flexShrink: 0 }}>
            {[['top', '🔥 Top'], ['recent', '🕐 Recentes']].map(([v, l]) => (
              <button key={v} type="button" className={`tab${type === v ? ' active' : ''}`} onClick={() => setType(v)}>{l}</button>
            ))}
          </div>

          <button type="submit" className="btn btn-cyan" style={{ flexShrink: 0 }} disabled={loading || !hashtag.trim()}>
            {loading ? '⏳ Minerando...' : '⚡ Minerar virais'}
          </button>
        </div>

        {/* Info */}
        <div style={{ marginTop: 12, fontSize: 11, color: 'var(--text3)', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span>📡</span>
          Busca via Instagram Graph API · apenas vídeos · download com qualidade 100% original · requer conta com API conectada
        </div>
      </form>

      {/* Error */}
      {error && (() => {
        const isToken = /oauth|token|access/i.test(error);
        const isNoAcct = /nenhuma conta|nenhuma conta/i.test(error);
        return (
          <div style={{ background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.3)', borderRadius: 12, padding: '14px 18px', marginBottom: 14 }}>
            <div style={{ color: '#f87171', fontSize: 13, fontWeight: 700, marginBottom: isToken || isNoAcct ? 8 : 0 }}>
              ⚠️ {error}
            </div>
            {isToken && (
              <div style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.6 }}>
                O token de acesso da sua conta está <strong style={{ color: '#fbbf24' }}>expirado ou inválido</strong>.
                Acesse <a href="/accounts" style={{ color: 'var(--cyan)', textDecoration: 'underline' }}>Contas</a> e reconecte
                sua conta via OAuth para gerar um novo token válido.
              </div>
            )}
            {isNoAcct && (
              <div style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.6 }}>
                Nenhuma conta está conectada via Instagram Graph API. Acesse{' '}
                <a href="/accounts" style={{ color: 'var(--cyan)', textDecoration: 'underline' }}>Contas</a> e conecte uma conta Business/Creator.
              </div>
            )}
          </div>
        );
      })()}

      {/* Empty state */}
      {!searched && !error && (
        <div className="empty-state">
          <div className="empty-icon">⚡</div>
          <div className="empty-title">Pronto para minerar</div>
          <div className="empty-sub">Digite uma hashtag do seu nicho e clique em Minerar para encontrar os vídeos mais virais via Graph API.</div>
        </div>
      )}

      {searched && !loading && !error && items.length === 0 && (
        <div className="empty-state">
          <div className="empty-icon">🎬</div>
          <div className="empty-title">Nenhum vídeo encontrado</div>
          <div className="empty-sub">Sem vídeos nessa hashtag ou a conta não tem permissão para buscar este conteúdo.</div>
        </div>
      )}

      {/* Results meta */}
      {meta && items.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, fontSize: 12, color: 'var(--text2)' }}>
          <span style={{ fontWeight: 700, color: 'var(--cyan)', fontSize: 14 }}>#{meta.hashtag}</span>
          <span>·</span>
          <span>{meta.videos} vídeos encontrados de {meta.total} posts</span>
          <span>·</span>
          <span style={{ color: 'var(--green)' }}>● API Graph</span>
        </div>
      )}

      {/* Cards grid */}
      {items.length > 0 && (
        <div className="g4" style={{ gap: 12 }}>
          {items.map((v, idx) => {
            const isLoading = downloading === v.igMediaId;
            const isDone    = !!done[v.igMediaId];
            const thumb     = proxyImg(v.thumbnailUrl);
            const age       = v.postedAt ? Math.round((Date.now() - new Date(v.postedAt)) / 86400000) : null;

            return (
              <div key={v.igMediaId} className="card" style={{ overflow: 'hidden' }}>
                {/* Rank stripe */}
                <div style={{ height: 3, background: idx < 3 ? 'linear-gradient(90deg,var(--cyan),var(--indigo))' : 'rgba(255,255,255,.06)' }} />

                {/* Thumbnail */}
                <div style={{ height: 130, background: 'linear-gradient(135deg,var(--bg3),var(--bg4))', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', overflow: 'hidden' }}>
                  {thumb
                    ? <img src={thumb} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={e => { e.target.style.display = 'none'; }} />
                    : <span style={{ fontSize: 40 }}>🎬</span>
                  }
                  {/* Rank badge */}
                  <div style={{ position: 'absolute', top: 8, left: 8 }}>
                    <span style={{
                      fontSize: 10, fontWeight: 800, padding: '2px 7px', borderRadius: 10,
                      background: idx < 3 ? 'rgba(0,212,255,.85)' : 'rgba(0,0,0,.6)',
                      color: idx < 3 ? '#000' : '#aaa',
                    }}>#{idx + 1}</span>
                  </div>
                  {/* Done overlay */}
                  {isDone && (
                    <div style={{ position: 'absolute', inset: 0, background: 'rgba(16,185,129,.25)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'rgba(16,185,129,.9)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>✓</div>
                    </div>
                  )}
                </div>

                {/* Info */}
                <div style={{ padding: '10px 12px 12px' }}>
                  {age !== null && (
                    <div style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 6 }}>Postado há {age}d</div>
                  )}

                  {v.caption && (
                    <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 8, lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                      {v.caption}
                    </div>
                  )}

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 8px', marginBottom: 10, fontSize: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span style={{ color: 'var(--text3)', fontSize: 11 }}>❤️</span>
                      <strong>{fmtK(v.likeCount)}</strong>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span style={{ color: 'var(--text3)', fontSize: 11 }}>💬</span>
                      <strong>{fmtK(v.commentsCount)}</strong>
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      className={`btn btn-sm ${isDone ? 'btn-ghost' : 'btn-primary'}`}
                      style={{ flex: 1, justifyContent: 'center' }}
                      onClick={() => handleDownload(v)}
                      disabled={isLoading || isDone}
                    >
                      {isLoading ? '⏳ Baixando...' : isDone ? '✓ Baixado' : '⬇ Baixar HD'}
                    </button>
                    {v.permalink && (
                      <a href={v.permalink} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm" title="Ver no Instagram">↗</a>
                    )}
                    {isDone && done[v.igMediaId] && (
                      <a href={`${API_BASE}${done[v.igMediaId]}`} download className="btn btn-ghost btn-sm" title="Salvar arquivo">💾</a>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Footer */}
      <div className="card card-p" style={{ marginTop: 16, display: 'flex', alignItems: 'flex-start', gap: 14 }}>
        <div style={{ fontSize: 22, flexShrink: 0 }}>🔒</div>
        <div>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 3 }}>Download via CDN oficial — qualidade 100% original</div>
          <div style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.6 }}>
            Os vídeos são encontrados via <strong>Instagram Graph API</strong> usando a hashtag do nicho e baixados diretamente do CDN oficial do Meta — sem perda de qualidade.
            As URLs do CDN expiram em alguns minutos, então baixe logo após a busca.
          </div>
        </div>
      </div>
    </>
  );
}
