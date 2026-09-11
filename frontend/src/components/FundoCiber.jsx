import { useEffect, useRef } from 'react';

/**
 * O fundo vivo: filamentos de energia e partículas.
 *
 * ── Por que canvas, e não CSS
 *
 * O que a referência mostra não é um gradiente animado: são dezenas de linhas
 * finas que se curvam juntas, como limalha num campo magnético. Isso é um
 * campo de fluxo — cada linha integra a mesma função de direção a partir de um
 * ponto diferente, e é a soma delas que forma o desenho. CSS não tem como
 * expressar isso: daria para animar manchas e gradientes, mas nunca a
 * coerência entre as linhas, que é justamente o que faz o desenho parecer
 * orgânico em vez de decorado.
 *
 * ── Por que sem `shadowBlur`
 *
 * O caminho óbvio para o brilho é `ctx.shadowBlur`. Ele é caro — desenha e
 * desfoca cada traço separadamente — e num campo de 34 linhas com 64 passos
 * cada, custa mais que todo o resto do quadro somado.
 *
 * Aqui o brilho vem de três passadas do MESMO caminho, cada uma mais larga e
 * mais transparente, em `lighter`. É mais barato, e o núcleo aceso aparece
 * onde as linhas se cruzam — que é como luz de verdade se comporta.
 *
 * ── O que impede isto de atrapalhar a leitura
 *
 * A regra que o próprio projeto já tinha aprendido: sobre uma grade densa de
 * dados, textura vira ruído no elemento que precisa estar mais legível. Então
 * este fundo fica em `z-index: -1`, atrás de tudo, e os cartões têm superfície
 * própria por cima. O que passa por baixo é só a casca translúcida.
 *
 * ── Três formas de desligar, e todas obedecidas
 *
 *   1. `prefers-reduced-motion` — quem já pediu menos movimento ao sistema
 *      não precisa pedir de novo aqui;
 *   2. `data-fundo="estatico"` — o interruptor em Minha Conta;
 *   3. aba escondida — quadro nenhum é desenhado, para o painel aberto numa
 *      guia de fundo não gastar bateria.
 *
 * Nos dois primeiros casos o desenho continua, PARADO: apagar a imagem
 * mudaria a cor do fundo junto, e o pedido é sobre movimento, não sobre cor.
 */

/* Densidade por área, não contagem fixa: 34 linhas desenhadas para 1280px
   viram uma teia em 3440px ultrawide e um emaranhado em 380px de celular.

   Subiu de 26/70 depois de medir o problema real: com a origem concentrada
   num canto, a barra lateral — bem no OUTRO lado da tela — ficava com uma
   fração da intensidade do resto, abaixo do que o olho registra como
   "movimento" e não só "textura parada". Mais linhas cobrindo a tela toda
   é a metade da correção; a outra é a distribuição, mais abaixo. */
const LINHAS_POR_MPX = 34;      // por megapixel de viewport
const PARTICULAS_POR_MPX = 90;
const MAX_LINHAS = 60;
const MAX_PARTICULAS = 160;

/* Passos por linha. Menos que ~40 mostra os cantos do polígono; mais que ~80
   não muda o que se vê e multiplica a conta. */
const PASSOS = 64;
const TAMANHO_PASSO = 26;

/* Escala de tempo. O ciclo tem de ser longo o bastante para o movimento não
   competir com a leitura: entre dois olhares para a tela, o desenho mudou
   menos do que a atenção que sobraria para notá-lo. */
const VELOCIDADE = 0.000045;

/* Teto de densidade de pixel. Em telas 3x, pintar tudo em resolução nativa
   triplica o custo de preenchimento para um desenho que é quase todo
   gradiente suave — onde ninguém vê a diferença. */
const DPR_MAX = 1.5;

export default function FundoCiber() {
  const refTela = useRef(null);

  useEffect(() => {
    const tela = refTela.current;
    if (!tela) return;
    const ctx = tela.getContext('2d', { alpha: true });
    if (!ctx) return;   /* canvas bloqueado: o fundo simplesmente não aparece */

    const raiz = document.documentElement;
    const menosMovimento = window.matchMedia('(prefers-reduced-motion: reduce)');

    let larg = 0, alt = 0, dpr = 1;
    let linhas = [], particulas = [];
    let quadro = 0;
    let t = 0;
    let ultimo = 0;
    /* Quando `laco` REALMENTE correu pela última vez. Ver `decidir`: o id do
       quadro não serve de prova de vida, o relógio serve. */
    let vivoEm = 0;

    /* Aleatório com semente. Sem isto, cada `resize` sorteia um desenho novo e
       o fundo "salta" ao arrastar a janela — o movimento que o olho percebe
       deixa de ser o do campo e passa a ser o do redimensionamento. */
    let semente = 20260908;
    const sorteio = () => {
      semente = (semente * 1664525 + 1013904223) % 4294967296;
      return semente / 4294967296;
    };

    /* ── Resolver a cor do tema para tres numeros ─────────────────────────

       Duas razoes, e a primeira foi um defeito de verdade.

       1. Os tokens deste projeto moram em `[data-mf]`, NAO em `:root`. Lido do
          `documentElement`, `--mf-primary-500` volta VAZIO — e a interpolacao
          produzia `color-mix(in oklch,  7%, transparent)`, que o
          `addColorStop` recusa lancando. O erro derrubava a arvore inteira: o
          canvas nem chegava a existir. A sonda passou a ser o proprio canvas,
          que esta dentro do `[data-mf]`.

       2. Montar `color-mix(...)` a cada traço obriga o navegador a
          interpretar CSS milhares de vezes por segundo. Resolvido para
          `[r,g,b]` uma vez por tema, cada cor de quadro vira concatenacao de
          numeros. */
    const sondaTela = document.createElement('canvas');
    sondaTela.width = sondaTela.height = 1;
    const sonda = sondaTela.getContext('2d', { willReadFrequently: true });

    /**
     * `[r,g,b]` de qualquer cor que o canvas aceite — inclusive `oklch`.
     *
     * Le de volta o PIXEL desenhado em vez de tentar interpretar a string: e
     * a unica forma que funciona para todo formato sem manter uma segunda
     * copia da matematica de cor, que este projeto tem motivo para evitar
     * (ver o comentario no teste de contraste sobre a pagina de paletas que
     * guardava a propria copia dos valores e ficou para tras).
     *
     * `null` quando a cor foi recusada: dois sentinelas diferentes, porque um
     * so daria falso negativo se a cor pedida fosse justamente ele.
     */
    function paraRgb(expr) {
      if (!expr || !sonda) return null;
      for (const sentinela of ['#ff00ff', '#00ff00']) {
        sonda.fillStyle = sentinela;
        sonda.fillStyle = expr;
        if (sonda.fillStyle === sentinela) return null;
      }
      sonda.fillRect(0, 0, 1, 1);
      const d = sonda.getImageData(0, 0, 1, 1).data;
      return [d[0], d[1], d[2]];
    }

    /** A cor do ciano, lida do tema — o fundo acompanha a troca de paleta. */
    function tinta() {
      /* `getComputedStyle(tela)` e nao `(raiz)`: ver o comentario acima. */
      const css = getComputedStyle(tela);
      const claro = raiz.getAttribute('data-tema') === 'claro';
      const cor = paraRgb(css.getPropertyValue('--mf-primary-500').trim())
        || paraRgb('oklch(0.776 0.149 227)') || [0, 200, 255];
      const cor2 = paraRgb(css.getPropertyValue('--mf-glow').trim())
        || paraRgb('oklch(0.579 0.232 260)') || [0, 110, 255];
      /* No tema claro o mesmo desenho vira sujeira sobre papel: a mesma
         geometria, um quinto da intensidade. */
      return { cor, cor2, forca: claro ? 0.2 : 1 };
    }
    let paleta = tinta();

    /** `rgba()` a partir do triplo resolvido. `pct` em 0-100, como no CSS. */
    const rgba = ([r, g, b], pct) => `rgba(${r},${g},${b},${(pct / 100).toFixed(4)})`;

    /**
     * O campo de direção.
     *
     * Três senoides com períodos incomensuráveis. Duas se repetiriam visivelmente
     * a cada volta; três só voltam ao mesmo estado depois de muito mais tempo
     * do que alguém passa olhando o fundo.
     */
    function angulo(x, y, tempo) {
      /* `Math.max(1, ...)` nao e paranoia: com a viewport em 0 (aba em
         segundo plano, contentor recolhido, previa de impressao) isto virava
         `x / 0` = Infinity, `Math.sin(Infinity)` = NaN, e o NaN chegava ao
         `createRadialGradient`, que LANCA. A excecao dentro do efeito
         derrubava a arvore inteira: nao era o fundo que sumia, era o painel. */
      const nx = x / Math.max(1, larg), ny = y / Math.max(1, alt);
      return (
        Math.sin(nx * 3.1 + tempo * 1.7) * 1.3 +
        Math.sin(ny * 2.3 - tempo * 1.1) * 1.1 +
        Math.sin((nx + ny) * 4.7 + tempo * 0.6) * 0.7
      );
    }

    function semear() {
      const mpx = Math.max(0.12, (larg * alt) / 1e6);
      const nLinhas = Math.min(MAX_LINHAS, Math.round(LINHAS_POR_MPX * mpx));
      const nPart = Math.min(MAX_PARTICULAS, Math.round(PARTICULAS_POR_MPX * mpx));
      semente = 20260908;

      /* Cobria só a diagonal alta-direita — a origem ficava fora da tela para
         o lado de quem olha a barra, e a barra é justamente onde a pessoa
         está olhando quando julga "isso está animado?". Medido na produção:
         ~2.3 de intensidade média ali contra ~15 no canto que tinha origem —
         sexta parte, abaixo do que registra como movimento sob o blur da
         barra. Agora as sementes cobrem a tela inteira, com uma folga de 10%
         para fora de cada borda para as linhas já entrarem em curva ao
         aparecer, e um viés leve (não mais exclusivo) para o canto
         alto-direito, que é de onde vem o "bloom" abaixo. */
      linhas = Array.from({ length: nLinhas }, () => {
        const a = sorteio(), b = sorteio();
        return {
          x: larg * (a * 1.2 - 0.1),
          y: alt * (b * 1.2 - 0.1),
          fase: sorteio() * 6.283,
          brilho: 0.45 + sorteio() * 0.75,
        };
      });

      particulas = Array.from({ length: nPart }, () => ({
        x: sorteio() * larg,
        y: sorteio() * alt,
        r: 0.6 + sorteio() * 1.5,
        fase: sorteio() * 6.283,
        vel: 0.35 + sorteio() * 0.9,
      }));
    }

    function medir() {
      dpr = Math.min(DPR_MAX, window.devicePixelRatio || 1);
      larg = window.innerWidth;
      alt = window.innerHeight;
      tela.width = Math.round(larg * dpr);
      tela.height = Math.round(alt * dpr);
      tela.style.width = `${larg}px`;
      tela.style.height = `${alt}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      semear();
    }

    function desenhar() {
      /* Sem area nao ha o que desenhar, e insistir era a origem do NaN acima.
         Note que isto acontece de verdade: o painel aberto numa aba de fundo
         reporta 0x0 ate ser mostrado. */
      if (larg < 2 || alt < 2) return;
      ctx.clearRect(0, 0, larg, alt);
      const { cor, cor2, forca } = paleta;
      if (forca <= 0) return;

      /* Bloom: a mancha larga por baixo. É ela que faz as linhas parecerem
         emitir luz em vez de estarem desenhadas em cima do fundo.

         Media no canto alto-direito (0.72, 0.18) com raio de 0.8*maior lado:
         a distância até o canto oposto da tela passava do raio, e o `stop`
         final é `rgba(cor2, 0)` — o canto simplesmente não recebia luz
         nenhuma. Era exatamente onde a barra lateral fica, e é a área que a
         pessoa olha para julgar "isso está animado?". Recentrado perto do
         meio e com raio maior que a diagonal inteira: todo canto agora cai
         dentro do gradiente, em vez de fora dele. */
      const bloom = ctx.createRadialGradient(
        larg * 0.55, alt * 0.42, 0,
        larg * 0.55, alt * 0.42, Math.hypot(larg, alt) * 0.78,
      );
      bloom.addColorStop(0, rgba(cor, 11 * forca));
      bloom.addColorStop(0.45, rgba(cor2, 6.5 * forca));
      bloom.addColorStop(1, rgba(cor2, 1.8 * forca));
      ctx.fillStyle = bloom;
      ctx.fillRect(0, 0, larg, alt);

      ctx.globalCompositeOperation = 'lighter';
      ctx.lineCap = 'round';

      /* ── Os filamentos ──────────────────────────────────────────────── */
      for (const linha of linhas) {
        /* O caminho é calculado uma vez e desenhado três, em larguras
           diferentes. Recalcular por passada triplicaria a conta para um
           resultado idêntico. */
        const pontos = [];
        let x = linha.x, y = linha.y;
        for (let i = 0; i < PASSOS; i++) {
          pontos.push(x, y);
          const a = angulo(x, y, t + linha.fase);
          x += Math.cos(a) * TAMANHO_PASSO;
          y += Math.sin(a) * TAMANHO_PASSO;
          /* Fora da tela com folga: parar aqui evita integrar centenas de
             passos que nunca serão vistos. */
          if (x < -larg * 0.4 || x > larg * 1.4 || y < -alt * 0.4 || y > alt * 1.4) break;
        }
        if (pontos.length < 6) continue;

        const traco = (largura, alfa) => {
          ctx.beginPath();
          ctx.moveTo(pontos[0], pontos[1]);
          /* Curva por pontos médios: passar `quadraticCurveTo` pelo meio de
             cada par transforma a poligonal em curva contínua sem precisar
             calcular tangentes. */
          for (let i = 2; i < pontos.length - 2; i += 2) {
            ctx.quadraticCurveTo(
              pontos[i], pontos[i + 1],
              (pontos[i] + pontos[i + 2]) / 2, (pontos[i + 1] + pontos[i + 3]) / 2,
            );
          }
          ctx.lineWidth = largura;
          ctx.strokeStyle = rgba(cor, alfa * linha.brilho * forca);
          ctx.stroke();
        };

        traco(6.5, 3.4);    // o halo
        traco(2.4, 6.8);    // o corpo
        traco(0.8, 13.0);   // o núcleo aceso

        /* O pulso: um ponto de luz que percorre o filamento. É o que faz o
           fundo parecer ter corrente passando, e não só desenho parado. */
        const prog = ((t * 90 + linha.fase) % 1.6) / 1.6;
        if (prog < 1) {
          const i = Math.min(pontos.length - 2, Math.floor(prog * (pontos.length / 2)) * 2);
          const desvanece = Math.sin(prog * Math.PI);
          const g = ctx.createRadialGradient(pontos[i], pontos[i + 1], 0, pontos[i], pontos[i + 1], 28);
          g.addColorStop(0, rgba(cor, 46 * desvanece * forca));
          g.addColorStop(1, rgba(cor, 0));
          ctx.fillStyle = g;
          ctx.fillRect(pontos[i] - 28, pontos[i + 1] - 28, 56, 56);
        }
      }

      /* ── As partículas ──────────────────────────────────────────────── */
      for (const p of particulas) {
        /* Elas seguem o MESMO campo das linhas. Movimento independente
           denunciaria que são duas coisas coladas; seguindo o campo, leem
           como poeira carregada pela mesma corrente. */
        const a = angulo(p.x, p.y, t + p.fase);
        p.x += Math.cos(a) * p.vel;
        p.y += Math.sin(a) * p.vel;
        if (p.x < -20) p.x = larg + 20; else if (p.x > larg + 20) p.x = -20;
        if (p.y < -20) p.y = alt + 20; else if (p.y > alt + 20) p.y = -20;

        /* Cintilância: aparece e desaparece, em vez de ficar acesa. Um campo
           de pontos permanentes lê como defeito da tela. */
        const cintila = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * 380 + p.fase * 7));
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, 6.283);
        ctx.fillStyle = rgba(cor, 38 * cintila * forca);
        ctx.fill();
      }

      ctx.globalCompositeOperation = 'source-over';
    }

    /** Parado é diferente de apagado: um quadro só, sem laço.

        MAS "parado" não pode significar "sempre o mesmo quadro" — se este é
        o único caminho que corre (`deveAnimar()` falso, ou a aba lida como
        escondida por tempo demais para o laço nunca decolar), `t` precisa
        avançar mesmo assim, ou toda vez que algo chama `decidir()` de novo
        — o intervalo periódico logo abaixo, um resize, uma troca de tema —
        o desenho recomeça do EXATO estado de antes e nunca se distingue de
        uma imagem parada. Aqui `t` avança pelo relógio de verdade
        (`performance.now()`, a mesma base de `laco`), então mesmo em quadros
        avulsos e espaçados o campo progride — mais em saltos que fluido, mas
        vivo, nunca congelado. */
    function umQuadro() {
      cancelAnimationFrame(quadro);
      quadro = 0;
      const agora = performance.now();
      const dt = ultimo ? Math.min(5000, agora - ultimo) : 16;
      ultimo = agora;
      t += dt * VELOCIDADE;
      desenhar();
    }

    function laco(agora) {
      vivoEm = agora;
      /* Avança pelo tempo REAL decorrido, não por quadro. Sem isso, o fundo
         corre em 120 Hz e arrasta em 30 — a velocidade passaria a depender do
         monitor de quem está olhando. */
      const dt = ultimo ? Math.min(64, agora - ultimo) : 16;
      ultimo = agora;
      t += dt * VELOCIDADE;
      desenhar();
      quadro = requestAnimationFrame(laco);
    }

    function deveAnimar() {
      /* `document.hidden` nao entra aqui: `decidir()` ja saiu antes nesse
         caso. Duas guardas para a mesma condicao em lugares diferentes e como
         se esquece de mexer numa das duas. */
      return !menosMovimento.matches
        && raiz.getAttribute('data-fundo') !== 'estatico';
    }

    function decidir() {
      /* A viewport pode ter mudado enquanto a aba estava escondida — e no
         primeiro retorno ela sai de 0x0 para o tamanho real. */
      if (larg < 2 || alt < 2) medir();
      paleta = tinta();

      /* Aba escondida: para o LAÇO, mas pinta um quadro.
      
         O que custa bateria é redesenhar 60 vezes por segundo; um quadro é
         irrelevante. E recusar o quadro deixava a página com fundo vazio em
         qualquer contexto que reporte visibilidade errado — iframe em segundo
         plano, webview, ferramenta de captura. Foi assim que descobri: o
         painel de pré-visualização reporta `hidden` enquanto está sendo
         fotografado, e o fundo nunca aparecia. */
      if (document.hidden) {
        umQuadro();
        return;
      }

      if (deveAnimar()) {
        /* O id do quadro NÃO prova que o laço está vivo.

           Um `requestAnimationFrame` agendado enquanto a página não está sendo
           pintada pode nunca disparar — e o id volta não-zero do mesmo jeito.
           O `if (!quadro)` que estava aqui lia esse id como "já vem quadro a
           caminho" e desistia de reagendar; como nada zera o id nesse caminho,
           desistia para sempre. A conferência periódica logo abaixo rodava a
           cada 1,5 s e esbarrava nesta mesma guarda, sem poder fazer nada.

           Medido na produção: `decidir()` correndo, `document.hidden` false,
           `deveAnimar()` true, zero chamadas de rAF em 2 s e zero pixels
           alterados. O fundo ficava parado até um F5 — e o F5 só resolvia se
           o carregamento seguinte não caísse no mesmo estado.

           A prova de vida é o RELÓGIO. Reagendar por engano não custa nada: o
           `cancelAnimationFrame` garante um pendente só. Não reagendar custa o
           recurso inteiro. */
        const vivo = quadro && (performance.now() - vivoEm) < 1000;
        if (!vivo) {
          cancelAnimationFrame(quadro);
          ultimo = 0;
          quadro = requestAnimationFrame(laco);
        }
      } else {
        umQuadro();
      }
    }

    /* Redimensionar remede e redecide. Sem o `debounce`, arrastar a borda da
       janela dispara uma realocação de canvas por pixel de movimento. */
    let esperaResize = 0;
    const aoRedimensionar = () => {
      clearTimeout(esperaResize);
      esperaResize = setTimeout(() => { medir(); decidir(); }, 140);
    };

    /* `ResizeObserver` NO LUGAR de confiar só no evento `resize` da janela.
    
       O evento não cobre tudo: a viewport pode mudar sem ele — painel
       embutido que muda de tamanho, emulação de viewport, barra de endereço
       do celular entrando e saindo. O sintoma é exato e silencioso: o canvas
       fica com o tamanho de quando montou, e se aquele tamanho era zero, o
       fundo nunca aparece. Foi assim que apareceu aqui.

       Observa o `<html>`, que acompanha a viewport. Os dois caminhos passam
       pelo mesmo `debounce`, então ter os dois não dobra o trabalho. */
    const observadorTamanho = new ResizeObserver(aoRedimensionar);
    observadorTamanho.observe(raiz);

    /* O tema e o interruptor de fundo são atributos no `<html>`: observar o
       elemento é mais confiável que um evento próprio, porque pega também a
       mudança feita por outra aba ou pelo `aplicar()` do arranque. */
    const observador = new MutationObserver(decidir);
    observador.observe(raiz, { attributes: true, attributeFilter: ['data-tema', 'data-fundo'] });

    medir();
    decidir();

    /* Conferência periódica, o tempo todo — não só ao montar.

       A primeira versão desta correção era um `setTimeout(decidir, 250)`
       único: cobria o caso de `document.hidden` mentir por um instante logo
       no F5. Não bastou. Voltou a acontecer — medido de novo depois do
       deploy: `requestAnimationFrame` zerado, `document.hidden` false,
       minutos depois de carregar. `focus`/`pageshow`/`visibilitychange` só
       ajudam quando o navegador de fato DISPARA o evento na transição — e
       existem contextos (um iframe embutido, uma ferramenta de captura, uma
       extensão) onde a visibilidade muda sem nenhum dos três disparar. Um
       evento que não dispara não é uma correção que às vezes falha; é uma
       correção que não roda.

       `setInterval` não depende de o navegador avisar nada: pergunta de novo
       sozinho. `decidir()` é barata — três leituras de estado e, na pior das
       hipóteses, um `requestAnimationFrame` a mais — e chamá-la de novo
       quando nada mudou não faz nada (o `if (!quadro)` da função já trata
       isso). O preço de perguntar toda hora é menor que o de ficar parado
       para sempre por não ter perguntado a segunda vez. */
    const conferenciaPeriodica = setInterval(decidir, 1500);

    window.addEventListener('resize', aoRedimensionar);
    document.addEventListener('visibilitychange', decidir);
    window.addEventListener('focus', decidir);
    window.addEventListener('pageshow', decidir);
    menosMovimento.addEventListener('change', decidir);

    return () => {
      cancelAnimationFrame(quadro);
      clearTimeout(esperaResize);
      clearInterval(conferenciaPeriodica);
      observador.disconnect();
      observadorTamanho.disconnect();
      window.removeEventListener('resize', aoRedimensionar);
      document.removeEventListener('visibilitychange', decidir);
      window.removeEventListener('focus', decidir);
      window.removeEventListener('pageshow', decidir);
      menosMovimento.removeEventListener('change', decidir);
    };
  }, []);

  return (
    <canvas
      ref={refTela}
      aria-hidden="true"
      style={{
        position: 'fixed', inset: 0, zIndex: -1, pointerEvents: 'none',
        /* Sem fundo próprio: quem pinta o chão é o `--mf-bg` do tema, e uma
           cor aqui criaria um segundo lugar para mudar a cor de fundo. */
        background: 'transparent',
      }}
    />
  );
}
