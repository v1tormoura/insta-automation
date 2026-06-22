import { useEffect, useState } from 'react';
import api from '../services/api';
import Toast from '../components/Toast';

export default function Settings() {
  const [settings, setSettings] = useState({ headless: false });
  const [toast, setToast] = useState(null);

  function showToast(type, title, message) { setToast({ type, title, message }); setTimeout(() => setToast(null), 3500); }

  async function loadSettings() { const res = await api.get('/settings'); setSettings(res.data); }

  async function updateHeadless(value) {
    try {
      const res = await api.patch('/settings', { headless: value });
      setSettings(res.data);
      showToast('success', 'Configuração salva', value ? 'A automação vai rodar oculta nas próximas execuções.' : 'A automação vai mostrar o navegador nas próximas execuções.');
    } catch (err) { showToast('error', 'Erro', err.response?.data?.error || 'Erro ao salvar configuração.'); }
  }

  useEffect(() => { loadSettings(); }, []);

  return (
    <div>
      <div className="page-header">
        <div className="page-header-left">
          <div className="eyebrow">Sistema</div>
          <h1>Configurações</h1>
          <p>Controle o modo de execução da automação.</p>
        </div>
        <div className="page-header-right">
          <span className="badge badge-green"><span className="dot"></span>Configurações ativas</span>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        {/* Headless toggle */}
        <div className="card">
          <div className="card-header"><h3>Automação</h3></div>
          <div className="setting-row">
            <div className="setting-info">
              <strong>Headless Global</strong>
              <span>Quando ativado, o navegador roda em segundo plano sem abrir janela visível.</span>
            </div>
            <div
              className={`toggle${settings.headless ? ' on' : ''}`}
              onClick={() => updateHeadless(!settings.headless)}
            />
          </div>
        </div>

        {/* Mode info */}
        <div className="card">
          <div className="card-header"><h3>Modo atual</h3></div>
          <div style={{ padding: '8px 0' }}>
            <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 8, color: settings.headless ? '#10b981' : '#6366f1' }}>
              {settings.headless ? '🤫 Oculto / Headless' : '👁️ Visível / Navegador aberto'}
            </div>
            <p style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.6 }}>
              A alteração vale para as próximas postagens. Se algum navegador já estiver aberto, feche antes de testar.
            </p>
          </div>

          {/* System status */}
          <div style={{ marginTop: 16, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 10 }}>Status do sistema</div>
            {[
              { label: 'Backend', ok: true },
              { label: 'Worker', ok: true },
              { label: 'MongoDB', ok: true },
              { label: 'Redis', ok: true },
            ].map(s => (
              <div className="sys-row" key={s.label}>
                <span className="sys-row-name"><span className={`sys-dot ${s.ok ? 'green' : 'red'}`}></span>{s.label}</span>
                <span className={`badge badge-${s.ok ? 'green' : 'red'}`}>{s.ok ? 'OK' : 'Offline'}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}
