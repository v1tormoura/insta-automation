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
