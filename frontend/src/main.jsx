import React from 'react';
/* Inter, só os pesos que a moldura do story usa.

   É a fonte que o servidor queima na mídia (`fonts-inter` no Dockerfile). Sem
   carregá-la aqui, o preview em Windows cairia em Segoe UI: outra largura por
   caractere, e o preview passaria a mentir sobre o que cabe em cada linha.

   Em macOS e iOS o `-apple-system` da pilha vence antes e o preview usa SF Pro
   — melhor ainda, porque é literalmente a letra do iPhone. */
import '@fontsource/inter/600.css';
import '@fontsource/inter/800.css';
import './index.css';

import ReactDOM from 'react-dom/client';

import { BrowserRouter } from 'react-router-dom';

import App from './App';

/* Tema e fundo ANTES do primeiro render.

   Aplicados a partir do localStorage, nao da resposta de `/conta`: esperando o
   servidor, o app pinta escuro e depois claro — o flash do tema errado, que e
   a coisa mais visivel que uma tela de preferencias pode fazer de errado. A
   resposta chega em seguida e corrige, se divergir. */
import { aplicar } from './services/preferencias';
aplicar();

ReactDOM.createRoot(document.getElementById('root')).render(
  <BrowserRouter>
    <App />
  </BrowserRouter>
);

/* Tira a splash de arranque (ver index.html) depois do primeiro quadro real.
   Duas `requestAnimationFrame`: a primeira cai depois do React confirmar o
   commit, a segunda depois do navegador já ter PINTADO esse commit na tela.
   Tirar cedo demais trocaria "carregando" por um instante de tela em branco
   — pior do que a splash ficar um quadro a mais do que precisava. */
requestAnimationFrame(() => requestAnimationFrame(() => {
  const splash = document.getElementById('boot-splash');
  if (!splash) return;
  splash.setAttribute('data-saindo', '');
  setTimeout(() => splash.remove(), 400);
}));

/* O service worker é registrado no ARRANQUE, e não só ao ligar o push.

   Ele já era registrado — porém apenas dentro de `notificacaoDoNavegador
   .ligar()`, no instante em que a pessoa aceita receber avisos. Quem nunca
   ligou ficava sem worker nenhum, e worker registrado é um dos critérios
   que o navegador usa para considerar o app INSTALÁVEL.

   Instalar tem uma consequência concreta e visível: enquanto o painel for
   só um site aberto numa aba, o Android mostra o DOMÍNIO — `instaflow.pro`
   — como remetente de cada notificação, porque é a única identidade que ele
   tem. Instalado na tela de início, passa a usar o `name` do manifesto:
   "Nexora".

   Sem `await` e falhando em silêncio: registrar não pode atrasar nem
   derrubar o primeiro render. `register` é idempotente, então continuar
   chamando de dentro de `ligar()` não registra duas vezes. */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' })
      .catch(err => console.warn('[SW] não registrou:', err.message));
  });
}
