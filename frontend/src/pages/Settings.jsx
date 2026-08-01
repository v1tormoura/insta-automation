import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import api from '../services/api';
import Toast from '../components/Toast';
import PageShell from '../components/PageShell';

const SYS_ROWS = [
  { label:'Backend', ok:true },
  { label:'Worker',  ok:true },
  { label:'MongoDB', ok:true },
  { label:'Redis',   ok:true },
];

export default function Settings() {
  const [settings, setSettings] = useState({ headless: false });
  const [toast, setToast]       = useState(null);

  function showToast(type, title, message) { setToast({ type, title, message }); setTimeout(() => setToast(null), 3500); }

  async function loadSettings() { const res = await api.get('/settings'); setSettings(res.data); }

  async function updateHeadless(value) {
    try {
      const res = await api.patch('/settings', { headless: value });
      setSettings(res.data);
      showToast('success', 'Configuração salva', value
        ? 'A automação vai rodar oculta nas próximas execuções.'
        : 'A automação vai mostrar o navegador nas próximas execuções.');
    } catch (err) { showToast('error', 'Erro', err.response?.data?.error || 'Erro ao salvar configuração.'); }
  }

  useEffect(() => { loadSettings(); }, []);

  const pageIcon = (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3"/><path d="M19.07 4.93l-1.41 1.41M4.93 4.93l1.41 1.41M12 2v2m0 16v2m7.07-7h-2M4.93 12H3m14.66 5.66l-1.41-1.41M6.34 6.34L4.93 4.93"/>
    </svg>
  );

  const pageActions = (
    <div style={{ display:'flex', alignItems:'center', gap:6, fontSize:11, fontWeight:700, color:'#4ade80', padding:'5px 12px', borderRadius:99, background:'oklch(0.22 0.06 150 / 0.25)', border:'1px solid oklch(0.38 0.12 150 / 0.3)' }}>
      <span style={{ width:6, height:6, borderRadius:'50%', background:'#4ade80', display:'inline-block', boxShadow:'0 0 6px #4ade80' }} />
      Configurações ativas
    </div>
  );

  const cardStyle  = { background:'oklch(0.16 0.05 235 / 0.85)', border:'1px solid oklch(1 0 0 / 0.07)', borderRadius:14, overflow:'hidden', backdropFilter:'blur(12px)' };

  return (
    <>
      <Toast toast={toast} onClose={() => setToast(null)} />
      <PageShell icon={pageIcon} title="Configurações" subtitle="Controle o modo de execução da automação." accent="cyan" actions={pageActions}>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>

          {/* Headless toggle card */}
          <motion.div initial={{ opacity:0, y:10 }} animate={{ opacity:1, y:0 }} transition={{ duration:.25 }} style={cardStyle}>
            <div style={{ padding:'12px 16px', borderBottom:'1px solid oklch(1 0 0 / 0.07)' }}>
              <h3 style={{ fontSize:'.88rem', fontWeight:700, color:'var(--text)', margin:0 }}>Automação</h3>
            </div>
            <div style={{ padding:'16px' }}>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:16 }}>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:13, fontWeight:700, color:'var(--text)', marginBottom:4 }}>Headless Global</div>
                  <div style={{ fontSize:11, color:'var(--text3)', lineHeight:1.6 }}>Quando ativado, o navegador roda em segundo plano sem abrir janela visível.</div>
                </div>
                <div
                  onClick={() => updateHeadless(!settings.headless)}
                  style={{
                    width:44, height:24, borderRadius:99, cursor:'pointer', flexShrink:0,
                    background: settings.headless ? 'var(--cyan)' : 'oklch(0.20 0.04 235 / 0.8)',
                    border: settings.headless ? '1px solid oklch(0.72 0.19 196 / 0.5)' : '1px solid oklch(1 0 0 / 0.1)',
                    position:'relative', transition:'background .2s, border .2s',
                  }}
                >
                  <div style={{
                    position:'absolute', top:3, left: settings.headless ? 22 : 3,
                    width:16, height:16, borderRadius:'50%', background:'#fff',
                    transition:'left .2s', boxShadow:'0 1px 4px oklch(0 0 0 / 0.3)',
                  }} />
                </div>
              </div>
            </div>
          </motion.div>

          {/* Mode info + system status card */}
          <motion.div initial={{ opacity:0, y:10 }} animate={{ opacity:1, y:0 }} transition={{ duration:.25, delay:.06 }} style={cardStyle}>
            <div style={{ padding:'12px 16px', borderBottom:'1px solid oklch(1 0 0 / 0.07)' }}>
              <h3 style={{ fontSize:'.88rem', fontWeight:700, color:'var(--text)', margin:0 }}>Modo atual</h3>
            </div>
            <div style={{ padding:'16px' }}>
              <div style={{ fontSize:20, fontWeight:800, marginBottom:8, color: settings.headless ? '#4ade80' : 'oklch(0.68 0.18 270)' }}>
                {settings.headless ? '🤫 Oculto / Headless' : '👁️ Visível / Navegador aberto'}
              </div>
              <p style={{ fontSize:12, color:'var(--text3)', lineHeight:1.6, margin:'0 0 16px' }}>
                A alteração vale para as próximas postagens. Se algum navegador já estiver aberto, feche antes de testar.
              </p>

              <div style={{ borderTop:'1px solid oklch(1 0 0 / 0.07)', paddingTop:14 }}>
                <div style={{ fontSize:10, fontWeight:700, color:'var(--text3)', textTransform:'uppercase', letterSpacing:'.07em', marginBottom:10, fontFamily:'var(--font-mono)' }}>Status do sistema</div>
                <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                  {SYS_ROWS.map((s, i) => (
                    <motion.div key={s.label} initial={{ opacity:0, x:-6 }} animate={{ opacity:1, x:0 }} transition={{ delay:.15 + i * .04 }}
                      style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'7px 10px', borderRadius:8, background:'oklch(0.12 0.04 235 / 0.5)' }}>
                      <div style={{ display:'flex', alignItems:'center', gap:8, fontSize:12, fontWeight:600, color:'var(--text)' }}>
                        <span style={{ width:7, height:7, borderRadius:'50%', background: s.ok ? '#4ade80' : '#f87171', display:'inline-block', boxShadow: s.ok ? '0 0 6px #4ade80' : '0 0 6px #f87171' }} />
                        {s.label}
                      </div>
                      <span style={{ fontSize:10, fontWeight:700, padding:'1px 8px', borderRadius:99, background: s.ok ? 'oklch(0.22 0.06 150 / 0.6)' : 'oklch(0.22 0.06 15 / 0.6)', color: s.ok ? '#4ade80' : '#f87171', border:`1px solid ${s.ok ? 'oklch(0.38 0.12 150 / 0.35)' : 'oklch(0.38 0.12 15 / 0.35)'}` }}>
                        {s.ok ? 'OK' : 'Offline'}
                      </span>
                    </motion.div>
                  ))}
                </div>
              </div>
            </div>
          </motion.div>

        </div>
      </PageShell>
    </>
  );
}
