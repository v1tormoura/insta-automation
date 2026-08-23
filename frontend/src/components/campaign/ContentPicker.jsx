import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import api from '../../services/api';

/**
 * Seleção de conteúdos da campanha.
 *
 * ── Por que é um componente próprio ─────────────────────────────────────────
 * A etapa vivia como função declarada dentro do wizard e CHAMADA no render
 * (`Atual()`). Quando ganhou um `useState` para o upload, esse hook passou a
 * pertencer ao wizard e a contagem de hooks mudava ao trocar de etapa — o
 * React derrubava a tela. Como componente de verdade, o estado é dele e a
 * etapa pode ter quantos hooks precisar.
 *
 * ── Organização ─────────────────────────────────────────────────────────────
 * A biblioteca inteira em uma grade só era o problema relatado: com dezenas de
 * arquivos não dava para achar nada. Agora a busca, o tipo e a pasta filtram no
 * SERVIDOR (a rota /media aceita search/type/folder/limit), e o que está
 * selecionado aparece sempre no topo — mesmo quando o filtro atual o esconde.
 */

const PAGINA = 40;

const ehVideo = m =>
  m?.type === 'video' || /\.(mp4|mov|webm|m4v|avi|mkv)$/i.test(m?.filename || '');

export default function ContentPicker({
  selecionados = [],      // [contentId] — a ordem é a ordem de seleção
  onSelecionar,           // (proximaLista) => void
  capas = {},             // { [contentId]: mediaId } — capa escolhida por vídeo
  onCapa,                 // (contentId, mediaId|null) => void
  onMidiasConhecidas,     // (lista) => void — devolve ao wizard o que já viu
  aviso,                  // (tipo, titulo, msg) => void
}) {
  const [itens, setItens]         = useState([]);
  const [pastas, setPastas]       = useState([]);
  const [total, setTotal]         = useState(0);
  const [busca, setBusca]         = useState('');
  const [buscaAtiva, setBuscaAtiva] = useState('');
  const [tipo, setTipo]           = useState('');
  const [pasta, setPasta]         = useState('');
  const [limite, setLimite]       = useState(PAGINA);
  const [carregando, setCarregando] = useState(false);
  const [enviando, setEnviando]   = useState(false);
  const [modalCapa, setModalCapa] = useState(null);   // contentId aguardando capa
  // Duas frentes separadas: escolher o que já existe e trazer coisa nova são
  // tarefas diferentes, e misturá-las na mesma barra escondia as duas.
  const [aba, setAba]             = useState('biblioteca');   // 'biblioteca' | 'upload'
  const [arrastando, setArrastando] = useState(false);
  const arquivoRef = useRef(null);

  /* Conhecidos: acumula tudo que já passou pela tela, para conseguir mostrar o
     card de um item selecionado que o filtro atual não traz mais. */
  const [conhecidos, setConhecidos] = useState({});

  const registrar = useCallback((lista) => {
    setConhecidos(prev => {
      const proximo = { ...prev };
      for (const m of lista) proximo[String(m._id)] = m;
      return proximo;
    });
  }, []);

  /* Callbacks do pai ficam em ref de propósito.
     O wizard as declara no corpo do componente, então elas têm identidade nova
     a cada render. Usadas direto como dependência, `carregar` mudaria a cada
     render e o efeito que chama `carregar` dispararia uma busca em laço
     infinito. Pelo ref, o efeito depende só do que realmente muda. */
  const avisoRef = useRef(null);
  const conhecidosRef = useRef(null);
  avisoRef.current = aviso;
  conhecidosRef.current = onMidiasConhecidas;

  useEffect(() => {
    conhecidosRef.current?.(Object.values(conhecidos));
  }, [conhecidos]);

  /* Busca com atraso: digitar "promo" dispararia 5 requisições sem isto. */
  useEffect(() => {
    const t = setTimeout(() => { setBuscaAtiva(busca.trim()); setLimite(PAGINA); }, 350);
    return () => clearTimeout(t);
  }, [busca]);

  const carregar = useCallback(() => {
    setCarregando(true);
    const params = new URLSearchParams({ limit: String(limite) });
    if (buscaAtiva) params.set('search', buscaAtiva);
    if (tipo)       params.set('type', tipo);
    if (pasta)      params.set('folder', pasta);

    api.get(`/media?${params.toString()}`)
      .then(({ data }) => {
        const lista = Array.isArray(data) ? data : (data.files || data.medias || []);
        setItens(lista);
        setTotal(Number(data?.total ?? lista.length));
        if (Array.isArray(data?.folders)) setPastas(data.folders);
        registrar(lista);
      })
      .catch(() => avisoRef.current?.('error', 'Erro', 'Não foi possível carregar a biblioteca.'))
      .finally(() => setCarregando(false));
  }, [buscaAtiva, tipo, pasta, limite, registrar]);

  useEffect(() => { carregar(); }, [carregar]);

  /* ── Ações ───────────────────────────────────────────────────────────────── */

  const alternar = (id) => {
    const chave = String(id);
    onSelecionar(selecionados.includes(chave)
      ? selecionados.filter(x => x !== chave)
      : [...selecionados, chave]);
  };

  const selecionarVisiveis = () => {
    const ids = itens.map(m => String(m._id));
    const faltando = ids.filter(id => !selecionados.includes(id));
    onSelecionar(faltando.length ? [...selecionados, ...faltando] : selecionados.filter(id => !ids.includes(id)));
  };

  async function enviar(arquivos, { comoCapaDe = null } = {}) {
    const lista = Array.from(arquivos || []);
    if (!lista.length) return;

    setEnviando(true);
    const forma = new FormData();
    // Campo 'media' é o nome canônico da rota. (O backend hoje aceita qualquer
    // nome; usar o canônico evita depender dessa tolerância.)
    lista.forEach(f => forma.append('media', f));
    if (pasta) forma.append('folder', pasta);

    try {
      const { data } = await api.post('/media/upload', forma);
      const criadas = data?.media || data?.files || [];
      if (!criadas.length) throw new Error('nenhum arquivo aceito');

      registrar(criadas);

      if (comoCapaDe) {
        onCapa?.(comoCapaDe, String(criadas[0]._id));
        avisoRef.current?.('success', 'Capa definida', 'A imagem enviada virou a capa do vídeo.');
        setModalCapa(null);
      } else {
        onSelecionar([...selecionados, ...criadas.map(m => String(m._id))
          .filter(id => !selecionados.includes(id))]);
        avisoRef.current?.('success', 'Upload concluído', `${criadas.length} arquivo(s) enviado(s) e selecionado(s).`);
      }
      carregar();
    } catch {
      avisoRef.current?.('error', 'Erro no upload', 'Não foi possível enviar os arquivos.');
    } finally {
      setEnviando(false);
      if (arquivoRef.current) arquivoRef.current.value = '';
    }
  }

  /* ── Derivados ───────────────────────────────────────────────────────────── */

  // Selecionados na ordem de seleção, incluindo os que o filtro atual esconde.
  const escolhidos = useMemo(
    () => selecionados.map(id => conhecidos[id]).filter(Boolean),
    [selecionados, conhecidos],
  );

  const imagensDisponiveis = useMemo(
    () => Object.values(conhecidos).filter(m => !ehVideo(m)),
    [conhecidos],
  );

  const todosVisiveisMarcados = itens.length > 0 && itens.every(m => selecionados.includes(String(m._id)));

  /* ── Estilos ─────────────────────────────────────────────────────────────── */

  const campo = {
    height: 34, padding: '0 10px', borderRadius: 8, fontSize: 12,
    background: 'oklch(0.10 0.03 235)', color: 'var(--text)',
    border: '1px solid oklch(1 0 0 / 0.10)', outline: 'none',
  };
  const botao = (ativo) => ({
    padding: '7px 12px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer',
    background: ativo ? 'rgba(0,212,255,.14)' : 'oklch(1 0 0 / 0.04)',
    color:      ativo ? 'var(--cyan)'         : 'var(--text3)',
    border:     ativo ? '1px solid rgba(0,212,255,.35)' : '1px solid oklch(1 0 0 / 0.08)',
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

      {/* ── Abas ───────────────────────────────────────────────────────────
          Escolher o que já existe e trazer arquivo novo são tarefas
          diferentes. Na mesma barra, o botão de enviar competia com os filtros
          e nenhuma das duas ficava óbvia. */}
      <div style={{ display: 'flex', gap: 4, padding: 4, borderRadius: 10,
        background: 'oklch(0.10 0.03 235)', border: '1px solid oklch(1 0 0 / 0.08)' }}>
        {[
          ['biblioteca', 'Biblioteca', `${total} arquivo(s) salvos`],
          ['upload',     'Enviar novos', 'Do seu computador'],
        ].map(([id, titulo, sub]) => (
          <button key={id} onClick={() => setAba(id)} style={{
            flex: 1, padding: '9px 12px', borderRadius: 8, cursor: 'pointer', textAlign: 'left',
            border: 'none',
            background: aba === id ? 'rgba(0,212,255,.13)' : 'transparent',
            color:      aba === id ? 'var(--cyan)'         : 'var(--text3)',
          }}>
            <div style={{ fontSize: 12, fontWeight: 800 }}>{titulo}</div>
            <div style={{ fontSize: 9.5, opacity: .75, marginTop: 1 }}>{sub}</div>
          </button>
        ))}
      </div>

      {/* ── Envio de arquivos ──────────────────────────────────────────────── */}
      {aba === 'upload' && (
        <label
          onDragOver={e => { e.preventDefault(); setArrastando(true); }}
          onDragLeave={() => setArrastando(false)}
          onDrop={e => {
            e.preventDefault();
            setArrastando(false);
            enviar(e.dataTransfer?.files);
          }}
          style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            gap: 10, padding: '38px 20px', borderRadius: 14, textAlign: 'center',
            cursor: enviando ? 'default' : 'pointer',
            border: `1.5px dashed ${arrastando ? 'var(--cyan)' : 'oklch(1 0 0 / 0.18)'}`,
            background: arrastando ? 'rgba(0,212,255,.06)' : 'oklch(1 0 0 / 0.02)',
            transition: 'all .15s',
          }}>
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke={arrastando ? 'var(--cyan)' : 'var(--text3)'}
            strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          <div style={{ fontSize: 13, fontWeight: 700, color: enviando ? 'var(--text3)' : 'var(--text)' }}>
            {enviando ? 'Enviando…' : 'Arraste os arquivos aqui ou clique para escolher'}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text3)', lineHeight: 1.6 }}>
            Vídeos e imagens. O que subir entra na biblioteca e já fica
            selecionado para esta campanha.
            {pasta && <><br />Será salvo na pasta <strong>{pasta}</strong>.</>}
          </div>
          <input ref={arquivoRef} type="file" multiple accept="video/*,image/*"
            style={{ display: 'none' }} disabled={enviando}
            onChange={e => enviar(e.target.files)} />
        </label>
      )}

      {/* ── Barra de controle ─────────────────────────────────────────────── */}
      {aba === 'biblioteca' && (
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          value={busca}
          onChange={e => setBusca(e.target.value)}
          placeholder="Buscar por nome do arquivo…"
          style={{ ...campo, flex: 1, minWidth: 180 }}
        />

        <div style={{ display: 'flex', gap: 5 }}>
          {[['', 'Tudo'], ['video', 'Vídeos'], ['image', 'Imagens']].map(([valor, rotulo]) => (
            <button key={valor} onClick={() => { setTipo(valor); setLimite(PAGINA); }}
              style={botao(tipo === valor)}>{rotulo}</button>
          ))}
        </div>

        {pastas.length > 1 && (
          <select value={pasta} onChange={e => { setPasta(e.target.value); setLimite(PAGINA); }}
            style={{ ...campo, cursor: 'pointer' }}>
            <option value="">Todas as pastas</option>
            {pastas.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        )}

      </div>
      )}

      {/* ── Selecionados ──────────────────────────────────────────────────────
          Fica no topo e fora do filtro: é o único lugar onde dá para conferir a
          seleção inteira sem limpar a busca. */}
      <div style={{
        border: '1px solid oklch(1 0 0 / 0.08)', borderRadius: 12, padding: 12,
        background: 'oklch(0.16 0.05 235 / 0.45)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: escolhidos.length ? 10 : 0, gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--cyan)' }}>
            {escolhidos.length} conteúdo(s) na campanha
          </span>
          {escolhidos.length > 0 && (
            <button onClick={() => onSelecionar([])} style={botao(false)}>Limpar seleção</button>
          )}
        </div>

        {escolhidos.length === 0 ? (
          <div style={{ fontSize: 11, color: 'var(--text3)', lineHeight: 1.6 }}>
            Nada selecionado ainda. Escolha abaixo ou envie arquivos novos — a ordem
            do clique é a ordem em que os conteúdos entram no plano.
          </div>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
            {escolhidos.map((m, i) => {
              const video = ehVideo(m);
              const capa  = capas[String(m._id)];
              return (
                <span key={m._id} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '5px 8px 5px 6px', borderRadius: 8, fontSize: 10.5,
                  background: 'oklch(0.10 0.03 235)', border: '1px solid oklch(1 0 0 / 0.10)',
                  color: 'var(--text2)', maxWidth: 260,
                }}>
                  <span style={{
                    width: 17, height: 17, borderRadius: '50%', flexShrink: 0,
                    background: 'var(--cyan)', color: '#04121c', fontSize: 9, fontWeight: 800,
                    display: 'grid', placeItems: 'center',
                  }}>{i + 1}</span>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {m.originalName || m.filename}
                  </span>
                  {video && (
                    <button
                      onClick={() => setModalCapa(String(m._id))}
                      title={capa ? 'Trocar a capa deste vídeo' : 'Definir capa deste vídeo'}
                      style={{
                        border: 'none', cursor: 'pointer', borderRadius: 6, padding: '2px 6px',
                        fontSize: 9, fontWeight: 700,
                        background: capa ? 'rgba(139,92,246,.18)' : 'oklch(1 0 0 / 0.06)',
                        color:      capa ? '#a78bfa'              : 'var(--text3)',
                      }}>{capa ? 'capa ✓' : 'capa'}</button>
                  )}
                  <button onClick={() => alternar(m._id)} title="Remover"
                    style={{ border: 'none', background: 'transparent', color: 'var(--text3)', cursor: 'pointer', fontSize: 13, lineHeight: 1, padding: 0 }}>×</button>
                </span>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Biblioteca ────────────────────────────────────────────────────── */}
      {aba === 'biblioteca' && (<>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, color: 'var(--text3)' }}>
          {carregando ? 'Carregando…' : `Mostrando ${itens.length} de ${total} na biblioteca`}
        </span>
        {itens.length > 0 && (
          <button onClick={selecionarVisiveis} style={botao(false)}>
            {todosVisiveisMarcados ? 'Desmarcar visíveis' : 'Selecionar visíveis'}
          </button>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(128px,1fr))', gap: 10 }}>
        {itens.map(m => {
          const id      = String(m._id);
          const marcado = selecionados.includes(id);
          const ordem   = selecionados.indexOf(id) + 1;
          const video   = ehVideo(m);
          return (
            <button key={id} onClick={() => alternar(id)} style={{
              position: 'relative', padding: 0, borderRadius: 12, overflow: 'hidden', cursor: 'pointer',
              aspectRatio: '3/4', textAlign: 'left', transition: 'all .18s cubic-bezier(.4,0,.2,1)',
              background: 'oklch(0.16 0.05 235)',
              border: `2px solid ${marcado ? 'var(--cyan)' : 'transparent'}`,
              boxShadow: marcado ? '0 4px 14px rgba(0,212,255,0.2)' : 'none',
              transform: marcado ? 'translateY(-2px)' : 'none',
            }}>
              {m.url && (video
                ? <video src={m.url} muted playsInline preload="metadata"
                    style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', filter: marcado ? 'brightness(1.08)' : 'brightness(.78)' }} />
                : <img src={m.url} alt=""
                    style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', filter: marcado ? 'brightness(1.08)' : 'brightness(.78)' }} />
              )}

              {marcado && (
                <span style={{
                  position: 'absolute', top: 8, left: 8, width: 24, height: 24, borderRadius: '50%',
                  background: 'var(--cyan)', color: '#04121c', display: 'grid', placeItems: 'center',
                  fontSize: 12, fontWeight: 800, boxShadow: '0 2px 5px rgba(0,0,0,.3)',
                }}>{ordem}</span>
              )}

              {video && capas[id] && (
                <span style={{
                  position: 'absolute', top: 8, right: 8, padding: '2px 6px', borderRadius: 6,
                  fontSize: 9, fontWeight: 800, background: 'rgba(139,92,246,.9)', color: '#fff',
                }}>CAPA</span>
              )}

              <div style={{
                position: 'absolute', left: 0, right: 0, bottom: 0, padding: '20px 9px 8px',
                background: 'linear-gradient(to top, rgba(0,0,0,.9), transparent)',
                fontSize: 10, fontWeight: 600, color: '#fff',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {video && (
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" style={{ display: 'inline-block', verticalAlign: '-1px', marginRight: 4 }}>
                    <polygon points="5 3 19 12 5 21 5 3" />
                  </svg>
                )}
                {m.originalName || m.filename}
              </div>
            </button>
          );
        })}

        {!carregando && !itens.length && (
          <div style={{
            gridColumn: '1/-1', padding: '34px 0', textAlign: 'center', color: 'var(--text3)',
            fontSize: 12.5, background: 'oklch(1 0 0 / 0.02)', borderRadius: 12, lineHeight: 1.7,
          }}>
            {buscaAtiva || tipo || pasta
              ? <>Nenhuma mídia bate com esse filtro.<br />Ajuste a busca ou envie um arquivo novo.</>
              : <>A biblioteca está vazia.<br />Use a aba <strong>Enviar novos</strong> para começar.</>}
          </div>
        )}
      </div>

      {itens.length < total && (
        <button onClick={() => setLimite(l => l + PAGINA)} disabled={carregando}
          style={{ ...botao(false), alignSelf: 'center', padding: '9px 18px' }}>
          {carregando ? 'Carregando…' : `Carregar mais (${total - itens.length} restantes)`}
        </button>
      )}
      </>)}

      {/* ── Modal de capa ─────────────────────────────────────────────────── */}
      {modalCapa && (
        <div
          onClick={e => { if (e.target === e.currentTarget) setModalCapa(null); }}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,.65)', zIndex: 60,
            display: 'grid', placeItems: 'center', padding: 20,
          }}>
          <div style={{
            width: 'min(560px, 100%)', maxHeight: '80vh', overflow: 'auto',
            background: 'oklch(0.14 0.04 235)', border: '1px solid oklch(1 0 0 / 0.10)',
            borderRadius: 16, padding: 18,
          }}>
            <h3 style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 700 }}>Capa do vídeo</h3>
            <p style={{ margin: '0 0 14px', fontSize: 11.5, color: 'var(--text3)', lineHeight: 1.6 }}>
              A imagem escolhida vira a miniatura do Reel. Sem capa, o Instagram usa
              um quadro do próprio vídeo.
            </p>

            <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
              <label style={{
                ...botao(false), cursor: enviando ? 'default' : 'pointer',
                background: 'rgba(16,185,129,.12)', color: '#34d399', border: '1px solid rgba(16,185,129,.28)',
              }}>
                {enviando ? 'Enviando…' : 'Enviar imagem nova'}
                <input type="file" accept="image/*" style={{ display: 'none' }} disabled={enviando}
                  onChange={e => enviar(e.target.files, { comoCapaDe: modalCapa })} />
              </label>
              {capas[modalCapa] && (
                <button onClick={() => { onCapa?.(modalCapa, null); setModalCapa(null); }} style={botao(false)}>
                  Remover capa
                </button>
              )}
            </div>

            {imagensDisponiveis.length ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(92px,1fr))', gap: 8 }}>
                {imagensDisponiveis.map(img => {
                  const escolhida = capas[modalCapa] === String(img._id);
                  return (
                    <button key={img._id}
                      onClick={() => { onCapa?.(modalCapa, String(img._id)); setModalCapa(null); }}
                      style={{
                        position: 'relative', aspectRatio: '3/4', padding: 0, borderRadius: 10,
                        overflow: 'hidden', cursor: 'pointer', background: 'oklch(0.16 0.05 235)',
                        border: `2px solid ${escolhida ? '#a78bfa' : 'transparent'}`,
                      }}>
                      <img src={img.url} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
                    </button>
                  );
                })}
              </div>
            ) : (
              <div style={{ fontSize: 11.5, color: 'var(--text3)', textAlign: 'center', padding: '18px 0' }}>
                Nenhuma imagem na biblioteca ainda — envie uma acima.
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
              <button onClick={() => setModalCapa(null)} style={botao(false)}>Fechar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
