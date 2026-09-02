import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import api from '../services/api';
import PageShell from '../components/PageShell';
import { EsqueletoLista } from '../components/Estados';

const fmtK = v => { const n = Number(v||0); return n>=1e6?(n/1e6).toFixed(1)+'M':n>=1e3?(n/1e3).toFixed(1)+'K':String(n); };

const EMPTY_FORM = { name: '', accountId: '', igMediaIdA: '', igMediaIdB: '', durationHours: '48' };

const cardStyle  = { background:'color-mix(in oklch, var(--mf-surface-1) 85%, transparent)', border:'1px solid var(--mf-border)', borderRadius: 'var(--mf-r-lg)', overflow:'hidden', backdropFilter:'blur(12px)' };
const inputStyle = { width:'100%', height:40, padding:'0 12px', borderRadius: 'var(--mf-r-sm)', border:'1px solid var(--mf-border)', background:'color-mix(in oklch, var(--mf-bg) 80%, transparent)', color:'var(--mf-text)', fontSize: 'var(--mf-t-sm)', boxSizing:'border-box', outline:'none', fontFamily:'var(--font)' };
const labelStyle = { fontSize: 'var(--mf-t-micro)', color:'var(--mf-text-3)', display:'block', marginBottom:5, fontFamily:'var(--mf-mono)', textTransform:'uppercase', letterSpacing:'.05em' };

export default function ABTest() {
  const [tests,    setTests]    = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [form,     setForm]     = useState(EMPTY_FORM);
  const [saving,   setSaving]   = useState(false);
  const [error,    setError]    = useState('');

  async function load() {
    try {
      const [t, a] = await Promise.all([api.get('/abtests'), api.get('/accounts')]);
      setTests(t.data);
      setAccounts(a.data || []);
    } catch (e) { setError(e.response?.data?.error || e.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function submit(e) {
    e.preventDefault();
    if (!form.igMediaIdA.trim() || !form.igMediaIdB.trim())
      return setError('Informe o Media ID dos dois Reels.');
    setSaving(true); setError('');
    try { await api.post('/abtests', form); setForm(EMPTY_FORM); await load(); }
    catch (e) { setError(e.response?.data?.error || e.message); }
    finally { setSaving(false); }
  }

  async function startTest(id) {
    try { await api.post(`/abtests/${id}/start`); await load(); }
    catch (e) { alert(e.response?.data?.error || e.message); }
  }
  async function endTest(id) {
    try { await api.post(`/abtests/${id}/end`); await load(); }
    catch (e) { alert(e.response?.data?.error || e.message); }
  }
  async function deleteTest(id) {
    if (!confirm('Remover teste?')) return;
    try { await api.delete(`/abtests/${id}`); await load(); }
    catch (e) { alert(e.response?.data?.error || e.message); }
  }

  const active   = tests.filter(t => t.status === 'ativo');
  const pending  = tests.filter(t => t.status === 'pendente');
  const finished = tests.filter(t => t.status === 'concluido');

  const pageIcon = (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 20V10M12 20V4M6 20v-6"/>
    </svg>
  );

  return (
    <PageShell icon={pageIcon} title="A/B Teste de Capa" subtitle="Compare dois Reels publicados para descobrir qual capa converte mais" accent="purple">

      {error && (
        <div style={{ background:'color-mix(in oklch, var(--mf-danger-500) 9%, transparent)', border:'1px solid oklch(0.38 0.12 15 / 0.35)', borderRadius: 'var(--mf-r-md)', padding:'8px 12px', color:'var(--mf-danger-500)', fontSize: 'var(--mf-t-sm)', marginBottom:14 }}>
          {error}
        </div>
      )}

      <div className="layout-form-2col" style={{ gap:14 }}>
        {/* Left — tests list */}
        <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
          {loading && <EsqueletoLista itens={3} />}

          {/* Active tests */}
          {active.map((test, i) => {
            const a = test.variantA || {};
            const b = test.variantB || {};
            const maxV = Math.max(a.views || 0, b.views || 0, 1);
            const pct  = v => Math.round(((v||0) / maxV) * 100);
            return (
              <motion.div key={test._id} initial={{ opacity:0, y:8 }} animate={{ opacity:1, y:0 }} transition={{ delay:i*.04 }} style={cardStyle}>
                <div style={{ padding:'12px 16px', borderBottom:'1px solid var(--mf-border)', display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
                  <div>
                    <div style={{ fontWeight:700, fontSize: 'var(--mf-t-body)', color:'var(--mf-text)' }}>{test.name}</div>
                    <div style={{ fontSize: 'var(--mf-t-micro)', color:'var(--mf-text-3)', marginTop:2 }}>@{test.accountId?.username} · {test.durationHours}h</div>
                  </div>
                  <span style={{ fontSize: 'var(--mf-t-nano)', fontWeight:700, padding:'2px 8px', borderRadius: 'var(--mf-r-full)', background:'color-mix(in oklch, var(--mf-success-500) 11%, transparent)', color:'var(--mf-success-500)', border:'1px solid oklch(0.38 0.12 150 / 0.3)', flexShrink:0 }}>● Em andamento</span>
                </div>

                <div style={{ padding:'12px 16px', display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
                  {[
                    { v:a, label:'Variante A', color:'var(--mf-mod, var(--mf-accent-500))',   id:a.igMediaId },
                    { v:b, label:'Variante B', color:'var(--mf-mod-publicar)', id:b.igMediaId },
                  ].map(({ v, label, color, id }) => (
                    <div key={label} style={{ background:`color-mix(in oklch, var(--mf-bg) 50%, transparent)`, border:`1px solid var(--mf-border)`, borderRadius: 'var(--mf-r-md)', padding:'12px 12px' }}>
                      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10 }}>
                        <div style={{ fontWeight:700, color, fontSize: 'var(--mf-t-sm)' }}>{label}</div>
                        {id && <span style={{ fontSize: 'var(--mf-t-nano)', color:'var(--mf-text-3)', fontFamily:'var(--mf-mono)' }}>{id.slice(0,10)}…</span>}
                      </div>
                      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:4, textAlign:'center', marginBottom:10 }}>
                        <div><div style={{ fontWeight:700, fontSize: 'var(--mf-t-body)', color:'var(--mf-text)' }}>{fmtK(v.views)}</div><div style={{ fontSize: 'var(--mf-t-nano)', color:'var(--mf-text-3)' }}>Views</div></div>
                        <div><div style={{ fontWeight:700, fontSize: 'var(--mf-t-body)', color:'var(--mf-text)' }}>{fmtK(v.likes)}</div><div style={{ fontSize: 'var(--mf-t-nano)', color:'var(--mf-text-3)' }}>Likes</div></div>
                        <div><div style={{ fontWeight:700, fontSize: 'var(--mf-t-body)', color:'var(--mf-success-500)' }}>{fmtK(v.saves)}</div><div style={{ fontSize: 'var(--mf-t-nano)', color:'var(--mf-text-3)' }}>Saves</div></div>
                      </div>
                      <div style={{ height:5, background:'color-mix(in oklch, var(--mf-bg) 60%, transparent)', borderRadius: 'var(--mf-r-xs)' }}>
                        <div style={{ height:'100%', borderRadius: 'var(--mf-r-xs)', background:color, width:`${pct(v.views)}%`, transition:'width .4s' }} />
                      </div>
                    </div>
                  ))}
                </div>

                <div style={{ padding:'8px 16px', borderTop:'1px solid var(--mf-border)', display:'flex', gap:8 }}>
                  <button className="btn-ghost" style={{ fontSize: 'var(--mf-t-xs)', padding:'4px 12px', borderRadius: 'var(--mf-r-sm)' }} onClick={() => endTest(test._id)}>Encerrar</button>
                  <button className="btn-danger" style={{ fontSize: 'var(--mf-t-xs)', padding:'4px 8px', borderRadius: 'var(--mf-r-sm)', marginLeft:'auto' }} onClick={() => deleteTest(test._id)}>🗑</button>
                </div>
              </motion.div>
            );
          })}

          {/* Pending */}
          {pending.length > 0 && (
            <motion.div initial={{ opacity:0, y:8 }} animate={{ opacity:1, y:0 }} style={cardStyle}>
              <div style={{ padding:'12px 16px', borderBottom:'1px solid var(--mf-border)' }}>
                <h3 style={{ fontSize: 'var(--mf-t-body)', fontWeight:700, color:'var(--mf-text)', margin:0 }}>Pendentes</h3>
              </div>
              {pending.map((test, i) => (
                <div key={test._id} style={{ display:'flex', alignItems:'center', gap:12, padding:'12px 16px', borderBottom: i < pending.length - 1 ? '1px solid var(--mf-border)' : 'none' }}>
                  <div style={{ flex:1 }}>
                    <div style={{ fontWeight:600, fontSize: 'var(--mf-t-sm)', color:'var(--mf-text)' }}>{test.name}</div>
                    <div style={{ fontSize: 'var(--mf-t-micro)', color:'var(--mf-text-3)', marginTop:2 }}>@{test.accountId?.username} · {test.durationHours}h</div>
                  </div>
                  <button className="btn-primary" style={{ fontSize: 'var(--mf-t-micro)', padding:'4px 12px', borderRadius: 'var(--mf-r-sm)' }} onClick={() => startTest(test._id)}>▶ Iniciar</button>
                  <button className="btn-ghost" style={{ fontSize: 'var(--mf-t-micro)', padding:'4px 8px', borderRadius: 'var(--mf-r-sm)' }} onClick={() => deleteTest(test._id)}>✕</button>
                </div>
              ))}
            </motion.div>
          )}

          {/* Finished */}
          {finished.length > 0 && (
            <motion.div initial={{ opacity:0, y:8 }} animate={{ opacity:1, y:0 }} style={cardStyle}>
              <div style={{ padding:'12px 16px', borderBottom:'1px solid var(--mf-border)' }}>
                <h3 style={{ fontSize: 'var(--mf-t-body)', fontWeight:700, color:'var(--mf-text)', margin:0 }}>Concluídos</h3>
              </div>
              {finished.map((test, i) => (
                <div key={test._id} style={{ display:'flex', alignItems:'center', gap:12, padding:'12px 16px', borderBottom: i < finished.length - 1 ? '1px solid var(--mf-border)' : 'none' }}>
                  <div style={{ width:32, height:32, borderRadius: 'var(--mf-r-sm)', background:'oklch(0.72 0.18 150 / 0.1)', border:'1px solid oklch(0.72 0.18 150 / 0.2)', display:'flex', alignItems:'center', justifyContent:'center', fontSize: 'var(--mf-t-body)', flexShrink:0 }}>
                    {test.winner === 'A' ? '🅰' : '🅱'}
                  </div>
                  <div style={{ flex:1 }}>
                    <div style={{ fontWeight:600, fontSize: 'var(--mf-t-sm)', color:'var(--mf-text)' }}>{test.name}</div>
                    <div style={{ fontSize: 'var(--mf-t-micro)', color:'var(--mf-text-3)', marginTop:2 }}>Variante <strong style={{ color:'var(--mf-success-500)' }}>{test.winner}</strong> venceu</div>
                  </div>
                  <button className="btn-ghost" style={{ fontSize: 'var(--mf-t-micro)', padding:'4px 8px', borderRadius: 'var(--mf-r-sm)' }} onClick={() => deleteTest(test._id)}>✕</button>
                </div>
              ))}
            </motion.div>
          )}

          {!loading && tests.length === 0 && (
            <div style={{ textAlign:'center', padding:'48px 16px', background:'color-mix(in oklch, var(--mf-surface-1) 50%, transparent)', border:'1px solid var(--mf-border)', borderRadius: 'var(--mf-r-lg)' }}>
              <div style={{ fontSize: 'var(--mf-t-display)', marginBottom:10 }}>🧪</div>
              <div style={{ fontWeight:700, fontSize: 'var(--mf-t-h2)', color:'var(--mf-text)', marginBottom:6 }}>Nenhum teste ainda</div>
              <div style={{ fontSize: 'var(--mf-t-sm)', color:'var(--mf-text-3)' }}>Crie o primeiro A/B teste usando o formulário ao lado.</div>
            </div>
          )}
        </div>

        {/* Right — create form */}
        <form onSubmit={submit} style={cardStyle}>
          <div style={{ padding:'12px 16px', borderBottom:'1px solid var(--mf-border)' }}>
            <h3 style={{ fontSize: 'var(--mf-t-body)', fontWeight:700, color:'var(--mf-text)', margin:0 }}>Novo teste</h3>
          </div>
          <div style={{ padding:'16px', display:'flex', flexDirection:'column', gap:12 }}>
            <div>
              <label style={labelStyle}>Nome do teste</label>
              <input style={inputStyle} required placeholder="Ex: Capa Quente A vs B" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            </div>

            <div>
              <label style={labelStyle}>Conta</label>
              <select style={{ ...inputStyle, appearance:'none' }} required value={form.accountId} onChange={e => setForm(f => ({ ...f, accountId: e.target.value }))}>
                <option value="">Selecionar...</option>
                {accounts.map(a => <option key={a._id} value={a._id}>@{a.username}</option>)}
              </select>
            </div>

            <div style={{ background:'color-mix(in oklch, var(--mf-primary-500) 7%, transparent)', border:'1px solid color-mix(in oklch, var(--mf-primary-500) 18%, transparent)', borderRadius: 'var(--mf-r-md)', padding:'8px 12px', fontSize: 'var(--mf-t-micro)', color:'var(--mf-text-2)', lineHeight:1.7 }}>
              Publique os dois Reels no Instagram, depois cole o <strong>Media ID</strong> de cada um.<br />
              O ID fica na URL do post: instagram.com/reel/<strong>ABC123xyz</strong>/
            </div>

            <div>
              <label style={labelStyle}>Media ID — Variante A</label>
              <input style={{ ...inputStyle, fontFamily:'var(--mf-mono)' }} required placeholder="Ex: 3456789012345678901" value={form.igMediaIdA} onChange={e => setForm(f => ({ ...f, igMediaIdA: e.target.value }))} />
            </div>

            <div>
              <label style={labelStyle}>Media ID — Variante B</label>
              <input style={{ ...inputStyle, fontFamily:'var(--mf-mono)' }} required placeholder="Ex: 3456789098765432109" value={form.igMediaIdB} onChange={e => setForm(f => ({ ...f, igMediaIdB: e.target.value }))} />
            </div>

            <div>
              <label style={labelStyle}>Duração do teste</label>
              <select style={{ ...inputStyle, appearance:'none' }} value={form.durationHours} onChange={e => setForm(f => ({ ...f, durationHours: e.target.value }))}>
                <option value="24">24 horas</option>
                <option value="48">48 horas</option>
                <option value="72">72 horas</option>
                <option value="168">7 dias</option>
              </select>
            </div>

            <button className="btn-primary" style={{ width:'100%', height:42, borderRadius: 'var(--mf-r-sm)', fontSize: 'var(--mf-t-sm)', display:'flex', alignItems:'center', justifyContent:'center', gap:6, opacity: saving ? .6 : 1 }} disabled={saving}>
              {saving ? 'Criando...' : '🧪 Criar A/B Teste'}
            </button>
          </div>
        </form>
      </div>
    </PageShell>
  );
}
