/**
 * A moldura de composição do story: a mídia no enquadramento 9:16 e o texto
 * livre na posição e no tamanho em que o servidor vai queimá-lo. Recebe
 * posições e handlers e desenha — não decide nada.
 */

/* Constantes do módulo, não exportadas: um arquivo que exporta um componente
   E constantes perde o fast refresh do Vite — o componente remonta a cada
   salvamento em vez de preservar o estado, e arrastar o texto para
   ajustar o CSS vira um exercício de recomeçar. Quem precisar do número
   recebe por prop. */
const PREVIEW_LARGURA = 300;

/* Espelha TAMANHOS_TEXTO em backend/src/services/textoNoStory.js.
   Fração da largura do story, não pixels — é o que faz o preview continuar
   fiel se a resolução mudar. Ao mexer em um, mexa no outro. */
const TAMANHOS_TEXTO = { pequeno: 0.045, medio: 0.065, grande: 0.095 };

/* As mesmas de textoNoStory.js: respiro até a borda e a resolução do
   story. É em cima delas que a conta do limite é feita dos dois lados. */
const MARGEM = 28;
const STORY_W = 1080;
const STORY_H = 1920;

const EH_VIDEO = /\.(mp4|mov|webm|m4v)(\?|$)/i;

/* A mesma letra que o servidor queima.

   O pedido foi "fonte do iPhone". Em macOS e iOS, `-apple-system` resolve para
   SF Pro de verdade — e aí o preview mostra exatamente a tipografia do
   iPhone. Fora da Apple ele cai em Inter, que é o que o container instala
   (`fonts-inter` no Dockerfile) e o que o drawtext usa. Nos dois casos o
   preview e a mídia final desenham a mesma letra, que é o ponto: um preview
   com outra fonte erra a largura de cada linha e mente sobre o que cabe.

   SF Pro não é embarcada: a licença da Apple cobre interfaces de apps das
   plataformas dela, não um servidor que grava texto em imagem. */
const FONTE_STORY =
  '-apple-system, "SF Pro Text", "SF Pro Display", Inter, "Segoe UI", ' +
  'Roboto, "Noto Sans", Helvetica, Arial, sans-serif';

export default function StoryMoldura({
  media,
  textoOn, texto, textoPos, textoTam, textoCor,
  arrastando, refMoldura,
  onClicar, onIniciarTexto, onMover, onSoltar,
  largura = PREVIEW_LARGURA,
}) {
  const linhas = String(texto || '').split('\n').filter(Boolean).slice(0, 6);

  return (
    <div
      ref={refMoldura}
      onClick={onClicar}
      onPointerMove={onMover}
      onPointerUp={onSoltar}
      onPointerCancel={onSoltar}
      style={{
        /* `touch-action: none` para o arrasto funcionar no celular: sem isso o
           navegador interpreta o gesto como rolagem da página e nada se mexe. */
        position: 'relative', width: largura, maxWidth: '100%',
        flexShrink: 0, aspectRatio: '9 / 16', touchAction: 'none',
        borderRadius: 'var(--mf-r-lg)', overflow: 'hidden',
        cursor: arrastando ? 'grabbing' : (textoOn ? 'crosshair' : 'default'),
        border: '1px solid var(--mf-border-strong)',
        boxShadow: 'var(--mf-shadow-2)',
        background: 'linear-gradient(160deg, var(--mf-surface-2), var(--mf-bg))',
        userSelect: 'none',
      }}
    >
      {/* A mídia entra com object-fit: cover — mesmo enquadramento que o
          Instagram aplica no story 9:16, e o mesmo que o ffmpeg faz com
          `crop` antes de desenhar qualquer coisa por cima. */}
      {media?.url && (
        EH_VIDEO.test(media.url)
          ? <video src={media.url} muted playsInline
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
          : <img src={media.url} alt=""
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
      )}

      {!media && (
        <div style={{
          position: 'absolute', inset: 0, display: 'grid', placeItems: 'center',
          fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text-3)',
          textAlign: 'center', padding: '0 22px', lineHeight: 1.6,
        }}>
          Selecione uma mídia abaixo para ver o enquadramento real
        </div>
      )}

      {/* Grade de terços — ajuda a mirar. Só aparece quando há o que
          posicionar: sobre a mídia sozinha ela é sujeira visual. */}
      {textoOn && (
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none', opacity: 0.5,
          background:
            'linear-gradient(to bottom, transparent 33.3%, var(--mf-border-strong) 33.3%, var(--mf-border-strong) 33.5%, transparent 33.5%,' +
            ' transparent 66.6%, var(--mf-border-strong) 66.6%, var(--mf-border-strong) 66.8%, transparent 66.8%)',
        }} />
      )}

      {/* ── O texto livre ────────────────────────────────────────────────────
          Desenhado com as MESMAS proporções do drawtext: corpo em fração da
          largura, entrelinha em 1.35, caixa a 45% de opacidade, e o bloco
          centrado no ponto — que é o que faz arrastar para o meio deixar o
          texto no meio, e não começando no meio. */}
      {textoOn && linhas.length > 0 && (() => {
        const corpo = (TAMANHOS_TEXTO[textoTam] || TAMANHOS_TEXTO.medio) * largura;
        const claro = textoCor !== 'preto';

        /* ── O mesmo limite que o renderizador aplica ──────────────────────

           `filtrosDeTexto` prende o topo do bloco entre a margem e o fim da
           mídia menos a altura do bloco. Sem repetir a conta aqui, arrastar o
           texto para baixo mostrava metade dele fora do quadro enquanto o
           story sairia com ele inteiro, um pouco mais acima — o preview
           erraria justamente onde a pessoa está olhando.

           A conta roda em pixels do story e depois é convertida para a escala
           da moldura, em vez de aproximada direto na escala menor: assim o
           número é o mesmo dos dois lados, e não um arredondamento parecido. */
        const escala = largura / STORY_W;
        const alturaLinha = TAMANHOS_TEXTO[textoTam] * STORY_W * 1.35;
        const alturaBloco = alturaLinha * linhas.length;
        const topo = Math.min(
          STORY_H - alturaBloco - MARGEM,
          Math.max(MARGEM, textoPos.y * STORY_H - alturaBloco / 2),
        );

        /* Na horizontal o renderizador prende com `max(min())` do próprio
           ffmpeg, porque só ele sabe a largura do texto na fonte carregada.
           Aqui a âncora é presa na mesma faixa: com uma linha muito larga os
           dois podem parar alguns pixels diferentes, mas nenhum dos dois
           deixa o texto sair da mídia — que é o que a pessoa precisa saber. */
        const ancoraX = Math.min(
          (STORY_W - MARGEM) / STORY_W,
          Math.max(MARGEM / STORY_W, textoPos.x),
        );

        return (
          <div
            onPointerDown={onIniciarTexto}
            title="Arraste o texto para onde quiser"
            style={{
              position: 'absolute',
              left: `${ancoraX * 100}%`, top: `${topo * escala}px`,
              transform: 'translateX(-50%)',
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              maxWidth: `${(STORY_W - MARGEM * 2) * escala}px`, cursor: 'grab',
              /* Um contorno só enquanto se arrasta: fora do gesto, o preview
                 tem que parecer o story, não a ferramenta. */
              outline: arrastando === 'texto'
                ? '2px dashed var(--mf-primary-500)' : 'none',
              outlineOffset: 4,
            }}
          >
            {linhas.map((linha, i) => (
              <span key={i} style={{
                fontFamily: FONTE_STORY,
                fontSize: `${corpo}px`, lineHeight: 1.35, fontWeight: 800,
                color: claro ? '#fff' : '#000',
                background: claro ? 'rgba(0,0,0,0.45)' : 'rgba(255,255,255,0.45)',
                padding: `0 ${corpo * 0.28}px`, whiteSpace: 'pre',
                letterSpacing: '-0.01em',
              }}>{linha}</span>
            ))}
          </div>
        );
      })()}

    </div>
  );
}
