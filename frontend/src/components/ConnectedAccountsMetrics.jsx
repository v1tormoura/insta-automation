import { useEffect, useState, useCallback, useRef } from 'react';
import { useServerEvents } from '../services/useServerEvents';
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
  const [atualizadoEm, setAtualizadoEm] = useState(null);
  const carregandoRef = useRef(false);

  /* `carregandoRef` impede chamadas sobrepostas. Sem ele, uma rajada de
     eventos do servidor — publicar em oito contas dispara oito — abriria
     oito requisições da mesma métrica, e a última a responder venceria, que
     não é necessariamente a mais recente. */
  const loadMetrics = useCallback(async (force = false) => {
    if (carregandoRef.current && !force) return;
    carregandoRef.current = true;
    try {
      if (force) setRefreshing(true);
      setError(null);
      const res = await api.get('/analytics/global-metrics', {
        params: { period, force: force ? 'true' : undefined },
      });
      setMetrics(res.data);
      setAtualizadoEm(Date.now());
    } catch (err) {
      console.error('[ConnectedAccountsMetrics]', err);
      setError('Não foi possível carregar as métricas das contas conectadas.');
    } finally {
      carregandoRef.current = false;
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

  /* ── Atualização contínua ────────────────────────────────────────────────
     Duas fontes, porque nenhuma das duas basta sozinha.

     Os eventos do servidor chegam no instante em que algo acontece — uma
     publicação sai, uma conta conecta — e são o que faz o número mudar na
     frente do usuário sem ele pedir. Mas eles só falam de fatos NOSSOS: a
     visualização de um post subir de 900 para 1200 acontece no Instagram, e
     nenhum evento nosso avisa.

     Daí o intervalo: ele cobre justamente o que muda fora daqui. Um minuto
     é curto para o número parecer parado e longo o bastante para não pesar —
     a rota agrega várias coleções por chamada.

     `document.hidden` para a aba em segundo plano. Sem isso, dez abas
     esquecidas abertas viram dez agregações por minuto no servidor, e
     ninguém está olhando para nenhuma delas. */
  useServerEvents(['insights', 'posts', 'accounts'], () => {
    if (document.hidden) return;
    loadMetrics();
  });

  useEffect(() => {
    const id = setInterval(() => {
      if (document.hidden) return;
      loadMetrics();
    }, 60_000);

    /* Ao voltar para a aba, atualiza na hora: quem volta depois de um tempo
       encontraria números velhos até o próximo intervalo. */
    const aoVoltar = () => { if (!document.hidden) loadMetrics(); };
    document.addEventListener('visibilitychange', aoVoltar);

    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', aoVoltar);
    };
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
            background: 'color-mix(in oklch, var(--mf-surface-1) 70%, transparent)',
            borderRadius: 'var(--mf-r-lg)',
            padding: 16,
            height: 110,
            border: '1px solid var(--mf-border)',
            animation: 'pulse 1.5s infinite',
          }} />
        ))}
      </div>
    );
  }

  if (error && !metrics) {
    return (
      <div style={{
        background: 'color-mix(in oklch, var(--mf-danger-500) 8%, transparent)',
        border: '1px solid color-mix(in oklch, var(--mf-danger-500) 20%, transparent)',
        borderRadius: 'var(--mf-r-lg)',
        padding: '12px 16px',
        marginBottom: 16,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        fontSize: 'var(--mf-t-xs)',
        color: 'var(--mf-danger-500)',
      }}>
        <span>{error}</span>
        <button onClick={() => loadMetrics(true)} className="btn btn-ghost btn-sm" style={{ fontSize: 'var(--mf-t-micro)' }}>
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
          <span style={{ width: 8, height: 8, borderRadius: 'var(--mf-r-full)', background: 'var(--mf-mod, var(--mf-accent-500))', boxShadow: '0 0 10px var(--mf-mod, var(--mf-accent-500))' }} />
          <h2 style={{ fontSize: 'var(--mf-t-xs)', fontWeight: 750, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--mf-text-2)', margin: 0 }}>
            Métricas Globais · Contas Conectadas
          </h2>
          <span style={{ fontSize: 'var(--mf-t-nano)', fontFamily: 'var(--mf-mono)', padding: '2px 8px', borderRadius: 'var(--mf-r-sm)', background: 'color-mix(in oklch, var(--mf-mod-contas) 8%, transparent)', color: 'var(--mf-mod, var(--mf-accent-500))', border: '1px solid color-mix(in oklch, var(--mf-mod-contas) 20%, transparent)' }}>
            {d.periodLabel || 'Últimos 30 dias'}
          </span>
          {/* Diz que o painel se atualiza sozinho. Sem isso o usuário fica
              clicando em atualizar por não ter como saber que não precisa. */}
          {atualizadoEm && (
            <span title={`Atualizado às ${new Date(atualizadoEm).toLocaleTimeString('pt-BR')}`}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 'var(--mf-t-nano)',
                color: 'var(--mf-text-3)', whiteSpace: 'nowrap' }}>
              <span style={{ width: 6, height: 6, borderRadius: 'var(--mf-r-full)', background: 'var(--mf-success-500)',
                animation: 'mf-pulse 2s var(--mf-ease-inout) infinite' }} />
              ao vivo
            </span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <select
            value={period}
            onChange={e => setPeriod(e.target.value)}
            style={{
              background: 'var(--mf-bg)',
              border: '1px solid var(--mf-border)',
              borderRadius: 'var(--mf-r-sm)',
              color: 'var(--mf-text-2)',
              fontSize: 'var(--mf-t-micro)',
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
              background: 'var(--mf-border-subtle)',
              border: '1px solid var(--mf-border)',
              borderRadius: 'var(--mf-r-sm)',
              padding: '4px 8px',
              color: 'var(--mf-text-3)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 'var(--mf-t-micro)',
            }}
          >
            <RefreshCw size={12} style={{ animation: refreshing ? 'dash-spin .7s linear infinite' : 'none' }} />
            <span style={{ display: 'none' }}>Atualizar</span>
          </button>
        </div>
      </div>

      {noAccounts ? (
        <div style={{
          background: 'color-mix(in oklch, var(--mf-surface-1) 60%, transparent)',
          border: '1px dashed var(--mf-border-strong)',
          borderRadius: 'var(--mf-r-lg)',
          padding: '24px 16px',
          textAlign: 'center',
          color: 'var(--mf-text-3)',
          fontSize: 'var(--mf-t-xs)',
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
            {/* Visualizações somadas de todas as contas conectadas.
                Alcance conta PESSOAS, visualização conta REPRODUÇÕES — a
                mesma pessoa vendo três vezes soma um no primeiro e três no
                segundo. Mostrar só o alcance escondia o número que responde
                "quanto o conteúdo rodou". */}
            <div style={{
              background: 'var(--mf-surface-1)',
              border: '1px solid var(--mf-border)',
              borderRadius: 'var(--mf-r-lg)',
              padding: '12px 16px',
              position: 'relative',
              overflow: 'hidden',
            }}>
              <span aria-hidden="true" style={{ position: 'absolute', inset: 'auto -10px -14px auto', width: 58, height: 58,
                borderRadius: 'var(--mf-r-full)', background: 'radial-gradient(circle, color-mix(in oklch, var(--mf-mod-metricas) 16%, transparent), transparent 70%)' }} />
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontSize: 'var(--mf-t-nano)', fontWeight: 700, letterSpacing: '.06em', color: 'var(--mf-text-3)', textTransform: 'uppercase' }}>
                  Visualizações
                </span>
                <Eye size={16} style={{ color: 'var(--mf-mod-metricas)', opacity: 0.9 }} />
              </div>
              <div style={{ fontSize: 'var(--mf-t-h1)', fontWeight: 800, color: 'var(--mf-mod-metricas)', fontFamily: 'var(--mf-mono)', letterSpacing: '-.02em', position: 'relative', zIndex: 1 }}>
                {fmt(d.totalViews)}
              </div>
              <div style={{ fontSize: 'var(--mf-t-nano)', color: 'var(--mf-text-3)', marginTop: 4 }}>
                Reproduções somadas de todas as contas
              </div>
            </div>

            {/* Card 1: Alcance Total */}
            <div style={{
              background: 'color-mix(in oklch, var(--mf-surface-1) 80%, transparent)',
              border: '1px solid var(--mf-border)',
              borderRadius: 'var(--mf-r-lg)',
              padding: '12px 16px',
              position: 'relative',
              overflow: 'hidden',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontSize: 'var(--mf-t-nano)', fontWeight: 700, letterSpacing: '.06em', color: 'var(--mf-text-3)', textTransform: 'uppercase' }}>
                  Alcance total
                </span>
                <Globe size={16} style={{ color: 'var(--mf-mod, var(--mf-accent-500))', opacity: 0.9 }} />
              </div>
              <div style={{ fontSize: 'var(--mf-t-h1)', fontWeight: 800, color: 'var(--mf-text)', fontFamily: 'var(--mf-mono)', letterSpacing: '-.02em' }}>
                {fmt(d.totalReach)}
              </div>
              <div style={{ fontSize: 'var(--mf-t-nano)', color: 'var(--mf-text-3)', marginTop: 4 }}>
                {d.connectedAccountsCount} {d.connectedAccountsCount === 1 ? 'conta conectada' : 'contas conectadas'}
              </div>
            </div>

            {/* Card 2: Seguidores Totais */}
            <div style={{
              background: 'color-mix(in oklch, var(--mf-surface-1) 80%, transparent)',
              border: '1px solid var(--mf-border)',
              borderRadius: 'var(--mf-r-lg)',
              padding: '12px 16px',
              position: 'relative',
              overflow: 'hidden',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontSize: 'var(--mf-t-nano)', fontWeight: 700, letterSpacing: '.06em', color: 'var(--mf-text-3)', textTransform: 'uppercase' }}>
                  Seguidores totais
                </span>
                <Users size={16} style={{ color: 'var(--mf-success-500)', opacity: 0.9 }} />
              </div>
              <div style={{ fontSize: 'var(--mf-t-h1)', fontWeight: 800, color: 'var(--mf-success-500)', fontFamily: 'var(--mf-mono)', letterSpacing: '-.02em' }}>
                {fmt(d.totalFollowers)}
              </div>
              <div style={{ fontSize: 'var(--mf-t-nano)', color: 'var(--mf-text-3)', marginTop: 4 }}>
                Audiência atual acumulada
              </div>
            </div>

            {/* Card 3: Melhor Post */}
            <div style={{
              background: 'color-mix(in oklch, var(--mf-surface-1) 80%, transparent)',
              border: '1px solid var(--mf-border)',
              borderRadius: 'var(--mf-r-lg)',
              padding: '12px 12px',
              position: 'relative',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
            }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: 'var(--mf-t-nano)', fontWeight: 700, letterSpacing: '.06em', color: 'var(--mf-text-3)', textTransform: 'uppercase' }}>
                    Melhor post
                  </span>
                  <Flame size={16} style={{ color: 'var(--mf-warning-500)' }} />
                </div>

                {d.bestPost ? (
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 4 }}>
                    <div style={{
                      width: 38,
                      height: 48,
                      borderRadius: 'var(--mf-r-sm)',
                      background: 'var(--mf-bg)',
                      overflow: 'hidden',
                      flexShrink: 0,
                      position: 'relative',
                      border: '1px solid var(--mf-border)',
                    }}>
                      {d.bestPost.thumbnailUrl ? (
                        <img
                          src={proxyImg(d.bestPost.thumbnailUrl)}
                          alt=""
                          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                          onError={e => { e.target.style.display = 'none'; }}
                        />
                      ) : (
                        <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--mf-text-3)' }}>
                          <Play size={14} />
                        </div>
                      )}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 'var(--mf-t-micro)', fontWeight: 700, color: 'var(--mf-mod, var(--mf-accent-500))', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        @{d.bestPost.username}
                      </div>
                      <div style={{ fontSize: 'var(--mf-t-body)', fontWeight: 800, color: 'var(--mf-text)', fontFamily: 'var(--mf-mono)' }}>
                        {fmt(d.bestPost.videoViews)} <span style={{ fontSize: 'var(--mf-t-nano)', fontWeight: 500, color: 'var(--mf-text-3)' }}>views</span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div style={{ fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text-3)', padding: '4px 0' }}>
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
                    padding: '2px 0',
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--mf-mod, var(--mf-accent-500))',
                    fontSize: 'var(--mf-t-nano)',
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
              background: 'color-mix(in oklch, var(--mf-surface-1) 80%, transparent)',
              border: '1px solid var(--mf-border)',
              borderRadius: 'var(--mf-r-lg)',
              padding: '12px 16px',
              position: 'relative',
              overflow: 'hidden',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontSize: 'var(--mf-t-nano)', fontWeight: 700, letterSpacing: '.06em', color: 'var(--mf-text-3)', textTransform: 'uppercase' }}>
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
                      color: 'var(--mf-mod-publicar)', opacity: coletandoStories ? 0.5 : 0.75,
                      display: 'flex', alignItems: 'center',
                    }}>
                    <RefreshCw size={12} style={coletandoStories
                      ? { animation: 'spin 1s linear infinite' } : undefined} />
                  </button>
                  <Eye size={16} style={{ color: 'var(--mf-mod-publicar)', opacity: 0.9 }} />
                </div>
              </div>
              <div style={{ fontSize: 'var(--mf-t-h1)', fontWeight: 800, color: 'var(--mf-mod-publicar)', fontFamily: 'var(--mf-mono)', letterSpacing: '-.02em' }}>
                {fmt(d.totalStoryViews)}
              </div>
              <div style={{ fontSize: 'var(--mf-t-nano)', color: 'var(--mf-text-3)', marginTop: 4 }}>
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
                  background: 'color-mix(in oklch, var(--mf-bg) 90%, transparent)',
                  border: '1px solid var(--mf-border)',
                  borderRadius: 'var(--mf-r-md)',
                  padding: 12,
                  overflow: 'hidden',
                }}
              >
                <div style={{ fontSize: 'var(--mf-t-micro)', fontWeight: 700, color: 'var(--mf-text-2)', marginBottom: 8, display: 'flex', justifyContent: 'space-between' }}>
                  <span>Melhor post de cada conta conectada:</span>
                  <span style={{ fontSize: 'var(--mf-t-nano)', color: 'var(--mf-text-3)' }}>{d.bestPostByAccount.length} contas</span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 8 }}>
                  {d.bestPostByAccount.map(acc => (
                    <div
                      key={acc.accountId}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        background: 'var(--mf-bg)',
                        border: '1px solid var(--mf-border)',
                        borderRadius: 'var(--mf-r-sm)',
                        padding: '4px 8px',
                      }}
                    >
                      {acc.thumbnailUrl ? (
                        <img
                          src={proxyImg(acc.thumbnailUrl)}
                          alt=""
                          style={{ width: 28, height: 36, borderRadius: 'var(--mf-r-xs)', objectFit: 'cover', flexShrink: 0 }}
                          onError={e => { e.target.style.display = 'none'; }}
                        />
                      ) : (
                        <div style={{ width: 28, height: 36, borderRadius: 'var(--mf-r-xs)', background: 'var(--mf-border-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--mf-text-3)', fontSize: 'var(--mf-t-nano)' }}>
                          —
                        </div>
                      )}

                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 'var(--mf-t-micro)', fontWeight: 700, color: 'var(--mf-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          @{acc.username}
                        </div>
                        <div style={{ fontSize: 'var(--mf-t-nano)', color: 'var(--mf-mod, var(--mf-accent-500))', fontFamily: 'var(--mf-mono)' }}>
                          {acc.hasPost ? `${fmt(acc.videoViews)} views` : 'Sem posts no período'}
                        </div>
                      </div>

                      {acc.permalink && (
                        <a
                          href={acc.permalink}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="Abrir no Instagram"
                          style={{ color: 'var(--mf-text-3)', padding: 4 }}
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
