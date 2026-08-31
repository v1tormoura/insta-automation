import { useState } from 'react';
import { motion } from 'framer-motion';
import api from '../services/api';
import PageShell from '../components/PageShell';
import { EsqueletoGrade } from '../components/Estados';

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

  const pageIcon = (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
    </svg>
  );

  const pageActions = (
    <div style={{ display:'flex', gap:3, background:'color-mix(in oklch, var(--mf-bg) 60%, transparent)', border:'1px solid var(--mf-border)', borderRadius: 'var(--mf-r-md)', padding:3 }}>
      {[['top','🔥 Top'], ['recent','🕐 Recentes']].map(([v, l]) => (
        <button key={v} onClick={() => setType(v)} style={{
          height:26, padding:'0 12px', borderRadius: 'var(--mf-r-sm)', fontSize: 'var(--mf-t-xs)', fontWeight:600,
          border:'none', cursor:'pointer', transition:'.15s',
          background: type === v ? 'var(--mf-mod, var(--mf-accent-500))' : 'transparent',
          color: type === v ? 'var(--mf-bg)' : 'var(--mf-text-3)',
        }}>{l}</button>
      ))}
    </div>
  );

  const cardStyle = { background:'color-mix(in oklch, var(--mf-surface-1) 85%, transparent)', border:'1px solid var(--mf-border)', borderRadius: 'var(--mf-r-lg)', overflow:'hidden', backdropFilter:'blur(12px)' };
  const inputStyle = { flex:1, minWidth:200, padding:'8px 8px 8px 32px', background:'color-mix(in oklch, var(--mf-bg) 80%, transparent)', border:'1px solid var(--mf-border)', borderRadius: 'var(--mf-r-sm)', color:'var(--mf-text)', fontSize: 'var(--mf-t-sm)', outline:'none' };

  return (
    <PageShell icon={pageIcon} title="Caçador de Virais" subtitle="Mine os vídeos mais virais do seu nicho direto da API do Instagram" accent="cyan" actions={pageActions}>

      {/* Search form */}
      <form onSubmit={search} style={{ ...cardStyle, padding:'16px', marginBottom:14 }}>
        <div style={{ display:'flex', gap:10, flexWrap:'wrap', alignItems:'center' }}>
          <div style={{ flex:1, minWidth:200, position:'relative' }}>
            <span style={{ position:'absolute', left:10, top:'50%', transform:'translateY(-50%)', color:'var(--mf-mod, var(--mf-accent-500))', fontSize: 'var(--mf-t-h2)', fontWeight:700, pointerEvents:'none' }}>#</span>
            <input
              style={inputStyle}
              placeholder="hot"
              value={hashtag}
              onChange={e => setHashtag(e.target.value.replace(/^#/, ''))}
            />
          </div>

          <button type="submit" className="btn-primary" style={{ flexShrink:0, height:38, padding:'0 16px', borderRadius: 'var(--mf-r-sm)', opacity:(loading || !hashtag.trim()) ? .5 : 1 }} disabled={loading || !hashtag.trim()}>
            {loading ? '⏳ Minerando...' : '⚡ Minerar virais'}
          </button>
        </div>
        <div style={{ marginTop:10, fontSize: 'var(--mf-t-micro)', color:'var(--mf-text-3)', display:'flex', alignItems:'center', gap:6 }}>
          <span>📡</span>
          Busca via Instagram Graph API · apenas vídeos · download com qualidade 100% original · requer conta com API conectada
        </div>
      </form>

      {/* Error */}
      {error && (() => {
        const isTokenErr = /oauth|cannot parse|invalid.*token/i.test(error);
        const isNoAcct   = /nenhuma conta/i.test(error);
        return (
          <div style={{ background:'color-mix(in oklch, var(--mf-danger-500) 9%, transparent)', border:'1px solid oklch(0.38 0.12 15 / 0.35)', borderRadius: 'var(--mf-r-md)', padding:'12px 16px', marginBottom:14 }}>
            <div style={{ color:'var(--mf-danger-500)', fontSize: 'var(--mf-t-sm)', fontWeight:700, marginBottom:8 }}>⚠️ {error}</div>
            {isTokenErr && (
              <div style={{ fontSize: 'var(--mf-t-xs)', color:'var(--mf-text-2)', lineHeight:1.7 }}>
                A busca por hashtags usa o endpoint <code style={{ background:'var(--mf-bg)', padding:'2px 4px', borderRadius: 'var(--mf-r-xs)' }}>ig_hashtag_search</code> da Meta.
                Acesse <a href="/accounts" style={{ color:'var(--mf-mod, var(--mf-accent-500))' }}>Contas</a> e reconecte sua conta.
              </div>
            )}
            {isNoAcct && (
              <div style={{ fontSize: 'var(--mf-t-xs)', color:'var(--mf-text-2)', lineHeight:1.6 }}>
                Nenhuma conta conectada via Instagram Graph API. Acesse <a href="/accounts" style={{ color:'var(--mf-mod, var(--mf-accent-500))' }}>Contas</a> e conecte uma conta Business/Creator.
              </div>
            )}
          </div>
        );
      })()}

      {/* Empty states */}
      {!searched && !error && (
        <div style={{ textAlign:'center', padding:'60px 16px', background:'color-mix(in oklch, var(--mf-surface-1) 50%, transparent)', border:'1px solid var(--mf-border)', borderRadius: 'var(--mf-r-lg)' }}>
          <div style={{ fontSize: 'var(--mf-t-display)', marginBottom:12 }}>⚡</div>
          <div style={{ fontWeight:700, fontSize: 'var(--mf-t-h2)', color:'var(--mf-text)', marginBottom:6 }}>Pronto para minerar</div>
          <div style={{ fontSize: 'var(--mf-t-sm)', color:'var(--mf-text-3)' }}>Digite uma hashtag do seu nicho e clique em Minerar para encontrar os vídeos mais virais.</div>
        </div>
      )}

      {searched && !loading && !error && items.length === 0 && (
        <div style={{ textAlign:'center', padding:'60px 16px', background:'color-mix(in oklch, var(--mf-surface-1) 50%, transparent)', border:'1px solid var(--mf-border)', borderRadius: 'var(--mf-r-lg)' }}>
          <div style={{ fontSize: 'var(--mf-t-display)', marginBottom:12 }}>🎬</div>
          <div style={{ fontWeight:700, fontSize: 'var(--mf-t-h2)', color:'var(--mf-text)', marginBottom:6 }}>Nenhum vídeo encontrado</div>
          <div style={{ fontSize: 'var(--mf-t-sm)', color:'var(--mf-text-3)' }}>Sem vídeos nessa hashtag ou a conta não tem permissão para buscar este conteúdo.</div>
        </div>
      )}

      {/* Meta info */}
      {meta && items.length > 0 && (
        <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:12, fontSize: 'var(--mf-t-xs)', color:'var(--mf-text-2)' }}>
          <span style={{ fontWeight:700, color:'var(--mf-mod, var(--mf-accent-500))', fontSize: 'var(--mf-t-body)' }}>#{meta.hashtag}</span>
          <span>·</span>
          <span>{meta.videos} vídeos encontrados de {meta.total} posts</span>
          <span>·</span>
          <span style={{ color:'var(--mf-success-500)' }}>● API Graph</span>
        </div>
      )}

      {/* Cards grid */}
      {loading && <EsqueletoGrade itens={8} minimo={180} />}

      {items.length > 0 && (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(180px,1fr))', gap:10 }}>
          {items.map((v, idx) => {
            const isLoading = downloading === v.igMediaId;
            const isDone    = !!done[v.igMediaId];
            const thumb     = proxyImg(v.thumbnailUrl);
            const age       = v.postedAt ? Math.round((Date.now() - new Date(v.postedAt)) / 86400000) : null;

            return (
              <motion.div
                key={v.igMediaId}
                initial={{ opacity:0, y:6 }}
                animate={{ opacity:1, y:0 }}
                transition={{ delay:idx*.03, duration:.18 }}
                style={{ ...cardStyle, borderRadius: 'var(--mf-r-md)' }}
              >
                <div style={{ height:3, background: idx < 3 ? 'linear-gradient(90deg,var(--mf-mod, var(--mf-accent-500)),oklch(0.68 0.18 270))' : 'var(--mf-border)' }} />

                <div style={{ height:130, background:'linear-gradient(135deg,var(--mf-bg),var(--mf-surface-1))', display:'flex', alignItems:'center', justifyContent:'center', position:'relative', overflow:'hidden' }}>
                  {thumb
                    ? <img src={thumb} alt="" style={{ width:'100%', height:'100%', objectFit:'cover' }} onError={e => { e.target.style.display='none'; }} />
                    : <span style={{ fontSize: 'var(--mf-t-display)' }}>🎬</span>
                  }
                  <div style={{ position:'absolute', top:8, left:8 }}>
                    <span style={{ fontSize: 'var(--mf-t-nano)', fontWeight:800, padding:'2px 8px', borderRadius: 'var(--mf-r-md)', background: idx < 3 ? 'oklch(0.72 0.19 196 / 0.9)' : 'oklch(0 0 0 / 0.6)', color: idx < 3 ? 'var(--mf-bg)' : '#aaa' }}>#{idx + 1}</span>
                  </div>
                  {isDone && (
                    <div style={{ position:'absolute', inset:0, background:'oklch(0.72 0.18 150 / 0.25)', display:'flex', alignItems:'center', justifyContent:'center' }}>
                      <div style={{ width:44, height:44, borderRadius: 'var(--mf-r-full)', background:'oklch(0.72 0.18 150 / 0.9)', display:'flex', alignItems:'center', justifyContent:'center', fontSize: 'var(--mf-t-h1)' }}>✓</div>
                    </div>
                  )}
                </div>

                <div style={{ padding:'8px 12px 12px' }}>
                  {age !== null && <div style={{ fontSize: 'var(--mf-t-nano)', color:'var(--mf-text-3)', marginBottom:6 }}>Postado há {age}d</div>}
                  {v.caption && (
                    <div style={{ fontSize: 'var(--mf-t-micro)', color:'var(--mf-text-2)', marginBottom:8, lineHeight:1.4, display:'-webkit-box', WebkitLineClamp:2, WebkitBoxOrient:'vertical', overflow:'hidden' }}>
                      {v.caption}
                    </div>
                  )}
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'4px 8px', marginBottom:10, fontSize: 'var(--mf-t-xs)' }}>
                    <div style={{ display:'flex', alignItems:'center', gap:4 }}><span style={{ fontSize: 'var(--mf-t-micro)' }}>❤️</span><strong>{fmtK(v.likeCount)}</strong></div>
                    <div style={{ display:'flex', alignItems:'center', gap:4 }}><span style={{ fontSize: 'var(--mf-t-micro)' }}>💬</span><strong>{fmtK(v.commentsCount)}</strong></div>
                  </div>
                  <div style={{ display:'flex', gap:6 }}>
                    <button className={isDone ? 'btn-ghost' : 'btn-primary'} style={{ flex:1, height:32, borderRadius: 'var(--mf-r-sm)', fontSize: 'var(--mf-t-micro)' }} onClick={() => handleDownload(v)} disabled={isLoading || isDone}>
                      {isLoading ? '⏳ Baixando...' : isDone ? '✓ Baixado' : '⬇ Baixar HD'}
                    </button>
                    {v.permalink && (
                      <a href={v.permalink} target="_blank" rel="noreferrer" className="btn-ghost" style={{ height:32, width:32, borderRadius: 'var(--mf-r-sm)', display:'flex', alignItems:'center', justifyContent:'center', fontSize: 'var(--mf-t-sm)' }}>↗</a>
                    )}
                    {isDone && done[v.igMediaId] && (
                      <a href={`${API_BASE}${done[v.igMediaId]}`} download className="btn-ghost" style={{ height:32, width:32, borderRadius: 'var(--mf-r-sm)', display:'flex', alignItems:'center', justifyContent:'center' }}>💾</a>
                    )}
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Footer info */}
      {(items.length > 0 || searched) && (
        <div style={{ marginTop:14, ...cardStyle, padding:'12px 16px', display:'flex', alignItems:'flex-start', gap:14 }}>
          <div style={{ fontSize: 'var(--mf-t-h1)', flexShrink:0 }}>🔒</div>
          <div>
            <div style={{ fontWeight:600, fontSize: 'var(--mf-t-sm)', marginBottom:3 }}>Download via CDN oficial — qualidade 100% original</div>
            <div style={{ fontSize: 'var(--mf-t-xs)', color:'var(--mf-text-2)', lineHeight:1.6 }}>
              Os vídeos são encontrados via <strong>Instagram Graph API</strong> e baixados diretamente do CDN oficial do Meta. As URLs expiram em minutos — baixe logo após a busca.
            </div>
          </div>
        </div>
      )}
    </PageShell>
  );
}
