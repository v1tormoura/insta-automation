import { useEffect, useState } from 'react';
import api from '../services/api';

const fmtK = v => { const n = Number(v||0); return n>=1e6?(n/1e6).toFixed(1)+'M':n>=1e3?(n/1e3).toFixed(1)+'K':String(n); };

const COND_LABELS = {
  videoViews: 'Views', engagementScore: 'Engajamento', savedCount: 'Saves', likeCount: 'Likes',
};
const DELAY_LABELS = { now: 'Imediato', '7d': '7 dias depois', '30d': '30 dias depois' };
const PERIOD_LABELS = { '7d': 'última semana', '30d': 'último mês', all: 'todos' };

const EMPTY_RULE = { name: '', condition: { metric: 'videoViews', operator: 'gt', value: 50000, period: '7d' }, action: { delay: '7d' } };

export default function SmartRepost() {
  const [rules,    setRules]    = useState([]);
  const [queue,    setQueue]    = useState([]);
  const [stats,    setStats]    = useState({});
  const [loading,  setLoading]  = useState(true);
  const [creating, setCreating] = useState(false);
  const [form,     setForm]     = useState(EMPTY_RULE);
  const [saving,   setSaving]   = useState(false);

  async function load() {
    try {
      const [r, q, s] = await Promise.all([
        api.get('/repost/rules'),
        api.get('/repost/queue'),
        api.get('/repost/stats'),
      ]);
      setRules(r.data);
      setQueue(q.data);
      setStats(s.data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function toggle(id) {
    try { await api.patch(`/repost/rules/${id}/toggle`); await load(); }
    catch (e) { alert(e.response?.data?.error || e.message); }
  }

  async function deleteRule(id) {
    if (!confirm('Remover regra?')) return;
    try { await api.delete(`/repost/rules/${id}`); await load(); }
    catch (e) { alert(e.response?.data?.error || e.message); }
  }

  async function createRule(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/repost/rules', form);
      setForm(EMPTY_RULE);
      setCreating(false);
      await load();
    } catch (e) {
      alert(e.response?.data?.error || e.message);
    } finally {
      setSaving(false);
    }
  }

  function setFormCond(k, v) { setForm(f => ({ ...f, condition: { ...f.condition, [k]: v } })); }
  function setFormAction(k, v) { setForm(f => ({ ...f, action: { ...f.action, [k]: v } })); }

  const RULE_COLORS = ['var(--cyan)','var(--green)','var(--indigo)','var(--purple)','var(--amber)','var(--pink)'];

  return (
    <>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--cyan)', textTransform: 'uppercase', letterSpacing: '.8px', marginBottom: 4 }}>Viralizar</div>
        <h1>Repost Inteligente</h1>
        <p style={{ color: 'var(--text2)', fontSize: 13, marginTop: 4 }}>Regras automáticas para republicar seus melhores conteúdos</p>
      </div>

      <div className="layout-2col">
        {/* Left */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* Rules */}
          <div className="card card-p">
            <div className="sec-header">
              <div className="sec-title">Regras</div>
              <button className="btn btn-cyan btn-sm" onClick={() => setCreating(v => !v)}>+ Nova</button>
            </div>

            {loading && <div style={{ color: 'var(--text2)', fontSize: 13, padding: '12px 0' }}>Carregando...</div>}
            {!loading && rules.length === 0 && (
              <div className="empty-state" style={{ padding: '20px 0' }}>
                <div className="empty-title">Sem regras ainda</div>
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {rules.map((rule, idx) => {
                const color = RULE_COLORS[idx % RULE_COLORS.length];
                return (
                  <div key={rule._id} style={{ display:'flex', alignItems:'center', gap:12, padding:'12px 14px', background: rule.active ? 'rgba(255,255,255,.03)' : 'transparent', border:`1px solid ${rule.active ? color+'33' : 'var(--border)'}`, borderRadius:10, transition:'.2s' }}>
                    <div style={{ width:8, height:8, borderRadius:'50%', background: rule.active ? color : 'var(--text3)', boxShadow: rule.active ? `0 0 7px ${color}` : 'none', flexShrink:0 }} />
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontWeight:600, fontSize:13 }}>{rule.name}</div>
                      <div style={{ fontSize:11, color:'var(--text2)', marginTop:2 }}>Se: {COND_LABELS[rule.condition.metric]} &gt; {fmtK(rule.condition.value)} ({PERIOD_LABELS[rule.condition.period]})</div>
                      <div style={{ fontSize:11, color:'var(--text3)', marginTop:1 }}>→ {DELAY_LABELS[rule.action.delay]}</div>
                    </div>
                    <div style={{ textAlign:'right', flexShrink:0, fontSize:11, color:'var(--text3)', marginRight:6 }}>{rule.runsCount} exec.</div>
                    <div className={`toggle${rule.active ? ' on' : ''}`} onClick={() => toggle(rule._id)} style={{ flexShrink:0 }} />
                    <button className="btn btn-ghost btn-sm" style={{ padding:'3px 8px', fontSize:11 }} onClick={() => deleteRule(rule._id)}>✕</button>
                  </div>
                );
              })}
            </div>

            {creating && (
              <form onSubmit={createRule} style={{ marginTop:16, padding:'14px', background:'rgba(255,255,255,.025)', borderRadius:10, border:'1px solid var(--border2)', display:'flex', flexDirection:'column', gap:10 }}>
                <div className="input-wrap">
                  <label className="input-label">Nome da regra</label>
                  <input className="input" required placeholder="Ex: Top Virais Semanais" value={form.name} onChange={e => setForm(f=>({...f, name:e.target.value}))} />
                </div>
                <div className="g2" style={{ gap:10 }}>
                  <div className="input-wrap">
                    <label className="input-label">Métrica</label>
                    <select className="input" value={form.condition.metric} onChange={e => setFormCond('metric', e.target.value)}>
                      <option value="videoViews">Views</option>
                      <option value="engagementScore">Engajamento</option>
                      <option value="savedCount">Saves</option>
                      <option value="likeCount">Likes</option>
                    </select>
                  </div>
                  <div className="input-wrap">
                    <label className="input-label">Valor mínimo</label>
                    <input className="input" type="number" min={0} value={form.condition.value} onChange={e => setFormCond('value', Number(e.target.value))} />
                  </div>
                </div>
                <div className="g2" style={{ gap:10 }}>
                  <div className="input-wrap">
                    <label className="input-label">Período</label>
                    <select className="input" value={form.condition.period} onChange={e => setFormCond('period', e.target.value)}>
                      <option value="7d">Última semana</option>
                      <option value="30d">Último mês</option>
                      <option value="all">Todos os posts</option>
                    </select>
                  </div>
                  <div className="input-wrap">
                    <label className="input-label">Ação</label>
                    <select className="input" value={form.action.delay} onChange={e => setFormAction('delay', e.target.value)}>
                      <option value="now">Repostar agora</option>
                      <option value="7d">7 dias depois</option>
                      <option value="30d">30 dias depois</option>
                    </select>
                  </div>
                </div>
                <div style={{ display:'flex', gap:8 }}>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCreating(false)} style={{ flex:1, justifyContent:'center' }}>Cancelar</button>
                  <button type="submit" className="btn btn-primary btn-sm" style={{ flex:1, justifyContent:'center' }} disabled={saving}>{saving ? 'Salvando...' : 'Criar regra'}</button>
                </div>
              </form>
            )}
          </div>

          {/* Queue */}
          <div className="card card-p">
            <div className="sec-header">
              <div className="sec-title">Fila de reposts</div>
              <span style={{ fontSize:12, color:'var(--text2)' }}>{queue.length} agendados</span>
            </div>
            {queue.length === 0
              ? <div className="empty-state" style={{ padding:'20px 0' }}><div className="empty-title">Fila vazia</div></div>
              : queue.map((item, i) => (
                <div key={i} className="queue-item">
                  <div className="queue-thumb" style={{ background:'rgba(30,111,255,.12)', color:'var(--indigo)', display:'flex', alignItems:'center', justifyContent:'center' }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>
                  </div>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div className="queue-name">@{item.username}</div>
                    <div className="queue-meta">{item.ruleName} · {fmtK(item.views)} views</div>
                  </div>
                  <div className="queue-time" style={{ fontSize:10 }}>
                    {new Date(item.scheduledAt).toLocaleDateString('pt-BR', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' })}
                  </div>
                </div>
              ))
            }
          </div>
        </div>

        {/* Right: stats */}
        <div className="card card-p" style={{ alignSelf:'start' }}>
          <div className="sec-header" style={{ marginBottom:14 }}><div className="sec-title">Visão geral</div></div>
          <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
            {[
              { label:'Regras no total',  value: stats.totalRules  ?? '—', color:'var(--cyan)'   },
              { label:'Regras ativas',    value: stats.activeRules ?? '—', color:'var(--green)'  },
              { label:'Na fila agora',    value: queue.length,              color:'var(--indigo)' },
            ].map(s => (
              <div key={s.label} style={{ display:'flex', alignItems:'center', gap:12 }}>
                <div style={{ width:10, height:10, borderRadius:'50%', background:s.color, flexShrink:0, boxShadow:`0 0 6px ${s.color}` }} />
                <div style={{ flex:1 }}><div style={{ fontSize:12, color:'var(--text2)' }}>{s.label}</div></div>
                <div style={{ fontWeight:800, fontSize:20, color:s.color, fontFamily:'var(--font-display)' }}>{s.value}</div>
              </div>
            ))}
          </div>
          <div style={{ marginTop:20, padding:'12px 14px', background:'rgba(0,212,255,.05)', border:'1px solid rgba(0,212,255,.15)', borderRadius:10, fontSize:12, color:'var(--text2)', lineHeight:1.6 }}>
            O job de repost roda automaticamente a cada hora e verifica quais posts atingiram as condições das regras ativas.
          </div>
        </div>
      </div>
    </>
  );
}
