import { createContext, useContext } from 'react';

/**
 * Contexto do Smart Activity, em arquivo próprio.
 *
 * Mora aqui e não junto dos componentes por uma razão de ferramenta: o Fast
 * Refresh do React só preserva estado quando um módulo exporta APENAS
 * componentes. Um hook exportado ao lado deles faz o módulo inteiro recarregar
 * do zero a cada salvamento — e a Central perderia o estado a cada tecla
 * durante o desenvolvimento, que é exatamente quando se quer olhar para ela.
 */
export const ContextoSmartActivity = createContext(null);

/** Estado das notificações. Vazio fora do provider, para nada quebrar. */
export function useSmartActivity() {
  return useContext(ContextoSmartActivity) || {};
}
