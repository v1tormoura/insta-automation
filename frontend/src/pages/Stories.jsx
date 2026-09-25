import { useState, useEffect, useRef, useMemo } from 'react';
import StoryMoldura from './StoryMoldura';
import Segmentado from '../components/Segmentado';

/* Os mesmos tetos do backend (src/services/textoNoStory.js). Repetidos e não
   importados porque são processos separados — mas com o nome igual dos dois
   lados, para uma busca por MAX_LINHAS encontrar as duas pontas. */
const MAX_LINHAS = 6;
const MAX_POR_LINHA = 80;

const PLACEHOLDER_TEXTO = 'Escreva aqui\nAté 6 linhas';
import { motion } from 'framer-motion';
import api from '../services/api';
import Toast from '../components/Toast';
import PageShell from '../components/PageShell';
import AccountPicker from '../components/AccountPicker';
import CardMetadados from '../components/CardMetadados';
import TituloDeCartao from '../components/TituloDeCartao';
import useServerEvents from '../services/useServerEvents';
import { EsqueletoLista } from '../components/Estados';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3000';
const DRAFT_KEY = 'stories_form_draft_v1';

function fmt(bytes) {
  if (!bytes) return '';
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}

export default function Stories() {
  const [accounts, setAccounts]       = useState([]);
  const [contasCarregando, setContasCarregando] = useState(true);
  const [selected, setSelected]       = useState([]);
  const [medias, setMedias]           = useState([]);   // { file, url, name, size, type, fromLib, id }
  const [uploading, setUploading]     = useState(false);
  const [dragOver, setDragOver]       = useState(false);
  const [gridMode, setGridMode]       = useState(true);

  /* ── Texto livre ──────────────────────────────────────────────────

     Queimado na mídia pelo ffmpeg antes de publicar — a API oficial não tem
     figurinhas, então o texto vai nos próprios pixels. Padrão em y=0.35. */
  const [texto, setTexto]             = useState('');
  const [textoPos, setTextoPos]       = useState({ x: 0.5, y: 0.35 });
  const [textoTam, setTextoTam]       = useState('medio');
  const [textoCor, setTextoCor]       = useState('branco');
  const [interval, setIntervalMin]    = useState(3);
  const [loading, setLoading]         = useState(false);
  const [results, setResults]         = useState(null);
  const [bgStatus, setBgStatus]       = useState(null);
  const [toast, setToast]             = useState(null);
  const fileRef = useRef();

  function showToast(type, t, msg) { setToast({ type, title: t, message: msg }); setTimeout(() => setToast(null), 3500); }

  /* Converte o clique no preview 9:16 em coordenadas normalizadas do story.
     É o mesmo sistema que o Instagram usa: 0,0 é o canto superior esquerdo. */
  function coordenadasDoEvento(elemento, clientX, clientY) {
    const r = elemento.getBoundingClientRect();
    return {
      x: Number(Math.min(1, Math.max(0, (clientX - r.left) / r.width)).toFixed(3)),
      y: Number(Math.min(1, Math.max(0, (clientY - r.top) / r.height)).toFixed(3)),
    };
  }

  /* ── Arrastar o texto ─────────────────────────────────────────────────────

     Clicar já posicionava, e clicar é bom para um salto grande. Mas ajustar
     dois por cento é uma sequência de cliques às cegas — você não vê o
     resultado enquanto mira, só depois de soltar. Arrastando, a pílula
     acompanha o dedo e a posição final é a que você viu antes de largar.

     `setPointerCapture` é o que faz o gesto sobreviver a sair da caixa: sem
     ele, arrastar um pouco além da borda entrega o evento a outro elemento e o
     movimento morre no meio, deixando o texto onde não se queria. */
  const [arrastando, setArrastando] = useState(null);

  function iniciarArrasto(alvo) {
    return (e) => {
      e.stopPropagation();
      e.currentTarget.setPointerCapture?.(e.pointerId);
      setArrastando(alvo);
    };
  }

  function moverArrasto(e) {
    if (!arrastando) return;
    e.preventDefault();
    /* `caixaPreview` e não `e.currentTarget`: com a captura de ponteiro, o
       currentTarget é o elemento que capturou (o texto), e medir a
       fração contra ele daria uma posição que salta. A referência é sempre a
       moldura do story. */
    const caixa = caixaPreview.current;
    if (!caixa) return;
    const pos = coordenadasDoEvento(caixa, e.clientX, e.clientY);
    setTextoPos(pos);
  }

  function soltarArrasto(e) {
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    setArrastando(null);
  }

  const caixaPreview = useRef(null);

  /* Clicar na moldura vazia posiciona o texto. */
  function clicarNaMoldura(e) {
    if (arrastando) return;
    const pos = coordenadasDoEvento(e.currentTarget, e.clientX, e.clientY);
    if (textoOn) setTextoPos(pos);
  }

  /**
   * O que o backend vai descartar do texto, dito antes de publicar.
   *
   * `limparTextoLivre` corta em 6 linhas de 80 caracteres. O corte é seco: o
   * story sai com o texto pela metade e nada avisa. Aqui a conta é a MESMA,
   * refeita no navegador — ao mexer em um teto, mexa no outro.
   *
   * Devolve `null` quando nada se perde, para o aviso não ocupar espaço
   * enquanto não há o que avisar.
   */
  const avisoTexto = useMemo(() => {
    const linhas = String(texto).split('\n').map(l => l.trim()).filter(Boolean);
    if (linhas.length > MAX_LINHAS) {
      const sobra = linhas.length - MAX_LINHAS;
      return `Só as ${MAX_LINHAS} primeiras linhas são desenhadas — `
           + `${sobra} ${sobra === 1 ? 'linha vai ficar' : 'linhas vão ficar'} de fora.`;
    }
    const longa = linhas.findIndex(l => l.length > MAX_POR_LINHA);
    if (longa >= 0) {
      return `A linha ${longa + 1} passa de ${MAX_POR_LINHA} caracteres e vai `
           + 'sair cortada. Quebre em duas para caber inteira.';
    }
    return null;
  }, [texto]);

  /* O texto está ligado quando há texto. Ponto.

     Antes havia um `textoOn` separado: o campo só aparecia depois de achar e
     acionar um alternador, e era possível ter texto escrito com o alternador
     desligado — nada saía, e nada explicava por quê. Dois estados para uma
     coisa só, e o segundo servindo apenas para contradizer o primeiro.

     Digitar liga; apagar desliga. É como o próprio Instagram funciona: você
     toca no "Aa" e escreve, não existe um interruptor de texto. */
  const textoOn = texto.trim().length > 0;

  /* ── Recupera rascunho salvo ao abrir ou voltar para a página ────────────── */
  useEffect(() => {
    try {
      const saved = localStorage.getItem(DRAFT_KEY);
      if (saved) {
        const d = JSON.parse(saved);
        if (d.texto)    setTexto(d.texto);
        if (d.textoPos) setTextoPos(d.textoPos);
        if (d.textoTam) setTextoTam(d.textoTam);
        if (d.textoCor) setTextoCor(d.textoCor);
        if (d.interval !== undefined) setIntervalMin(d.interval);
        if (Array.isArray(d.medias) && d.medias.length) setMedias(d.medias);
        if (Array.isArray(d.selected) && d.selected.length) setSelected(d.selected);
      }
    } catch { /* segue sem este dado */ }

    // Verifica status de envio em segundo plano
    api.get('/api/stories/status').then(r => {
      if (r.data?.running) setBgStatus(r.data);
    /* `finally` no FIM da cadeia. Encaixado antes do `then`, ele desligaria a
       bandeira enquanto as contas ainda não entraram no estado, e o seletor
       apareceria vazio por um quadro antes de preencher. */
    }).catch(() => { /* a tela mostra o seletor vazio */ })
      .finally(() => setContasCarregando(false));
  }, []);

  /* ── Salva rascunho automaticamente a cada alteração ───────────────────── */
  useEffect(() => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({
        interval, medias, selected,
        texto, textoPos, textoTam, textoCor
      }));
    } catch { /* segue sem este dado */ }
  }, [interval, medias, selected,
      texto, textoPos, textoTam, textoCor]);

  useEffect(() => {
    api.get('/accounts').then(r => {
      const accs = r.data.accounts || r.data || [];
      setAccounts(accs);
      /* Nenhuma conta vem marcada.

         Antes todas as conectadas entravam selecionadas. Numa tela cujo botão
         se chama "Publicar agora", um estado inicial que já escolheu por você
         é a forma mais fácil de publicar na conta errada — e o erro é público
         e não se desfaz. Marcar quatro contas custa quatro cliques; despublicar
         um story de uma conta que não era para ter recebido, não custa nada
         porque não dá.

         O rascunho continua sendo restaurado (mais acima): retomar o que VOCÊ
         escolheu é diferente de escolher por você. */
    }).catch(() => {});
  }, []);

  // Escuta eventos SSE em tempo real de stories
  useServerEvents(['stories', 'posts'], (ev) => {
    if (ev?.action === 'progress') {
      setBgStatus(prev => ({ ...(prev || {}), running: true, completed: ev.completed, total: ev.total, lastUser: ev.username }));
    } else if (ev?.action === 'completed') {
      setBgStatus(null);
      showToast('success', 'Stories Concluídos!', 'Todos os stories agendados foram publicados.');
    }
  });

  async function addFiles(files) {
    const list = Array.from(files);
    if (!list.length) return;
    setUploading(true);
    try {
      for (const f of list) {
        const form = new FormData();
        form.append('image', f);
        const { data } = await api.post('/api/stories/upload', form);
        setMedias(p => [...p, {
          id: data.url + Date.now(),
          url: data.url.startsWith('http') ? data.url : `${API}${data.url}`,
          name: f.name,
          size: f.size,
          type: f.type.startsWith('video') ? 'video' : 'image',
          selected: true,
        }]);
      }
    } catch (e) { showToast('error', 'Erro', e.response?.data?.error || 'Falha no upload.'); }
    finally { setUploading(false); }
  }

  function toggleMedia(id) {
    setMedias(p => p.map(m => m.id === id ? { ...m, selected: !m.selected } : m));
  }
  function removeMedia(id) { setMedias(p => p.filter(m => m.id !== id)); }
  function selectAllMedia() { setMedias(p => p.map(m => ({ ...m, selected: true }))); }
  function clearSelection() { setMedias(p => p.map(m => ({ ...m, selected: false }))); }

  const selectedMedia = medias.filter(m => m.selected);
  const totalMin = Math.max(0, (selectedMedia.length - 1)) * interval;

  /**
   * O que ainda impede a publicação, em ordem de quem resolve primeiro.
   *
   * ── Por que trocar as fichas por isto
   *
   * O topo mostrava "Contas 0/4 · Mídias 0/0 · Duração 0 min · Intervalo 3
   * min". Quatro números, e nenhum deles respondia a pergunta que a pessoa
   * tem ao abrir a tela: por que o botão está apagado. Duração e intervalo
   * são a MESMA informação dita duas vezes (uma é a outra multiplicada pelo
   * número de mídias), e as duas só interessam depois que o resto está
   * resolvido.
   *
   * Agora o topo é a lista de pendências, e ela some quando acaba — dando
   * lugar ao resumo do que vai acontecer. Um aviso que continua na tela
   * depois de resolvido ensina a ignorá-lo.
   */
  const pendencias = useMemo(() => {
    const p = [];
    if (!contasCarregando && !accounts.length) {
      p.push({ o: 'Nenhuma conta conectada', como: 'Conecte uma conta em Contas para poder publicar.' });
    } else if (!selected.length) {
      p.push({ o: 'Nenhuma conta selecionada', como: 'Escolha ao lado em quais contas o story sai.' });
    }
    if (!medias.length) {
      p.push({ o: 'Nenhuma mídia', como: 'Arraste uma imagem ou vídeo, ou escolha da biblioteca.' });
    } else if (!selectedMedia.length) {
      p.push({ o: 'Nenhuma mídia marcada', como: 'Clique nas mídias que devem virar story.' });
    }
    if (textoOn && !texto.trim()) {
      p.push({ o: 'Texto ligado e vazio', como: 'Escreva o texto, ou desligue.' });
    }
    return p;
  }, [contasCarregando, accounts.length, selected.length, medias.length,
      selectedMedia.length, textoOn, texto]);


  async function publish() {
    if (!selected.length) return showToast('warning', 'Atenção', 'Selecione pelo menos uma conta.');
    if (!selectedMedia.length) return showToast('warning', 'Atenção', 'Adicione pelo menos uma mídia.');
    setLoading(true); setResults(null);
    try {
      const { data } = await api.post('/api/stories', {
        accountIds: selected,
        imageUrl: selectedMedia[0].url,
        /* `null` quando desligado, e não o objeto com string vazia: é a
           ausência que faz o backend pular a repassagem de ffmpeg. */
        textoLivre: textoOn && texto.trim()
          ? { texto: texto.trim(), x: textoPos.x, y: textoPos.y,
              tamanho: textoTam, cor: textoCor }
          : null,
        mediaUrls: selectedMedia.map(m => m.url),
        intervalMinutes: interval,
      });
      setResults(data);
      if (data.inBackground) {
        setBgStatus({ running: true, total: selected.length, completed: 0 });
        showToast('success', 'Publicação iniciada!', data.message || 'Stories em execução em segundo plano.');
      } else {
        showToast('success', 'Publicado!', `${data.successCount || 0} de ${data.total || selected.length} publicados.`);
      }
      setMedias([]);
      setTexto('');
      setIntervalMin(1);
    } catch (e) { showToast('error', 'Erro', e.response?.data?.error || 'Falha ao publicar.'); }
    finally { setLoading(false); }
  }

  const pageIcon = (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
    </svg>
  );

  const pageActions = (
    <button
      onClick={publish}
      disabled={loading || !selected.length || !selectedMedia.length}
      className="btn-primary"
      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 'var(--mf-r-sm)', fontSize: 'var(--mf-t-sm)', fontWeight: 700, opacity: (loading || !selected.length || !selectedMedia.length) ? 0.5 : 1 }}
    >
      {loading ? (
        <>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ animation: 'spin 1s linear infinite' }}><path d="M21 12a9 9 0 11-6.219-8.56"/></svg>
          Iniciando...
        </>
      ) : (
        <>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
          Publicar agora
        </>
      )}
    </button>
  );

  return (
    <>
      <Toast toast={toast} onClose={() => setToast(null)} />

      <PageShell
        icon={pageIcon}
        title="Stories em Massa"
        subtitle="Publique fotos e vídeos em todas as contas conectadas"
        accent="purple"
        actions={pageActions}
      >
        {/* Banner de status em segundo plano */}
        {bgStatus?.running && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 16px', borderRadius: 'var(--mf-r-md)', background: 'color-mix(in oklch, var(--mf-mod-contas) 10%, transparent)', border: '1px solid color-mix(in oklch, var(--mf-mod-contas) 30%, transparent)', marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--mf-mod, var(--mf-accent-500))" strokeWidth="2.5" strokeLinecap="round" style={{ animation: 'spin 1s linear infinite' }}><path d="M21 12a9 9 0 11-6.219-8.56"/></svg>
              <span style={{ fontSize: 'var(--mf-t-xs)', fontWeight: 600, color: 'var(--mf-mod, var(--mf-accent-500))' }}>
                Publicação de stories em segundo plano ativa ({bgStatus.completed || 0}/{bgStatus.total || selected.length})
              </span>
            </div>
            <span style={{ fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text-3)', fontFamily: 'var(--mf-mono)' }}>Você pode navegar livremente</span>
          </div>
        )}

        {/* Stats row */}
        {/* ── O que falta, ou o que vai acontecer ─────────────────────────

            Um dos dois, nunca os dois: enquanto há pendência, o resumo do
            plano é conversa sobre algo que ainda não pode acontecer. */}
        {pendencias.length > 0 ? (
          <div style={{
            display: 'flex', flexDirection: 'column', gap: 7, marginBottom: 4,
            padding: '11px 13px', borderRadius: 'var(--mf-r-md)',
            border: '1px solid color-mix(in oklch, var(--mf-warning-500) 24%, transparent)',
            background: 'color-mix(in oklch, var(--mf-warning-500) 6%, var(--mf-surface-2))',
          }}>
            <div style={{ fontSize: 'var(--mf-t-micro)', fontWeight: 750, color: 'var(--mf-warning-500)', letterSpacing: '-0.01em' }}>
              {pendencias.length === 1 ? 'Falta 1 coisa para publicar' : `Faltam ${pendencias.length} coisas para publicar`}
            </div>
            {pendencias.map(p => (
              <div key={p.o} style={{ display: 'flex', gap: 8, alignItems: 'baseline', minWidth: 0 }}>
                <span style={{ width: 5, height: 5, borderRadius: '50%', flexShrink: 0,
                  background: 'var(--mf-warning-500)', transform: 'translateY(-2px)' }} />
                <span style={{ fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text)', fontWeight: 650, flexShrink: 0 }}>{p.o}</span>
                <span style={{ fontSize: 'var(--mf-t-nano)', color: 'var(--mf-text-3)', minWidth: 0 }}>{p.como}</span>
              </div>
            ))}
          </div>
        ) : (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 4,
            padding: '10px 13px', borderRadius: 'var(--mf-r-md)',
            border: '1px solid color-mix(in oklch, var(--mf-success-500) 24%, transparent)',
            background: 'color-mix(in oklch, var(--mf-success-500) 6%, var(--mf-surface-2))',
          }}>
            <span style={{ fontSize: 'var(--mf-t-micro)', fontWeight: 750, color: 'var(--mf-success-500)', flexShrink: 0 }}>
              Pronto para publicar
            </span>
            {/* Uma frase, e não quatro fichas: a mesma informação dita como se
                diria em voz alta, que é como ela se confere. */}
            <span style={{ fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text-2)', minWidth: 0 }}>
              {selectedMedia.length} {selectedMedia.length === 1 ? 'story' : 'stories'} em{' '}
              {selected.length} {selected.length === 1 ? 'conta' : 'contas'}
              {selectedMedia.length > 1 && `, um a cada ${interval} min`}
              {totalMin > 0 && ` — ${totalMin < 60 ? `${totalMin} min` : `${(totalMin / 60).toFixed(1)}h`} no total`}
              {textoOn && texto.trim() ? ', com texto na mídia' : ''}
            </span>
          </div>
        )}

        {/* Workspace */}
        <div className="layout-2col">

          {/* ── Esquerda: composição e mídias ────────────────────────────

              A moldura vem primeiro porque é a única parte da tela que mostra
              o RESULTADO; a grade de arquivos é material, não resultado. */}
          <motion.div
            style={{ display: 'flex', flexDirection: 'column', gap: 11 }}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
          >
            <div style={{ ...PANEL, padding: 18 }}>
              <div style={PANEL_HEAD}>
                <div style={{ minWidth: 0 }}>
                  <TituloDeCartao icone="previa" mod="stories">Como vai sair</TituloDeCartao>
                  <p style={{ margin: '3px 0 0', fontSize: 'var(--mf-t-nano)', color: 'var(--mf-text-3)' }}>
                    Enquadramento e texto no tamanho real do story
                  </p>
                </div>
                {textoOn && (
                  <span className="mf-mono" style={{ fontSize: 'var(--mf-t-nano)', color: 'var(--mf-text-3)', flexShrink: 0 }}>
                    arraste para posicionar
                  </span>
                )}
              </div>

              <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                <StoryMoldura
                  media={selectedMedia[0]}
                  textoOn={textoOn}
                  texto={texto}
                  textoPos={textoPos}
                  textoTam={textoTam}
                  textoCor={textoCor}
                  arrastando={arrastando}
                  refMoldura={caixaPreview}
                  onClicar={clicarNaMoldura}
                  onIniciarTexto={iniciarArrasto('texto')}
                  onMover={moverArrasto}
                  onSoltar={soltarArrasto}
                />

                {/* ── Texto na mídia ──────────────────────────────────────────

                    Ao lado da moldura, e não abaixo: o que se digita aqui
                    aparece ali, e separar as duas coisas por uma rolagem
                    quebraria justamente a relação que faz a tela funcionar. */}
                <div style={{ flex: 1, minWidth: 210, display: 'flex', flexDirection: 'column', gap: 10 }}>

                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 'var(--mf-t-sm)', fontWeight: 700, letterSpacing: '-0.01em' }}>Texto na mídia</div>
                    <div style={{ fontSize: 'var(--mf-t-nano)', color: 'var(--mf-text-3)', marginTop: 2 }}>
                      Queimado na imagem — funciona em qualquer conta
                    </div>
                  </div>

                  {/* Sempre visível. O campo é a função: escondê-lo atrás de um
                      alternador transformava "escrever no story" em "descobrir
                      onde se liga o escrever no story". */}
                  <>
                      <textarea
                        value={texto}
                        onChange={e => setTexto(e.target.value)}
                        rows={3}
                        placeholder={PLACEHOLDER_TEXTO}
                        style={{
                          width: '100%', resize: 'vertical', minHeight: 62,
                          padding: '8px 10px', borderRadius: 'var(--mf-r-sm)',
                          background: 'var(--mf-bg)', color: 'var(--mf-text)',
                          border: '1px solid color-mix(in oklch, var(--mf-primary-500) 25%, transparent)',
                          fontSize: 'var(--mf-t-micro)', lineHeight: 1.5, outline: 'none',
                          fontFamily: 'inherit',
                        }} />

                      {/* O aviso do corte: o backend
                          corta em 6 linhas de 80 caracteres, e sem dizer isso a
                          pessoa escreve sete e só descobre depois de publicar. */}
                      {avisoTexto && (
                        <div style={{ fontSize: 'var(--mf-t-nano)', lineHeight: 1.5,
                          color: 'var(--mf-warning-500)',
                          background: 'color-mix(in oklch, var(--mf-warning-500) 8%, transparent)',
                          border: '1px solid color-mix(in oklch, var(--mf-warning-500) 24%, transparent)',
                          borderRadius: 'var(--mf-r-sm)', padding: '6px 9px' }}>
                          {avisoTexto}
                        </div>
                      )}

                      {textoOn && <>
                      <Segmentado
                        rotulo="Tamanho do texto" full mod="contas"
                        valor={textoTam} onChange={setTextoTam}
                        opcoes={[
                          { value: 'pequeno', label: 'Pequeno' },
                          { value: 'medio',   label: 'Médio' },
                          { value: 'grande',  label: 'Grande' },
                        ]} />

                      <Segmentado
                        rotulo="Cor do texto" full mod="contas"
                        valor={textoCor} onChange={setTextoCor}
                        opcoes={[
                          { value: 'branco', label: 'Branco' },
                          { value: 'preto',  label: 'Preto' },
                        ]} />

                      <div className="mf-mono" style={{ fontSize: 'var(--mf-t-nano)', color: 'var(--mf-text-3)' }}>
                        texto x {textoPos.x.toFixed(2)} · y {textoPos.y.toFixed(2)} · arraste na moldura
                      </div>
                      </>}
                  </>

                  {!textoOn && (
                    <div style={{ fontSize: 'var(--mf-t-nano)', color: 'var(--mf-text-3)', lineHeight: 1.6 }}>
                      O story sai como a mídia está. Escreva acima para compor
                      um texto por cima dela.
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div style={PANEL}>
              {/* Panel heading */}
              <div style={PANEL_HEAD}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--mf-2)', flexWrap: 'wrap', minWidth: 0 }}>
                  <TituloDeCartao icone="midia" mod="stories">Mídias do story</TituloDeCartao>
                  <span style={{ fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text-3)', fontFamily: 'var(--mf-mono)' }}>{selectedMedia.length} de {medias.length > 0 ? medias.length : 60} selecionadas</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--mf-2)', flexWrap: 'wrap', minWidth: 0 }}>
                  <label style={DARK_BTN}>
                    <input ref={fileRef} type="file" accept="image/*,video/*" multiple style={{ display: 'none' }}
                      onChange={e => addFiles(e.target.files)} />
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
                    {uploading ? 'Enviando...' : 'Adicionar mídias'}
                  </label>
                  <button onClick={() => setGridMode(true)} style={{ ...VIEW_BTN, ...(gridMode ? VIEW_BTN_ON : {}) }} title="Grade">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
                  </button>
                  <button onClick={() => setGridMode(false)} style={{ ...VIEW_BTN, ...(!gridMode ? VIEW_BTN_ON : {}) }} title="Lista">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
                  </button>
                </div>
              </div>

              {/* Dropzone */}
              <label
                onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={e => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files); }}
                style={{
                  margin: '0 19px', height: 112,
                  border: `1.5px dashed ${dragOver ? 'var(--mf-mod, var(--mf-accent-500))' : 'color-mix(in oklch, var(--mf-primary-500) 30%, transparent)'}`,
                  borderRadius: 'var(--mf-r-md)',
                  background: dragOver ? 'color-mix(in oklch, var(--mf-primary-500) 6%, transparent)' : 'color-mix(in oklch, var(--mf-primary-500) 2%, transparent)',
                  display: 'grid', justifyItems: 'center', alignContent: 'center', gap: 7, cursor: 'pointer', transition: 'all var(--mf-normal) var(--mf-ease-out)',
                }}>
                <input type="file" accept="image/*,video/*" multiple style={{ display: 'none' }} onChange={e => addFiles(e.target.files)} />
                <div style={{ width: 34, height: 34, borderRadius: 'var(--mf-r-md)', background: 'color-mix(in oklch, var(--mf-primary-500) 8%, transparent)', display: 'grid', placeItems: 'center', color: 'var(--mf-mod, var(--mf-accent-500))' }}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.39 18.39A5 5 0 0018 9h-1.26A8 8 0 103 16.3"/></svg>
                </div>
                <strong style={{ fontSize: 'var(--mf-t-xs)', color: 'var(--mf-text-2)' }}>Arraste fotos ou vídeos para enviar</strong>
                <span style={{ fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text-3)' }}>MP4, MOV, JPG, PNG <em style={{ fontStyle: 'normal', color: 'var(--mf-border-strong)' }}>(máx. 200MB por arquivo)</em></span>
              </label>

              {/* Grid */}
              {medias.length > 0 && (
                <div className={gridMode ? 'stories-media-grid' : ''}
                  style={{
                    padding: '16px 16px 8px',
                    display: 'grid',
                    gridTemplateColumns: gridMode ? undefined : '1fr',
                    gap: 10, maxHeight: 330, overflowY: 'auto',
                    overscrollBehavior: 'contain',
                    WebkitOverflowScrolling: 'touch',
                  }}>
                  {medias.map(m => gridMode ? (
                    <div key={m.id} onClick={() => toggleMedia(m.id)} style={{
                      position: 'relative', height: 165,
                      border: `1px solid ${m.selected ? 'var(--mf-mod, var(--mf-accent-500))' : 'var(--mf-border)'}`,
                      background: 'var(--mf-bg)', borderRadius: 'var(--mf-r-sm)', overflow: 'hidden', cursor: 'pointer', transition: '.18s',
                      boxShadow: m.selected ? '0 0 0 2px color-mix(in oklch, var(--mf-primary-500) 20%, transparent)' : 'none',
                    }}>
                      <div style={{ height: 138, overflow: 'hidden', background: 'var(--mf-bg)', position: 'relative' }}>
                        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg,transparent 60%,oklch(0 0 0 / 0.52))' }} />
                        {m.type === 'video'
                          ? <video src={m.url} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                          : <img src={m.url} alt={m.name} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                        }
                        <div style={{ position: 'absolute', left: 8, top: 8, width: 18, height: 18, borderRadius: 'var(--mf-r-full)', display: 'grid', placeItems: 'center', background: m.selected ? 'var(--mf-mod, var(--mf-accent-500))' : 'var(--mf-surface-1)', border: `1px solid ${m.selected ? 'var(--mf-surface-3)' : 'var(--mf-border-strong)'}`, boxShadow: '0 3px 9px oklch(0 0 0 / 0.3)', color: 'var(--mf-bg)', zIndex: 1 }}>
                          {m.selected && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>}
                        </div>
                      </div>
                      <div style={{ height: 27, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 8px', fontSize: 'var(--mf-t-nano)', color: 'var(--mf-text-2)' }}>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '70%', fontFamily: 'var(--mf-mono)' }}>{m.name}</span>
                        <button onClick={e => { e.stopPropagation(); removeMedia(m.id); }} style={{ background: 'none', border: 'none', color: 'var(--mf-text-3)', cursor: 'pointer', fontSize: 'var(--mf-t-sm)', lineHeight: 1 }}>×</button>
                      </div>
                    </div>
                  ) : (
                    <div key={m.id} onClick={() => toggleMedia(m.id)} style={{
                      display: 'grid', gridTemplateColumns: '60px 1fr auto', alignItems: 'center', gap: 10,
                      height: 52, border: `1px solid ${m.selected ? 'var(--mf-mod, var(--mf-accent-500))' : 'var(--mf-border)'}`,
                      background: 'var(--mf-bg)', borderRadius: 'var(--mf-r-sm)', overflow: 'hidden', cursor: 'pointer', padding: '0 12px 0 0',
                    }}>
                      <div style={{ height: '100%', overflow: 'hidden', background: 'var(--mf-bg)' }}>
                        {m.type === 'video'
                          ? <video src={m.url} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          : <img src={m.url} alt={m.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        }
                      </div>
                      <span style={{ fontSize: 'var(--mf-t-micro)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--mf-text-2)', fontFamily: 'var(--mf-mono)' }}>{m.name}</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 'var(--mf-t-nano)', color: 'var(--mf-text-3)', fontFamily: 'var(--mf-mono)' }}>{fmt(m.size)}</span>
                        <div style={{ width: 17, height: 17, borderRadius: 'var(--mf-r-xs)', display: 'grid', placeItems: 'center', border: `1px solid ${m.selected ? 'var(--mf-mod, var(--mf-accent-500))' : 'var(--mf-border-strong)'}`, background: m.selected ? 'var(--mf-mod, var(--mf-accent-500))' : 'transparent', color: 'var(--mf-bg)' }}>
                          {m.selected && <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Footer */}
              <div style={{ minHeight: 54, borderTop: '1px solid var(--mf-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 16px', flexWrap: 'wrap', gap: 8, marginTop: medias.length > 0 ? 0 : 4 }}>
                <span style={{ fontSize: 'var(--mf-t-micro)', color: 'var(--mf-mod, var(--mf-accent-500))', fontFamily: 'var(--mf-mono)' }}>{selectedMedia.length} selecionadas</span>
                <div style={{ display: 'flex', gap: 20 }}>
                  <button onClick={clearSelection} style={{ background: 'transparent', border: 'none', color: 'var(--mf-danger-500)', fontSize: 'var(--mf-t-micro)', fontWeight: 600, cursor: 'pointer' }}>Limpar seleção</button>
                  <button onClick={selectAllMedia} style={{ background: 'transparent', border: 'none', color: 'var(--mf-mod, var(--mf-accent-500))', fontSize: 'var(--mf-t-micro)', fontWeight: 600, cursor: 'pointer' }}>Selecionar todas</button>
                </div>
              </div>
            </div>

            {/* Resultados */}
            {results && (
              <div style={PANEL}>
                <div style={PANEL_HEAD}>
                  <TituloDeCartao icone="resultado" mod="stories">Resultado</TituloDeCartao>
                  <span style={{ fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text-3)', fontFamily: 'var(--mf-mono)' }}>{results.successCount} de {results.total} publicados</span>
                </div>
                <div style={{ padding: '8px 16px 16px', display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {(results.results || []).map((r, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--mf-border)', fontSize: 'var(--mf-t-xs)' }}>
                      <span style={{ width: 8, height: 8, borderRadius: 'var(--mf-r-full)', background: r.status === 'success' ? 'var(--mf-success-500)' : 'var(--mf-danger-500)', flexShrink: 0, display: 'inline-block' }} />
                      <strong>@{r.username}</strong>
                      <span style={{ color: r.status === 'success' ? 'var(--mf-success-500)' : 'var(--mf-danger-500)', flex: 1 }}>
                        {r.status === 'success' ? 'Publicado pela API oficial' : r.error}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </motion.div>

          {/* ── Right column ── */}
          <motion.div
            className="stories-right-col"
            style={{ display: 'flex', flexDirection: 'column', gap: 11 }}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, delay: 0.06 }}
          >

            {/* Contas */}
            <div style={PANEL}>
              <div style={{ ...PANEL_HEAD, borderRadius: '11px 11px 0 0' }}>
                <TituloDeCartao icone="contas" mod="stories">Contas</TituloDeCartao>
              </div>
              <div style={{ padding: '8px 12px 12px' }}>
                {contasCarregando && !accounts.length
                  ? <EsqueletoLista itens={3} />
                  : <AccountPicker
                      accounts={accounts}
                      selected={selected}
                      onChange={setSelected}
                    />}
              </div>
            </div>

            {/* Intervalo */}
            <div style={PANEL}>
              <div style={{ minHeight: 56, padding: '12px 16px 8px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <TituloDeCartao icone="envio" mod="stories">Intervalo entre stories</TituloDeCartao>
                  <p style={{ color: 'var(--mf-text-3)', fontSize: 'var(--mf-t-micro)', margin: '4px 0 0' }}>Aguarda este tempo entre cada publicação.</p>
                </div>
              </div>
              <div style={{ padding: '4px 16px 16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: 'var(--mf-text-3)', fontSize: 'var(--mf-t-micro)', marginBottom: 8 }}>
                  <span>Intervalo entre stories</span>
                  <strong style={{ fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text)', fontFamily: 'var(--mf-mono)' }}>{interval} {interval === 1 ? 'minuto' : 'minutos'}</strong>
                </div>
                <input type="range" min={1} max={15} value={interval} onChange={e => setIntervalMin(Number(e.target.value))}
                  style={{ width: '100%', accentColor: 'var(--mf-mod, var(--mf-accent-500))', margin: '0 0 4px' }} />
                <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--mf-text-3)', fontSize: 'var(--mf-t-nano)', fontFamily: 'var(--mf-mono)' }}>
                  <span>1 min</span><span>15 min</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: 'var(--mf-text-3)', fontSize: 'var(--mf-t-micro)', borderTop: '1px solid var(--mf-border)', marginTop: 10, paddingTop: 10 }}>
                  <span>Duração total estimada</span>
                  <strong style={{ fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text)', fontFamily: 'var(--mf-mono)' }}>{totalMin} {totalMin === 1 ? 'minuto' : 'minutos'}</strong>
                </div>
              </div>
            </div>

            <CardMetadados tipo="ambos" style={{ marginBottom: 14 }} />

            {/* Publicar */}
            <div style={{ ...PANEL, padding: 18 }}>
              <div>
                <TituloDeCartao icone="envio" mod="stories">Publicar</TituloDeCartao>
                <p style={{ margin: '3px 0 0', fontSize: 'var(--mf-t-nano)', color: 'var(--mf-text-3)' }}>Pela API oficial do Instagram — imagem ou vídeo, com o texto na mídia</p>
              </div>

              <button onClick={publish} disabled={loading || !selected.length || !selectedMedia.length} style={{
                marginTop: 16, width: '100%', height: 48, borderRadius: 'var(--mf-r-md)', border: 'none',
                cursor: loading || !selected.length || !selectedMedia.length ? 'not-allowed' : 'pointer',
                background: loading || !selected.length || !selectedMedia.length
                  ? 'color-mix(in oklch, var(--mf-primary-500) 15%, transparent)'
                  : 'linear-gradient(135deg, var(--mf-primary-500), var(--mf-primary-500))',
                color: loading || !selected.length || !selectedMedia.length ? 'color-mix(in oklch, var(--mf-primary-500) 50%, transparent)' : 'var(--mf-bg)',
                fontSize: 'var(--mf-t-sm)', fontWeight: 750, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                boxShadow: loading || !selected.length || !selectedMedia.length ? 'none' : '0 8px 22px color-mix(in oklch, var(--mf-primary-500) 25%, transparent)',
                transition: 'all var(--mf-normal) var(--mf-ease-out)',
              }}>
                {loading ? (
                  <>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ animation: 'spin 1s linear infinite' }}><path d="M21 12a9 9 0 11-6.219-8.56"/></svg>
                    Publicando...
                  </>
                ) : (
                  <>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                    Publicar agora
                  </>
                )}
              </button>
              <p style={{ display: 'flex', alignItems: 'center', gap: 5, margin: '8px 0 0', color: 'var(--mf-text-3)', fontSize: 'var(--mf-t-nano)' }}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                As publicações serão distribuídas conforme o intervalo definido.
              </p>
            </div>
          </motion.div>
        </div>

        <style>{`
          .stories-media-grid { grid-template-columns: repeat(5, minmax(0,1fr)); }
          @media (max-width: 1024px) { .stories-media-grid { grid-template-columns: repeat(4, minmax(0,1fr)); } }
          @media (max-width: 768px)  { .stories-media-grid { grid-template-columns: repeat(3, minmax(0,1fr)); } }
          @media (max-width: 480px)  { .stories-media-grid { grid-template-columns: repeat(2, minmax(0,1fr)); } }
          @keyframes spin { to { transform: rotate(360deg); } }
        `}</style>
      </PageShell>
    </>
  );
}

const PANEL = {
  border: '1px solid var(--mf-border)',
  background: 'color-mix(in oklch, var(--mf-surface-1) 85%, transparent)',
  borderRadius: 'var(--mf-r-md)',
  overflow: 'hidden',
  backdropFilter: 'blur(12px)',
};
/* `flexWrap` e `minWidth: 0` porque o cabeçalho tem título de um lado e uma
   fila de botões do outro. Sem quebra, em 320px os dois disputam a mesma
   linha e a fila de botões saía 16px para fora da tela — cortada, não
   rolável. Com quebra, ela desce e continua inteira. */
const PANEL_HEAD = {
  minHeight: 52, display: 'flex', alignItems: 'center',
  justifyContent: 'space-between', flexWrap: 'wrap', gap: 'var(--mf-2)',
  padding: 'var(--mf-3) var(--mf-4)', minWidth: 0,
  borderBottom: '1px solid var(--mf-border)',
};
const DARK_BTN = {
  height: 30, borderRadius: 'var(--mf-r-sm)', padding: '0 8px', display: 'flex', alignItems: 'center', gap: 6,
  background: 'var(--mf-bg)', border: '1px solid var(--mf-border)', color: 'var(--mf-text-2)', fontSize: 'var(--mf-t-micro)', fontWeight: 650, cursor: 'pointer',
};
const VIEW_BTN = {
  width: 30, height: 30, borderRadius: 'var(--mf-r-sm)', display: 'grid', placeItems: 'center',
  color: 'var(--mf-text-3)', background: 'var(--mf-bg)', border: '1px solid var(--mf-border)', cursor: 'pointer',
};
const VIEW_BTN_ON = { background: 'var(--mf-surface-1)', color: 'var(--mf-text)' };
