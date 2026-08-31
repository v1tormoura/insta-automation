import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import api from '../services/api';
import PageShell from '../components/PageShell';
import { EsqueletoLista } from '../components/Estados';

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

  const RULE_COLORS = ['var(--mf-mod, var(--mf-accent-500))','var(--mf-success-500)','var(--indigo)','var(--mf-mod-publicar)','var(--mf-warning-500)','var(--mf-mod-campanhas)'];

  const pageIcon = (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 014-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 01-4 4H3"/>
    </svg>
  );

  const pageActions = (
    <>
      <div style={{ display: 'flex', gap: 6 }}>
        {[
          { label: 'Regras', val: stats.totalRules ?? '—', color: 'var(--mf-mod, var(--mf-accent-500))' },
          { label: 'Ativas', val: stats.activeRules ?? '—', color: 'var(--mf-success-500)' },
          { label: 'Na fila', val: queue.length, color: 'var(--mf-primary-300)' },
        ].map(s => (
          <div key={s.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 8px', borderRadius: 'var(--mf-r-sm)', background: 'color-mix(in oklch, var(--mf-bg) 60%, transparent)', border: '1px solid var(--mf-border)', fontSize: 'var(--mf-t-micro)' }}>
            <span style={{ fontWeight: 700, color: s.color, fontVariantNumeric: 'tabular-nums', fontFamily: 'var(--mf-mono)' }}>{s.val}</span>
            <span style={{ color: 'var(--mf-text-3)', fontFamily: 'var(--mf-mono)' }}>{s.label}</span>
          </div>
        ))}
      </div>
      <button className="btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 12px', borderRadius: 'var(--mf-r-sm)', fontSize: 'var(--mf-t-sm)', fontWeight: 700 }} onClick={() => setCreating(v => !v)}>
        + Nova regra
      </button>
    </>
  );

  const cardStyle = { background: 'color-mix(in oklch, var(--mf-surface-1) 85%, transparent)', border: '1px solid var(--mf-border)', borderRadius: 'var(--mf-r-lg)', padding: '16px', backdropFilter: 'blur(12px)', overflow: 'hidden' };
  const cardHdStyle = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 };
  const cardTitleStyle = { fontSize: 'var(--mf-t-body)', fontWeight: 700, color: 'var(--mf-text)', margin: 0 };

  return (
    <PageShell
      icon={pageIcon}
      title="Repost Inteligente"
      subtitle="Regras automáticas para republicar seus melhores conteúdos"
      accent="green"
      actions={pageActions}
    >
      <div className="layout-2col">
        {/* Left */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* Rules */}
          <motion.div initial={{ opacity:0, y:10 }} animate={{ opacity:1, y:0 }} transition={{ duration:.25 }} style={cardStyle}>
            <div style={cardHdStyle}>
              <h3 style={cardTitleStyle}>Regras</h3>
              <button className="btn-ghost" style={{ fontSize: 'var(--mf-t-xs)', padding:'4px 8px', borderRadius: 'var(--mf-r-sm)' }} onClick={() => setCreating(v => !v)}>+ Nova</button>
            </div>

            {loading && <EsqueletoLista itens={3} />}
            {!loading && rules.length === 0 && (
              <div style={{ textAlign:'center', padding:'16px 0' }}>
                <div style={{ fontSize: 'var(--mf-t-body)', color:'var(--mf-text-3)' }}>Sem regras ainda</div>
              </div>
            )}

            <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
              {rules.map((rule, idx) => {
                const color = RULE_COLORS[idx % RULE_COLORS.length];
                return (
                  <div key={rule._id} style={{ display:'flex', alignItems:'center', gap:12, padding:'12px 12px', background: rule.active ? 'var(--mf-border-subtle)' : 'transparent', border:`1px solid ${rule.active ? color+'33' : 'var(--mf-border)'}`, borderRadius: 'var(--mf-r-md)', transition:'.2s' }}>
                    <div style={{ width:8, height:8, borderRadius: 'var(--mf-r-full)', background: rule.active ? color : 'var(--mf-text-3)', boxShadow: rule.active ? `0 0 7px ${color}` : 'none', flexShrink:0 }} />
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontWeight:600, fontSize: 'var(--mf-t-sm)', color:'var(--mf-text)' }}>{rule.name}</div>
                      <div style={{ fontSize: 'var(--mf-t-micro)', color:'var(--mf-text-2)', marginTop:2 }}>Se: {COND_LABELS[rule.condition.metric]} &gt; {fmtK(rule.condition.value)} ({PERIOD_LABELS[rule.condition.period]})</div>
                      <div style={{ fontSize: 'var(--mf-t-micro)', color:'var(--mf-text-3)', marginTop:1 }}>→ {DELAY_LABELS[rule.action.delay]}</div>
                    </div>
                    <div style={{ textAlign:'right', flexShrink:0, fontSize: 'var(--mf-t-micro)', color:'var(--mf-text-3)', marginRight:6, fontFamily:'var(--mf-mono)' }}>{rule.runsCount} exec.</div>
                    <div className={`toggle${rule.active ? ' on' : ''}`} onClick={() => toggle(rule._id)} style={{ flexShrink:0 }} />
                    <button className="btn-ghost" style={{ padding:'2px 8px', fontSize: 'var(--mf-t-micro)', borderRadius: 'var(--mf-r-sm)' }} onClick={() => deleteRule(rule._id)}>✕</button>
                  </div>
                );
              })}
            </div>

            {creating && (
              <form onSubmit={createRule} style={{ marginTop:16, padding:'12px', background:'color-mix(in oklch, var(--mf-bg) 60%, transparent)', borderRadius: 'var(--mf-r-md)', border:'1px solid var(--mf-border)', display:'flex', flexDirection:'column', gap:10 }}>
                <div className="input-wrap">
                  <label className="input-label">Nome da regra</label>
                  <input className="input" required placeholder="Ex: Top Virais Semanais" value={form.name} onChange={e => setForm(f=>({...f, name:e.target.value}))} />
                </div>
                <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(140px, 1fr))', gap:10 }}>
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
                <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(140px, 1fr))', gap:10 }}>
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
                  <button type="button" className="btn-ghost" onClick={() => setCreating(false)} style={{ flex:1, justifyContent:'center', borderRadius: 'var(--mf-r-sm)' }}>Cancelar</button>
                  <button type="submit" className="btn-primary" style={{ flex:1, justifyContent:'center', borderRadius: 'var(--mf-r-sm)' }} disabled={saving}>{saving ? 'Salvando...' : 'Criar regra'}</button>
                </div>
              </form>
            )}
          </motion.div>

          {/* Queue */}
          <motion.div initial={{ opacity:0, y:10 }} animate={{ opacity:1, y:0 }} transition={{ duration:.25, delay:.06 }} style={cardStyle}>
            <div style={cardHdStyle}>
              <h3 style={cardTitleStyle}>Fila de reposts</h3>
              <span style={{ fontSize: 'var(--mf-t-micro)', color:'var(--mf-text-3)', fontFamily:'var(--mf-mono)', background:'color-mix(in oklch, var(--mf-bg) 60%, transparent)', border:'1px solid var(--mf-border)', borderRadius: 'var(--mf-r-full)', padding:'2px 8px' }}>{queue.length} agendados</span>
            </div>
            {queue.length === 0
              ? <div style={{ textAlign:'center', padding:'32px 0', color:'var(--mf-text-3)', fontSize: 'var(--mf-t-body)' }}>Fila vazia</div>
              : <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                  {queue.map((item, i) => (
                    <motion.div key={i} initial={{ opacity:0, y:5 }} animate={{ opacity:1, y:0 }} transition={{ delay: i * 0.04 }}
                      style={{ display:'flex', alignItems:'center', gap:12, padding:'8px 12px', background:'color-mix(in oklch, var(--mf-bg) 60%, transparent)', borderRadius: 'var(--mf-r-md)', border:'1px solid var(--mf-border)' }}>
                      <div style={{ width:36, height:36, borderRadius: 'var(--mf-r-md)', background:'rgba(30,111,255,.12)', color:'var(--indigo)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>
                      </div>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ fontWeight:600, fontSize: 'var(--mf-t-sm)', color:'var(--mf-text)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>@{item.username}</div>
                        <div style={{ fontSize: 'var(--mf-t-micro)', color:'var(--mf-text-3)', marginTop:2 }}>{item.ruleName} · {fmtK(item.views)} views</div>
                      </div>
                      <div style={{ fontSize: 'var(--mf-t-nano)', color:'var(--mf-text-3)', fontFamily:'var(--mf-mono)', flexShrink:0, textAlign:'right' }}>
                        {new Date(item.scheduledAt).toLocaleDateString('pt-BR', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' })}
                      </div>
                    </motion.div>
                  ))}
                </div>
            }
          </motion.div>
        </div>

        {/* Right: stats */}
        <motion.div initial={{ opacity:0, y:10 }} animate={{ opacity:1, y:0 }} transition={{ duration:.25, delay:.1 }} style={{ ...cardStyle, alignSelf:'start' }}>
          <div style={{ ...cardHdStyle, marginBottom:16 }}>
            <h3 style={cardTitleStyle}>Visão geral</h3>
          </div>
          <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
            {[
              { label:'Regras no total',  value: stats.totalRules  ?? '—', color:'var(--mf-mod, var(--mf-accent-500))'  },
              { label:'Regras ativas',    value: stats.activeRules ?? '—', color:'var(--mf-success-500)' },
              { label:'Na fila agora',    value: queue.length,              color:'var(--mf-primary-300)'      },
            ].map(s => (
              <div key={s.label} style={{ display:'flex', alignItems:'center', gap:12 }}>
                <div style={{ width:8, height:8, borderRadius: 'var(--mf-r-full)', background:s.color, flexShrink:0, boxShadow:`0 0 6px ${s.color}` }} />
                <div style={{ flex:1 }}><div style={{ fontSize: 'var(--mf-t-xs)', color:'var(--mf-text-2)' }}>{s.label}</div></div>
                <div style={{ fontWeight:800, fontSize: 'var(--mf-t-h1)', color:s.color, fontVariantNumeric:'tabular-nums' }}>{s.value}</div>
              </div>
            ))}
          </div>
          <div style={{ marginTop:20, padding:'12px 12px', background:'color-mix(in oklch, var(--mf-mod-contas) 5%, transparent)', border:'1px solid color-mix(in oklch, var(--mf-mod-contas) 15%, transparent)', borderRadius: 'var(--mf-r-md)', fontSize: 'var(--mf-t-xs)', color:'var(--mf-text-2)', lineHeight:1.6 }}>
            O job de repost roda automaticamente a cada hora e verifica quais posts atingiram as condições das regras ativas.
          </div>
        </motion.div>
      </div>
    </PageShell>
  );
}
