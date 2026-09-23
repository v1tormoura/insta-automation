import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import api from '../services/api';
import PageShell from '../components/PageShell';
import Toast from '../components/Toast';
import ConfirmModal from '../components/ConfirmModal';
import AiCaptionModal from '../components/campaign/AiCaptionModal';
import { EsqueletoGrade } from '../components/Estados';
import { Vazio } from '../components/Estados';
import './Legends.css';

/**
 * Banco de Legendas.
 *
 * ── O que a tela anterior fazia errado
 *
 * Duas colunas de cartões altos, cada um com um bloco de texto cinza de seis
 * linhas e dois botões grandes — "Editar" e "Excluir" — do mesmo tamanho. Numa
 * tela cuja tarefa é ESCOLHER uma legenda entre várias, o que ocupava o espaço
 * era o texto que ninguém lê inteiro e a ação que quase nunca se usa. Não havia
 * como filtrar por categoria, marcar a que se usa toda semana, copiar sem abrir,
 * nem saber quantos caracteres a legenda tem (e o limite do Instagram é 2.200).
 *
 * ── O que esta faz
 *
 * A legenda é identificada pelo TÍTULO e pela categoria; o texto é uma prévia
 * de três linhas, para reconhecer, não para ler. As ações viram ícones no
 * rodapé, na ordem em que se usam: copiar (o que mais se faz), editar,
 * duplicar, excluir. A estrela fixa a legenda no topo.
 *
 * A cor da categoria é DERIVADA do nome, não escolhida: categorias nascem
 * digitando, e uma paleta fixa por posição mudaria a cor de "Viral" ao criar
 * uma categoria antes dela na lista.
 */

const POR_PAGINA = [12, 24, 48];
const LIMITE_IG = 2200;
const LIMITE_TITULO = 60;

/* Seis matizes bem separados no círculo. O índice sai de um hash do nome, e
   não da posição na lista: assim "Viral" tem sempre a mesma cor, mesmo que
   você crie outra categoria antes dela. */
const MATIZES = [265, 190, 30, 340, 145, 215];
function corDaCategoria(nome) {
  const s = String(nome || 'Geral');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return `oklch(0.72 0.17 ${MATIZES[h % MATIZES.length]})`;
}

const ICO = {
  copiar:   <><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></>,
  editar:   <><path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z" /></>,
  duplicar: <><rect x="8" y="8" width="13" height="13" rx="2" /><path d="M4 16V4a2 2 0 0 1 2-2h10" /></>,
  lixo:     <><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M10 11v6M14 11v6" /><path d="M9 6V4h6v2" /></>,
  estrela:  <><polygon points="12 2 15.1 8.6 22 9.5 17 14.4 18.2 21.5 12 18.1 5.8 21.5 7 14.4 2 9.5 8.9 8.6 12 2" /></>,
  busca:    <><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.6" y2="16.6" /></>,
  ia:       <><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" /></>,
  chave:    <><path d="M4 7V4h16v3M9 20h6M12 4v16" /></>,
  legenda:  <><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></>,
};
const Svg = ({ k, s = 14 }) => (
  <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">{ICO[k]}</svg>
);

/* As variáveis que o publicador sabe resolver (templateResolver.js). A lista
   vive aqui só como rótulo — quem substitui é o backend, na hora de publicar. */
const VARIAVEIS = ['{username}', '{nome}', '{data}', '{hora}', '{cidade}'];

function quandoCurto(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
    + ' · ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

export default function Legends() {
  const [legendas, setLegendas] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [toast, setToast] = useState(null);

  const [titulo, setTitulo] = useState('');
  const [categoria, setCategoria] = useState('Geral');
  const [texto, setTexto] = useState('');
  const [editando, setEditando] = useState(null);
  const [salvando, setSalvando] = useState(false);
  const textoRef = useRef(null);

  const [busca, setBusca] = useState('');
  const [filtroCat, setFiltroCat] = useState('');
  const [pagina, setPagina] = useState(1);
  const [porPagina, setPorPagina] = useState(12);
  const [paraExcluir, setParaExcluir] = useState(null);
  const [iaAberta, setIaAberta] = useState(false);
  const [menuDe, setMenuDe] = useState(null);

  const aviso = (type, title, message) => setToast({ type, title, message, id: Date.now() });

  const carregar = useCallback(async () => {
    try {
      const { data } = await api.get('/legends');
      setLegendas(Array.isArray(data) ? data : []);
    } catch {
      aviso('error', 'Erro', 'Não foi possível carregar as legendas.');
    } finally { setCarregando(false); }
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  const categorias = useMemo(() => {
    const m = new Map();
    for (const l of legendas) {
      const c = (l.category || 'Geral').trim() || 'Geral';
      m.set(c, (m.get(c) || 0) + 1);
    }
    return [...m].sort((a, b) => a[0].localeCompare(b[0], 'pt-BR'));
  }, [legendas]);

  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return legendas.filter(l => {
      if (filtroCat && (l.category || 'Geral') !== filtroCat) return false;
      if (!q) return true;
      return (l.title || '').toLowerCase().includes(q) || (l.text || '').toLowerCase().includes(q);
    });
  }, [legendas, busca, filtroCat]);

  const totalPaginas = Math.max(1, Math.ceil(filtradas.length / porPagina));
  const paginaSegura = Math.min(pagina, totalPaginas);
  const visiveis = filtradas.slice((paginaSegura - 1) * porPagina, paginaSegura * porPagina);
  useEffect(() => { setPagina(1); }, [busca, filtroCat, porPagina]);

  const favoritas = legendas.filter(l => l.favorita).length;

  /* ── Ações ──────────────────────────────────────────────────────────────── */

  function limparForm() { setEditando(null); setTitulo(''); setCategoria('Geral'); setTexto(''); }

  async function salvar(e) {
    e?.preventDefault();
    if (!titulo.trim() || !texto.trim()) {
      return aviso('warning', 'Falta preencher', 'Título e legenda são obrigatórios.');
    }
    setSalvando(true);
    try {
      const corpo = { title: titulo.trim(), category: categoria.trim() || 'Geral', text: texto };
      if (editando) await api.patch(`/legends/${editando}`, corpo);
      else await api.post('/legends', { ...corpo, isActive: true });
      aviso('success', editando ? 'Legenda atualizada' : 'Legenda salva', titulo.trim());
      limparForm();
      carregar();
    } catch (err) {
      aviso('error', 'Erro', err.response?.data?.error || 'Não foi possível salvar.');
    } finally { setSalvando(false); }
  }

  function editar(l) {
    setEditando(l._id); setTitulo(l.title || ''); setCategoria(l.category || 'Geral'); setTexto(l.text || '');
    setMenuDe(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function duplicar(l) {
    setMenuDe(null);
    try {
      await api.post('/legends', { title: `${l.title} (cópia)`, category: l.category, text: l.text, isActive: true });
      aviso('success', 'Duplicada', l.title);
      carregar();
    } catch { aviso('error', 'Erro', 'Não foi possível duplicar.'); }
  }

  async function favoritar(l) {
    /* Otimista: a estrela responde ao toque e o servidor confirma depois. Se
       falhar, a lista é recarregada e ela volta — é uma preferência, não um
       dado que se perde. */
    setLegendas(ls => ls.map(x => x._id === l._id ? { ...x, favorita: !x.favorita } : x));
    try { await api.patch(`/legends/${l._id}`, { favorita: !l.favorita }); }
    catch { aviso('error', 'Erro', 'Não deu para favoritar.'); carregar(); }
  }

  async function copiar(l) {
    try {
      await navigator.clipboard.writeText(l.text || '');
      aviso('success', 'Copiada', 'A legenda está na área de transferência.');
    } catch { aviso('error', 'Erro', 'O navegador bloqueou a cópia.'); }
  }

  async function excluir(l) {
    setParaExcluir(null);
    try {
      await api.delete(`/legends/${l._id}`);
      aviso('success', 'Excluída', l.title);
      if (editando === l._id) limparForm();
      carregar();
    } catch { aviso('error', 'Erro', 'Não foi possível excluir.'); }
  }

  /* Insere no ponto do cursor, não no fim: quem escreveu metade da frase quer
     a variável ali, e não colada depois do ponto final. */
  function inserirVariavel(v) {
    const el = textoRef.current;
    if (!el) { setTexto(t => t + v); return; }
    const i = el.selectionStart ?? texto.length;
    const f = el.selectionEnd ?? i;
    setTexto(texto.slice(0, i) + v + texto.slice(f));
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(i + v.length, i + v.length); });
  }

  const pageIcon = <Svg k="legenda" s={18} />;

  return (
    <PageShell icon={pageIcon} title="Banco de Legendas"
      subtitle="Salve legendas prontas e use nas publicações automaticamente." accent="purple"
      actions={
        <div className="lg-stats">
          <div className="lg-stat"><strong>{legendas.length}</strong><span>Legendas</span></div>
          <div className="lg-stat"><strong>{favoritas}</strong><span>Favoritas</span></div>
          <div className="lg-stat"><strong>{categorias.length}</strong><span>Categorias</span></div>
        </div>
      }>

      <div className="lg-layout">
        {/* ── Coluna do formulário ─────────────────────────────────────────── */}
        <form className="mf-card lg-form" onSubmit={salvar}>
          <div className="mf-card__head">
            <h3 className="mf-card__title">{editando ? 'Editar legenda' : 'Nova legenda'}</h3>
            {editando && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={limparForm}>Cancelar edição</button>
            )}
          </div>

          <div className="mf-card__body lg-form__corpo">
            <label className="lg-campo">
              <span className="lg-rotulo">Título</span>
              <input className="input" value={titulo} maxLength={LIMITE_TITULO}
                onChange={e => setTitulo(e.target.value)} placeholder="Ex: Curiosidade viral 01" />
              <span className="lg-contador">{titulo.length}/{LIMITE_TITULO}</span>
            </label>

            <label className="lg-campo">
              <span className="lg-rotulo">Categoria</span>
              <input className="input" value={categoria} list="lg-categorias"
                onChange={e => setCategoria(e.target.value)} placeholder="Geral" />
              {/* Digitar OU escolher: a categoria nasce no momento em que se
                  precisa dela, e um <select> obrigaria a criar antes. */}
              <datalist id="lg-categorias">
                {categorias.map(([c]) => <option key={c} value={c} />)}
              </datalist>
            </label>

            <label className="lg-campo lg-campo--cresce">
              <span className="lg-rotulo">Legenda</span>
              <textarea ref={textoRef} className="txta lg-texto" value={texto} maxLength={LIMITE_IG}
                onChange={e => setTexto(e.target.value)} placeholder="Digite sua legenda pronta…" />
              <span className="lg-contador" data-alerta={texto.length > LIMITE_IG * 0.9 ? 'sim' : undefined}>
                {texto.length}/{LIMITE_IG}
              </span>
            </label>

            <div className="lg-ferramentas">
              <button type="button" className="lg-ferramenta" onClick={() => setIaAberta(true)}>
                <Svg k="ia" /> IA
              </button>
              {/* As variáveis que o publicador resolve na hora de postar. */}
              <details className="lg-vars">
                <summary className="lg-ferramenta"><Svg k="chave" /> Variáveis</summary>
                <div className="lg-vars__lista">
                  {VARIAVEIS.map(v => (
                    <button key={v} type="button" onClick={() => inserirVariavel(v)}>{v}</button>
                  ))}
                </div>
              </details>
            </div>
          </div>

          <div className="lg-form__pe">
            <button type="submit" className="lg-salvar" disabled={salvando}>
              {salvando ? 'Salvando…' : editando ? 'Salvar alterações' : 'Salvar legenda'}
            </button>
          </div>
        </form>

        {/* ── Coluna da lista ──────────────────────────────────────────────── */}
        <section className="mf-card lg-lista">
          <div className="mf-card__head lg-lista__head">
            <h3 className="mf-card__title">Legendas salvas</h3>
            <div className="lg-filtros">
              <div className="lg-busca">
                <Svg k="busca" />
                <input value={busca} onChange={e => setBusca(e.target.value)}
                  placeholder="Buscar legendas…" aria-label="Buscar legendas" />
              </div>
              <select className="lg-select" value={filtroCat} onChange={e => setFiltroCat(e.target.value)}
                aria-label="Filtrar por categoria">
                <option value="">Todas as categorias</option>
                {categorias.map(([c, n]) => <option key={c} value={c}>{c} ({n})</option>)}
              </select>
            </div>
          </div>

          <div className="mf-card__body">
            {carregando ? (
              <EsqueletoGrade itens={6} minimo={260} />
            ) : !filtradas.length ? (
              <Vazio
                icone={<Svg k="legenda" s={22} />}
                titulo={legendas.length ? 'Nenhuma legenda com esse filtro' : 'Nenhuma legenda salva ainda'}
                descricao={legendas.length
                  ? 'Mude a busca ou escolha outra categoria.'
                  : 'Escreva no formulário ao lado e ela fica disponível em todo envio.'}
              />
            ) : (
              <>
                <div className="lg-grade">
                  {visiveis.map(l => {
                    const cat = (l.category || 'Geral').trim() || 'Geral';
                    const cor = corDaCategoria(cat);
                    return (
                      <article key={l._id} className="lg-cartao" style={{ '--cat': cor }}>
                        <header className="lg-cartao__topo">
                          <span className="lg-chip">{cat}</span>
                          <button type="button" className="lg-estrela" data-ativa={l.favorita ? 'sim' : undefined}
                            onClick={() => favoritar(l)} title={l.favorita ? 'Remover dos favoritos' : 'Fixar no topo'}
                            aria-pressed={!!l.favorita} aria-label={l.favorita ? 'Remover dos favoritos' : 'Fixar no topo'}>
                            <Svg k="estrela" s={15} />
                          </button>
                        </header>

                        <h4 className="lg-cartao__titulo">{l.title || 'Sem título'}</h4>
                        <p className="lg-cartao__previa">{l.text}</p>

                        <footer className="lg-cartao__pe">
                          <span className="lg-data">{quandoCurto(l.createdAt)}</span>
                          <span className="lg-chars">{(l.text || '').length} caracteres</span>
                        </footer>

                        <div className="lg-acoes">
                          {/* Copiar primeiro: é o que mais se faz com uma
                              legenda salva, e estava atrás de abrir para editar. */}
                          <button type="button" onClick={() => copiar(l)} title="Copiar texto"><Svg k="copiar" /></button>
                          <button type="button" onClick={() => editar(l)} title="Editar"><Svg k="editar" /></button>
                          <button type="button" onClick={() => duplicar(l)} title="Duplicar"><Svg k="duplicar" /></button>
                          <button type="button" className="lg-acoes__perigo" onClick={() => setParaExcluir(l)} title="Excluir"><Svg k="lixo" /></button>
                        </div>
                      </article>
                    );
                  })}
                </div>

                {(filtradas.length > porPagina || porPagina !== 12) && (
                  <div className="lg-paginacao">
                    <button type="button" disabled={paginaSegura <= 1}
                      onClick={() => setPagina(p => Math.max(1, p - 1))} aria-label="Página anterior">‹</button>
                    <span>{paginaSegura} de {totalPaginas}</span>
                    <button type="button" disabled={paginaSegura >= totalPaginas}
                      onClick={() => setPagina(p => Math.min(totalPaginas, p + 1))} aria-label="Próxima página">›</button>
                    <label className="lg-porpagina">
                      Mostrar
                      <select value={porPagina} onChange={e => setPorPagina(Number(e.target.value))}>
                        {POR_PAGINA.map(n => <option key={n} value={n}>{n}</option>)}
                      </select>
                    </label>
                  </div>
                )}
              </>
            )}
          </div>
        </section>
      </div>

      <AiCaptionModal
        aberta={iaAberta}
        contexto={titulo}
        textoAtual={texto}
        onAplicar={t => { setTexto(t); setIaAberta(false); }}
        onFechar={() => setIaAberta(false)}
      />

      <ConfirmModal
        open={!!paraExcluir}
        title={`Excluir "${paraExcluir?.title || ''}"?`}
        message="A legenda sai do banco e deixa de aparecer nos envios."
        detalhe={<>Envios <strong style={{ color: 'var(--mf-text)' }}>já criados</strong> que usam este texto não mudam — a legenda já foi copiada para eles.</>}
        confirmLabel="Excluir legenda"
        onConfirm={() => excluir(paraExcluir)}
        onCancel={() => setParaExcluir(null)}
      />

      <Toast toast={toast} onClose={() => setToast(null)} />
    </PageShell>
  );
}
