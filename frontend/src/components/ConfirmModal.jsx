import { useEffect, useRef } from 'react';
import PortalModal from './PortalModal';
import './ConfirmModal.css';

/**
 * A pergunta que antecede uma ação sem volta.
 *
 * ── O que estava errado
 *
 * Duas coisas conviviam. O `window.confirm` do navegador, que aparece colado
 * na barra de endereço com a fonte do sistema e o domínio em cima ("instaflow
 * .pro diz") — parece aviso de site suspeito, não o seu painel. E este
 * componente, escrito antes do sistema de design, com as cores cravadas no
 * CSS (`#081225`, `#94a3b8`): fora de qualquer tema, sem ícone, sem hierarquia
 * entre "cancelar" e "excluir", e sem teclado.
 *
 * ── As decisões que ele carrega
 *
 * O foco começa no CANCELAR, não no confirmar. Quem chega aqui apertando Enter
 * por reflexo não pode apagar vinte envios por isso — e a tecla que confirma é
 * a que a pessoa escolheu apertar, não a que ela já estava apertando.
 *
 * `Esc` cancela. A ordem dos botões segue a do sistema operacional em que o
 * painel roda mais (cancelar à esquerda, ação à direita); no celular eles
 * empilham e o destrutivo fica embaixo, longe do polegar que rola.
 *
 * `role="alertdialog"` e não `dialog`: o leitor de tela anuncia o texto inteiro
 * de uma vez, porque aqui a mensagem É a informação — não há nada a explorar
 * dentro da caixa.
 *
 * O foco volta para onde estava quando a caixa fecha. Sem isso, cancelar joga
 * quem usa teclado para o começo da página.
 *
 * @param {boolean}  open
 * @param {string}   title
 * @param {string}   message        a consequência, em uma frase
 * @param {node}     [detalhe]      o que exatamente será afetado (lista, contagem)
 * @param {string}   [confirmLabel] padrão: "Confirmar"
 * @param {string}   [cancelLabel]  padrão: "Cancelar"
 * @param {string}   [tone]         'danger' (padrão) | 'primary'
 * @param {boolean}  [carregando]   trava os botões enquanto a ação corre
 * @param {func}     onConfirm
 * @param {func}     onCancel
 */

const ICONE = {
  danger: <><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></>,
  primary: <><circle cx="12" cy="12" r="10" /><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3" /><line x1="12" y1="17" x2="12.01" y2="17" /></>,
};

export default function ConfirmModal({
  open, title, message, detalhe,
  confirmLabel = 'Confirmar', cancelLabel = 'Cancelar',
  tone = 'danger', carregando = false,
  onConfirm, onCancel,
}) {
  const cancelarRef = useRef(null);
  const caixaRef = useRef(null);
  const focoAnterior = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    focoAnterior.current = document.activeElement;
    /* Um quadro depois: o elemento precisa existir e estar visível para
       receber foco — no mesmo tique ele ainda não foi pintado. */
    const t = setTimeout(() => cancelarRef.current?.focus(), 0);

    const aoTeclar = e => {
      if (e.key === 'Escape') { e.preventDefault(); onCancel?.(); return; }
      if (e.key !== 'Tab') return;
      /* Prende o Tab dentro da caixa: sem isto ele passeia pela página atrás,
         e a pessoa responde a uma pergunta que não está mais vendo. */
      const focaveis = caixaRef.current?.querySelectorAll('button:not([disabled])');
      if (!focaveis?.length) return;
      const primeiro = focaveis[0], ultimo = focaveis[focaveis.length - 1];
      if (e.shiftKey && document.activeElement === primeiro) { e.preventDefault(); ultimo.focus(); }
      else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primeiro.focus(); }
    };
    document.addEventListener('keydown', aoTeclar);
    return () => {
      clearTimeout(t);
      document.removeEventListener('keydown', aoTeclar);
      focoAnterior.current?.focus?.();
    };
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <PortalModal>
      <div className="mf-confirma__fundo" onMouseDown={e => { if (e.target === e.currentTarget) onCancel?.(); }}>
        <div className="mf-confirma" data-tom={tone} role="alertdialog" aria-modal="true"
          aria-labelledby="mf-confirma-titulo" aria-describedby="mf-confirma-texto" ref={caixaRef}>

          <div className="mf-confirma__topo">
            <span className="mf-confirma__ico" aria-hidden="true">
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                {ICONE[tone] || ICONE.danger}
              </svg>
            </span>
            <div style={{ minWidth: 0 }}>
              <h2 id="mf-confirma-titulo" className="mf-confirma__titulo">{title}</h2>
              {message && <p id="mf-confirma-texto" className="mf-confirma__texto">{message}</p>}
            </div>
          </div>

          {detalhe && <div className="mf-confirma__detalhe">{detalhe}</div>}

          <div className="mf-confirma__acoes">
            <button type="button" ref={cancelarRef} onClick={onCancel} disabled={carregando}
              className="mf-confirma__btn mf-confirma__btn--fantasma">
              {cancelLabel}
            </button>
            <button type="button" onClick={onConfirm} disabled={carregando}
              className="mf-confirma__btn mf-confirma__btn--acao">
              {carregando ? 'Aguarde…' : confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </PortalModal>
  );
}
