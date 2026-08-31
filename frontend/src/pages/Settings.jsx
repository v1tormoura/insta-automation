import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import api from '../services/api';
import Toast from '../components/Toast';
import PageShell from '../components/PageShell';
import { EsqueletoLista } from '../components/Estados';

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

  const [primeiraCarga, setPrimeiraCarga] = useState(true);

  async function loadSettings() {
    try { const res = await api.get('/settings'); setSettings(res.data); }
    finally { setPrimeiraCarga(false); }
  }

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
    <div style={{ display:'flex', alignItems:'center', gap:6, fontSize: 'var(--mf-t-micro)', fontWeight:700, color:'var(--mf-success-500)', padding:'4px 12px', borderRadius: 'var(--mf-r-full)', background:'color-mix(in oklch, var(--mf-success-500) 6%, transparent)', border:'1px solid oklch(0.38 0.12 150 / 0.3)' }}>
      <span style={{ width:6, height:6, borderRadius: 'var(--mf-r-full)', background:'var(--mf-success-500)', display:'inline-block', boxShadow:'0 0 6px var(--mf-success-500)' }} />
      Configurações ativas
    </div>
  );

  const cardStyle  = { background:'color-mix(in oklch, var(--mf-surface-1) 85%, transparent)', border:'1px solid var(--mf-border)', borderRadius: 'var(--mf-r-lg)', overflow:'hidden', backdropFilter:'blur(12px)' };

  return (
    <>
      <Toast toast={toast} onClose={() => setToast(null)} />
      <PageShell icon={pageIcon} title="Configurações" subtitle="Controle o modo de execução da automação." accent="cyan" actions={pageActions}>
        <div className="settings-grid">

          {/* Enquanto os ajustes não chegam, os interruptores desenhariam na
              posição "desligado" e saltariam para a real quando o dado
              entrasse — sugerindo que algo mudou sozinho. O esqueleto evita
              essa leitura falsa. */}
          {primeiraCarga && <EsqueletoLista itens={2} />}

          {/* Headless toggle card */}
          <motion.div initial={{ opacity:0, y:10 }} animate={{ opacity:1, y:0 }} transition={{ duration:.25 }} style={cardStyle}>
            <div style={{ padding:'12px 16px', borderBottom:'1px solid var(--mf-border)' }}>
              <h3 style={{ fontSize: 'var(--mf-t-body)', fontWeight:700, color:'var(--mf-text)', margin:0 }}>Automação</h3>
            </div>
            <div style={{ padding:'16px' }}>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:16 }}>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize: 'var(--mf-t-sm)', fontWeight:700, color:'var(--mf-text)', marginBottom:4 }}>Headless Global</div>
                  <div style={{ fontSize: 'var(--mf-t-micro)', color:'var(--mf-text-3)', lineHeight:1.6 }}>Quando ativado, o navegador roda em segundo plano sem abrir janela visível.</div>
                </div>
                <div
                  onClick={() => updateHeadless(!settings.headless)}
                  style={{
                    width:44, height:24, borderRadius: 'var(--mf-r-full)', cursor:'pointer', flexShrink:0,
                    background: settings.headless ? 'var(--mf-mod, var(--mf-accent-500))' : 'color-mix(in oklch, var(--mf-surface-2) 80%, transparent)',
                    border: settings.headless ? '1px solid oklch(0.72 0.19 196 / 0.5)' : '1px solid var(--mf-border)',
                    position:'relative', transition:'background .2s, border .2s',
                  }}
                >
                  <div style={{
                    position:'absolute', top:3, left: settings.headless ? 22 : 3,
                    width:16, height:16, borderRadius: 'var(--mf-r-full)', background:'var(--mf-text)',
                    transition:'left .2s', boxShadow:'0 1px 4px oklch(0 0 0 / 0.3)',
                  }} />
                </div>
              </div>
            </div>
          </motion.div>

          {/* Mode info + system status card */}
          <motion.div initial={{ opacity:0, y:10 }} animate={{ opacity:1, y:0 }} transition={{ duration:.25, delay:.06 }} style={cardStyle}>
            <div style={{ padding:'12px 16px', borderBottom:'1px solid var(--mf-border)' }}>
              <h3 style={{ fontSize: 'var(--mf-t-body)', fontWeight:700, color:'var(--mf-text)', margin:0 }}>Modo atual</h3>
            </div>
            <div style={{ padding:'16px' }}>
              <div style={{ fontSize: 'var(--mf-t-h1)', fontWeight:800, marginBottom:8, color: settings.headless ? 'var(--mf-success-500)' : 'oklch(0.68 0.18 270)' }}>
                {settings.headless ? '🤫 Oculto / Headless' : '👁️ Visível / Navegador aberto'}
              </div>
              <p style={{ fontSize: 'var(--mf-t-xs)', color:'var(--mf-text-3)', lineHeight:1.6, margin:'0 0 16px' }}>
                A alteração vale para as próximas postagens. Se algum navegador já estiver aberto, feche antes de testar.
              </p>

              <div style={{ borderTop:'1px solid var(--mf-border)', paddingTop:14 }}>
                <div style={{ fontSize: 'var(--mf-t-nano)', fontWeight:700, color:'var(--mf-text-3)', textTransform:'uppercase', letterSpacing:'.07em', marginBottom:10, fontFamily:'var(--mf-mono)' }}>Status do sistema</div>
                <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                  {SYS_ROWS.map((s, i) => (
                    <motion.div key={s.label} initial={{ opacity:0, x:-6 }} animate={{ opacity:1, x:0 }} transition={{ delay:.15 + i * .04 }}
                      style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'8px 8px', borderRadius: 'var(--mf-r-sm)', background:'color-mix(in oklch, var(--mf-bg) 50%, transparent)' }}>
                      <div style={{ display:'flex', alignItems:'center', gap:8, fontSize: 'var(--mf-t-xs)', fontWeight:600, color:'var(--mf-text)' }}>
                        <span style={{ width:7, height:7, borderRadius: 'var(--mf-r-full)', background: s.ok ? 'var(--mf-success-500)' : 'var(--mf-danger-500)', display:'inline-block', boxShadow: s.ok ? '0 0 6px var(--mf-success-500)' : '0 0 6px var(--mf-danger-500)' }} />
                        {s.label}
                      </div>
                      <span style={{ fontSize: 'var(--mf-t-nano)', fontWeight:700, padding:'2px 8px', borderRadius: 'var(--mf-r-full)', background: s.ok ? 'color-mix(in oklch, var(--mf-success-500) 13%, transparent)' : 'color-mix(in oklch, var(--mf-danger-500) 13%, transparent)', color: s.ok ? 'var(--mf-success-500)' : 'var(--mf-danger-500)', border:`1px solid ${s.ok ? 'oklch(0.38 0.12 150 / 0.35)' : 'oklch(0.38 0.12 15 / 0.35)'}` }}>
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
