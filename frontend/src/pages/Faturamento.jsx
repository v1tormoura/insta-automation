import { useState, useEffect } from 'react';

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

  return (
    <div>
      <div className="page-header">
        <div className="page-header-left">
          <div className="eyebrow">Visão Geral</div>
          <h1>Faturamento</h1>
          <p>Acompanhe sua meta de vendas mensal e registre suas receitas.</p>
        </div>
      </div>

      {/* Card de progresso */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-header">
          <span>{MONTHS[now.getMonth()]} {now.getFullYear()}</span>
          <button onClick={() => { setGoalInput(goal ? goal.toFixed(2) : ''); setEditGoal(true); }}
            style={{ fontSize: 11, color: 'var(--cyan)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700 }}>
            {goal ? 'Editar meta' : 'Definir meta'}
          </button>
        </div>
        <div className="card-body">
          {editGoal && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
              <input
                value={goalInput}
                onChange={e => setGoalInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && saveGoal()}
                placeholder="Ex: 5000,00"
                autoFocus
                style={{ flex: 1, height: 38, padding: '0 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg3)', color: 'var(--text)', fontSize: 14 }}
              />
              <button onClick={saveGoal} style={{ height: 38, padding: '0 16px', borderRadius: 8, background: 'var(--cyan)', color: '#040e1c', border: 'none', fontWeight: 700, cursor: 'pointer' }}>Salvar</button>
              <button onClick={() => setEditGoal(false)} style={{ height: 38, padding: '0 12px', borderRadius: 8, background: 'none', border: '1px solid var(--border)', color: 'var(--text2)', cursor: 'pointer' }}>Cancelar</button>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 14 }}>
            <div>
              <div style={{ fontSize: 32, fontWeight: 900, color: 'var(--cyan)', letterSpacing: '-1px' }}>{fmtBRL(total)}</div>
              <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>
                de {goal > 0 ? fmtBRL(goal) : <span style={{ color: 'var(--cyan)', cursor: 'pointer' }} onClick={() => setEditGoal(true)}>definir meta</span>}
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 32, fontWeight: 900, color: reached ? '#22c55e' : 'var(--text)', letterSpacing: '-1px' }}>{pct.toFixed(0)}%</div>
              <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>{thisMonth.length} {thisMonth.length === 1 ? 'venda' : 'vendas'}</div>
            </div>
          </div>

          <div style={{ height: 10, borderRadius: 99, background: 'var(--bg3)', overflow: 'hidden', marginBottom: 8 }}>
            <div style={{
              height: '100%', borderRadius: 99, transition: 'width .6s cubic-bezier(.4,0,.2,1)',
              background: reached ? '#22c55e' : 'linear-gradient(90deg, var(--cyan), #00b8d9)',
              width: `${pct}%`,
            }} />
          </div>

          <div style={{ fontSize: 11, color: reached ? '#22c55e' : 'var(--text3)' }}>
            {reached
              ? '✅ Meta atingida! Parabéns!'
              : goal > 0
                ? `Faltam ${fmtBRL(goal - total)} para atingir a meta`
                : 'Defina uma meta para acompanhar o progresso'}
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        {/* Registrar venda */}
        <div className="card">
          <div className="card-header"><span>Registrar venda</span></div>
          <div className="card-body">
            <form onSubmit={addEntry} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={{ fontSize: 11, color: 'var(--text3)', display: 'block', marginBottom: 5 }}>Valor (R$) *</label>
                <input
                  type="text" value={amount} onChange={e => setAmount(e.target.value)}
                  placeholder="0,00" required
                  style={{ width: '100%', height: 40, padding: '0 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg3)', color: 'var(--text)', fontSize: 14, boxSizing: 'border-box' }}
                />
              </div>
              <div>
                <label style={{ fontSize: 11, color: 'var(--text3)', display: 'block', marginBottom: 5 }}>Descrição</label>
                <input
                  type="text" value={desc} onChange={e => setDesc(e.target.value)}
                  placeholder="Ex: Produto X, Serviço Y"
                  style={{ width: '100%', height: 40, padding: '0 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg3)', color: 'var(--text)', fontSize: 14, boxSizing: 'border-box' }}
                />
              </div>
              <button type="submit" style={{
                height: 42, borderRadius: 8, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 13,
                background: 'linear-gradient(100deg, var(--cyan), #00b8d9)', color: '#040e1c',
                boxShadow: '0 6px 18px rgba(0,212,255,.2)',
              }}>
                + Registrar venda
              </button>
            </form>
          </div>
        </div>

        {/* Histórico */}
        <div className="card">
          <div className="card-header">
            <span>Histórico do mês</span>
            <span style={{ fontSize: 11, color: 'var(--text3)' }}>{thisMonth.length} {thisMonth.length === 1 ? 'venda' : 'vendas'}</span>
          </div>
          <div className="card-body" style={{ maxHeight: 300, overflowY: 'auto', padding: 0 }}>
            {thisMonth.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '32px 16px', color: 'var(--text3)', fontSize: 12 }}>
                <div style={{ fontSize: 28, marginBottom: 8 }}>💰</div>
                Nenhuma venda registrada este mês.
              </div>
            ) : (
              [...thisMonth].reverse().map((e, i) => (
                <div key={e.id} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '10px 18px',
                  borderBottom: i < thisMonth.length - 1 ? '1px solid var(--border)' : 'none',
                }}>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>{e.desc}</div>
                    <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 1 }}>
                      {new Date(e.date).toLocaleDateString('pt-BR')}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--cyan)' }}>{fmtBRL(e.amount)}</span>
                    <button onClick={() => removeEntry(e.id)} style={{ background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: 2, borderRadius: 4 }}
                      onMouseEnter={ev => ev.currentTarget.style.color = '#f87171'}
                      onMouseLeave={ev => ev.currentTarget.style.color = 'var(--text3)'}
                    >×</button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
