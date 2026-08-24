import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import PageShell from '../components/PageShell';

const KEY_GOAL    = 'fat_goal';
const KEY_ENTRIES = 'fat_entries';

function loadGoal()    { return Number(localStorage.getItem(KEY_GOAL)) || 0; }
function loadEntries() { try { return JSON.parse(localStorage.getItem(KEY_ENTRIES) || '[]'); } catch { return []; } }

function fmtBRL(v) { return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }

const MONTHS = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

export default function Faturamento() {
  const [goal, setGoal]             = useState(loadGoal);
  const [goalInput, setGoalInput]   = useState('');
  const [editGoal, setEditGoal]     = useState(false);
  const [entries, setEntries]       = useState(loadEntries);
  const [amount, setAmount]         = useState('');
  const [desc, setDesc]             = useState('');

  const now      = new Date();
  const monthKey = `${now.getFullYear()}-${now.getMonth()}`;
  const thisMonth = entries.filter(e => e.month === monthKey);
  const total    = thisMonth.reduce((s, e) => s + e.amount, 0);
  const pct      = goal > 0 ? Math.min(100, (total / goal) * 100) : 0;
  const reached  = pct >= 100;

  useEffect(() => { localStorage.setItem(KEY_GOAL, goal); }, [goal]);
  useEffect(() => { localStorage.setItem(KEY_ENTRIES, JSON.stringify(entries)); }, [entries]);

  function saveGoal() {
    const v = parseFloat(goalInput.replace(',', '.'));
    if (!isNaN(v) && v > 0) { setGoal(v); setEditGoal(false); setGoalInput(''); }
  }

  function addEntry(e) {
    e.preventDefault();
    const v = parseFloat(amount.replace(',', '.'));
    if (isNaN(v) || v <= 0) return;
    setEntries(p => [...p, {
      id: Date.now(), amount: v,
      desc: desc.trim() || 'Venda',
      month: monthKey,
      date: new Date().toISOString(),
    }]);
    setAmount(''); setDesc('');
  }

  function removeEntry(id) { setEntries(p => p.filter(e => e.id !== id)); }

  const pageIcon = (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/>
    </svg>
  );

  const cardStyle = { background:'oklch(0.16 0.05 235 / 0.85)', border:'1px solid var(--mf-border)', borderRadius:14, overflow:'hidden', backdropFilter:'blur(12px)' };

  return (
    <PageShell
      icon={pageIcon}
      title="Faturamento"
      subtitle="Acompanhe sua meta de vendas mensal e registre suas receitas"
      accent="gold"
    >
      {/* Progress card */}
      <motion.div initial={{ opacity:0, y:10 }} animate={{ opacity:1, y:0 }} transition={{ duration:.25 }} style={{ ...cardStyle, marginBottom:14 }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'12px 16px', borderBottom:'1px solid var(--mf-border)' }}>
          <h3 style={{ fontSize:'.88rem', fontWeight:700, color:'var(--mf-text)', margin:0 }}>{MONTHS[now.getMonth()]} {now.getFullYear()}</h3>
          <button onClick={() => { setGoalInput(goal ? goal.toFixed(2) : ''); setEditGoal(true); }}
            style={{ fontSize:11, color:'var(--mf-mod, var(--mf-accent-500))', background:'none', border:'none', cursor:'pointer', fontWeight:700 }}>
            {goal ? 'Editar meta' : 'Definir meta'}
          </button>
        </div>
        <div style={{ padding:'16px 18px' }}>
          {editGoal && (
            <div style={{ display:'flex', gap:8, marginBottom:20 }}>
              <input
                value={goalInput}
                onChange={e => setGoalInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && saveGoal()}
                placeholder="Ex: 5000,00"
                autoFocus
                style={{ flex:1, height:38, padding:'0 12px', borderRadius:8, border:'1px solid oklch(0.72 0.19 196 / 0.3)', background:'oklch(0.10 0.03 235 / 0.8)', color:'var(--mf-text)', fontSize:14, outline:'none' }}
              />
              <button onClick={saveGoal} style={{ height:38, padding:'0 16px', borderRadius:8, background:'var(--mf-mod, var(--mf-accent-500))', color:'var(--mf-bg)', border:'none', fontWeight:700, cursor:'pointer' }}>Salvar</button>
              <button onClick={() => setEditGoal(false)} className="btn-ghost" style={{ height:38, padding:'0 12px', borderRadius:8 }}>Cancelar</button>
            </div>
          )}

          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-end', marginBottom:16 }}>
            <div>
              <div style={{ fontSize:32, fontWeight:900, color:'var(--mf-mod, var(--mf-accent-500))', letterSpacing:'-1px', fontVariantNumeric:'tabular-nums' }}>{fmtBRL(total)}</div>
              <div style={{ fontSize:12, color:'var(--mf-text-3)', marginTop:2 }}>
                de {goal > 0 ? fmtBRL(goal) : <span style={{ color:'var(--mf-mod, var(--mf-accent-500))', cursor:'pointer' }} onClick={() => setEditGoal(true)}>definir meta</span>}
              </div>
            </div>
            <div style={{ textAlign:'right' }}>
              <div style={{ fontSize:32, fontWeight:900, color: reached ? 'var(--mf-success-500)' : 'var(--mf-text)', letterSpacing:'-1px', fontVariantNumeric:'tabular-nums' }}>{pct.toFixed(0)}%</div>
              <div style={{ fontSize:12, color:'var(--mf-text-3)', marginTop:2, fontFamily:'var(--mf-mono)' }}>{thisMonth.length} {thisMonth.length === 1 ? 'venda' : 'vendas'}</div>
            </div>
          </div>

          <div style={{ height:10, borderRadius:99, background:'oklch(0.10 0.03 235 / 0.6)', overflow:'hidden', marginBottom:8 }}>
            <motion.div
              initial={{ width:0 }}
              animate={{ width:`${pct}%` }}
              transition={{ duration:.7, ease:'easeOut' }}
              style={{ height:'100%', borderRadius:99, background: reached ? 'var(--mf-success-500)' : 'linear-gradient(90deg, var(--mf-mod, var(--mf-accent-500)), #00b8d9)' }}
            />
          </div>

          <div style={{ fontSize:11, color: reached ? 'var(--mf-success-500)' : 'var(--mf-text-3)' }}>
            {reached
              ? '✅ Meta atingida! Parabéns!'
              : goal > 0
                ? `Faltam ${fmtBRL(goal - total)} para atingir a meta`
                : 'Defina uma meta para acompanhar o progresso'}
          </div>
        </div>
      </motion.div>

      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(280px, 1fr))', gap:14 }}>
        {/* Registrar venda */}
        <motion.div initial={{ opacity:0, y:10 }} animate={{ opacity:1, y:0 }} transition={{ duration:.25, delay:.06 }} style={cardStyle}>
          <div style={{ padding:'12px 16px', borderBottom:'1px solid var(--mf-border)' }}>
            <h3 style={{ fontSize:'.88rem', fontWeight:700, color:'var(--mf-text)', margin:0 }}>Registrar venda</h3>
          </div>
          <div style={{ padding:'14px 16px' }}>
            <form onSubmit={addEntry} style={{ display:'flex', flexDirection:'column', gap:12 }}>
              <div>
                <label style={{ fontSize:11, color:'var(--mf-text-3)', display:'block', marginBottom:5, fontFamily:'var(--mf-mono)', textTransform:'uppercase', letterSpacing:'.05em' }}>Valor (R$) *</label>
                <input
                  type="text" value={amount} onChange={e => setAmount(e.target.value)}
                  placeholder="0,00" required
                  style={{ width:'100%', height:40, padding:'0 12px', borderRadius:8, border:'1px solid var(--mf-border)', background:'oklch(0.10 0.03 235 / 0.8)', color:'var(--mf-text)', fontSize:14, boxSizing:'border-box', outline:'none' }}
                />
              </div>
              <div>
                <label style={{ fontSize:11, color:'var(--mf-text-3)', display:'block', marginBottom:5, fontFamily:'var(--mf-mono)', textTransform:'uppercase', letterSpacing:'.05em' }}>Descrição</label>
                <input
                  type="text" value={desc} onChange={e => setDesc(e.target.value)}
                  placeholder="Ex: Produto X, Serviço Y"
                  style={{ width:'100%', height:40, padding:'0 12px', borderRadius:8, border:'1px solid var(--mf-border)', background:'oklch(0.10 0.03 235 / 0.8)', color:'var(--mf-text)', fontSize:14, boxSizing:'border-box', outline:'none' }}
                />
              </div>
              <button type="submit" className="btn-primary" style={{ height:42, borderRadius:8, fontSize:13, display:'flex', alignItems:'center', justifyContent:'center' }}>
                + Registrar venda
              </button>
            </form>
          </div>
        </motion.div>

        {/* Histórico */}
        <motion.div initial={{ opacity:0, y:10 }} animate={{ opacity:1, y:0 }} transition={{ duration:.25, delay:.1 }} style={cardStyle}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'12px 16px', borderBottom:'1px solid var(--mf-border)' }}>
            <h3 style={{ fontSize:'.88rem', fontWeight:700, color:'var(--mf-text)', margin:0 }}>Histórico do mês</h3>
            <span style={{ fontSize:11, color:'var(--mf-text-3)', fontFamily:'var(--mf-mono)', background:'oklch(0.10 0.03 235 / 0.6)', border:'1px solid var(--mf-border)', borderRadius:100, padding:'2px 8px' }}>{thisMonth.length} {thisMonth.length === 1 ? 'venda' : 'vendas'}</span>
          </div>
          <div style={{ maxHeight:300, overflowY:'auto' }}>
            {thisMonth.length === 0 ? (
              <div style={{ textAlign:'center', padding:'32px 16px', color:'var(--mf-text-3)', fontSize:12 }}>
                <div style={{ fontSize:28, marginBottom:8 }}>💰</div>
                Nenhuma venda registrada este mês.
              </div>
            ) : (
              [...thisMonth].reverse().map((e, i) => (
                <div key={e.id} style={{
                  display:'flex', justifyContent:'space-between', alignItems:'center',
                  padding:'10px 16px',
                  borderBottom: i < thisMonth.length - 1 ? '1px solid var(--mf-border)' : 'none',
                }}>
                  <div>
                    <div style={{ fontSize:12, fontWeight:600, color:'var(--mf-text)' }}>{e.desc}</div>
                    <div style={{ fontSize:10, color:'var(--mf-text-3)', marginTop:1, fontFamily:'var(--mf-mono)' }}>
                      {new Date(e.date).toLocaleDateString('pt-BR')}
                    </div>
                  </div>
                  <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                    <span style={{ fontSize:14, fontWeight:800, color:'var(--mf-mod, var(--mf-accent-500))', fontVariantNumeric:'tabular-nums' }}>{fmtBRL(e.amount)}</span>
                    <button onClick={() => removeEntry(e.id)} className="btn-ghost" style={{ padding:'2px 7px', borderRadius:6, fontSize:14, lineHeight:1 }}
                      onMouseEnter={ev => ev.currentTarget.style.color = 'var(--mf-danger-500)'}
                      onMouseLeave={ev => ev.currentTarget.style.color = ''}
                    >×</button>
                  </div>
                </div>
              ))
            )}
          </div>
        </motion.div>
      </div>
    </PageShell>
  );
}
