const CHAVE_NAVEGADOR = 'mf_notif_navegador';

/**
 * Notificação nativa do navegador.
 *
 * ── Por que a permissão NUNCA é pedida sozinha
 *
 * Um `Notification.requestPermission()` no carregamento é a caixa de diálogo
 * que todo mundo aprendeu a negar por reflexo — e uma negação é permanente:
 * o navegador não pergunta de novo, e o recurso fica morto para sempre naquele
 * aparelho. Pedir só depois de a pessoa ligar o interruptor troca um reflexo
 * de recusa por uma resposta a uma pergunta que ela mesma fez.
 *
 * Sem permissão, nada quebra: o aviso interno continua sendo a experiência
 * completa, e o nativo é um extra para quando a aba está atrás de outra.
 */
export const notificacaoDoNavegador = {
  suportada: () => typeof window !== 'undefined' && 'Notification' in window,
  permissao: () => (('Notification' in window) ? Notification.permission : 'unsupported'),
  ligada: () => {
    try { return localStorage.getItem(CHAVE_NAVEGADOR) === '1'; } catch { return false; }
  },
  async ligar() {
    if (!this.suportada()) return 'unsupported';
    const r = await Notification.requestPermission();
    try { localStorage.setItem(CHAVE_NAVEGADOR, r === 'granted' ? '1' : '0'); } catch { /* modo privado */ }
    return r;
  },
  desligar() {
    // A permissão do navegador NÃO é revogada aqui: só o navegador pode fazer
    // isso. O que se desliga é o nosso uso dela.
    try { localStorage.setItem(CHAVE_NAVEGADOR, '0'); } catch { /* idem */ }
  },
  mostrar(n) {
    if (!this.suportada() || !this.ligada() || Notification.permission !== 'granted') return;
    // Só quando a aba está escondida: com ela à vista, o aviso interno já
    // apareceu e o nativo seria a mesma coisa dita duas vezes.
    if (document.visibilityState === 'visible') return;
    try {
      new Notification(n.titulo, { body: n.mensagem, tag: n._id, icon: '/mouraflow-icon.svg' });
    } catch { /* alguns navegadores exigem service worker */ }
  },
};
