import { createPortal } from 'react-dom';

/**
 * Portal de modal — a correção definitiva da tela "bugada" ao abrir um diálogo.
 *
 * ── O bug
 *
 * Um `.modal-overlay` é `position: fixed; inset: 0`, então deveria cobrir a
 * viewport e centralizar o diálogo. Mas o CSS tem uma regra: um ancestral com
 * `container-type` (as consultas de container do `.mf-card`), `transform`,
 * `filter` ou `will-change` deixa de ser transparente ao posicionamento e vira
 * o BLOCO DE CONTENÇÃO dos descendentes `fixed`. Aí o `inset: 0` passa a valer
 * contra esse ancestral — não contra a tela — e o modal aparece colado no topo,
 * do tamanho do cartão, com o resto da página apagada por baixo.
 *
 * Nenhuma regra de CSS no overlay resolve isso: `!important`, z-index, nada
 * muda contra qual caixa o `fixed` resolve. A única saída é o nó do modal não
 * ter esse ancestral. É o que este portal faz: monta o modal como filho direto
 * de <body>, onde não há `container-type` nem `transform` acima dele.
 *
 * ── O `data-mf`
 *
 * Os tokens do tema são escopados a `[data-mf]` (ver tokens.css). Fora da casca
 * `.mf-app`, o modal perderia todas as cores e medidas. O invólucro do portal
 * recarrega o escopo — o `<body>` passa a ter um filho `[data-mf]` só enquanto
 * o modal está aberto.
 */
export default function PortalModal({ children }) {
  if (typeof document === 'undefined') return null;

  /* O tema viaja junto. Os tokens claros moram em seletores como
     `[data-tema='claro'] [data-mf]`; montado em <body>, fora da casca do app, o
     portal podia cair num escopo de tema diferente do resto da tela — o
     diálogo saindo escuro com o painel claro, ou o contrário. Copiando os
     atributos da casca, o modal resolve exatamente os mesmos tokens. */
  const casca = document.querySelector('.mf-app') || document.documentElement;
  const tema = casca?.getAttribute?.('data-tema') || undefined;
  const densidade = casca?.getAttribute?.('data-densidade') || undefined;

  return createPortal(
    <div data-mf data-tema={tema} data-densidade={densidade}>{children}</div>,
    document.body,
  );
}
