'use strict';

/** O app Express: CORS, arquivos públicos, rotas e o tratador de erro. Sem efeitos colaterais. */

const path = require('path');
const express = require('express');
const cors = require('cors');
const config = require('./config');
const auth = require('./middleware/auth');

const UPLOADS = path.resolve(__dirname, '../uploads');

/* Imagens externas que o painel exibe: avatar e miniaturas vêm das CDNs da Meta.
   Qualquer outro host é recusado — um proxy aberto buscaria o que pedissem. */
const HOSTS_DE_IMAGEM = /(^|\.)(cdninstagram\.com|fbcdn\.net|instagram\.com)$/i;

const app = express();
app.set('trust proxy', true);

app.use(cors({
  origin: (origin, cb) => cb(null, !origin || config.frontendUrls.some(o => origin === o || origin.startsWith(o))),
  credentials: true,
}));
// O corpo da campanha cresce com os conteúdos e as legendas por conta; 100 KB não bastam.
app.use(express.json({ limit: '10mb' }));

// ── Públicas ────────────────────────────────────────────────────────────────
// A Meta baixa daqui as mídias que publicamos.
app.use('/uploads', express.static(UPLOADS, { maxAge: '1h' }));

app.get('/image-proxy', async (req, res) => {
  const url = String(req.query.url || '');
  if (!url) return res.status(400).send('URL obrigatória');

  if (url.startsWith('/uploads/')) {
    const alvo = path.resolve(UPLOADS, decodeURIComponent(url.slice('/uploads/'.length).split('?')[0]));
    if (!alvo.startsWith(UPLOADS + path.sep)) return res.status(400).send('Caminho inválido');
    return res.sendFile(alvo, err => { if (err && !res.headersSent) res.status(404).send('Arquivo não encontrado'); });
  }

  let destino;
  try { destino = new URL(url); } catch { return res.status(400).send('URL inválida'); }
  if (destino.protocol !== 'https:' || !HOSTS_DE_IMAGEM.test(destino.hostname)) return res.status(400).send('Host não permitido');

  try {
    const resposta = await fetch(destino, { signal: AbortSignal.timeout(10_000) });
    if (!resposta.ok) return res.status(resposta.status).send('Imagem não disponível');
    res.set('Content-Type', resposta.headers.get('content-type') || 'image/jpeg');
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(Buffer.from(await resposta.arrayBuffer()));
  } catch {
    res.status(502).send('Erro ao carregar imagem');
  }
});

app.get('/', (req, res) => {
  const verificacao = process.env.META_DOMAIN_VERIFICATION;
  res.send(`<!DOCTYPE html><html><head>${verificacao ? `<meta name="facebook-domain-verification" content="${verificacao.replace(/[^\w-]/g, '')}" />` : ''}</head><body>API rodando</body></html>`);
});
app.get('/healthz', (req, res) => res.json({ ok: true }));

app.use('/auth', require('./routes/authRoutes'));
app.use('/oauth', require('./routes/oauthRoutes'));

// ── Com login (JWT) ─────────────────────────────────────────────────────────
app.use('/events',        auth, require('./routes/eventsRoutes'));
app.use('/dashboard',     auth, require('./routes/dashboardRoutes'));
app.use('/health',        auth, require('./routes/healthRoutes'));
app.use('/accounts',      auth, require('./routes/accountRoutes'));
app.use('/campaigns',     auth, require('./routes/campaignRoutes'));
app.use('/posts',         auth, require('./routes/postRoutes'));
app.use('/legends',       auth, require('./routes/legendRoutes'));
app.use('/notificacoes',  auth, require('./routes/notificacoesRoutes'));
app.use('/conta',         auth, require('./routes/contaRoutes'));
app.use('/ai',            auth, require('./routes/aiRoutes'));
app.use('/media',         auth, require('./routes/mediaRoutes'));
app.use('/api/stories',   auth, require('./routes/storyRoutes'));
app.use('/loops',         auth, require('./routes/loopRoutes'));
app.use('/insights',      auth, require('./routes/insightRoutes'));
app.use('/analytics',     auth, require('./routes/analyticsRoutes'));
app.use('/jobs',          auth, require('./routes/jobRoutes'));
app.use('/meta-apps',     auth, require('./routes/metaAppRoutes'));
app.use('/convites',      auth, require('./routes/convitesRoutes'));
app.use('/usuarios',      auth, auth.soAdmin, require('./routes/usuariosRoutes'));

app.use((req, res) => res.status(404).json({ error: 'Rota não encontrada' }));

/* Tratador global: sempre JSON, com `code` quando houver — o painel mostra o
   código, e um erro sem nada reconhecível vira "não foi possível". */
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error('[Express] erro:', err?.stack || err);
  const corpo = { error: err.message || 'Erro interno do servidor' };

  if (err.type === 'entity.too.large' || status === 413) {
    corpo.code = 'PAYLOAD_TOO_LARGE';
    corpo.error = 'O conteúdo enviado é grande demais para uma requisição só.';
  } else if (err.type === 'entity.parse.failed') {
    corpo.code = 'INVALID_JSON';
    corpo.error = 'O corpo da requisição não é um JSON válido.';
  } else if (err.code === 'LIMIT_FILE_SIZE') {
    corpo.code = 'ARQUIVO_GRANDE';
    corpo.error = 'O arquivo passa do tamanho permitido.';
    return res.status(400).json(corpo);
  } else if (err.code) {
    corpo.code = String(err.code);
  }
  res.status(status).json(corpo);
});

module.exports = app;
