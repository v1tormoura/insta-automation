import { useEffect, useState, useCallback } from 'react';
import api from '../services/api';
import './Promo.css';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000';
const avatarSrc = av => av
  ? (av.startsWith('http') ? `${API_BASE}/image-proxy?url=${encodeURIComponent(av)}` : `${API_BASE}${av}`)
  : null;

function timeAgo(dateStr) {
  if (!dateStr) return null;
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'agora';
  if (m < 60) return `${m}min atrás`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h atrás`;
  return `${Math.floor(h / 24)}d atrás`;
}

const DEFAULT_TEMPLATE = '👇 Acesse meu bot gratuito no Telegram!\n🤖 {link}';

export default function Promo() {
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState({});
  const [testing, setTesting]   = useState({});
  const [toast, setToast]       = useState(null);
  const [configs, setConfigs]   = useState({});

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  };

  const load = useCallback(async () => {
    try {
      const res = await api.get('/promo');
      setAccounts(res.data);
      const cfgs = {};
      res.data.forEach(a => {
        cfgs[a._id] = {
          promoEnabled:        a.promoEnabled        ?? false,
          promoLink:           a.promoLink            || '',
          autoComment:         a.autoComment          ?? true,
          autoCommentTemplate: a.autoCommentTemplate  || DEFAULT_TEMPLATE,
          autoStory:           a.autoStory            ?? false,
          autoBio:             a.autoBio              ?? false,
        };
      });
      setConfigs(cfgs);
    } catch (e) {
      showToast('Erro ao carregar contas', 'error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function patch(id, key, val) {
    setConfigs(prev => ({ ...prev, [id]: { ...prev[id], [key]: val } }));
  }

  async function save(id) {
    setSaving(p => ({ ...p, [id]: true }));
    try {
      await api.post(`/promo/${id}`, configs[id]);
      showToast('Configuração salva!');
      load();
    } catch (e) {
      showToast(e?.response?.data?.error || 'Erro ao salvar', 'error');
    } finally {
      setSaving(p => ({ ...p, [id]: false }));
    }
  }

  async function test(id, feature) {
    const key = `${id}:${feature}`;
    setTesting(p => ({ ...p, [key]: true }));
    try {
      const res = await api.post(`/promo/${id}/test/${feature}`);
      showToast(res.data?.message || 'Teste enviado!');
    } catch (e) {
      showToast(e?.response?.data?.error || `Erro no teste de ${feature}`, 'error');
    } finally {
      setTesting(p => ({ ...p, [key]: false }));
    }
  }

  const hasToken = a => !!(a.accessToken && a.igUserId);

  return (
    <div className="promo-page">
      {toast && (
        <div className={`promo-toast promo-toast--${toast.type}`}>{toast.msg}</div>
      )}

      <div className="promo-header">
        <div className="promo-header-icon">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.8a19.79 19.79 0 01-3.07-8.68A2 2 0 012 0h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.09 7.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 14.92z"/>
          </svg>
        </div>
        <div>
          <h1 className="promo-title">Divulgação Automática</h1>
          <p className="promo-subtitle">Promova seu bot do Telegram automaticamente após cada publicação</p>
        </div>
      </div>

      <div className="promo-info-bar">
        <span className="promo-info-dot" />
        <span>Após cada Reel publicado pelo Loop, o sistema executa as ações ativas automaticamente (aguarda 2 min para indexação)</span>
      </div>

      {loading ? (
        <div className="promo-empty">
          <div className="promo-spinner" />
          <span>Carregando contas...</span>
        </div>
      ) : accounts.length === 0 ? (
        <div className="promo-empty">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text3)' }}>
            <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/>
            <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/>
          </svg>
          <span>Nenhuma conta encontrada. Adicione uma conta em <strong>Contas</strong>.</span>
        </div>
      ) : (
        <div className="promo-grid">
          {accounts.map(acc => {
            const cfg = configs[acc._id] || {};
            const ok  = hasToken(acc);
            const isSav = saving[acc._id];

            return (
              <div key={acc._id} className={`promo-card${cfg.promoEnabled && ok ? ' promo-card--active' : ''}`}>
                {/* Card header */}
                <div className="promo-card-head">
                  <div className="promo-acc-info">
                    {avatarSrc(acc.avatar)
                      ? <img src={avatarSrc(acc.avatar)} alt={acc.username} className="promo-avatar" />
                      : <div className="promo-avatar promo-avatar--placeholder">{(acc.username || '?')[0].toUpperCase()}</div>
                    }
                    <div>
                      <div className="promo-acc-name">@{acc.username}</div>
                      {!ok && <div className="promo-no-token">Sem token OAuth — conecte em Contas</div>}
                      {ok && acc.lastPromoAt && (
                        <div className="promo-last">Última promoção: {timeAgo(acc.lastPromoAt)}</div>
                      )}
                    </div>
                  </div>

                  <label className="promo-toggle" title={ok ? 'Ativar divulgação' : 'Precisa de token OAuth'}>
                    <input
                      type="checkbox"
                      checked={!!cfg.promoEnabled}
                      disabled={!ok}
                      onChange={e => patch(acc._id, 'promoEnabled', e.target.checked)}
                    />
                    <span className="promo-toggle-knob" />
                  </label>
                </div>

                {/* Link Telegram */}
                <div className="promo-field">
                  <label className="promo-label">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/>
                      <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/>
                    </svg>
                    Link do Telegram / URL de destino
                  </label>
                  <input
                    className="promo-input"
                    type="url"
                    placeholder="https://t.me/seubot"
                    value={cfg.promoLink || ''}
                    onChange={e => patch(acc._id, 'promoLink', e.target.value)}
                    disabled={!ok}
                  />
                  <div className="promo-hint">Use <code>{'{link}'}</code>, <code>{'{username}'}</code> ou <code>{'{nome}'}</code> no template abaixo</div>
                </div>

                {/* Features */}
                <div className="promo-features">
                  {/* Feature 1 — Auto Comment */}
                  <div className={`promo-feat${cfg.autoComment ? ' promo-feat--on' : ''}`}>
                    <div className="promo-feat-head">
                      <div className="promo-feat-left">
                        <span className="promo-feat-icon promo-feat-icon--comment">💬</span>
                        <div>
                          <div className="promo-feat-name">Comentário Fixado</div>
                          <div className="promo-feat-desc">Posta automaticamente no primeiro comentário</div>
                        </div>
                      </div>
                      <div className="promo-feat-actions">
                        <button
                          className="promo-test-btn"
                          disabled={!ok || !cfg.promoEnabled || testing[`${acc._id}:comment`]}
                          onClick={() => test(acc._id, 'comment')}
                          title="Testar agora no post mais recente"
                        >
                          {testing[`${acc._id}:comment`] ? '...' : 'Testar'}
                        </button>
                        <label className="promo-toggle promo-toggle--sm">
                          <input
                            type="checkbox"
                            checked={!!cfg.autoComment}
                            disabled={!ok}
                            onChange={e => patch(acc._id, 'autoComment', e.target.checked)}
                          />
                          <span className="promo-toggle-knob" />
                        </label>
                      </div>
                    </div>
                    {cfg.autoComment && (
                      <textarea
                        className="promo-template"
                        rows={3}
                        value={cfg.autoCommentTemplate || ''}
                        onChange={e => patch(acc._id, 'autoCommentTemplate', e.target.value)}
                        placeholder="Mensagem do comentário. Use {link}, {username}, {nome}"
                        disabled={!ok}
                      />
                    )}
                  </div>

                  {/* Feature 2 — Auto Story */}
                  <div className={`promo-feat${cfg.autoStory ? ' promo-feat--on' : ''}`}>
                    <div className="promo-feat-head">
                      <div className="promo-feat-left">
                        <span className="promo-feat-icon promo-feat-icon--story">📸</span>
                        <div>
                          <div className="promo-feat-name">Story Automático</div>
                          <div className="promo-feat-desc">Publica story com link apontando para seu Telegram</div>
                        </div>
                      </div>
                      <div className="promo-feat-actions">
                        <button
                          className="promo-test-btn"
                          disabled={!ok || !cfg.promoEnabled || testing[`${acc._id}:story`]}
                          onClick={() => test(acc._id, 'story')}
                          title="Testar agora"
                        >
                          {testing[`${acc._id}:story`] ? '...' : 'Testar'}
                        </button>
                        <label className="promo-toggle promo-toggle--sm">
                          <input
                            type="checkbox"
                            checked={!!cfg.autoStory}
                            disabled={!ok}
                            onChange={e => patch(acc._id, 'autoStory', e.target.checked)}
                          />
                          <span className="promo-toggle-knob" />
                        </label>
                      </div>
                    </div>
                  </div>

                  {/* Feature 3 — Auto Bio */}
                  <div className={`promo-feat${cfg.autoBio ? ' promo-feat--on' : ''}`}>
                    <div className="promo-feat-head">
                      <div className="promo-feat-left">
                        <span className="promo-feat-icon promo-feat-icon--bio">🔗</span>
                        <div>
                          <div className="promo-feat-name">Bio Atualizada</div>
                          <div className="promo-feat-desc">Mantém o link da bio sempre apontando para seu bot</div>
                        </div>
                      </div>
                      <div className="promo-feat-actions">
                        <button
                          className="promo-test-btn"
                          disabled={!ok || !cfg.promoEnabled || testing[`${acc._id}:bio`]}
                          onClick={() => test(acc._id, 'bio')}
                          title="Testar agora"
                        >
                          {testing[`${acc._id}:bio`] ? '...' : 'Testar'}
                        </button>
                        <label className="promo-toggle promo-toggle--sm">
                          <input
                            type="checkbox"
                            checked={!!cfg.autoBio}
                            disabled={!ok}
                            onChange={e => patch(acc._id, 'autoBio', e.target.checked)}
                          />
                          <span className="promo-toggle-knob" />
                        </label>
                      </div>
                    </div>
                  </div>
                </div>

                <button
                  className={`promo-save-btn${isSav ? ' promo-save-btn--loading' : ''}`}
                  disabled={!ok || isSav}
                  onClick={() => save(acc._id)}
                >
                  {isSav ? 'Salvando...' : 'Salvar configurações'}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
