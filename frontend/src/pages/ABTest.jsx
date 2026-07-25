import { useEffect, useState } from 'react';
import api from '../services/api';

const fmtK = v => { const n = Number(v||0); return n>=1e6?(n/1e6).toFixed(1)+'M':n>=1e3?(n/1e3).toFixed(1)+'K':String(n); };

const EMPTY_FORM = { name: '', accountId: '', igMediaIdA: '', igMediaIdB: '', durationHours: '48' };

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

  return (
    <>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--cyan)', textTransform: 'uppercase', letterSpacing: '.8px', marginBottom: 4 }}>Viralizar</div>
        <h1>A/B Teste de Capa</h1>
        <p style={{ color: 'var(--text2)', fontSize: 13, marginTop: 4 }}>
          Compare dois Reels já publicados para descobrir qual capa converte mais
        </p>
      </div>

      {error && (
        <div style={{ background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.3)', borderRadius: 10, padding: '10px 14px', color: '#f87171', fontSize: 13, marginBottom: 14 }}>
          {error}
        </div>
      )}

      <div className="layout-2col">
        {/* Left — tests list */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

          {loading && <div className="card card-p" style={{ textAlign: 'center', color: 'var(--text2)' }}>Carregando...</div>}

          {/* Active */}
          {active.map(test => {
            const a = test.variantA || {};
            const b = test.variantB || {};
            const maxV = Math.max(a.views || 0, b.views || 0, 1);
            const pct  = v => Math.round(((v||0) / maxV) * 100);
            return (
              <div key={test._id} className="card card-p">
                <div className="sec-header">
                  <div>
                    <div className="sec-title">{test.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>@{test.accountId?.username} · {test.durationHours}h</div>
                  </div>
                  <span className="badge badge-green" style={{ alignSelf: 'flex-start' }}>● Em andamento</span>
                </div>

                <div className="g2" style={{ gap: 10, marginTop: 12, marginBottom: 14 }}>
                  {[
                    { v: a, label: 'Variante A', color: 'var(--cyan)',   id: a.igMediaId },
                    { v: b, label: 'Variante B', color: 'var(--indigo)', id: b.igMediaId },
                  ].map(({ v, label, color, id }) => (
                    <div key={label} style={{ background: 'rgba(255,255,255,.025)', border: `1px solid color-mix(in srgb,${color} 28%,transparent)`, borderRadius: 11, padding: '12px 14px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                        <div style={{ fontWeight: 700, color, fontSize: 13 }}>{label}</div>
                        {id && <span style={{ fontSize: 9, color: 'var(--text3)', fontFamily: 'monospace' }}>{id.slice(0,14)}…</span>}
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4, textAlign: 'center', marginBottom: 10 }}>
                        <div><div style={{ fontWeight: 700, fontSize: 14 }}>{fmtK(v.views)}</div><div style={{ fontSize: 9, color: 'var(--text3)' }}>Views</div></div>
                        <div><div style={{ fontWeight: 700, fontSize: 14 }}>{fmtK(v.likes)}</div><div style={{ fontSize: 9, color: 'var(--text3)' }}>Likes</div></div>
                        <div><div style={{ fontWeight: 700, fontSize: 14, color: 'var(--green)' }}>{fmtK(v.saves)}</div><div style={{ fontSize: 9, color: 'var(--text3)' }}>Saves</div></div>
                      </div>
                      <div style={{ height: 5, background: 'rgba(255,255,255,.06)', borderRadius: 3 }}>
                        <div style={{ height: '100%', borderRadius: 3, background: color, width: `${pct(v.views)}%`, transition: 'width .4s' }} />
                      </div>
                    </div>
                  ))}
                </div>

                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn btn-ghost btn-sm" onClick={() => endTest(test._id)}>⏹ Encerrar</button>
                  <button className="btn btn-danger btn-sm" style={{ marginLeft: 'auto' }} onClick={() => deleteTest(test._id)}>🗑</button>
                </div>
              </div>
            );
          })}

          {/* Pending */}
          {pending.length > 0 && (
            <div className="card card-p">
              <div className="sec-header"><div className="sec-title">Pendentes</div></div>
              {pending.map(test => (
                <div key={test._id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{test.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text3)' }}>@{test.accountId?.username} · {test.durationHours}h</div>
                  </div>
                  <button className="btn btn-primary btn-sm" onClick={() => startTest(test._id)}>▶ Iniciar</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => deleteTest(test._id)}>✕</button>
                </div>
              ))}
            </div>
          )}

          {/* Finished */}
          {finished.length > 0 && (
            <div className="card card-p">
              <div className="sec-header"><div className="sec-title">Concluídos</div></div>
              {finished.map(test => (
                <div key={test._id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                  <div style={{ width: 32, height: 32, borderRadius: 8, background: 'rgba(16,185,129,.1)', border: '1px solid rgba(16,185,129,.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, flexShrink: 0 }}>
                    {test.winner === 'A' ? '🅰' : '🅱'}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{test.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>Variante <strong style={{ color: 'var(--green)' }}>{test.winner}</strong> venceu</div>
                  </div>
                  <button className="btn btn-ghost btn-sm" onClick={() => deleteTest(test._id)}>✕</button>
                </div>
              ))}
            </div>
          )}

          {!loading && tests.length === 0 && (
            <div className="empty-state">
              <div className="empty-icon">🧪</div>
              <div className="empty-title">Nenhum teste ainda</div>
              <div className="empty-sub">Crie o primeiro A/B teste usando o formulário ao lado.</div>
            </div>
          )}
        </div>

        {/* Right — create form */}
        <form onSubmit={submit} className="card card-p" style={{ alignSelf: 'start' }}>
          <div className="sec-header" style={{ marginBottom: 16 }}>
            <div className="sec-title">Novo teste</div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="input-wrap">
              <label className="input-label">Nome do teste</label>
              <input className="input" required placeholder="Ex: Capa Quente A vs B" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            </div>

            <div className="input-wrap">
              <label className="input-label">Conta</label>
              <select className="input" required value={form.accountId} onChange={e => setForm(f => ({ ...f, accountId: e.target.value }))}>
                <option value="">Selecionar...</option>
                {accounts.map(a => <option key={a._id} value={a._id}>@{a.username}</option>)}
              </select>
            </div>

            <div style={{ background: 'rgba(6,182,212,.06)', border: '1px solid rgba(6,182,212,.18)', borderRadius: 9, padding: '10px 12px', fontSize: 11, color: 'var(--text2)', lineHeight: 1.7 }}>
              💡 Publique os dois Reels no Instagram, depois cole o <strong>Media ID</strong> de cada um.<br />
              O ID fica na URL do post: instagram.com/reel/<strong>ABC123xyz</strong>/
            </div>

            <div className="input-wrap">
              <label className="input-label">Media ID — Variante A</label>
              <input className="input" required placeholder="Ex: 3456789012345678901" value={form.igMediaIdA} onChange={e => setForm(f => ({ ...f, igMediaIdA: e.target.value }))} style={{ fontFamily: 'monospace' }} />
            </div>

            <div className="input-wrap">
              <label className="input-label">Media ID — Variante B</label>
              <input className="input" required placeholder="Ex: 3456789098765432109" value={form.igMediaIdB} onChange={e => setForm(f => ({ ...f, igMediaIdB: e.target.value }))} style={{ fontFamily: 'monospace' }} />
            </div>

            <div className="input-wrap">
              <label className="input-label">Duração do teste</label>
              <select className="input" value={form.durationHours} onChange={e => setForm(f => ({ ...f, durationHours: e.target.value }))}>
                <option value="24">24 horas</option>
                <option value="48">48 horas</option>
                <option value="72">72 horas</option>
                <option value="168">7 dias</option>
              </select>
            </div>

            <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} disabled={saving}>
              {saving ? 'Criando...' : '🧪 Criar A/B Teste'}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
