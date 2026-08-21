import { useEffect, useMemo, useState } from 'react';
import api from '../../services/api';

/**
 * Biblioteca de legendas do painel, usada de dentro da campanha.
 *
 * Faz os dois sentidos: puxa um texto já salvo para o campo em edição, e salva
 * o texto atual como legenda nova. Sem o segundo, a biblioteca só encheria pela
 * tela de Legendas e ninguém alimentaria ela durante o trabalho de verdade.
 *
 * O título vem de `title` — o model Legend não tem campo `name`, e ler o campo
 * errado deixava todos os itens sem rótulo na lista.
 */
export default function LegendLibraryModal({
  aberta,
  textoAtual = '',      // o que está no campo agora, para o botão "salvar esta"
  onAplicar,            // (texto) => void
  onFechar,
}) {
  const [itens, setItens]         = useState([]);
  const [busca, setBusca]         = useState('');
  const [categoria, setCategoria] = useState('');
  const [carregando, setCarregando] = useState(false);
  const [salvando, setSalvando]   = useState(false);
  const [titulo, setTitulo]       = useState('');
  const [erro, setErro]           = useState('');

  useEffect(() => {
    if (!aberta) return;
    setCarregando(true);
    setErro('');
    api.get('/legends')
      .then(({ data }) => setItens(Array.isArray(data) ? data : (data?.legends || [])))
      .catch(() => setErro('Não foi possível carregar a biblioteca de legendas.'))
      .finally(() => setCarregando(false));
  }, [aberta]);

  const categorias = useMemo(
    () => [...new Set(itens.map(l => l.category || 'Geral'))].sort(),
    [itens],
  );

  const filtradas = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return itens.filter(l => {
      if (categoria && (l.category || 'Geral') !== categoria) return false;
      if (!termo) return true;
      return `${l.title || ''} ${l.text || ''}`.toLowerCase().includes(termo);
    });
  }, [itens, busca, categoria]);

  async function salvarAtual() {
    const texto = String(textoAtual || '').trim();
    if (!texto) { setErro('O campo está vazio — escreva a legenda antes de salvar.'); return; }

    setSalvando(true);
    setErro('');
    try {
      const { data } = await api.post('/legends', {
        title: titulo.trim() || texto.slice(0, 40),
        text: texto,
        category: categoria || 'Campanhas',
      });
      setItens(prev => [data, ...prev]);
      setTitulo('');
    } catch {
      setErro('Não foi possível salvar na biblioteca.');
    } finally {
      setSalvando(false);
    }
  }

  if (!aberta) return null;

  const botao = {
    padding: '7px 12px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer',
    background: 'oklch(1 0 0 / 0.05)', color: 'var(--text2)', border: '1px solid oklch(1 0 0 / 0.10)',
  };
  const campo = {
    height: 32, padding: '0 10px', borderRadius: 8, fontSize: 12,
    background: 'oklch(0.10 0.03 235)', color: 'var(--text)',
    border: '1px solid oklch(1 0 0 / 0.10)', outline: 'none',
  };

  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) onFechar?.(); }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)', zIndex: 999, display: 'grid', placeItems: 'center', padding: 20 }}>
      <div style={{
        background: 'oklch(0.14 0.04 235)', padding: 20, borderRadius: 16,
        width: 'min(620px, 100%)', maxHeight: '85vh', display: 'flex', flexDirection: 'column',
        border: '1px solid oklch(1 0 0 / 0.10)',
      }}>
        <h3 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 700 }}>Biblioteca de legendas</h3>
        <p style={{ margin: '0 0 14px', fontSize: 11.5, color: 'var(--text3)', lineHeight: 1.6 }}>
          Aplique um texto já salvo ou guarde o que está escrito agora para reutilizar
          em outras campanhas.
        </p>

        <div style={{ display: 'flex', gap: 7, marginBottom: 12, flexWrap: 'wrap' }}>
          <input value={busca} onChange={e => setBusca(e.target.value)}
            placeholder="Buscar por título ou texto…" style={{ ...campo, flex: 1, minWidth: 160 }} />
          {categorias.length > 1 && (
            <select value={categoria} onChange={e => setCategoria(e.target.value)} style={{ ...campo, cursor: 'pointer' }}>
              <option value="">Todas</option>
              {categorias.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
        </div>

        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8, paddingRight: 4 }}>
          {carregando && (
            <div style={{ textAlign: 'center', color: 'var(--text3)', padding: 20, fontSize: 12 }}>Carregando…</div>
          )}

          {!carregando && filtradas.map(lg => (
            <button key={lg._id} onClick={() => { onAplicar?.(lg.text || ''); onFechar?.(); }}
              style={{ textAlign: 'left', padding: 12, borderRadius: 10, cursor: 'pointer',
                background: 'oklch(1 0 0 / 0.04)', border: '1px solid oklch(1 0 0 / 0.08)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--cyan)' }}>
                  {lg.title || 'Sem título'}
                </span>
                <span style={{ fontSize: 9.5, color: 'var(--text3)', flexShrink: 0 }}>
                  {lg.category || 'Geral'}
                </span>
              </div>
              <div style={{
                fontSize: 11, color: 'var(--text2)', whiteSpace: 'pre-wrap',
                display: '-webkit-box', WebkitLineClamp: 4, WebkitBoxOrient: 'vertical', overflow: 'hidden',
              }}>{lg.text}</div>
            </button>
          ))}

          {!carregando && !filtradas.length && (
            <div style={{ textAlign: 'center', color: 'var(--text3)', padding: 24, fontSize: 12, lineHeight: 1.7 }}>
              {itens.length
                ? 'Nenhuma legenda bate com esse filtro.'
                : <>A biblioteca está vazia.<br />Salve a legenda atual abaixo para começar.</>}
            </div>
          )}
        </div>

        {/* Salvar a legenda atual */}
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid oklch(1 0 0 / 0.07)' }}>
          <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 7 }}>Guardar a legenda atual</div>
          <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
            <input value={titulo} onChange={e => setTitulo(e.target.value)}
              placeholder="Título (opcional)" style={{ ...campo, flex: 1, minWidth: 150 }} />
            <button onClick={salvarAtual} disabled={salvando || !String(textoAtual || '').trim()}
              style={{ ...botao,
                background: 'rgba(16,185,129,.12)', color: '#34d399', border: '1px solid rgba(16,185,129,.28)',
                opacity: (salvando || !String(textoAtual || '').trim()) ? .5 : 1 }}>
              {salvando ? 'Salvando…' : 'Salvar na biblioteca'}
            </button>
          </div>
        </div>

        {erro && (
          <div style={{ marginTop: 10, fontSize: 11, color: '#fca5a5' }}>{erro}</div>
        )}

        <div style={{ marginTop: 14, textAlign: 'right' }}>
          <button onClick={onFechar} style={botao}>Fechar</button>
        </div>
      </div>
    </div>
  );
}
