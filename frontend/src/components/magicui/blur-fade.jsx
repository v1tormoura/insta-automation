import { motion, useInView, useReducedMotion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';

/**
 * BlurFade — revela o conteúdo com desfoque e deslocamento.
 *
 * O estado inicial é `opacity: 0`, então o conteúdo só chega ao leitor
 * depois que a animação roda. Isso é frágil de um jeito que não aparece em
 * desenvolvimento: quem revela é o `requestAnimationFrame`, e quem decide
 * quando revelar é um `IntersectionObserver` — os dois dependem do
 * navegador estar de fato renderizando a página. Aba em segundo plano,
 * aparelho sobrecarregado ou uma janela que parou de compor quadros, e as
 * seções ficam invisíveis para sempre, ocupando altura sem mostrar nada.
 *
 * Aconteceu nesta dashboard: onze das quatorze seções existiam no DOM,
 * somavam 3147px, e a tela parecia acabar depois do quarto painel.
 *
 * A defesa não pode ser mandar a animação ir para o estado visível — quem
 * executa a animação é justamente o quadro que pode estar faltando. A saída
 * é DEIXAR DE ANIMAR: nos três casos abaixo o componente devolve uma <div>
 * comum, sem `initial` e sem `animate`, e aí não há estado do qual o
 * conteúdo precise sair para aparecer.
 *
 *  1. Movimento reduzido pedido no sistema — o correto de qualquer forma.
 *  2. A seção deveria estar visível e a animação não terminou a tempo.
 *     `onAnimationComplete` cancela o prazo, então uma revelação normal
 *     nunca chega a acioná-lo.
 *  3. Rede de segurança geral: passados alguns segundos da montagem sem que
 *     a seção tenha sido revelada, ela aparece de qualquer jeito.
 *
 * A terceira troca um pedaço do efeito por garantia, e vale a pena dizer o
 * que se perde: quem rolar depois desse prazo encontra as seções de baixo
 * já visíveis, sem o esmaecer. Em compensação, "a página parece vazia" deixa
 * de ser um estado possível. Entre um efeito e o conteúdo, o conteúdo ganha.
 */

/* Generoso o bastante para não atropelar a revelação de quem está rolando a
   página, curto o bastante para ninguém encarar uma tela vazia. */
const PRAZO_DE_SEGURANCA_MS = 6000;

export function BlurFade({ children, delay = 0, duration = 0.4, yOffset = 6, inView = false, className }) {
  const ref = useRef(null);
  const semMovimento = useReducedMotion();
  const naTela = useInView(ref, { once: true, amount: 0.3 });

  const deveAparecer = !inView || naTela;
  const [revelado, setRevelado] = useState(false);
  const [semAnimacao, setSemAnimacao] = useState(false);

  /* Prazo curto: a seção já deveria estar aparecendo. */
  useEffect(() => {
    if (semMovimento || revelado || !deveAparecer) return undefined;
    const id = setTimeout(() => setSemAnimacao(true), (duration + delay) * 1000 + 900);
    return () => clearTimeout(id);
  }, [semMovimento, revelado, deveAparecer, duration, delay]);

  /* Prazo longo: vale mesmo para as seções que o observador ainda não
     reportou — é o caso em que ele não está funcionando. */
  useEffect(() => {
    if (semMovimento || revelado) return undefined;
    const id = setTimeout(() => setSemAnimacao(true), PRAZO_DE_SEGURANCA_MS);
    return () => clearTimeout(id);
  }, [semMovimento, revelado]);

  if (semMovimento || semAnimacao) {
    return <div ref={ref} className={className}>{children}</div>;
  }

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: yOffset, filter: 'blur(6px)' }}
      animate={deveAparecer ? { opacity: 1, y: 0, filter: 'blur(0px)' } : {}}
      transition={{ duration, delay, ease: [0.21, 0.47, 0.32, 0.98] }}
      onAnimationComplete={() => setRevelado(true)}
      className={className}
    >
      {children}
    </motion.div>
  );
}
