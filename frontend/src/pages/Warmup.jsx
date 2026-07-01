import { useEffect, useState } from 'react';
import api from '../services/api';

const DEFAULT_COMMENTS = [
  '🔥🔥🔥', '❤️', 'Incrível!', 'Muito bom!', '👏👏', 'Perfeito!',
  'Que lindo!', '😍', 'Top demais!', '💯', 'Amei!', '👌',
  'Sensacional!', '🙌', 'Maravilhoso!', 'Show!', '💪', 'Que demais!',
];

const ACTIONS = [
  { value: 'likes',    label: 'Curtidas',    icon: '❤️' },
  { value: 'comments', label: 'Comentários', icon: '💬' },
  { value: 'follows',  label: 'Follows',     icon: '➕' },
];

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
  const [loading, setLoading] = useState(true);
  const [configs, setConfigs] = useState({});
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

  if (loading) return (
    <div className="page-container">
      <p style={{ color: 'var(--text-muted)' }}>Carregando...</p>
    </div>
  );

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Aquecimento de Contas</h1>
          <p className="page-subtitle">Simula curtidas, comentários e follows para aquecer contas antes de postar</p>
        </div>
      </div>

      {accounts.length === 0 && (
        <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--text-muted)' }}>
          Nenhuma conta encontrada. Adicione contas primeiro.
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 16 }}>
        {accounts.map(account => {
          const cfg = configs[account._id] || defaultCfg();
          const isExpanded = expanded === account._id;
          const isActive = account.warmupActive;

          return (
            <div key={account._id} className="card" style={{ padding: 0, overflow: 'hidden' }}>
              {/* Header do card */}
              <div style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 14, borderBottom: isExpanded ? '1px solid var(--border)' : 'none' }}>
                {/* Avatar */}
                <div style={{
                  width: 48, height: 48, borderRadius: '50%', overflow: 'hidden', flexShrink: 0,
                  background: 'var(--bg-secondary)',
                  border: isActive ? '2px solid #22c55e' : '2px solid var(--border)',
                }}>
                  {account.avatar
                    ? <img src={account.avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={e => { e.target.style.display='none'; }} />
                    : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 18, color: 'var(--text-muted)' }}>
                        {account.username?.[0]?.toUpperCase()}
                      </div>
                  }
                </div>

                {/* Info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    @{account.username}
                  </div>
                  <div style={{ fontSize: 12, color: isActive ? '#22c55e' : 'var(--text-muted)', fontWeight: 600, marginTop: 2 }}>
                    {isActive ? `🔥 Aquecendo — ${cfg.intensity}` : '⚪ Inativo'}
                  </div>
                </div>

                {/* Ações rápidas */}
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  {isActive ? (
                    <button onClick={() => stopWarmup(account._id)} style={{
                      padding: '6px 14px', borderRadius: 7, border: 'none', cursor: 'pointer',
                      background: '#ef4444', color: '#fff', fontWeight: 700, fontSize: 12,
                    }}>⏹ Parar</button>
                  ) : (
                    <button onClick={() => startWarmup(account._id)} style={{
                      padding: '6px 14px', borderRadius: 7, border: 'none', cursor: 'pointer',
                      background: 'var(--primary)', color: '#fff', fontWeight: 700, fontSize: 12,
                    }}>🔥 Iniciar</button>
                  )}
                  <button onClick={() => setExpanded(isExpanded ? null : account._id)} style={{
                    padding: '6px 10px', borderRadius: 7, border: '1px solid var(--border)',
                    background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 12,
                  }}>
                    {isExpanded ? '▲' : '▼'}
                  </button>
                </div>
              </div>

              {/* Config expandida */}
              {isExpanded && (
                <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>

                  {/* Intensidade */}
                  <div>
                    <div style={labelStyle}>Intensidade</div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      {[
                        { v: 'leve', label: 'Leve', color: '#22c55e' },
                        { v: 'medio', label: 'Médio', color: '#f59e0b' },
                        { v: 'agressivo', label: 'Agressivo', color: '#ef4444' },
                      ].map(({ v, label, color }) => (
                        <button key={v} onClick={() => updateCfg(account._id, 'intensity', v)} style={{
                          flex: 1, padding: '6px 0', borderRadius: 7, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 12,
                          background: cfg.intensity === v ? color : 'var(--bg-secondary)',
                          color: cfg.intensity === v ? '#fff' : 'var(--text-muted)',
                        }}>{label}</button>
                      ))}
                    </div>
                  </div>

                  {/* Ações */}
                  <div>
                    <div style={labelStyle}>Ações a executar</div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      {ACTIONS.map(a => (
                        <button key={a.value} onClick={() => toggleAction(account._id, a.value)} style={{
                          flex: 1, padding: '6px 0', borderRadius: 7, border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: 12,
                          background: cfg.actions?.includes(a.value) ? 'var(--primary)' : 'var(--bg-secondary)',
                          color: cfg.actions?.includes(a.value) ? '#fff' : 'var(--text-muted)',
                        }}>{a.icon} {a.label}</button>
                      ))}
                    </div>
                  </div>

                  {/* Limites numéricos */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                    {cfg.actions?.includes('likes') && (
                      <div>
                        <div style={labelStyle}>Max. Curtidas</div>
                        <input type="number" min={1} max={100} value={cfg.maxLikes}
                          onChange={e => updateCfg(account._id, 'maxLikes', Number(e.target.value))}
                          style={inputStyle} />
                      </div>
                    )}
                    {cfg.actions?.includes('comments') && (
                      <div>
                        <div style={labelStyle}>Max. Comentários</div>
                        <input type="number" min={1} max={50} value={cfg.maxComments}
                          onChange={e => updateCfg(account._id, 'maxComments', Number(e.target.value))}
                          style={inputStyle} />
                      </div>
                    )}
                    {cfg.actions?.includes('follows') && (
                      <div>
                        <div style={labelStyle}>Max. Follows</div>
                        <input type="number" min={1} max={50} value={cfg.maxFollows}
                          onChange={e => updateCfg(account._id, 'maxFollows', Number(e.target.value))}
                          style={inputStyle} />
                      </div>
                    )}
                  </div>

                  {/* Lista de comentários */}
                  {cfg.actions?.includes('comments') && (
                    <div>
                      <div style={labelStyle}>Comentários (um por linha)</div>
                      <textarea
                        value={cfg.commentList}
                        onChange={e => updateCfg(account._id, 'commentList', e.target.value)}
                        rows={6}
                        placeholder={'🔥🔥🔥\nIncrível!\nAmei!\n💯'}
                        style={{
                          width: '100%', boxSizing: 'border-box', padding: '8px 12px',
                          borderRadius: 8, border: '1px solid var(--border)',
                          background: 'var(--bg-secondary)', color: 'var(--text)',
                          fontSize: 13, resize: 'vertical', fontFamily: 'inherit',
                        }}
                      />
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                        {cfg.commentList.split('\n').filter(s => s.trim()).length} comentários cadastrados
                      </div>
                    </div>
                  )}

                  {/* Intervalo */}
                  <div>
                    <div style={labelStyle}>Intervalo entre ciclos: {cfg.intervalMinutes} min</div>
                    <input type="range" min={10} max={120} step={5}
                      value={cfg.intervalMinutes}
                      onChange={e => updateCfg(account._id, 'intervalMinutes', Number(e.target.value))}
                      style={{ width: '100%' }}
                    />
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)' }}>
                      <span>10 min</span><span>120 min</span>
                    </div>
                  </div>

                  {/* Botão salvar/iniciar */}
                  <button onClick={() => startWarmup(account._id)} style={{
                    width: '100%', padding: '10px 0', borderRadius: 8, border: 'none', cursor: 'pointer',
                    background: isActive ? '#f59e0b' : 'var(--primary)', color: '#fff', fontWeight: 700, fontSize: 14,
                  }}>
                    {isActive ? '🔄 Atualizar configuração' : '🔥 Iniciar aquecimento'}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const labelStyle = {
  fontSize: 11, color: 'var(--text-muted)', fontWeight: 600,
  textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 6,
};

const inputStyle = {
  width: '100%', boxSizing: 'border-box', padding: '7px 10px',
  borderRadius: 7, border: '1px solid var(--border)',
  background: 'var(--bg-secondary)', color: 'var(--text)', fontSize: 13,
};
