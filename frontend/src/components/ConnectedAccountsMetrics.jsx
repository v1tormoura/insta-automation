import { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Globe, Users, Flame, Eye, RefreshCw, ChevronDown, ChevronUp, ExternalLink, Play } from 'lucide-react';
import api from '../services/api';

const fmt = v => Number(v || 0).toLocaleString('pt-BR');
const fmtK = v => {
  const n = Number(v || 0);
  return n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(n);
};

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000';
const proxyImg = url => {
  if (!url) return '';
  if (url.startsWith('/uploads/')) return `${API_BASE}${url}`;
  return `${API_BASE}/image-proxy?url=${encodeURIComponent(url)}`;
};

export default function ConnectedAccountsMetrics() {
  const [metrics, setMetrics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [period, setPeriod] = useState('30d');
  const [showAccountsDetail, setShowAccountsDetail] = useState(false);
  const [coletandoStories, setColetandoStories] = useState(false);

  const loadMetrics = useCallback(async (force = false) => {
    try {
      if (force) setRefreshing(true);
      setError(null);
      const res = await api.get('/analytics/global-metrics', {
        params: { period, force: force ? 'true' : undefined },
      });
      setMetrics(res.data);
    } catch (err) {
      console.error('[ConnectedAccountsMetrics]', err);
      setError('Não foi possível carregar as métricas das contas conectadas.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [period]);

  /**
   * Coleta a audiência dos stories AGORA e recarrega o painel.
   *
   * O ciclo automático roda a cada 30 min, mas story vive 24h e some sem aviso.
   * Quem acabou de publicar precisa conseguir puxar o número na hora, em vez de
   * esperar a próxima volta sem saber se funcionou.
   */
  const coletarStories = useCallback(async () => {
    setColetandoStories(true);
    try {
      await api.post('/analytics/story-insights/sync');
      await loadMetrics(true);
    } catch (err) {
      console.error('[StoryInsights]', err);
      setError('Não foi possível coletar as visualizações dos stories.');
    } finally {
      setColetandoStories(false);
    }
  }, [loadMetrics]);

  useEffect(() => {
    loadMetrics();
  }, [loadMetrics]);

  if (loading && !metrics) {
    return (
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
        gap: 12,
        marginBottom: 18,
      }}>
        {[1, 2, 3, 4].map(i => (
          <div key={i} style={{
            background: 'oklch(0.14 0.04 235 / 0.7)',
            borderRadius: 14,
            padding: 16,
            height: 110,
            border: '1px solid oklch(1 0 0 / 0.06)',
            animation: 'pulse 1.5s infinite',
          }} />
        ))}
      </div>
    );
  }

  if (error && !metrics) {
    return (
      <div style={{
        background: 'rgba(239, 68, 68, 0.08)',
        border: '1px solid rgba(239, 68, 68, 0.2)',
        borderRadius: 14,
        padding: '12px 16px',
        marginBottom: 16,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        fontSize: 12,
        color: '#fca5a5',
      }}>
        <span>{error}</span>
        <button onClick={() => loadMetrics(true)} className="btn btn-ghost btn-sm" style={{ fontSize: 11 }}>
          Tentar novamente
        </button>
      </div>
    );
  }

  const d = metrics || {};
  const noAccounts = (d.connectedAccountsCount || 0) === 0;

  return (
    <div style={{ marginBottom: 18 }}>
      {/* ── Cabeçalho do Módulo ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--cyan)', boxShadow: '0 0 10px var(--cyan)' }} />
          <h2 style={{ fontSize: 12, fontWeight: 750, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text2)', margin: 0 }}>
            Métricas Globais · Contas Conectadas
          </h2>
          <span style={{ fontSize: 10.5, fontFamily: 'var(--font-mono)', padding: '2px 8px', borderRadius: 6, background: 'rgba(0,212,255,0.08)', color: 'var(--cyan)', border: '1px solid rgba(0,212,255,0.2)' }}>
            {d.periodLabel || 'Últimos 30 dias'}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <select
            value={period}
            onChange={e => setPeriod(e.target.value)}
            style={{
              background: 'oklch(0.12 0.04 235)',
              border: '1px solid oklch(1 0 0 / 0.1)',
              borderRadius: 7,
              color: 'var(--text2)',
              fontSize: 11,
              padding: '4px 8px',
              cursor: 'pointer',
            }}
          >
            <option value="7d">7 dias</option>
            <option value="30d">30 dias</option>
            <option value="90d">90 dias</option>
          </select>

          <button
            type="button"
            onClick={() => loadMetrics(true)}
            title="Atualizar métricas agora"
            style={{
              background: 'oklch(1 0 0 / 0.04)',
              border: '1px solid oklch(1 0 0 / 0.08)',
              borderRadius: 7,
              padding: '5px 8px',
              color: 'var(--text3)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 11,
            }}
          >
            <RefreshCw size={12} style={{ animation: refreshing ? 'dash-spin .7s linear infinite' : 'none' }} />
            <span style={{ display: 'none' }}>Atualizar</span>
          </button>
        </div>
      </div>

      {noAccounts ? (
        <div style={{
          background: 'oklch(0.14 0.04 235 / 0.6)',
          border: '1px dashed oklch(1 0 0 / 0.12)',
          borderRadius: 14,
          padding: '24px 16px',
          textAlign: 'center',
          color: 'var(--text3)',
          fontSize: 12,
        }}>
          Nenhuma conta conectada no momento. Conecte uma conta para visualizar alcance, seguidores e o melhor post.
        </div>
      ) : (
        <>
          {/* ── Grid dos 4 Cards Principais ── */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
            gap: 10,
          }}>
            {/* Card 1: Alcance Total */}
            <div style={{
              background: 'oklch(0.15 0.05 235 / 0.8)',
              border: '1px solid oklch(1 0 0 / 0.08)',
              borderRadius: 14,
              padding: '14px 16px',
              position: 'relative',
              overflow: 'hidden',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.06em', color: 'var(--text3)', textTransform: 'uppercase' }}>
                  Alcance total
                </span>
                <Globe size={16} style={{ color: 'var(--cyan)', opacity: 0.9 }} />
              </div>
              <div style={{ fontSize: 20, fontWeight: 800, color: '#fff', fontFamily: 'var(--font-mono)', letterSpacing: '-.02em' }}>
                {fmt(d.totalReach)}
              </div>
              <div style={{ fontSize: 10.5, color: 'var(--text3)', marginTop: 4 }}>
                {d.connectedAccountsCount} {d.connectedAccountsCount === 1 ? 'conta conectada' : 'contas conectadas'}
              </div>
            </div>

            {/* Card 2: Seguidores Totais */}
            <div style={{
              background: 'oklch(0.15 0.05 235 / 0.8)',
              border: '1px solid oklch(1 0 0 / 0.08)',
              borderRadius: 14,
              padding: '14px 16px',
              position: 'relative',
              overflow: 'hidden',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.06em', color: 'var(--text3)', textTransform: 'uppercase' }}>
                  Seguidores totais
                </span>
                <Users size={16} style={{ color: '#34d399', opacity: 0.9 }} />
              </div>
              <div style={{ fontSize: 20, fontWeight: 800, color: '#34d399', fontFamily: 'var(--font-mono)', letterSpacing: '-.02em' }}>
                {fmt(d.totalFollowers)}
              </div>
              <div style={{ fontSize: 10.5, color: 'var(--text3)', marginTop: 4 }}>
                Audiência atual acumulada
              </div>
            </div>

            {/* Card 3: Melhor Post */}
            <div style={{
              background: 'oklch(0.15 0.05 235 / 0.8)',
              border: '1px solid oklch(1 0 0 / 0.08)',
              borderRadius: 14,
              padding: '12px 14px',
              position: 'relative',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
            }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.06em', color: 'var(--text3)', textTransform: 'uppercase' }}>
                    Melhor post
                  </span>
                  <Flame size={16} style={{ color: '#f59e0b' }} />
                </div>

                {d.bestPost ? (
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 4 }}>
                    <div style={{
                      width: 38,
                      height: 48,
                      borderRadius: 6,
                      background: 'oklch(0.10 0.03 235)',
                      overflow: 'hidden',
                      flexShrink: 0,
                      position: 'relative',
                      border: '1px solid oklch(1 0 0 / 0.1)',
                    }}>
                      {d.bestPost.thumbnailUrl ? (
                        <img
                          src={proxyImg(d.bestPost.thumbnailUrl)}
                          alt=""
                          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                          onError={e => { e.target.style.display = 'none'; }}
                        />
                      ) : (
                        <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text3)' }}>
                          <Play size={14} />
                        </div>
                      )}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--cyan)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        @{d.bestPost.username}
                      </div>
                      <div style={{ fontSize: 14, fontWeight: 800, color: '#fff', fontFamily: 'var(--font-mono)' }}>
                        {fmt(d.bestPost.videoViews)} <span style={{ fontSize: 9.5, fontWeight: 500, color: 'var(--text3)' }}>views</span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div style={{ fontSize: 11, color: 'var(--text3)', padding: '6px 0' }}>
                    Nenhum post no período
                  </div>
                )}
              </div>

              {/* Botão para ver detalhamento por conta */}
              {d.bestPostByAccount?.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowAccountsDetail(!showAccountsDetail)}
                  style={{
                    marginTop: 6,
                    padding: '3px 0',
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--cyan)',
                    fontSize: 10,
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 3,
                  }}
                >
                  {showAccountsDetail ? 'Ocultar detalhes' : 'Ver por conta'}
                  {showAccountsDetail ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                </button>
              )}
            </div>

            {/* Card 4: Visualizações dos Stories */}
            <div style={{
              background: 'oklch(0.15 0.05 235 / 0.8)',
              border: '1px solid oklch(1 0 0 / 0.08)',
              borderRadius: 14,
              padding: '14px 16px',
              position: 'relative',
              overflow: 'hidden',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.06em', color: 'var(--text3)', textTransform: 'uppercase' }}>
                  Stories
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <button
                    onClick={coletarStories}
                    disabled={coletandoStories}
                    title="Coletar as visualizações dos stories ativos agora"
                    style={{
                      background: 'transparent', border: 'none', padding: 0,
                      cursor: coletandoStories ? 'default' : 'pointer',
                      color: '#a78bfa', opacity: coletandoStories ? 0.5 : 0.75,
                      display: 'flex', alignItems: 'center',
                    }}>
                    <RefreshCw size={12} style={coletandoStories
                      ? { animation: 'spin 1s linear infinite' } : undefined} />
                  </button>
                  <Eye size={16} style={{ color: '#a78bfa', opacity: 0.9 }} />
                </div>
              </div>
              <div style={{ fontSize: 20, fontWeight: 800, color: '#a78bfa', fontFamily: 'var(--font-mono)', letterSpacing: '-.02em' }}>
                {fmt(d.totalStoryViews)}
              </div>
              <div style={{ fontSize: 10.5, color: 'var(--text3)', marginTop: 4 }}>
                {coletandoStories ? 'Coletando…' : 'Visualizações nos stories'}
              </div>
            </div>
          </div>

          {/* ── Detalhamento: Melhor Post por Conta ── */}
          <AnimatePresence>
            {showAccountsDetail && d.bestPostByAccount?.length > 0 && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.2 }}
                style={{
                  marginTop: 12,
                  background: 'oklch(0.13 0.04 235 / 0.9)',
                  border: '1px solid oklch(1 0 0 / 0.08)',
                  borderRadius: 12,
                  padding: 12,
                  overflow: 'hidden',
                }}
              >
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text2)', marginBottom: 8, display: 'flex', justifyContent: 'space-between' }}>
                  <span>Melhor post de cada conta conectada:</span>
                  <span style={{ fontSize: 10, color: 'var(--text3)' }}>{d.bestPostByAccount.length} contas</span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 8 }}>
                  {d.bestPostByAccount.map(acc => (
                    <div
                      key={acc.accountId}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        background: 'oklch(0.11 0.03 235)',
                        border: '1px solid oklch(1 0 0 / 0.06)',
                        borderRadius: 8,
                        padding: '6px 10px',
                      }}
                    >
                      {acc.thumbnailUrl ? (
                        <img
                          src={proxyImg(acc.thumbnailUrl)}
                          alt=""
                          style={{ width: 28, height: 36, borderRadius: 4, objectFit: 'cover', flexShrink: 0 }}
                          onError={e => { e.target.style.display = 'none'; }}
                        />
                      ) : (
                        <div style={{ width: 28, height: 36, borderRadius: 4, background: 'oklch(1 0 0 / 0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text3)', fontSize: 9 }}>
                          —
                        </div>
                      )}

                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          @{acc.username}
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--cyan)', fontFamily: 'var(--font-mono)' }}>
                          {acc.hasPost ? `${fmt(acc.videoViews)} views` : 'Sem posts no período'}
                        </div>
                      </div>

                      {acc.permalink && (
                        <a
                          href={acc.permalink}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="Abrir no Instagram"
                          style={{ color: 'var(--text3)', padding: 4 }}
                        >
                          <ExternalLink size={12} />
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}
    </div>
  );
}
