import api from './api';

const CHAVE_LOCAL = 'mf_notif_navegador';

/**
 * Notificação do sistema — service worker e Web Push.
 *
 * ── O que estava errado antes
 *
 * A primeira versão usava `new Notification(...)` direto da página. Funciona no
 * desktop e o **Android Chrome recusa**: exige
 * `ServiceWorkerRegistration.showNotification()`. Como a chamada estava dentro
 * de um `try`, ela falhava em silêncio — nada aparecia no celular e nenhum
 * erro era mostrado, que é a pior combinação possível.
 *
 * E notificação a partir da página só existe enquanto a página existe. Com o
 * app fechado — que é quando a notificação vale alguma coisa — nada chega.
 * Isso exige push de verdade, entregue ao service worker pelo servidor.
 *
 * ── Por que a permissão continua não sendo pedida sozinha
 *
 * `requestPermission()` no carregamento é a caixa que se nega por reflexo, e a
 * negação é permanente: o navegador não pergunta de novo naquele aparelho. Só
 * ao ligar o interruptor.
 *
 * ── iOS
 *
 * O Safari só entrega push se o site tiver sido adicionado à Tela de Início, no
 * iOS 16.4+. Não há como contornar por código — `diagnostico()` detecta o caso
 * para a interface poder explicar em vez de simplesmente não funcionar.
 */

const temSW    = () => typeof navigator !== 'undefined' && 'serviceWorker' in navigator;
const temPush  = () => typeof window !== 'undefined' && 'PushManager' in window;
const temNotif = () => typeof window !== 'undefined' && 'Notification' in window;

/** iOS fora da Tela de Início: o caso que precisa de explicação, não de erro. */
function ehIOSNoNavegador() {
  if (typeof navigator === 'undefined') return false;
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const instalado = window.matchMedia?.('(display-mode: standalone)').matches
    || window.navigator.standalone === true;
  return ios && !instalado;
}

/** Base64 URL-safe → Uint8Array, formato que o PushManager exige na chave. */
function chaveParaBytes(base64) {
  const preenchido = (base64 + '='.repeat((4 - base64.length % 4) % 4))
    .replace(/-/g, '+').replace(/_/g, '/');
  const crus = atob(preenchido);
  return Uint8Array.from([...crus].map(c => c.charCodeAt(0)));
}

let registroSW = null;

async function registrar() {
  if (!temSW()) return null;
  if (registroSW) return registroSW;
  try {
    registroSW = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    await navigator.serviceWorker.ready;
    return registroSW;
  } catch (err) {
    console.warn('[Push] service worker não registrou:', err.message);
    return null;
  }
}

export const notificacaoDoNavegador = {
  suportada: () => temSW() && temPush() && temNotif(),

  permissao: () => (temNotif() ? Notification.permission : 'unsupported'),

  ligada() {
    try { return localStorage.getItem(CHAVE_LOCAL) === '1'; } catch { return false; }
  },

  /**
   * Por que não funciona, quando não funciona.
   *
   * Um interruptor que não faz nada e não diz por quê é pior que um
   * interruptor ausente.
   */
  diagnostico() {
    if (ehIOSNoNavegador()) {
      return { pode: false, motivo: 'ios-navegador',
        texto: 'No iPhone, o aviso do sistema exige adicionar o MouraFlow à Tela de Início pelo botão Compartilhar. Depois disso, ative aqui.' };
    }
    if (!this.suportada()) {
      return { pode: false, motivo: 'sem-suporte',
        texto: 'Este navegador não entrega notificações do sistema. Os avisos dentro do painel continuam funcionando.' };
    }
    if (this.permissao() === 'denied') {
      return { pode: false, motivo: 'negada',
        texto: 'O navegador bloqueou as notificações deste site. Libere nas permissões do site para reativar.' };
    }
    return { pode: true, motivo: 'ok', texto: '' };
  },

  /**
   * Pede a permissão, registra o worker e inscreve o aparelho.
   *
   * A ordem importa: sem permissão o `subscribe` falha, e sem worker registrado
   * não existe `pushManager`.
   */
  async ligar() {
    const d = this.diagnostico();
    if (!d.pode) return { ok: false, ...d };

    const permissao = await Notification.requestPermission();
    if (permissao !== 'granted') {
      try { localStorage.setItem(CHAVE_LOCAL, '0'); } catch { /* modo privado */ }
      return { ok: false, motivo: 'negada',
        texto: 'Permissão negada. Os avisos dentro do painel continuam funcionando.' };
    }

    const registro = await registrar();
    if (!registro) return { ok: false, motivo: 'sem-worker', texto: 'O service worker não pôde ser registrado.' };

    try {
      const { data } = await api.get('/notificacoes/push/chave-publica');
      if (!data?.chave) {
        return { ok: false, motivo: 'sem-chave',
          texto: 'O servidor ainda não tem chaves VAPID configuradas. Gere-as e reinicie o backend.' };
      }

      /* Reaproveita a inscrição existente quando há uma: o navegador devolve a
         mesma, e reinscrever geraria um segundo endpoint para o mesmo
         aparelho. */
      const existente = await registro.pushManager.getSubscription();
      const inscricao = existente || await registro.pushManager.subscribe({
        userVisibleOnly: true,   // exigido pelo Chrome; push silencioso é recusado
        applicationServerKey: chaveParaBytes(data.chave),
      });

      await api.post('/notificacoes/push/inscrever', {
        ...inscricao.toJSON(),
        aparelho: navigator.userAgent.slice(0, 120),
      });

      try { localStorage.setItem(CHAVE_LOCAL, '1'); } catch { /* modo privado */ }
      return { ok: true, motivo: 'ok', texto: '' };
    } catch (err) {
      return { ok: false, motivo: 'falhou',
        texto: err.response?.data?.error || err.message || 'Não foi possível inscrever este aparelho.' };
    }
  },

  /**
   * Desliga NESTE aparelho.
   *
   * A permissão do navegador não é revogada — só o navegador pode fazer isso.
   * O que se desfaz é a inscrição, que é o que realmente faz a notificação
   * chegar.
   */
  async desligar() {
    try { localStorage.setItem(CHAVE_LOCAL, '0'); } catch { /* modo privado */ }
    try {
      const registro = await registrar();
      const inscricao = await registro?.pushManager.getSubscription();
      if (inscricao) {
        await api.post('/notificacoes/push/cancelar', { endpoint: inscricao.endpoint })
          .catch(() => { /* o servidor limpa sozinho quando o envio falhar */ });
        await inscricao.unsubscribe();
      }
    } catch { /* já estava desligado */ }
  },

  /**
   * Aviso local, para quando o app está aberto em outra aba.
   *
   * Vai pelo service worker, não por `new Notification` — ver o comentário no
   * topo. Com a aba à vista não dispara: o cartão interno já apareceu e o
   * nativo seria a mesma coisa dita duas vezes.
   */
  async mostrar(n) {
    if (!this.suportada() || !this.ligada()) return;
    if (Notification.permission !== 'granted') return;
    if (document.visibilityState === 'visible') return;
    try {
      const registro = await registrar();
      await registro?.showNotification(n.titulo || 'MouraFlow', {
        body: n.mensagem || '',
        icon: '/mouraflow-icon.svg',
        badge: '/mouraflow-icon.svg',
        tag: n._id || 'mouraflow',
        data: { url: '/', id: n._id || '' },
      });
    } catch { /* o push do servidor cobre o caso do app fechado */ }
  },
};
