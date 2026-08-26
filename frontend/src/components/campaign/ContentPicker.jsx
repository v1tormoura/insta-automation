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
 *
 * A grade rola DENTRO de si, com altura limitada. Solta, ela empurrava os
 * filtros e a bandeja de selecionados para fora da tela: com 315 arquivos a
 * etapa passava de dois mil pixels, e conferir a seleção exigia rolar de volta
 * ao topo.
 */

const PAGINA = 40;

const ehVideo = m =>
  m?.type === 'video' || /\.(mp4|mov|webm|m4v|avi|mkv)$/i.test(m?.filename || '');

const nomeDe = m => m?.originalName || m?.filename || 'sem nome';

/* Sentinela de "capa em lote". O modal é o mesmo em ambos os casos — só muda
   quem recebe a escolha — e um contentId reservado evita duplicar a tela
   inteira só para trocar o destino. */
const TODOS = '__todos__';

/**
 * Miniatura de uma mídia — o mesmo desenho na bandeja e na grade.
 *
 * Fica FORA do ContentPicker de propósito. Declarada dentro, ela ganharia
 * identidade nova a cada render, e o React trataria cada render como um
 * componente diferente: desmontaria e remontaria os elementos. Com quarenta
 * miniaturas na grade, cada tecla digitada na busca destruiria e recriaria
 * quarenta <video>, que o navegador teria de decodificar de novo.
 */
function Miniatura({ midia, brilho = 1 }) {
  if (!midia?.url) return null;
  const estilo = {
    position: 'absolute', inset: 0, width: '100%', height: '100%',
    objectFit: 'cover', filter: `brightness(${brilho})`,
  };
  return ehVideo(midia)
    ? <video src={midia.url} muted playsInline preload="metadata" style={estilo} />
    : <img src={midia.url} alt="" style={estilo} />;
}

/** Ícone de imagem — usado onde a capa ainda não foi escolhida. */
function IconeCapa({ tamanho = 9 }) {
  return (
    <svg width={tamanho} height={tamanho} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <polyline points="21 15 16 10 5 21" />
    </svg>
  );
}

export default function ContentPicker({
  selecionados = [],      // [contentId] — a ordem é a ordem de seleção
  onSelecionar,           // (proximaLista) => void
  capas = {},             // { [contentId]: mediaId } — capa escolhida por vídeo
  onCapa,                 // (contentId, mediaId|null) => void
  onCapaTodos,            // (mediaId|null) => void — aplica a TODOS os vídeos
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

  /* Fechar o modal com Esc: ele cobre a tela inteira e, sem isto, a única
     saída era acertar o clique fora ou o botão Fechar lá no rodapé. */
  useEffect(() => {
    if (!modalCapa) return;
    const aoTeclar = e => { if (e.key === 'Escape') setModalCapa(null); };
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, [modalCapa]);

  /* Aplica a capa escolhida a um vídeo ou a todos, conforme o modal aberto.
     Concentrado aqui porque os três caminhos que definem capa — clicar numa
     imagem, enviar uma nova, remover — precisam da mesma decisão, e espalhá-la
     era como o modo lote deixaria de valer para o upload. */
  function aplicarCapa(mediaId) {
    if (modalCapa === TODOS) onCapaTodos?.(mediaId, idsDeVideo);
    else onCapa?.(modalCapa, mediaId);
    setModalCapa(null);
  }

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

  async function enviar(arquivos, { comoCapaDe = null, idsAlvo = [] } = {}) {
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
        const id = String(criadas[0]._id);
        if (comoCapaDe === TODOS) {
          onCapaTodos?.(id, idsAlvo);
          avisoRef.current?.('success', 'Capa definida',
            'A imagem enviada virou a capa de todos os vídeos da campanha.');
        } else {
          onCapa?.(comoCapaDe, id);
          avisoRef.current?.('success', 'Capa definida', 'A imagem enviada virou a capa do vídeo.');
        }
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

  /* Só os vídeos: capa em imagem não existe — o Instagram usa a própria
     imagem como miniatura, e gravar capa nela sujaria o plano com uma chave
     que o executor ignoraria.

     Sem useMemo de propósito: é um filtro sobre a lista de selecionados, que
     tem dezenas de itens e não centenas, e o resultado não entra em nenhuma
     lista de dependências — só em manipuladores e no JSX. Memoizar aqui fazia
     o compilador do React desistir de otimizar o componente inteiro. */
  const idsDeVideo = escolhidos.filter(ehVideo).map(m => String(m._id));
  const totalVideos = idsDeVideo.length;

  /* Vídeo sem capa não é erro — o Instagram escolhe um quadro. Mas é uma
     escolha que passa despercebida, então a bandeja diz quantos estão assim. */
  const videosSemCapa = escolhidos.filter(m => ehVideo(m) && !capas[String(m._id)]).length;

  const todosVisiveisMarcados = itens.length > 0 && itens.every(m => selecionados.includes(String(m._id)));

  /* ── Estilos ─────────────────────────────────────────────────────────────── */

  const ACENTO = 'var(--mf-mod-campanhas, var(--mf-accent-500))';

  const campo = {
    height: 36, padding: '0 11px', borderRadius: 9, fontSize: 12,
    background: 'var(--mf-surface-2)', color: 'var(--mf-text)',
    border: '1px solid var(--mf-border)', outline: 'none',
  };

  const botao = (ativo) => ({
    padding: '7px 12px', borderRadius: 9, fontSize: 11, fontWeight: 700, cursor: 'pointer',
    transition: 'all .15s',
    background: ativo ? `color-mix(in oklch, ${ACENTO} 14%, transparent)` : 'var(--mf-surface-2)',
    color:      ativo ? ACENTO : 'var(--mf-text-3)',
    border:     `1px solid ${ativo ? `color-mix(in oklch, ${ACENTO} 38%, transparent)` : 'var(--mf-border)'}`,
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

      {/* ── Abas ───────────────────────────────────────────────────────────
          Escolher o que já existe e trazer arquivo novo são tarefas
          diferentes. Na mesma barra, o botão de enviar competia com os filtros
          e nenhuma das duas ficava óbvia. */}
      <div style={{ display: 'flex', gap: 4, padding: 4, borderRadius: 12,
        background: 'var(--mf-surface-2)', border: '1px solid var(--mf-border)' }}>
        {[
          ['biblioteca', 'Biblioteca', `${total} arquivo(s) salvos`],
          ['upload',     'Enviar novos', 'Do seu computador'],
        ].map(([id, titulo, sub]) => (
          <button key={id} onClick={() => setAba(id)} style={{
            flex: 1, padding: '9px 12px', borderRadius: 9, cursor: 'pointer', textAlign: 'left',
            border: 'none', transition: 'all .15s',
            background: aba === id ? `color-mix(in oklch, ${ACENTO} 15%, transparent)` : 'transparent',
            color:      aba === id ? ACENTO : 'var(--mf-text-3)',
          }}>
            <div style={{ fontSize: 12, fontWeight: 800 }}>{titulo}</div>
            <div style={{ fontSize: 9.5, opacity: .78, marginTop: 1 }}>{sub}</div>
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
            border: `1.5px dashed ${arrastando ? ACENTO : 'var(--mf-border-strong)'}`,
            background: arrastando
              ? `color-mix(in oklch, ${ACENTO} 7%, transparent)`
              : 'var(--mf-surface-2)',
            transition: 'all .15s',
          }}>
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none"
            stroke={arrastando ? ACENTO : 'var(--mf-text-3)'}
            strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          <div style={{ fontSize: 13, fontWeight: 700, color: enviando ? 'var(--mf-text-3)' : 'var(--mf-text)' }}>
            {enviando ? 'Enviando…' : 'Arraste os arquivos aqui ou clique para escolher'}
          </div>
          <div style={{ fontSize: 11, color: 'var(--mf-text-3)', lineHeight: 1.6 }}>
            Vídeos e imagens. O que subir entra na biblioteca e já fica
            selecionado para esta campanha.
            {pasta && <><br />Será salvo na pasta <strong>{pasta}</strong>.</>}
          </div>
          <input ref={arquivoRef} type="file" multiple accept="video/*,image/*"
            style={{ display: 'none' }} disabled={enviando}
            onChange={e => enviar(e.target.files)} />
        </label>
      )}

      {/* ── Selecionados ──────────────────────────────────────────────────────
          Miniaturas, não nomes de arquivo. Os nomes vêm do exportador e são
          quase idênticos entre si — `(new)larissagomes2g_178551331…` — então a
          bandeja em texto não dizia o que estava na campanha.

          É também onde mora a capa: só faz sentido definir capa do que já foi
          escolhido, e aqui cada vídeo tem a sua ao lado. */}
      <div style={{
        border: '1px solid var(--mf-border)', borderRadius: 14, padding: 14,
        background: 'var(--mf-surface-1)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          marginBottom: escolhidos.length ? 12 : 0, gap: 8, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 9, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12.5, fontWeight: 750, color: ACENTO }}>
              {escolhidos.length} conteúdo(s) na campanha
            </span>
            {videosSemCapa > 0 && (
              <span style={{ fontSize: 10.5, color: 'var(--mf-text-3)' }}>
                {videosSemCapa} sem capa — o Instagram escolhe um quadro
              </span>
            )}
          </div>
          {escolhidos.length > 0 && (
            <>
              {/* Com 27 vídeos na campanha, definir capa um a um são 27 idas ao
                  modal. Quase sempre a capa é a mesma para todos. */}
              {totalVideos > 1 && (
                <button onClick={() => setModalCapa(TODOS)} style={{
                  ...botao(false),
                  background: 'color-mix(in oklch, var(--mf-mod-publicar) 14%, transparent)',
                  color: 'var(--mf-mod-publicar)',
                  border: '1px solid color-mix(in oklch, var(--mf-mod-publicar) 36%, transparent)',
                }}>
                  Capa para todos ({totalVideos})
                </button>
              )}
              <button onClick={() => onSelecionar([])} style={botao(false)}>Limpar seleção</button>
            </>
          )}
        </div>

        {escolhidos.length === 0 ? (
          <div style={{ fontSize: 11.5, color: 'var(--mf-text-3)', lineHeight: 1.65 }}>
            Nada selecionado ainda. Escolha abaixo ou envie arquivos novos — a ordem
            do clique é a ordem em que os conteúdos entram no plano.
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 4, scrollbarWidth: 'thin' }}>
            {escolhidos.map((m, i) => {
              const id    = String(m._id);
              const video = ehVideo(m);
              const capa  = capas[id] ? conhecidos[capas[id]] : null;
              return (
                <div key={id} style={{ width: 92, flexShrink: 0 }}>
                  <div style={{
                    position: 'relative', width: 92, aspectRatio: '3/4', borderRadius: 11,
                    overflow: 'hidden', background: 'var(--mf-surface-3)',
                    border: '1px solid var(--mf-border)',
                  }}>
                    <Miniatura midia={m} brilho={0.92} />

                    <span style={{
                      position: 'absolute', top: 5, left: 5, width: 19, height: 19, borderRadius: '50%',
                      background: ACENTO, color: 'var(--mf-bg)',
                      fontSize: 9.5, fontWeight: 800, display: 'grid', placeItems: 'center',
                      boxShadow: '0 1px 4px oklch(0 0 0 / .4)',
                    }}>{i + 1}</span>

                    <button onClick={() => alternar(id)} title="Remover da campanha"
                      style={{
                        position: 'absolute', top: 5, right: 5, width: 19, height: 19, borderRadius: '50%',
                        display: 'grid', placeItems: 'center', cursor: 'pointer', padding: 0,
                        /* Branco literal, não token: isto flutua sobre a FOTO,
                           não sobre a superfície do app. Um token de texto
                           seguiria o tema e sumiria sobre a imagem. */
                        background: 'oklch(0 0 0 / .55)', border: '1px solid oklch(1 0 0 / .22)',
                        color: '#fff', fontSize: 12, lineHeight: 1,
                      }}>×</button>
                  </div>

                  {/* Capa só existe para vídeo. Na imagem o espaço fica com o
                      nome do arquivo, para a linha não dançar de altura. */}
                  {video ? (
                    <button onClick={() => setModalCapa(id)}
                      title={capa ? `Capa: ${nomeDe(capa)} — clique para trocar` : 'Definir a capa deste vídeo'}
                      style={{
                        marginTop: 5, width: '100%', display: 'flex', alignItems: 'center', gap: 5,
                        padding: '4px 6px', borderRadius: 8, cursor: 'pointer', textAlign: 'left',
                        fontSize: 9.5, fontWeight: 750, transition: 'all .15s',
                        background: capa
                          ? 'color-mix(in oklch, var(--mf-mod-publicar) 16%, transparent)'
                          : 'var(--mf-surface-2)',
                        color: capa ? 'var(--mf-mod-publicar)' : 'var(--mf-text-3)',
                        border: `1px solid ${capa
                          ? 'color-mix(in oklch, var(--mf-mod-publicar) 38%, transparent)'
                          : 'var(--mf-border)'}`,
                      }}>
                      <span style={{
                        width: 15, height: 15, borderRadius: 4, flexShrink: 0, overflow: 'hidden',
                        position: 'relative', display: 'grid', placeItems: 'center',
                        background: capa ? 'transparent' : 'var(--mf-surface-3)',
                      }}>
                        {capa
                          ? <img src={capa.url} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
                          : <IconeCapa />}
                      </span>
                      {capa ? 'Capa' : 'Definir capa'}
                    </button>
                  ) : (
                    <div style={{
                      marginTop: 5, fontSize: 9.5, color: 'var(--mf-text-3)', padding: '5px 2px',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }} title={nomeDe(m)}>{nomeDe(m)}</div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Biblioteca ────────────────────────────────────────────────────── */}
      {aba === 'biblioteca' && (<>
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

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, color: 'var(--mf-text-3)' }}>
          {carregando ? 'Carregando…' : `Mostrando ${itens.length} de ${total} na biblioteca`}
        </span>
        {itens.length > 0 && (
          <button onClick={selecionarVisiveis} style={botao(false)}>
            {todosVisiveisMarcados ? 'Desmarcar visíveis' : 'Selecionar visíveis'}
          </button>
        )}
      </div>

      {/* A grade rola dentro de si. Solta, ela empurrava os filtros e a bandeja
          para fora da tela, e a etapa passava de dois mil pixels de altura. */}
      <div style={{
        maxHeight: 'min(56vh, 560px)', overflowY: 'auto', overflowX: 'hidden',
        padding: 2, borderRadius: 12, scrollbarWidth: 'thin',
      }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(min(124px,100%),1fr))', gap: 10 }}>
          {itens.map(m => {
            const id      = String(m._id);
            const marcado = selecionados.includes(id);
            const ordem   = selecionados.indexOf(id) + 1;
            const video   = ehVideo(m);
            const capa    = capas[id] ? conhecidos[capas[id]] : null;
            return (
              /* Contêiner posicionado com DOIS botões IRMÃOS: o de selecionar,
                 que preenche o cartão, e o da capa por cima. Botão dentro de
                 botão é HTML inválido — o navegador desaninha os dois, e o
                 clique na capa passaria a marcar o vídeo. */
              <div key={id} style={{
                position: 'relative', borderRadius: 12, aspectRatio: '3/4',
                transition: 'transform .18s cubic-bezier(.4,0,.2,1)',
                transform: marcado ? 'translateY(-2px)' : 'none',
              }}>
                <button onClick={() => alternar(id)}
                  title={marcado ? 'Remover da campanha' : 'Adicionar à campanha'}
                  style={{
                    position: 'absolute', inset: 0, padding: 0, borderRadius: 12, overflow: 'hidden',
                    cursor: 'pointer', textAlign: 'left', width: '100%', height: '100%',
                    background: 'var(--mf-surface-2)',
                    border: `2px solid ${marcado ? ACENTO : 'var(--mf-border)'}`,
                    boxShadow: marcado
                      ? `0 4px 16px color-mix(in oklch, ${ACENTO} 24%, transparent)`
                      : 'none',
                    transition: 'border-color .18s, box-shadow .18s',
                  }}>
                  <Miniatura midia={m} brilho={marcado ? 1.06 : 0.76} />

                  {marcado && (
                    <span style={{
                      position: 'absolute', top: 7, left: 7, width: 23, height: 23, borderRadius: '50%',
                      background: ACENTO, color: 'var(--mf-bg)',
                      display: 'grid', placeItems: 'center', fontSize: 11.5, fontWeight: 800,
                      boxShadow: '0 2px 6px oklch(0 0 0 / .4)',
                    }}>{ordem}</span>
                  )}

                  <div style={{
                    position: 'absolute', left: 0, right: 0, bottom: 0,
                    /* Folga à direita quando o botão de capa está lá, para o
                       nome do arquivo não passar por baixo dele. */
                    padding: video && marcado ? '20px 38px 8px 9px' : '20px 9px 8px',
                    background: 'linear-gradient(to top, oklch(0 0 0 / .9), transparent)',
                    /* Sobre o gradiente preto da miniatura — branco literal
                       pelo mesmo motivo do botão de remover. */
                    fontSize: 10, fontWeight: 600, color: '#fff',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {video && (
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"
                        style={{ display: 'inline-block', verticalAlign: '-1px', marginRight: 4 }}>
                        <polygon points="5 3 19 12 5 21 5 3" />
                      </svg>
                    )}
                    {nomeDe(m)}
                  </div>
                </button>

                {/* A capa aparece no próprio cartão assim que o vídeo entra na
                    campanha. Antes existia só como um texto de 9px dentro da
                    bandeja, e passava despercebida. */}
                {video && marcado && (
                  <button onClick={() => setModalCapa(id)}
                    title={capa ? `Capa: ${nomeDe(capa)} — clique para trocar` : 'Definir a capa deste vídeo'}
                    style={{
                      position: 'absolute', right: 7, bottom: 7, zIndex: 2,
                      width: 26, height: 26, borderRadius: 8, padding: 0, cursor: 'pointer',
                      display: 'grid', placeItems: 'center', overflow: 'hidden',
                      background: capa ? 'transparent' : 'oklch(0 0 0 / .6)',
                      /* A borda também é branca literal: `--mf-surface-3` é
                         opaca e escura, e sumiria contra fotos escuras. */
                      border: `1.5px solid ${capa ? 'var(--mf-mod-publicar)' : 'oklch(1 0 0 / .35)'}`,
                      color: '#fff',
                    }}>
                    {capa
                      ? <img src={capa.url} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
                      : <IconeCapa tamanho={13} />}
                  </button>
                )}
              </div>
            );
          })}

          {!carregando && !itens.length && (
            <div style={{
              gridColumn: '1/-1', padding: '34px 0', textAlign: 'center', color: 'var(--mf-text-3)',
              fontSize: 12.5, background: 'var(--mf-surface-2)', borderRadius: 12, lineHeight: 1.7,
            }}>
              {buscaAtiva || tipo || pasta
                ? <>Nenhuma mídia bate com esse filtro.<br />Ajuste a busca ou envie um arquivo novo.</>
                : <>A biblioteca está vazia.<br />Use a aba <strong>Enviar novos</strong> para começar.</>}
            </div>
          )}
        </div>
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
          role="dialog" aria-modal="true"
          aria-label={modalCapa === TODOS ? 'Escolher a capa de todos os vídeos' : 'Escolher a capa do vídeo'}
          style={{
            position: 'fixed', inset: 0, background: 'oklch(0 0 0 / .68)', zIndex: 60,
            display: 'grid', placeItems: 'center', padding: 20,
          }}>
          <div style={{
            width: 'min(600px, 100%)', maxHeight: '82vh', display: 'flex', flexDirection: 'column',
            background: 'var(--mf-surface-1)', border: '1px solid var(--mf-border)',
            borderRadius: 18, boxShadow: '0 24px 60px oklch(0 0 0 / .5)',
          }}>
            <div style={{ padding: '18px 20px 14px', borderBottom: '1px solid var(--mf-border)' }}>
              <h3 style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 750, color: 'var(--mf-text)' }}>
                {modalCapa === TODOS ? `Capa para os ${totalVideos} vídeos` : 'Capa do vídeo'}
              </h3>
              <p style={{ margin: 0, fontSize: 11.5, color: 'var(--mf-text-3)', lineHeight: 1.6 }}>
                {modalCapa === TODOS
                  ? <>A imagem escolhida vira a miniatura de <strong>todos</strong> os vídeos
                      desta campanha, substituindo as capas já definidas. Depois dá para
                      trocar a de um vídeo específico pelo botão no cartão dele.</>
                  : <>A imagem escolhida vira a miniatura do Reel no perfil. Sem capa, o
                      Instagram usa um quadro do próprio vídeo.</>}
              </p>
            </div>

            <div style={{ padding: '14px 20px', display: 'flex', gap: 8, flexWrap: 'wrap',
              borderBottom: '1px solid var(--mf-border)' }}>
              <label style={{
                ...botao(false), cursor: enviando ? 'default' : 'pointer',
                background: 'color-mix(in oklch, var(--mf-success-500) 14%, transparent)',
                color: 'var(--mf-success-500)',
                border: '1px solid color-mix(in oklch, var(--mf-success-500) 34%, transparent)',
              }}>
                {enviando ? 'Enviando…' : 'Enviar imagem nova'}
                <input type="file" accept="image/*" style={{ display: 'none' }} disabled={enviando}
                  onChange={e => enviar(e.target.files, { comoCapaDe: modalCapa, idsAlvo: idsDeVideo })} />
              </label>
              {(modalCapa === TODOS ? videosSemCapa < totalVideos : capas[modalCapa]) && (
                <button onClick={() => aplicarCapa(null)} style={botao(false)}>
                  {modalCapa === TODOS ? 'Remover a capa de todos' : 'Remover capa'}
                </button>
              )}
            </div>

            <div style={{ padding: '14px 20px', overflowY: 'auto', flex: 1, scrollbarWidth: 'thin' }}>
              {imagensDisponiveis.length ? (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(88px,1fr))', gap: 9 }}>
                  {imagensDisponiveis.map(img => {
                    const escolhida = modalCapa !== TODOS && capas[modalCapa] === String(img._id);
                    return (
                      <button key={img._id}
                        onClick={() => aplicarCapa(String(img._id))}
                        title={nomeDe(img)}
                        style={{
                          position: 'relative', aspectRatio: '3/4', padding: 0, borderRadius: 10,
                          overflow: 'hidden', cursor: 'pointer', background: 'var(--mf-surface-2)',
                          border: `2px solid ${escolhida ? 'var(--mf-mod-publicar)' : 'var(--mf-border)'}`,
                          transition: 'border-color .15s',
                        }}>
                        <img src={img.url} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
                        {escolhida && (
                          <span style={{
                            position: 'absolute', top: 5, right: 5, width: 18, height: 18, borderRadius: '50%',
                            background: 'var(--mf-mod-publicar)', display: 'grid', placeItems: 'center',
                          }}>
                            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="var(--mf-bg)"
                              strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div style={{ fontSize: 11.5, color: 'var(--mf-text-3)', textAlign: 'center', padding: '22px 0', lineHeight: 1.7 }}>
                  Nenhuma imagem na biblioteca ainda.<br />Envie uma acima para usar como capa.
                </div>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '14px 20px',
              borderTop: '1px solid var(--mf-border)' }}>
              <button onClick={() => setModalCapa(null)} style={botao(false)}>Fechar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
