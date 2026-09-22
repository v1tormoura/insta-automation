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
        texto: 'No iPhone, o aviso do sistema exige adicionar o Nexora à Tela de Início pelo botão Compartilhar. Depois disso, ative aqui.' };
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
   * O estado REAL deste aparelho — não o interruptor.
   *
   * O interruptor é um "1" no localStorage; a permissão, o service worker e
   * a inscrição são do navegador; e o servidor pode ter apagado a inscrição
   * depois de o serviço de push a dar como morta. Quatro fontes que podem
   * discordar, e quando discordam a pessoa vê "ligado" e não recebe nada.
   * Aqui as quatro ficam lado a lado.
   */
  async estadoLocal() {
    const saida = {
      suportada: this.suportada(), permissao: this.permissao(), interruptor: this.ligada(),
      swRegistrado: false, inscritoLocal: false, endpoint: '', servidor: null,
      ios: /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1),
      instalado: !!(window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true),
    };
    try {
      const reg = temSW() ? await navigator.serviceWorker.getRegistration('/') : null;
      saida.swRegistrado = !!reg;
      const ins = reg ? await reg.pushManager.getSubscription() : null;
      saida.inscritoLocal = !!ins;
      saida.endpoint = ins?.endpoint || '';
    } catch { /* fica como "não" */ }
    if (saida.endpoint) {
      try {
        const { data } = await api.get('/notificacoes/push/estado', { params: { endpoint: saida.endpoint } });
        saida.servidor = data || null;
      } catch { saida.servidor = null; }
    }
    return saida;
  },

  /**
   * Aviso LOCAL, sem passar pelo servidor nem pelo serviço de push.
   *
   * É a metade do diagnóstico que faltava: se este aparecer, o sistema
   * (Windows, iOS) deixa o Nexora mostrar avisos e o problema, se houver,
   * está no caminho do push; se não aparecer, o bloqueio é do sistema —
   * Não Perturbe, Assistente de Foco, notificações do Chrome desligadas no
   * Windows, Resumo Programado no iPhone. Ignora o interruptor e a
   * visibilidade de propósito: é teste.
   */
  async mostrarTeste() {
    if (!temNotif() || !temSW()) return { ok: false, motivo: 'sem-suporte', texto: 'Este navegador não mostra avisos do sistema.' };
    if (Notification.permission !== 'granted') return { ok: false, motivo: 'sem-permissao', texto: 'A permissão de notificação não está concedida neste navegador.' };
    const reg = await registrar();
    if (!reg) return { ok: false, motivo: 'sem-worker', texto: 'O service worker não pôde ser registrado.' };
    try {
      await reg.showNotification('Aviso local do Nexora ✅', {
        body: 'Se você está vendo isto, o aparelho deixa o Nexora avisar. O caminho do push é o próximo a testar.',
        icon: '/nexora-icon.png?v=3', badge: '/nexora-badge.png?v=3',
        tag: 'teste-local', data: { url: '/', id: 'teste-local' },
      });
      return { ok: true };
    } catch (err) {
      return { ok: false, motivo: 'falhou', texto: err.message || 'O navegador recusou mostrar o aviso.' };
    }
  },

  /**
   * Refaz a inscrição deste aparelho do zero: descarta a atual (que pode
   * estar morta no serviço de push) e cria outra. O servidor limpa a antiga
   * sozinho quando o próximo envio a ela falhar com 404/410.
   */
  async reinscrever() {
    try {
      const reg = await registrar();
      const atual = await reg?.pushManager.getSubscription();
      if (atual) {
        await api.post('/notificacoes/push/cancelar', { endpoint: atual.endpoint }).catch(() => {});
        await atual.unsubscribe().catch(() => {});
      }
    } catch { /* segue para o ligar() */ }
    return this.ligar();
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
      await registro?.showNotification(n.titulo || 'Nexora', {
        body: n.mensagem || '',
        icon: '/nexora-icon.png?v=3',
        // Silhueta monocromática para a barra de status — ver sw.js.
        badge: '/nexora-badge.png?v=3',
        tag: n._id || 'nexora',
        data: { url: '/', id: n._id || '' },
      });
    } catch { /* o push do servidor cobre o caso do app fechado */ }
  },
};
