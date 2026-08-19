import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import api from '../services/api';
import Toast from '../components/Toast';
import PageShell from '../components/PageShell';

/**
 * Listagem de campanhas (fase 5).
 *
 * O painel completo com plano, timeline e controles é da fase 9. Aqui ficam a
 * lista, os filtros e as ações que a API já expõe: pausar, retomar e cancelar.
 */

const STATUS = {
  draft:     { rotulo: 'Rascunho',   cor: '#94a3b8', bg: 'rgba(148,163,184,.12)' },
  planning:  { rotulo: 'Planejando', cor: '#60a5fa', bg: 'rgba(59,130,246,.12)' },
  scheduled: { rotulo: 'Agendada',   cor: 'var(--cyan)', bg: 'rgba(0,212,255,.12)' },
  running:   { rotulo: 'Rodando',    cor: '#34d399', bg: 'rgba(16,185,129,.12)' },
  paused:    { rotulo: 'Pausada',    cor: '#fbbf24', bg: 'rgba(245,158,11,.12)' },
  completed: { rotulo: 'Concluída',  cor: '#34d399', bg: 'rgba(16,185,129,.12)' },
  partial:   { rotulo: 'Parcial',    cor: '#fbbf24', bg: 'rgba(245,158,11,.12)' },
  failed:    { rotulo: 'Falhou',     cor: '#f87171', bg: 'rgba(244,63,94,.12)' },
  cancelled: { rotulo: 'Cancelada',  cor: '#94a3b8', bg: 'rgba(148,163,184,.12)' },
};

const FILTROS = [
  ['',          'Todas'],
  ['scheduled', 'Agendadas'],
  ['running',   'Rodando'],
  ['paused',    'Pausadas'],
  ['completed', 'Concluídas'],
];

export default function Campaigns() {
  const navigate = useNavigate();

  const [campanhas, setCampanhas] = useState([]);
  const [status, setStatus]   = useState('');
  const [busca, setBusca]     = useState('');
  const [pagina, setPagina]   = useState(1);
  const [paginacao, setPaginacao] = useState({ pages: 1, total: 0 });
  const [carregando, setCarregando] = useState(true);
  const [toast, setToast]     = useState(null);

  const aviso = (type, title, message) => {
    setToast({ type, title, message });
    setTimeout(() => setToast(null), 3500);
  };

  async function carregar() {
    setCarregando(true);
    try {
      const params = new URLSearchParams({ page: String(pagina), limit: '20' });
      if (status) params.set('status', status);
      if (busca.trim()) params.set('search', busca.trim());

      const { data } = await api.get(`/campaigns?${params}`);
      setCampanhas(data.campaigns || []);
      setPaginacao(data.pagination || { pages: 1, total: 0 });
    } catch (err) {
      aviso('error', 'Erro', err.response?.data?.message || 'Não foi possível carregar as campanhas.');
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => { carregar(); /* eslint-disable-next-line */ }, [pagina, status]);

  // Busca com espera: evita uma requisição por tecla digitada.
  useEffect(() => {
    const t = setTimeout(() => { setPagina(1); carregar(); }, 400);
    return () => clearTimeout(t);
    /* eslint-disable-next-line */
  }, [busca]);

  async function acao(id, rota, rotulo) {
    try {
      await api.post(`/campaigns/${id}/${rota}`);
      aviso('success', rotulo, 'Campanha atualizada.');
      carregar();
    } catch (err) {
      aviso('error', 'Não foi possível', err.response?.data?.message || err.message);
    }
  }

  const fmt = d => d ? new Date(d).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  }) : '—';

  return (
    <PageShell
      icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 3v18h18"/><path d="M18 17V9M13 17V5M8 17v-3"/></svg>}
      title="Campanhas"
      subtitle="Planeje publicações distribuídas entre contas e conteúdos"
      accent="cyan"
      actions={
        <button className="btn btn-primary" onClick={() => navigate('/campaigns/nova')}>
          Nova campanha
        </button>
      }
    >
      {/* ── Filtros ── */}
      <div style={{ display:'flex', gap:8, flexWrap:'wrap', alignItems:'center', marginBottom:14 }}>
        <input className="input" style={{ flex:1, minWidth:180 }} placeholder="Buscar campanha..."
          value={busca} onChange={e => setBusca(e.target.value)} />
        {FILTROS.map(([id, rotulo]) => (
          <button key={id || 'todas'} onClick={() => { setStatus(id); setPagina(1); }} style={{
            padding:'7px 13px', borderRadius:8, fontSize:11.5, fontWeight:700, cursor:'pointer',
            background: status === id ? 'rgba(0,212,255,.12)' : 'oklch(1 0 0 / 0.04)',
            color:      status === id ? 'var(--cyan)' : 'var(--text3)',
            border:     `1px solid ${status === id ? 'rgba(0,212,255,.3)' : 'oklch(1 0 0 / 0.08)'}`,
          }}>{rotulo}</button>
        ))}
      </div>

      {/* ── Lista ── */}
      {carregando ? (
        <div style={{ padding:'50px 0', textAlign:'center', color:'var(--text3)', fontSize:12 }}>
          Carregando...
        </div>
      ) : !campanhas.length ? (
        <div style={{ padding:'56px 20px', textAlign:'center', color:'var(--text3)' }}>
          <div style={{ fontSize:14, fontWeight:600, color:'var(--text2)', marginBottom:6 }}>
            Nenhuma campanha ainda
          </div>
          <div style={{ fontSize:12, marginBottom:16 }}>
            Uma campanha distribui seus conteúdos entre várias contas, com horários planejados.
          </div>
          <button className="btn btn-primary" onClick={() => navigate('/campaigns/nova')}>
            Criar a primeira
          </button>
        </div>
      ) : (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(min(320px,100%),1fr))', gap:12 }}>
          {campanhas.map((c, i) => {
            const st = STATUS[c.status] || STATUS.draft;
            const publicadas = c.publishedPublications || 0;
            const total      = c.totalPublications || 0;
            const pct        = total ? Math.round((publicadas / total) * 100) : 0;

            return (
              <motion.div key={c._id}
                initial={{ opacity:0, y:8 }} animate={{ opacity:1, y:0 }}
                transition={{ delay: i * .03, duration:.24 }}
                style={{
                  background:'oklch(0.16 0.05 235 / 0.7)', borderRadius:14, overflow:'hidden',
                  border:'1px solid oklch(1 0 0 / 0.08)', borderLeft:`3px solid ${st.cor}`,
                }}>
                <div style={{ padding:'13px 14px 11px' }}>
                  <div style={{ display:'flex', justifyContent:'space-between', gap:9, alignItems:'flex-start' }}>
                    {/* O nome abre o painel da campanha. O card inteiro não é
                        clicável porque já contém os botões de pausar/cancelar —
                        um clique perdido dispararia a ação errada. */}
                    <div style={{ minWidth:0 }}>
                      <div onClick={() => navigate(`/campaigns/${c._id}`)}
                        title="Abrir a campanha"
                        style={{ fontSize:13, fontWeight:700, overflow:'hidden', cursor:'pointer',
                          textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{c.name}</div>
                      {c.description && (
                        <div style={{ fontSize:11, color:'var(--text3)', marginTop:3, overflow:'hidden',
                          textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{c.description}</div>
                      )}
                    </div>
                    <span style={{ flexShrink:0, fontSize:10, fontWeight:700, padding:'3px 9px',
                      borderRadius:20, background:st.bg, color:st.cor }}>{st.rotulo}</span>
                  </div>

                  <div style={{ display:'flex', gap:14, marginTop:11, fontFamily:'var(--font-mono)', fontSize:10.5, color:'var(--text3)' }}>
                    <span>{(c.accountIds || []).length} contas</span>
                    <span>{(c.contentIds || []).length} conteúdos</span>
                    <span>{total} publicações</span>
                  </div>

                  {/* Progresso */}
                  <div style={{ marginTop:11 }}>
                    <div style={{ height:5, borderRadius:20, background:'oklch(1 0 0 / 0.06)', overflow:'hidden' }}>
                      <div style={{ width:`${pct}%`, height:'100%', background:st.cor, transition:'width .3s' }} />
                    </div>
                    <div style={{ display:'flex', justifyContent:'space-between', marginTop:5,
                      fontFamily:'var(--font-mono)', fontSize:10, color:'var(--text3)' }}>
                      <span>{publicadas} / {total}</span>
                      <span>criada {fmt(c.createdAt)}</span>
                    </div>
                  </div>
                </div>

                <div style={{ height:1, background:'oklch(1 0 0 / 0.06)' }} />
                <div style={{ padding:'8px 10px', display:'flex', gap:6, flexWrap:'wrap' }}>
                  {['scheduled', 'running'].includes(c.status) && (
                    <button onClick={() => acao(c._id, 'pause', 'Pausada')} style={botao('#fbbf24', 'rgba(245,158,11,.12)')}>
                      Pausar
                    </button>
                  )}
                  {c.status === 'paused' && (
                    <button onClick={() => acao(c._id, 'resume', 'Retomada')} style={botao('#34d399', 'rgba(16,185,129,.12)')}>
                      Retomar
                    </button>
                  )}
                  {!['cancelled', 'completed'].includes(c.status) && (
                    <button onClick={() => acao(c._id, 'cancel', 'Cancelada')} style={botao('#f87171', 'rgba(244,63,94,.1)')}>
                      Cancelar
                    </button>
                  )}
                  {(c.failedPublications > 0) && (
                    <button onClick={() => acao(c._id, 'retry-failed', 'Falhas reprogramadas')} style={botao('#a78bfa', 'rgba(139,92,246,.12)')}>
                      Reexecutar falhas
                    </button>
                  )}
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* ── Paginação ── */}
      {paginacao.pages > 1 && (
        <div style={{ display:'flex', justifyContent:'center', alignItems:'center', gap:10, marginTop:16 }}>
          <button className="btn btn-ghost" disabled={pagina <= 1}
            onClick={() => setPagina(p => p - 1)}>Anterior</button>
          <span style={{ fontFamily:'var(--font-mono)', fontSize:11, color:'var(--text3)' }}>
            {pagina} / {paginacao.pages}
          </span>
          <button className="btn btn-ghost" disabled={pagina >= paginacao.pages}
            onClick={() => setPagina(p => p + 1)}>Próxima</button>
        </div>
      )}

      <Toast toast={toast} onClose={() => setToast(null)} />
    </PageShell>
  );
}

const botao = (cor, fundo) => ({
  padding:'6px 11px', borderRadius:8, fontSize:11, fontWeight:700, cursor:'pointer',
  background: fundo, color: cor, border: `1px solid ${cor}44`,
});
