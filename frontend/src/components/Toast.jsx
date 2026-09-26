import { useEffect } from 'react';
import { avisar } from '../services/avisos';

/**
 * Ponte para o aviso único do painel (`services/avisos` → sonner).
 *
 * As telas guardam `{ type, title, message }` num estado e renderizam
 * `<Toast toast={...} onClose={...} />`. Antes, este componente desenhava o
 * próprio cartão — e o estilo dele morava em `dashboard.css`, que só carrega
 * com o Dashboard: em qualquer outra tela o aviso saía sem layout, com o "×"
 * caindo embaixo do texto. Agora cada aviso novo vai para a mesma pilha, com o
 * mesmo visual em todas as telas, e o estado da tela é limpo na hora.
 */
export default function Toast({ toast, onClose }) {
  useEffect(() => {
    if (!toast) return;
    avisar(toast.type, toast.title, toast.message);
    onClose?.();
    // Um aviso por objeto novo; `onClose` muda a cada render da tela.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast]);
  return null;
}
