import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, Film, Image as ImageIcon, Layers, Music, Check, Loader2, ExternalLink } from 'lucide-react';
import PageShell from '../components/PageShell';
import api from '../services/api';
import { avisar } from '../services/avisos';
import { useServerEvents } from '../services/useServerEvents';

/**
 * Importar mídias — o que as SUAS contas conectadas já publicaram vai para a
 * Biblioteca, na qualidade e no formato escolhidos (API oficial).
 */

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';
const srcDo = u => (u?.startsWith('/uploads') ? `${API_URL}${u}` : u);

const QUALIDADES = [
  ['original', 'Original', 'Como foi publicado'],
  ['720', '720p HD', 'Menor lado 720'],
  ['480', '480p SD', 'Menor lado 480'],
  ['360', '360p', 'Menor lado 360'],
];
const FORMATOS = [
  ['mp4', 'MP4', 'Compatível', Film],
  ['webm', 'WEBM', 'Web', Film],
  ['mp3', 'MP3', 'Só áudio', Music],
];

function Opcao({ ativo, onClick, titulo, sub, icone: Icone }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={ativo}
      style={{
        display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left', padding: '10px 12px', minWidth: 0,
        borderRadius: 'var(--mf-r-md)', cursor: 'pointer',
        background: ativo ? 'color-mix(in oklch, var(--mf-primary-500) 10%, var(--mf-surface-1))' : 'var(--mf-surface-1)',
        border: `1px solid ${ativo ? 'color-mix(in oklch, var(--mf-primary-500) 55%, transparent)' : 'var(--mf-border)'}`,
        boxShadow: ativo ? '0 0 18px -6px color-mix(in oklch, var(--mf-primary-500) 60%, transparent)' : 'none',
      }}>
      {Icone && <Icone size={16} style={{ color: ativo ? 'var(--mf-primary-500)' : 'var(--mf-text-3)', flexShrink: 0 }} />}
      <span style={{ minWidth: 0, flex: 1 }}>
        <span style={{ display: 'block', fontSize: 'var(--mf-t-sm)', fontWeight: 700, color: 'var(--mf-text)' }}>{titulo}</span>
        <span style={{ display: 'block', fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text-3)' }}>{sub}</span>
      </span>
      {ativo && <Check size={14} style={{ color: 'var(--mf-primary-500)', flexShrink: 0 }} />}
    </button>
  );
}

const rotulo = t => (
  <div style={{ fontSize: 'var(--mf-t-micro)', fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase',
    color: 'var(--mf-text-3)', margin: '0 0 8px' }}>{t}</div>
);

export default function Importar() {
  const [contas, setContas] = useState([]);
  const [conta, setConta] = useState('');
  const [itens, setItens] = useState([]);
  const [depois, setDepois] = useState(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState('');
  const [marcados, setMarcados] = useState(() => new Set());
  const [qualidade, setQualidade] = useState('original');
  const [formato, setFormato] = useState('mp4');
  const [pasta, setPasta] = useState('Importados');
  const [progresso, setProgresso] = useState(null); // { feitas, total } | { fim, importados, erros }

  useEffect(() => {
    api.get('/accounts', { params: { limit: 500 } })
      .then(r => {
        const lista = (r.data?.accounts || []).filter(c => c.hasApiToken);
        setContas(lista);
        if (lista[0]) setConta(lista[0].id);
      })
      .catch(() => setContas([]));
  }, []);

  const carregar = useCallback(async (mais = false) => {
    if (!conta) return;
    setCarregando(true); setErro('');
    try {
      const { data } = await api.get(`/importar/${conta}`, { params: mais && depois ? { depois } : {} });
      setItens(v => (mais ? [...v, ...data.itens] : data.itens));
      setDepois(data.depois);
    } catch (e) {
      setErro(e.response?.data?.error || 'Não foi possível listar as publicações.');
    } finally { setCarregando(false); }
  }, [conta, depois]);

  useEffect(() => {
    if (!conta) return;
    let vivo = true;
    api.get(`/importar/${conta}`)
      .then(({ data }) => { if (vivo) { setItens(data.itens); setDepois(data.depois); setErro(''); } })
      .catch(e => { if (vivo) setErro(e.response?.data?.error || 'Não foi possível listar as publicações.'); })
      .finally(() => { if (vivo) setCarregando(false); });
    return () => { vivo = false; };
  }, [conta]);

  useServerEvents(['media'], d => {
    if (d?.action === 'importacao') setProgresso({ feitas: d.feitas, total: d.total });
    if (d?.action === 'importacao_fim') {
      setProgresso({ fim: true, importados: d.importados, erros: d.erros });
      avisar(d.erros ? 'warning' : 'success', 'Importação concluída',
        `${d.importados} arquivo(s) na Biblioteca${d.erros ? `, ${d.erros} com erro` : ''}.`);
    }
  });

  const escolherConta = id => {
    if (id === conta) return;
    setCarregando(true); setItens([]); setMarcados(new Set()); setDepois(null); setConta(id);
  };
  const alternar = id => setMarcados(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const todosMarcados = itens.length > 0 && itens.every(i => marcados.has(i.id));
  const temVideo = useMemo(() => itens.some(i => marcados.has(i.id) && i.tipo !== 'IMAGE'), [itens, marcados]);
  const importando = progresso && !progresso.fim;

  async function importar() {
    if (!marcados.size) return;
    try {
      await api.post('/importar', { accountId: conta, ids: [...marcados], qualidade, formato, pasta });
      setProgresso({ feitas: 0, total: marcados.size });
    } catch (e) {
      avisar('error', 'Não foi possível importar', e.response?.data?.error || e.message);
    }
  }

  return (
    <PageShell icon={<Download size={18} />} title="Importar mídias"
      subtitle="Traga para a Biblioteca o que as suas contas já publicaram, na qualidade que quiser">

      {/* Contas */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 'var(--mf-4)' }}>
        {contas.length === 0 && (
          <div style={{ fontSize: 'var(--mf-t-sm)', color: 'var(--mf-text-3)' }}>
            Nenhuma conta conectada pela API. Conecte em <a href="/accounts" style={{ color: 'var(--mf-primary-500)' }}>Contas</a>.
          </div>
        )}
        {contas.map(c => {
          const ativa = c.id === conta;
          return (
            <button key={c.id} type="button" onClick={() => escolherConta(c.id)}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px 6px 6px', borderRadius: 'var(--mf-r-full)', cursor: 'pointer',
                background: ativa ? 'color-mix(in oklch, var(--mf-primary-500) 12%, var(--mf-surface-1))' : 'var(--mf-surface-1)',
                border: `1px solid ${ativa ? 'color-mix(in oklch, var(--mf-primary-500) 50%, transparent)' : 'var(--mf-border)'}`,
                color: ativa ? 'var(--mf-text)' : 'var(--mf-text-2)', fontSize: 'var(--mf-t-xs)', fontWeight: 650 }}>
              <span style={{ width: 24, height: 24, borderRadius: '50%', overflow: 'hidden', background: 'var(--mf-surface-3)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700 }}>
                {c.avatar ? <img src={srcDo(c.avatar)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : c.username?.[0]?.toUpperCase()}
              </span>
              @{c.username}
            </button>
          );
        })}
      </div>

      <div style={{ display: 'grid', gap: 'var(--mf-4)', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 340px), 1fr))', alignItems: 'start' }}>
        {/* Publicações */}
        <section className="mf-card" style={{ padding: 'var(--mf-4)', gridColumn: 'span 2', minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 'var(--mf-3)', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 'var(--mf-t-sm)', fontWeight: 700, color: 'var(--mf-text)' }}>Publicações</span>
            <span style={{ fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text-3)' }}>{marcados.size} de {itens.length} selecionadas</span>
            <span style={{ flex: 1 }} />
            <button type="button" className="btn btn-ghost btn-sm" disabled={!itens.length}
              onClick={() => setMarcados(todosMarcados ? new Set() : new Set(itens.map(i => i.id)))}>
              {todosMarcados ? 'Limpar seleção' : 'Selecionar todas'}
            </button>
          </div>

          {erro && <div style={{ fontSize: 'var(--mf-t-xs)', color: 'var(--mf-danger-500)', marginBottom: 'var(--mf-3)' }}>{erro}</div>}

          <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fill, minmax(118px, 1fr))' }}>
            {itens.map(i => {
              const sel = marcados.has(i.id);
              return (
                <button key={i.id} type="button" onClick={() => alternar(i.id)} title={i.legenda || ''}
                  style={{ position: 'relative', aspectRatio: '9 / 14', borderRadius: 'var(--mf-r-md)', overflow: 'hidden', padding: 0, cursor: 'pointer',
                    background: 'var(--mf-surface-2)',
                    border: `2px solid ${sel ? 'var(--mf-primary-500)' : 'transparent'}`,
                    boxShadow: sel ? '0 0 16px -4px color-mix(in oklch, var(--mf-primary-500) 70%, transparent)' : 'none' }}>
                  {i.miniatura && <img src={i.miniatura} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />}
                  <span style={{ position: 'absolute', top: 6, left: 6, display: 'flex', alignItems: 'center', gap: 4, padding: '2px 6px', borderRadius: 'var(--mf-r-full)',
                    background: 'rgba(0,0,0,.6)', color: '#fff', fontSize: 10, fontWeight: 700 }}>
                    {i.tipo === 'VIDEO' ? <Film size={11} /> : i.tipo === 'CAROUSEL_ALBUM' ? <Layers size={11} /> : <ImageIcon size={11} />}
                    {i.tipo === 'CAROUSEL_ALBUM' ? i.itens : i.produto === 'REELS' ? 'Reel' : i.tipo === 'VIDEO' ? 'Vídeo' : 'Foto'}
                  </span>
                  <span style={{ position: 'absolute', top: 6, right: 6, width: 20, height: 20, borderRadius: '50%',
                    background: sel ? 'var(--mf-primary-500)' : 'rgba(0,0,0,.45)', border: '1.5px solid #fff',
                    display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {sel && <Check size={12} color="var(--mf-primary-fg)" />}
                  </span>
                  {i.quando && (
                    <span style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '14px 6px 5px', fontSize: 10, color: '#fff', textAlign: 'left',
                      background: 'linear-gradient(transparent, rgba(0,0,0,.75))' }}>
                      {new Date(i.quando).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {carregando && <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--mf-4)' }}><Loader2 size={18} className="mf-spin" /></div>}
          {!carregando && !itens.length && conta && !erro && (
            <div style={{ fontSize: 'var(--mf-t-sm)', color: 'var(--mf-text-3)', textAlign: 'center', padding: 'var(--mf-6)' }}>Esta conta ainda não publicou nada.</div>
          )}
          {depois && !carregando && (
            <div style={{ display: 'flex', justifyContent: 'center', marginTop: 'var(--mf-3)' }}>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => carregar(true)}>Carregar mais</button>
            </div>
          )}
        </section>

        {/* Opções */}
        <section className="mf-card" style={{ padding: 'var(--mf-4)', minWidth: 0 }}>
          {rotulo('Qualidade')}
          <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', marginBottom: 'var(--mf-4)' }}>
            {QUALIDADES.map(([id, t, s]) => (
              <Opcao key={id} ativo={qualidade === id} onClick={() => setQualidade(id)} titulo={t} sub={s} />
            ))}
          </div>

          {rotulo('Formato de saída')}
          <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', marginBottom: 'var(--mf-2)' }}>
            {FORMATOS.map(([id, t, s, I]) => (
              <Opcao key={id} ativo={formato === id} onClick={() => setFormato(id)} titulo={t} sub={s} icone={I} />
            ))}
          </div>
          <div style={{ fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text-3)', marginBottom: 'var(--mf-4)', lineHeight: 1.5 }}>
            Qualidade e formato valem para os vídeos{temVideo ? '' : ' (nenhum vídeo selecionado)'}; fotos entram como foram publicadas. A qualidade nunca amplia um vídeo menor.
          </div>

          {rotulo('Pasta na Biblioteca')}
          <input className="inp" value={pasta} onChange={e => setPasta(e.target.value)} placeholder="Importados" style={{ marginBottom: 'var(--mf-4)' }} />

          {progresso && (
            <div style={{ marginBottom: 'var(--mf-3)', fontSize: 'var(--mf-t-xs)', color: 'var(--mf-text-2)' }}>
              {progresso.fim
                ? <>Pronto: <strong style={{ color: 'var(--mf-text)' }}>{progresso.importados}</strong> arquivo(s) na Biblioteca{progresso.erros ? `, ${progresso.erros} com erro` : ''}.{' '}
                    <a href="/biblioteca" style={{ color: 'var(--mf-primary-500)', display: 'inline-flex', alignItems: 'center', gap: 3 }}>Abrir <ExternalLink size={11} /></a></>
                : <>Importando… {progresso.feitas} de {progresso.total}
                    <div style={{ height: 4, borderRadius: 2, background: 'var(--mf-surface-3)', marginTop: 6, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${progresso.total ? (progresso.feitas / progresso.total) * 100 : 0}%`, background: 'var(--mf-primary-500)', transition: 'width .3s' }} />
                    </div></>}
            </div>
          )}

          <button type="button" className="btn-primary" onClick={importar} disabled={!marcados.size || importando}
            style={{ width: '100%', height: 44, fontSize: 'var(--mf-t-body)' }}>
            {importando ? <Loader2 size={16} className="mf-spin" /> : <Download size={16} />}
            {importando ? 'Importando…' : `Importar ${marcados.size || ''} para a Biblioteca`}
          </button>
        </section>
      </div>
    </PageShell>
  );
}
