import { useEffect, useState } from 'react';
import api from '../services/api';

const fmtK = v => { const n = Number(v||0); return n>=1e6?(n/1e6).toFixed(1)+'M':n>=1e3?(n/1e3).toFixed(1)+'K':String(n); };

const EMPTY_FORM = { name: '', accountId: '', caption: '', durationHours: '48', variantAFile: '', variantBFile: '' };

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
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/abtests', form);
      setForm(EMPTY_FORM);
      await load();
    } catch (e) {
      alert(e.response?.data?.error || e.message);
    } finally {
      setSaving(false);
    }
  }

  async function endTest(id) {
    try { await api.post(`/abtests/${id}/end`); await load(); }
    catch (e) { alert(e.response?.data?.error || e.message); }
  }

  async function startTest(id) {
    try { await api.post(`/abtests/${id}/start`); await load(); }
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
        <p style={{ color: 'var(--text2)', fontSize: 13, marginTop: 4 }}>Compare duas capas de Reel para descobrir qual converte mais</p>
      </div>

      {error && <div style={{ color: 'var(--red)', marginBottom: 14, fontSize: 13 }}>{error}</div>}

      <div className="layout-2col">
        {/* Left column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

          {loading && <div className="card card-p" style={{ textAlign: 'center', color: 'var(--text2)' }}>Carregando...</div>}

          {/* Active tests */}
          {active.map(test => {
            const a = test.variantA || {};
            const b = test.variantB || {};
            const maxCtr = Math.max(a.views || 0, b.views || 0, 1);
            return (
              <div key={test._id} className="card card-p">
                <div className="sec-header">
                  <div className="sec-title">{test.name}</div>
                  <span className="badge badge-green">● Em andamento</span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 14 }}>
                  @{test.accountId?.username} · {test.durationHours}h de duração
                </div>
                <div className="g2" style={{ gap: 10, marginBottom: 14 }}>
                  {[
                    { v: a, label: 'Variante A', color: 'var(--cyan)' },
                    { v: b, label: 'Variante B', color: 'var(--indigo)' },
                  ].map(({ v, label, color }) => (
                    <div key={label} style={{ background: 'rgba(255,255,255,.025)', border: `1px solid color-mix(in srgb,${color} 30%,transparent)`, borderRadius: 11, padding: '14px 16px' }}>
                      <div style={{ fontWeight: 700, color, fontSize: 13, marginBottom: 10 }}>{label}</div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4, textAlign: 'center', marginBottom: 8 }}>
                        <div><div style={{ fontWeight: 700, fontSize: 13 }}>{fmtK(v.views)}</div><div style={{ fontSize: 9, color: 'var(--text3)' }}>Views</div></div>
                        <div><div style={{ fontWeight: 700, fontSize: 13 }}>{fmtK(v.likes)}</div><div style={{ fontSize: 9, color: 'var(--text3)' }}>Likes</div></div>
                        <div><div style={{ fontWeight: 700, fontSize: 13, color: 'var(--green)' }}>{fmtK(v.saves)}</div><div style={{ fontSize: 9, color: 'var(--text3)' }}>Saves</div></div>
                      </div>
                      <div className="progress-track prog-h5">
                        <div className="progress-fill" style={{ width: `${((v.views||0)/maxCtr)*100}%`, background: color }} />
                      </div>
                    </div>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn btn-ghost btn-sm" onClick={() => endTest(test._id)}>⏹ Encerrar</button>
                  <button className="btn btn-danger btn-sm" onClick={() => deleteTest(test._id)}>🗑</button>
                </div>
              </div>
            );
          })}

          {/* Pending tests */}
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
              <div className="sec-header"><div className="sec-title">Testes concluídos</div></div>
              {finished.map(test => (
                <div key={test._id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 0', borderBottom: '1px solid var(--border)' }}>
                  <div style={{ width: 32, height: 32, borderRadius: 8, background: 'rgba(16,185,129,.1)', border: '1px solid rgba(16,185,129,.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, flexShrink: 0 }}>✓</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{test.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>Variante {test.winner} venceu</div>
                  </div>
                  <button className="btn btn-ghost btn-sm" onClick={() => deleteTest(test._id)}>✕</button>
                </div>
              ))}
            </div>
          )}

          {!loading && tests.length === 0 && (
            <div className="empty-state"><div className="empty-icon">🧪</div><div className="empty-title">Nenhum teste ainda</div><div className="empty-sub">Crie o primeiro A/B teste usando o formulário ao lado.</div></div>
          )}
        </div>

        {/* Right: form */}
        <form onSubmit={submit} className="card card-p" style={{ alignSelf: 'start' }}>
          <div className="sec-header" style={{ marginBottom: 16 }}><div className="sec-title">Novo teste</div></div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="input-wrap">
              <label className="input-label">Nome do teste</label>
              <input className="input" required placeholder="Ex: Cover Verão A vs B" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="input-wrap">
              <label className="input-label">Conta</label>
              <select className="input" required value={form.accountId} onChange={e => setForm(f => ({ ...f, accountId: e.target.value }))}>
                <option value="">Selecionar...</option>
                {accounts.map(a => <option key={a._id} value={a._id}>@{a.username}</option>)}
              </select>
            </div>
            <div className="input-wrap">
              <label className="input-label">Capa — Variante A (arquivo em /uploads)</label>
              <input className="input" placeholder="nome_arquivo.jpg" value={form.variantAFile} onChange={e => setForm(f => ({ ...f, variantAFile: e.target.value }))} />
            </div>
            <div className="input-wrap">
              <label className="input-label">Capa — Variante B (arquivo em /uploads)</label>
              <input className="input" placeholder="nome_arquivo_b.jpg" value={form.variantBFile} onChange={e => setForm(f => ({ ...f, variantBFile: e.target.value }))} />
            </div>
            <div className="input-wrap">
              <label className="input-label">Duração</label>
              <select className="input" value={form.durationHours} onChange={e => setForm(f => ({ ...f, durationHours: e.target.value }))}>
                <option value="24">24 horas</option>
                <option value="48">48 horas</option>
                <option value="72">72 horas</option>
                <option value="168">7 dias</option>
              </select>
            </div>
            <div className="input-wrap">
              <label className="input-label">Legenda</label>
              <textarea className="input" rows={3} placeholder="Legenda para ambas as variantes..." value={form.caption} onChange={e => setForm(f => ({ ...f, caption: e.target.value }))} />
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
