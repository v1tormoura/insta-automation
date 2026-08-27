/**
 * Service worker do MouraFlow — só notificação.
 *
 * ── Por que ele existe
 *
 * `new Notification(...)` a partir de uma página funciona no desktop e o
 * Android Chrome RECUSA: exige `ServiceWorkerRegistration.showNotification()`.
 * Sem este arquivo, a notificação no celular falhava em silêncio — sem erro
 * visível, sem nada aparecendo.
 *
 * E só um service worker recebe `push` com o app fechado. É essa a diferença
 * entre "avisa enquanto você está olhando" e "o celular apita".
 *
 * ── O que ele deliberadamente NÃO faz
 *
 * Nenhum cache. Um service worker que intercepta `fetch` passa a decidir qual
 * versão do app cada pessoa vê, e a partir daí um deploy pode não chegar a
 * quem já tem o worker instalado — o defeito mais difícil de diagnosticar que
 * um PWA produz. Aqui ele não tem `fetch` handler nenhum: a rede continua
 * funcionando exatamente como antes.
 */

/* Assume o controle sem esperar a aba fechar. Sem isto, um worker novo fica
   "esperando" até todas as abas do app serem fechadas — e no celular elas
   raramente são. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', evento => evento.waitUntil(self.clients.claim()));

self.addEventListener('push', evento => {
  let dados = {};
  try {
    dados = evento.data ? evento.data.json() : {};
  } catch {
    // Payload ilegível não pode virar notificação vazia e muda.
    dados = { titulo: 'MouraFlow', mensagem: 'Novidade nas suas contas.' };
  }

  const titulo = dados.titulo || 'MouraFlow';
  const opcoes = {
    body: dados.mensagem || '',
    icon: '/mouraflow-icon.svg',
    badge: '/mouraflow-icon.svg',
    /* `tag` faz a notificação nova SUBSTITUIR a anterior do mesmo marco em vez
       de empilhar. Sem isso, dois ciclos que reenviassem o mesmo aviso
       deixariam duas linhas idênticas na gaveta do sistema. */
    tag: dados.id || 'mouraflow',
    renotify: false,
    data: { url: dados.url || '/', id: dados.id || '' },
  };

  /* `waitUntil` mantém o worker vivo até a notificação existir. Sem ele, o
     navegador pode encerrar o worker antes da promessa resolver — e mostra uma
     notificação genérica "site atualizado em segundo plano" no lugar. */
  evento.waitUntil(self.registration.showNotification(titulo, opcoes));
});

self.addEventListener('notificationclick', evento => {
  evento.notification.close();
  const destino = evento.notification.data?.url || '/';

  evento.waitUntil((async () => {
    const abas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });

    /* Foca uma aba já aberta em vez de abrir outra. Abrir sempre uma nova
       deixa a pessoa com seis abas do mesmo painel depois de uma semana. */
    for (const aba of abas) {
      if ('focus' in aba) {
        try { await aba.navigate?.(destino); } catch { /* navigate nem sempre existe */ }
        return aba.focus();
      }
    }
    if (self.clients.openWindow) return self.clients.openWindow(destino);
  })());
});
