import { useEffect, useState } from 'react';
import api from '../services/api';

const DEFAULT_COMMENTS = [
  '🔥🔥🔥', '❤️', 'Incrível!', 'Muito bom!', '👏👏', 'Perfeito!',
  'Que lindo!', '😍', 'Top demais!', '💯', 'Amei!', '👌',
  'Sensacional!', '🙌', 'Maravilhoso!', 'Show!', '💪', 'Que demais!',
];

const ACTIONS = [
  { value: 'likes',    label: 'Curtidas',    icon: '❤️', color: '#f43f5e' },
  { value: 'comments', label: 'Comentários', icon: '💬', color: '#3b82f6' },
  { value: 'follows',  label: 'Follows',     icon: '➕', color: '#10b981' },
];

const INTENSITY = [
  { v: 'leve',      label: 'Leve',      color: '#22c55e', desc: '1-3 ações/ciclo' },
  { v: 'medio',     label: 'Médio',     color: '#f59e0b', desc: '3-6 ações/ciclo' },
  { v: 'agressivo', label: 'Agressivo', color: '#ef4444', desc: '6-10 ações/ciclo' },
];

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000';
const avatarSrc = av => av
  ? (av.startsWith('http') ? `${API_BASE}/image-proxy?url=${encodeURIComponent(av)}` : `${API_BASE}${av}`)
  : null;

function defaultCfg() {
  return {
    intensity: 'leve',
    actions: ['likes'],
    intervalMinutes: 30,
    maxLikes: 6,
    maxComments: 2,
    maxFollows: 4,
    commentList: DEFAULT_COMMENTS.join('\n'),
  };
}

export default function Warmup() {
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [configs, setConfigs]   = useState({});
  const [expanded, setExpanded] = useState(null);

  async function load() {
    try {
      const res = await api.get('/warmup');
      const data = res.data;
      setAccounts(data);
      const cfgs = {};
      data.forEach(a => {
        cfgs[a._id] = {
          intensity: a.warmupIntensity || 'leve',
          actions: a.warmupActions?.length ? a.warmupActions : ['likes'],
          intervalMinutes: a.warmupInterval || 30,
          maxLikes: a.warmupMaxLikes || 6,
          maxComments: a.warmupMaxComments || 2,
          maxFollows: a.warmupMaxFollows || 4,
          commentList: (a.warmupComments?.length ? a.warmupComments : DEFAULT_COMMENTS).join('\n'),
        };
      });
      setConfigs(cfgs);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function updateCfg(id, key, value) {
    setConfigs(prev => ({ ...prev, [id]: { ...prev[id], [key]: value } }));
  }

  function toggleAction(id, action) {
    const cur = configs[id]?.actions || [];
    updateCfg(id, 'actions', cur.includes(action) ? cur.filter(a => a !== action) : [...cur, action]);
  }

  async function startWarmup(id) {
    const cfg = configs[id];
    if (!cfg?.actions?.length) return alert('Selecione ao menos uma ação.');
    const comments = cfg.commentList.split('\n').map(s => s.trim()).filter(Boolean);
    try {
      await api.post(`/warmup/${id}/start`, { ...cfg, commentList: comments });
      load();
    } catch (err) {
      alert(err.response?.data?.error || err.message);
    }
  }

  async function stopWarmup(id) {
    try {
      await api.post(`/warmup/${id}/stop`);
      load();
    } catch (err) {
      alert(err.response?.data?.error || err.message);
    }
  }

  const activeCount = accounts.filter(a => a.warmupActive).length;

  if (loading) return (
    <div className="page-container">
      <p style={{ color: 'var(--text3)' }}>Carregando...</p>
    </div>
  );

  return (
    <div className="page-container">
      {/* Header */}
      <div className="page-header" style={{ marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--cyan)', textTransform: 'uppercase', letterSpacing: '.8px', marginBottom: 4 }}>Viralizar</div>
          <h1 className="page-title">Aquecimento de Contas</h1>
          <p style={{ color: 'var(--text2)', fontSize: 13, marginTop: 4 }}>
            Simula curtidas, comentários e follows para esquentar contas antes de postar
          </p>
        </div>
      </div>

      {/* Stats bar */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: 10, marginBottom: 22 }}>
        {[
          { label: 'TOTAL DE CONTAS', value: accounts.length,              color: 'var(--cyan)',  icon: '👤' },
          { label: 'AQUECENDO AGORA', value: activeCount,                   color: '#22c55e',      icon: '🔥' },
          { label: 'CONTAS INATIVAS', value: accounts.length - activeCount, color: 'var(--text3)', icon: '⚪' },
        ].map(s => (
          <div key={s.label} style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 12, padding: '14px 16px' }}>
            <div style={{ fontSize: 20, marginBottom: 4 }}>{s.icon}</div>
            <div style={{ fontWeight: 800, fontSize: 22, color: s.color, lineHeight: 1 }}>{s.value}</div>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text3)', letterSpacing: '.05em', marginTop: 4 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {accounts.length === 0 && (
        <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--text3)' }}>
          Nenhuma conta encontrada. Adicione contas primeiro.
        </div>
      )}

      {/* Cards grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(320px,1fr))', gap: 14 }}>
        {accounts.map(account => {
          const cfg        = configs[account._id] || defaultCfg();
          const isActive   = account.warmupActive;
          const isExpanded = expanded === account._id;
          const intCfg     = INTENSITY.find(i => i.v === cfg.intensity) || INTENSITY[0];
          const src        = avatarSrc(account.avatar);

          return (
            <div key={account._id} style={{
              background: 'var(--bg2)',
              border: `1px solid ${isActive ? 'rgba(34,197,94,.35)' : 'var(--border)'}`,
              borderRadius: 14, overflow: 'hidden',
              boxShadow: isActive ? '0 0 0 1px rgba(34,197,94,.12), 0 4px 20px rgba(34,197,94,.07)' : 'none',
              transition: 'border-color .2s, box-shadow .2s',
            }}>
              {/* Active bar */}
              {isActive && (
                <div style={{ height: 3, background: 'linear-gradient(90deg,#22c55e,#16a34a)' }} />
              )}

              {/* Card header */}
              <div style={{ padding: '18px 18px 14px', display: 'flex', gap: 14 }}>
                {/* Profile photo */}
                <div style={{ position: 'relative', flexShrink: 0 }}>
                  <div style={{
                    width: 60, height: 60, borderRadius: '50%', overflow: 'hidden',
                    border: isActive ? '3px solid #22c55e' : '3px solid var(--border)',
                    boxShadow: isActive ? '0 0 16px rgba(34,197,94,.4)' : 'none',
                    background: 'var(--bg3)', transition: 'border-color .2s, box-shadow .2s',
                  }}>
                    {src
                      ? <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                          onError={e => { e.target.style.display = 'none'; }} />
                      : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 22, color: 'var(--cyan)' }}>
                          {account.username?.[0]?.toUpperCase()}
                        </div>
                    }
                  </div>
                  <div style={{
                    position: 'absolute', bottom: 2, right: 2, width: 14, height: 14, borderRadius: '50%',
                    background: isActive ? '#22c55e' : '#4b5563',
                    border: '2px solid var(--bg2)',
                    boxShadow: isActive ? '0 0 8px #22c55e' : 'none',
                  }} />
                </div>

                {/* Info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    @{account.username}
                  </div>
                  {account.accountType && (
                    <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--cyan)', textTransform: 'uppercase', letterSpacing: '.06em', marginTop: 2 }}>
                      {account.accountType}
                    </div>
                  )}
                  <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                    {isActive ? (
                      <>
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#22c55e', boxShadow: '0 0 6px #22c55e' }} />
                        <span style={{ fontSize: 11, color: '#22c55e', fontWeight: 700 }}>Aquecendo — {intCfg.label}</span>
                        <span style={{ fontSize: 10, color: 'var(--text3)' }}>· {cfg.intervalMinutes}min/ciclo</span>
                      </>
                    ) : (
                      <>
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--text3)' }} />
                        <span style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 600 }}>Inativo</span>
                      </>
                    )}
                  </div>
                  {isActive && cfg.actions?.length > 0 && (
                    <div style={{ display: 'flex', gap: 4, marginTop: 7, flexWrap: 'wrap' }}>
                      {cfg.actions.map(a => {
                        const ac = ACTIONS.find(x => x.value === a);
                        return ac ? (
                          <span key={a} style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 6,
                            background: `${ac.color}18`, color: ac.color, border: `1px solid ${ac.color}33` }}>
                            {ac.icon} {ac.label}
                          </span>
                        ) : null;
                      })}
                    </div>
                  )}
                </div>

                {/* Controls */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
                  {isActive ? (
                    <button onClick={() => stopWarmup(account._id)} style={{
                      padding: '6px 12px', borderRadius: 8, cursor: 'pointer', whiteSpace: 'nowrap',
                      background: 'rgba(239,68,68,.12)', color: '#ef4444', fontWeight: 700, fontSize: 12,
                      border: '1px solid rgba(239,68,68,.3)',
                    }}>⏹ Parar</button>
                  ) : (
                    <button onClick={() => startWarmup(account._id)} style={{
                      padding: '6px 12px', borderRadius: 8, cursor: 'pointer', whiteSpace: 'nowrap',
                      background: 'rgba(34,197,94,.12)', color: '#22c55e', fontWeight: 700, fontSize: 12,
                      border: '1px solid rgba(34,197,94,.3)',
                    }}>🔥 Iniciar</button>
                  )}
                  <button onClick={() => setExpanded(isExpanded ? null : account._id)} style={{
                    padding: '5px 10px', borderRadius: 8, border: '1px solid var(--border)',
                    background: 'transparent', color: 'var(--text3)', cursor: 'pointer', fontSize: 11, fontWeight: 600,
                  }}>
                    {isExpanded ? '▲ Fechar' : '⚙ Config'}
                  </button>
                </div>
              </div>

              {/* Mini stats */}
              {(account.followers || account.following || account.postsCount) && (
                <div style={{ padding: '0 18px 12px', display: 'flex', gap: 16 }}>
                  {[
                    { label: 'Seguidores', value: account.followers },
                    { label: 'Seguindo',   value: account.following },
                    { label: 'Posts',      value: account.postsCount },
                  ].filter(s => s.value != null).map(s => (
                    <div key={s.label}>
                      <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--text)' }}>
                        {s.value >= 1000 ? `${(s.value/1000).toFixed(1)}K` : s.value}
                      </div>
                      <div style={{ fontSize: 9, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.04em' }}>{s.label}</div>
                    </div>
                  ))}
                </div>
              )}

              <div style={{ borderTop: '1px solid var(--border)' }} />

              {/* Config panel */}
              {isExpanded && (
                <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 16 }}>
                  {/* Intensity */}
                  <div>
                    <div style={labelStyle}>Intensidade</div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {INTENSITY.map(({ v, label, color, desc }) => (
                        <button key={v} onClick={() => updateCfg(account._id, 'intensity', v)} title={desc} style={{
                          flex: 1, padding: '8px 0', borderRadius: 8,
                          border: `1px solid ${cfg.intensity === v ? color : 'var(--border)'}`,
                          cursor: 'pointer', fontWeight: 700, fontSize: 11,
                          background: cfg.intensity === v ? `${color}20` : 'var(--bg3)',
                          color: cfg.intensity === v ? color : 'var(--text3)',
                          transition: 'all .15s',
                        }}>
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Actions */}
                  <div>
                    <div style={labelStyle}>Ações a executar</div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {ACTIONS.map(a => {
                        const on = cfg.actions?.includes(a.value);
                        return (
                          <button key={a.value} onClick={() => toggleAction(account._id, a.value)} style={{
                            flex: 1, padding: '8px 0', borderRadius: 8, cursor: 'pointer', fontWeight: 700, fontSize: 11,
                            background: on ? `${a.color}20` : 'var(--bg3)',
                            color: on ? a.color : 'var(--text3)',
                            border: `1px solid ${on ? a.color : 'var(--border)'}`,
                            transition: 'all .15s',
                          }}>{a.icon} {a.label}</button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Numeric limits */}
                  <div style={{ display: 'flex', gap: 10 }}>
                    {cfg.actions?.includes('likes') && (
                      <div style={{ flex: 1 }}>
                        <div style={labelStyle}>Max. Curtidas</div>
                        <input type="number" min={1} max={100} value={cfg.maxLikes}
                          onChange={e => updateCfg(account._id, 'maxLikes', Number(e.target.value))}
                          style={inputStyle} />
                      </div>
                    )}
                    {cfg.actions?.includes('comments') && (
                      <div style={{ flex: 1 }}>
                        <div style={labelStyle}>Max. Comentários</div>
                        <input type="number" min={1} max={50} value={cfg.maxComments}
                          onChange={e => updateCfg(account._id, 'maxComments', Number(e.target.value))}
                          style={inputStyle} />
                      </div>
                    )}
                    {cfg.actions?.includes('follows') && (
                      <div style={{ flex: 1 }}>
                        <div style={labelStyle}>Max. Follows</div>
                        <input type="number" min={1} max={50} value={cfg.maxFollows}
                          onChange={e => updateCfg(account._id, 'maxFollows', Number(e.target.value))}
                          style={inputStyle} />
                      </div>
                    )}
                  </div>

                  {/* Comment list */}
                  {cfg.actions?.includes('comments') && (
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                        <div style={labelStyle}>Comentários (um por linha)</div>
                        <span style={{ fontSize: 10, color: 'var(--cyan)', fontWeight: 600 }}>
                          {cfg.commentList.split('\n').filter(s => s.trim()).length} cadastrados
                        </span>
                      </div>
                      <textarea
                        value={cfg.commentList}
                        onChange={e => updateCfg(account._id, 'commentList', e.target.value)}
                        rows={5}
                        placeholder={'🔥🔥🔥\nIncrível!\nAmei!\n💯'}
                        style={{
                          width: '100%', boxSizing: 'border-box', padding: '8px 12px',
                          borderRadius: 8, border: '1px solid var(--border)',
                          background: 'var(--bg3)', color: 'var(--text)',
                          fontSize: 12, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5,
                        }}
                      />
                    </div>
                  )}

                  {/* Interval */}
                  <div>
                    <div style={{ ...labelStyle, marginBottom: 8 }}>
                      Intervalo entre ciclos:&nbsp;
                      <span style={{ color: 'var(--cyan)', fontWeight: 800 }}>{cfg.intervalMinutes} min</span>
                    </div>
                    <input type="range" min={10} max={120} step={5}
                      value={cfg.intervalMinutes}
                      onChange={e => updateCfg(account._id, 'intervalMinutes', Number(e.target.value))}
                      style={{ width: '100%', accentColor: 'var(--cyan)' }}
                    />
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text3)', marginTop: 2 }}>
                      <span>10 min</span><span>120 min</span>
                    </div>
                  </div>

                  {/* CTA */}
                  <button onClick={() => startWarmup(account._id)} style={{
                    width: '100%', padding: '10px 0', borderRadius: 9, border: 'none', cursor: 'pointer',
                    background: isActive
                      ? 'linear-gradient(135deg,#f59e0b,#d97706)'
                      : 'linear-gradient(135deg,#22c55e,#16a34a)',
                    color: '#fff', fontWeight: 700, fontSize: 13,
                    boxShadow: isActive ? '0 4px 16px rgba(245,158,11,.3)' : '0 4px 16px rgba(34,197,94,.3)',
                  }}>
                    {isActive ? '🔄 Atualizar configuração' : '🔥 Iniciar aquecimento'}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Info footer */}
      {accounts.length > 0 && (
        <div className="card card-p" style={{ marginTop: 20, display: 'flex', gap: 14, alignItems: 'flex-start' }}>
          <div style={{ fontSize: 22, flexShrink: 0 }}>🔥</div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>Como funciona o aquecimento</div>
            <div style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.7 }}>
              O aquecimento simula comportamento orgânico: curtidas, comentários e follows em conteúdos do nicho.
              Reduz o risco de shadowban e melhora o alcance inicial das postagens.
              Use intensidade <strong>Leve</strong> para contas novas e <strong>Médio</strong> para contas estabelecidas.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const labelStyle = {
  fontSize: 10, color: 'var(--text3)', fontWeight: 700,
  textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6,
};

const inputStyle = {
  width: '100%', boxSizing: 'border-box', padding: '7px 10px',
  borderRadius: 8, border: '1px solid var(--border)',
  background: 'var(--bg3)', color: 'var(--text)', fontSize: 12,
};
