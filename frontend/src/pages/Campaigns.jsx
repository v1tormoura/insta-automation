import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import api from '../services/api';
import Toast from '../components/Toast';
import PageShell from '../components/PageShell';
import Segmentado from '../components/Segmentado';

/**
 * Listagem de campanhas (fase 5).
 *
 * O painel completo com plano, timeline e controles é da fase 9. Aqui ficam a
 * lista, os filtros e as ações que a API já expõe: pausar, retomar e cancelar.
 */

/* Nove estados, cada um declarando só a cor — o fundo sai dela por
   color-mix. Antes eram dezoito valores mantidos em sincronia na mão, e
   'rodando' e 'concluída' compartilhavam o mesmo verde apesar de quererem
   dizer coisas diferentes: uma está em movimento, a outra terminou. Agora
   'rodando' usa o verde de sucesso com o ponto pulsando, e 'concluída' fica
   sóbria — o que está acontecendo agora chama mais atenção que o que já
   passou. */
const STATUS = {
  draft:     { rotulo: 'Rascunho',   cor: 'var(--mf-text-3)' },
  planning:  { rotulo: 'Planejando', cor: 'var(--mf-info-500)' },
  scheduled: { rotulo: 'Agendada',   cor: 'var(--mf-mod-contas)' },
  running:   { rotulo: 'Rodando',    cor: 'var(--mf-success-500)', vivo: true },
  paused:    { rotulo: 'Pausada',    cor: 'var(--mf-warning-500)' },
  completed: { rotulo: 'Concluída',  cor: 'var(--mf-text-2)' },
  partial:   { rotulo: 'Parcial',    cor: 'var(--mf-warning-500)' },
  failed:    { rotulo: 'Falhou',     cor: 'var(--mf-danger-500)' },
  cancelled: { rotulo: 'Cancelada',  cor: 'var(--mf-text-3)' },
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
      accent="pink"
      actions={
        <button className="btn btn-primary" onClick={() => navigate('/campaigns/nova')}>
          Nova campanha
        </button>
      }
    >
      {/* ── Filtros ── */}
      <div style={{ display:'flex', gap:'var(--mf-3)', flexWrap:'wrap', alignItems:'center', marginBottom:'var(--mf-4)' }}>
        <input className="input" style={{ flex:'1 1 200px', minWidth:0 }} placeholder="Buscar campanha…"
          aria-label="Buscar campanha"
          value={busca} onChange={e => setBusca(e.target.value)} />
        {/* Os filtros são exclusivos — só um status por vez. Como botões
            soltos liam-se como cinco ações; como segmentado, lê-se como um
            controle com um valor. */}
        <Segmentado
          rotulo="Filtrar por status" mod="campanhas"
          opcoes={FILTROS.map(([value, label]) => ({ value, label }))}
          valor={status} onChange={id => { setStatus(id); setPagina(1); }}
        />
      </div>

      {/* ── Lista ── */}
      {carregando ? (
        /* Esqueletos com a forma dos cards que vão chegar, em vez da palavra
           "Carregando": o layout não salta quando os dados entram. */
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(min(320px,100%),1fr))', gap:'var(--mf-3)' }}>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="mf-skel" style={{ height:158, borderRadius:'var(--mf-r-lg)' }} />
          ))}
        </div>
      ) : !campanhas.length ? (
        <div className="mf-empty" style={{ padding:'var(--mf-12) var(--mf-5)' }}>
          <div style={{ fontSize:'var(--mf-t-h2)', fontWeight:650, color:'var(--mf-text)', marginBottom:'var(--mf-2)' }}>
            Nenhuma campanha ainda
          </div>
          <div style={{ fontSize:'var(--mf-t-sm)', color:'var(--mf-text-3)', marginBottom:'var(--mf-5)', maxWidth:'46ch', textWrap:'pretty' }}>
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
                /* A faixa colorida à esquerda repete a cor do selo de estado.
                   É redundante de propósito: numa grade de vinte campanhas o
                   olho encontra "a que falhou" pela faixa, sem ler selo algum. */
                style={{
                  background:'var(--mf-surface-1)', borderRadius:'var(--mf-r-lg)', overflow:'hidden',
                  border:'1px solid var(--mf-border)', borderLeft:`3px solid ${st.cor}`,
                  containerType:'inline-size', minWidth:0,
                }}>
                <div style={{ padding:'13px 14px 11px' }}>
                  <div style={{ display:'flex', justifyContent:'space-between', gap:9, alignItems:'flex-start' }}>
                    {/* O nome abre o painel da campanha. O card inteiro não é
                        clicável porque já contém os botões de pausar/cancelar —
                        um clique perdido dispararia a ação errada. */}
                    <div style={{ minWidth:0 }}>
                      {/* Era uma <div> com onClick: invisível para teclado e
                          para leitor de tela, que não têm como saber que
                          aquilo abre alguma coisa. Como <button> entra na
                          ordem de tabulação e responde a Enter. */}
                      <button type="button" onClick={() => navigate(`/campaigns/${c._id}`)}
                        title="Abrir a campanha"
                        style={{ display:'block', width:'100%', textAlign:'left', padding:0,
                          background:'none', border:'none', cursor:'pointer', color:'var(--mf-text)',
                          fontSize:'var(--mf-t-sm)', fontWeight:650, overflow:'hidden',
                          textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{c.name}</button>
                      {c.description && (
                        <div style={{ fontSize:'var(--mf-t-xs)', color:'var(--mf-text-3)', marginTop:3, overflow:'hidden',
                          textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{c.description}</div>
                      )}
                    </div>
                    <span style={{ flexShrink:0, display:'inline-flex', alignItems:'center', gap:6,
                      fontSize:'var(--mf-t-micro)', fontWeight:600, padding:'3px 9px',
                      borderRadius:'var(--mf-r-full)', color:st.cor,
                      background:`color-mix(in oklch, ${st.cor} 12%, transparent)`,
                      border:`1px solid color-mix(in oklch, ${st.cor} 26%, transparent)` }}>
                      <span aria-hidden="true" style={{ width:6, height:6, borderRadius:'var(--mf-r-full)',
                        background:'currentColor', flexShrink:0,
                        animation: st.vivo ? 'mf-pulse 1.6s var(--mf-ease-inout) infinite' : 'none' }} />
                      {st.rotulo}
                    </span>
                  </div>

                  <div className="mf-mono" style={{ display:'flex', gap:'var(--mf-3)', flexWrap:'wrap', marginTop:'var(--mf-3)', fontSize:'var(--mf-t-micro)', color:'var(--mf-text-3)' }}>
                    <span>{(c.accountIds || []).length} contas</span>
                    <span>{(c.contentIds || []).length} conteúdos</span>
                    <span>{total} publicações</span>
                  </div>

                  {/* Progresso */}
                  <div style={{ marginTop:'var(--mf-3)' }}>
                    <div role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}
                      aria-label={`${publicadas} de ${total} publicações`}
                      style={{ height:5, borderRadius:'var(--mf-r-full)', background:'var(--mf-surface-2)', overflow:'hidden' }}>
                      <div style={{ width:`${pct}%`, height:'100%', background:st.cor, borderRadius:'inherit', transition:'width var(--mf-slow) var(--mf-ease-out)' }} />
                    </div>
                    <div className="mf-mono" style={{ display:'flex', justifyContent:'space-between', gap:'var(--mf-2)', marginTop:5,
                      fontSize:'var(--mf-t-micro)', color:'var(--mf-text-3)' }}>
                      <span>{publicadas} / {total}</span>
                      <span>criada {fmt(c.createdAt)}</span>
                    </div>
                  </div>
                </div>

                <div style={{ height:1, background:'var(--mf-border-subtle)' }} />
                <div style={{ padding:'var(--mf-2)', display:'flex', gap:'var(--mf-2)', flexWrap:'wrap' }}>
                  {['scheduled', 'running'].includes(c.status) && (
                    <button onClick={() => acao(c._id, 'pause', 'Pausada')} style={botao('var(--mf-warning-500)')}>
                      Pausar
                    </button>
                  )}
                  {c.status === 'paused' && (
                    <button onClick={() => acao(c._id, 'resume', 'Retomada')} style={botao('var(--mf-success-500)')}>
                      Retomar
                    </button>
                  )}
                  {!['cancelled', 'completed'].includes(c.status) && (
                    <button onClick={() => acao(c._id, 'cancel', 'Cancelada')} style={botao('var(--mf-danger-500)')}>
                      Cancelar
                    </button>
                  )}
                  {(c.failedPublications > 0) && (
                    <button onClick={() => acao(c._id, 'retry-failed', 'Falhas reprogramadas')} style={botao('var(--mf-mod-publicar)')}>
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
          <span className="mf-mono" style={{ fontSize:'var(--mf-t-xs)', color:'var(--mf-text-3)' }}>
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

/* Uma cor por botão: o fundo e a borda saem dela. Antes cada chamada
   passava fundo e cor separados, e a borda vinha de concatenar '44' no hex
   — o que só funcionava para cor em hexadecimal de seis dígitos. */
const botao = (cor) => ({
  padding:'5px 11px', borderRadius:'var(--mf-r-sm)', fontSize:'var(--mf-t-micro)',
  fontWeight:600, cursor:'pointer', color: cor,
  background: `color-mix(in oklch, ${cor} 12%, transparent)`,
  border: `1px solid color-mix(in oklch, ${cor} 28%, transparent)`,
});
