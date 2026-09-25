'use strict';

/**
 * Configuração do servidor, lida do ambiente UMA vez e validada na subida.
 *
 * Faltando algo obrigatório, o processo não sobe e diz o quê — em vez de subir
 * com um segredo padrão conhecido (o que já foi o caso do JWT e da senha do
 * painel) ou quebrar na primeira publicação.
 */

const path = require('path');

/* Em desenvolvimento vale o `backend/.env`; no servidor, o `.env` da raiz (o
   mesmo que o docker compose lê). Variável já definida no ambiente prevalece. */
require('dotenv').config({
  path: [path.join(__dirname, '../../.env'), path.join(__dirname, '../../../.env')],
  quiet: true,
});

const semBarra = v => String(v || '').trim().replace(/\/+$/, '');

const config = {
  port: Number(process.env.PORT) || 3000,
  databaseUrl: process.env.DATABASE_URL || '',

  /* Endereço público DESTA API. A Meta baixa daqui os vídeos e imagens que
     publicamos, e é para cá que o OAuth devolve o código. */
  publicUrl: semBarra(process.env.PUBLIC_URL),
  /* Endereço do painel (Cloudflare Pages). Pode ser uma lista separada por
     vírgula quando o painel responde em mais de um domínio. */
  frontendUrls: String(process.env.FRONTEND_URL || '').split(',').map(semBarra).filter(Boolean),

  jwtSecret: process.env.JWT_SECRET || '',
  authUsername: process.env.AUTH_USERNAME || 'admin',
  authPassword: process.env.AUTH_PASSWORD || '',

  oauthRedirectUri: semBarra(process.env.OAUTH_REDIRECT_URI),
  /* `force_reauth` faz o Instagram pedir login a cada autorização — é o que
     permite conectar várias contas seguidas no mesmo navegador. */
  oauthForceReauth: String(process.env.OAUTH_FORCE_REAUTH ?? 'true').toLowerCase() !== 'false',

  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
  vapid: {
    publicKey: process.env.VAPID_PUBLIC_KEY || '',
    privateKey: process.env.VAPID_PRIVATE_KEY || '',
    subject: process.env.VAPID_SUBJECT || 'mailto:admin@example.com',
  },
};

config.frontendUrl = config.frontendUrls[0] || 'http://localhost:5173';
/* Padrão: a página /oauth-callback do painel. Ela conclui a conexão, avisa a
   tela de Contas quando aberta em janela e funciona também no navegador de
   outro perfil (link guiado). O mesmo endereço precisa estar cadastrado nas
   "URIs de redirecionamento do OAuth" do app na Meta. */
if (!config.oauthRedirectUri) config.oauthRedirectUri = `${config.frontendUrl}/oauth-callback`;

/** Lança com a lista do que falta. Chamado pelo server.js, não na importação — os testes não precisam de tudo. */
config.validar = function validar() {
  const faltando = [];
  if (!config.databaseUrl) faltando.push('DATABASE_URL');
  if (!config.jwtSecret) faltando.push('JWT_SECRET');
  if (!process.env.ENCRYPTION_KEY) faltando.push('ENCRYPTION_KEY');
  if (!config.authPassword) faltando.push('AUTH_PASSWORD');
  if (!config.publicUrl) faltando.push('PUBLIC_URL');
  if (!config.frontendUrls.length) faltando.push('FRONTEND_URL');
  if (faltando.length) {
    throw new Error(`Variáveis de ambiente obrigatórias não definidas: ${faltando.join(', ')} — veja backend/.env.example`);
  }
};

module.exports = config;
