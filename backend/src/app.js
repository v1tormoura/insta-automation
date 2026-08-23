require('dotenv').config();
const express = require('express');
const cors = require('cors');
const connectDB = require('./config/db');
const dashboardRoutes = require('./routes/dashboardRoutes');
const startAutoSync = require('./jobs/accountAutoSync');
const startDailyReset = require('./jobs/resetDailyPosts');
const { startFastSync } = require('./jobs/accountFastSync');
const { startSessionKeepAlive } = require('./jobs/sessionKeepAlive');
const { cleanProcessedFiles } = require('./services/videoProcessor');
const { startHealthCheck } = require('./jobs/healthCheck');
// loopJob desativado — novos loops usam exclusivamente a arquitetura Job-based (processJobRound)
const { startInsightAutoSync } = require('./services/insightSyncService');
const { startStoryInsightAutoSync } = require('./services/storyInsightSync');
const { startTokenRefreshJob } = require('./jobs/tokenRefreshJob');
const { startRepostJob }      = require('./jobs/repostJob');
const { startProxyHealthCheck } = require('./jobs/proxyHealthCheck');
const auth = require('./middleware/auth');
const app = express();

connectDB();

// OAuth callback — redireciona para o frontend preservando code e state
app.get('/oauth-callback', (req, res) => {
  const FRONTEND = process.env.FRONTEND_URL || 'http://localhost:5200';
  const params   = new URLSearchParams(req.query).toString();
  res.redirect(`${FRONTEND}/oauth-callback?${params}`);
});

app.get('/image-proxy', async (req, res) => {
  try {
    const imageUrl = req.query.url;
    if (!imageUrl) return res.status(400).send('URL obrigatoria');
    // Handle local /uploads/ paths — serve directly from filesystem
    if (imageUrl.startsWith('/uploads/')) {
      const filePath = require('path').resolve(__dirname, '..', imageUrl.slice(1));
      return res.sendFile(filePath, err => { if (err) res.status(404).send('Arquivo nao encontrado'); });
    }
    const response = await fetch(imageUrl, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return res.status(response.status).send('Imagem nao disponivel');
    res.set('Content-Type', response.headers.get('content-type') || 'image/jpeg');
    res.set('Cache-Control', 'public, max-age=3600');
    // Use arrayBuffer to avoid Web Streams vs Node.js Readable mismatch (Node 18+ native fetch)
    const buf = await response.arrayBuffer();
    res.send(Buffer.from(buf));
  } catch (err) {
    res.status(500).send('Erro ao carregar imagem');
  }
});

const _allowedOrigins = (process.env.FRONTEND_URL || 'http://localhost:5200')
  .split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || _allowedOrigins.some(o => origin.startsWith(o))) return cb(null, true);
    cb(null, false);
  },
  credentials: true,
}));
// Limite do corpo: o padrão do Express é 100 KB, e ninguém escolheu esse número.
// O corpo da campanha cresce com a quantidade de conteúdos e com as legendas por
// conta — passando de 100 KB, o body-parser rejeita e a resposta sai como erro
// genérico, sem relação visível com o tamanho. O nginx à frente já aceita 500 MB.
app.use(express.json({ limit: '10mb' }));

// Rotas públicas — sem autenticação
app.use('/uploads', express.static('uploads'));
app.use('/auth', require('./routes/authRoutes'));
app.use('/api/oauth', require('./routes/oauthRoutes'));
app.use('/oauth', require('./routes/oauthRoutes'));

// Todas as rotas abaixo exigem JWT
app.use('/events',       auth, require('./routes/eventsRoutes'));
app.use('/dashboard',    auth, dashboardRoutes);
app.use('/logs',         auth, require('./routes/logRoutes'));
app.use('/settings',     auth, require('./routes/settingsRoutes'));
app.use('/sessions',     auth, require('./routes/sessionRoutes'));
app.use('/health',       auth, require('./routes/healthRoutes'));
app.use('/accounts',     auth, require('./routes/accountRoutes'));
app.use('/proxy',        auth, require('./routes/proxyRoutes'));
app.use('/campaigns',    auth, require('./routes/campaignRoutes'));
app.use('/posts',        auth, require('./routes/postRoutes'));
app.use('/legends',      auth, require('./routes/legendRoutes'));
app.use('/ai',           auth, require('./routes/aiRoutes'));
app.use('/media',        auth, require('./routes/mediaRoutes'));
app.use('/api/stories',  auth, require('./routes/storyRoutes'));
app.use('/warmup',       auth, require('./routes/warmupRoutes'));
app.use('/loops',        auth, require('./routes/loopRoutes'));
app.use('/profile-edit', auth, require('./routes/profileEditRoutes'));
app.use('/insights',     auth, require('./routes/insightRoutes'));
app.use('/analytics',    auth, require('./routes/analyticsRoutes'));
app.use('/abtests',      auth, require('./routes/abtestRoutes'));
app.use('/repost',       auth, require('./routes/repostRoutes'));
app.use('/jobs',         auth, require('./routes/jobRoutes'));
app.use('/viral',        auth, require('./routes/viralRoutes'));
app.use('/promo',        auth, require('./routes/promoRoutes'));
app.use('/downloader',   auth, require('./routes/downloaderRoutes'));
app.use('/api/limpador', auth, require('./routes/limpadorRoutes'));
app.use('/meta-apps',        auth, require('./routes/metaAppRoutes'));
app.use('/video-templates', auth, require('./routes/videoTemplateRoutes'));
app.use('/video-batches',   auth, require('./routes/videoBatchRoutes'));

app.get('/', (req, res) => {
  res.send(`<!DOCTYPE html><html><head><meta name="facebook-domain-verification" content="a0yvnt1zew8fyuboqj8eug81flhr72" /></head><body>API rodando</body></html>`);
});

// Global error handler — garante JSON em vez de HTML em erros inesperados
/**
 * Tratador global.
 *
 * Fica aqui, e não no fim do arquivo, porque precisa vir DEPOIS das rotas que
 * ele protege — o Express só entrega o erro a um handler registrado adiante.
 *
 * `code` entra na resposta junto com a mensagem: o painel mostra o código ao
 * usuário, e um erro sem nenhum campo reconhecível vira "não foi possível",
 * que não diz nada a ninguém. Erro de corpo grande demais ganha texto próprio,
 * porque "request entity too large" não sugere a causa para quem está usando.
 */
app.use((err, req, res, next) => {
  console.error('[Express] erro global:', err?.message || err);

  const status = err.status || err.statusCode || 500;
  const corpo  = { error: err.message || 'Erro interno do servidor' };

  if (err.type === 'entity.too.large' || status === 413) {
    corpo.code  = 'PAYLOAD_TOO_LARGE';
    corpo.error = 'O conteúdo enviado é grande demais para uma requisição só.';
  } else if (err.type === 'entity.parse.failed') {
    corpo.code  = 'INVALID_JSON';
    corpo.error = 'O corpo da requisição não é um JSON válido.';
  } else if (err.code) {
    corpo.code = String(err.code);
  }

  res.status(status).json(corpo);
});

// Diagnostico do Multilogin -- GET /multilogin/status
app.get('/multilogin/status', async (req, res) => {
  const ML6 = 'http://127.0.0.1:63332';
  const result = {
    mode:         process.env.MULTILOGIN_MODE || '(nao definido)',
    hasEmail:     !!process.env.MULTILOGIN_EMAIL,
    hasPassword:  !!process.env.MULTILOGIN_PASSWORD,
    ml6Running:   false,
    ml6Token:     null,
    profilesRaw:  null,
    profileCount: 0,
    error:        null,
  };

  try {
    const ping = await fetch(`${ML6}/api/v1/profile?offset=0&count=1`, { signal: AbortSignal.timeout(4000) });
    result.ml6Running    = true;
    result.ml6StatusCode = ping.status;

    if (process.env.MULTILOGIN_EMAIL && process.env.MULTILOGIN_PASSWORD) {
      const crypto  = require('crypto');
      const pwdHash = crypto.createHash('md5').update(process.env.MULTILOGIN_PASSWORD).digest('hex');
      const authR   = await fetch(`${ML6}/user/signin`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email: process.env.MULTILOGIN_EMAIL, password: pwdHash }),
        signal:  AbortSignal.timeout(4000),
      });
      const authD = await authR.json();
      result.ml6Token = authD?.data?.token ? 'OK' : `falhou: ${JSON.stringify(authD).slice(0, 200)}`;

      if (authD?.data?.token) {
        const headers = { 'Authorization': `Bearer ${authD.data.token}` };
        const profR   = await fetch(`${ML6}/api/v1/profile?offset=0&count=5`, { headers, signal: AbortSignal.timeout(4000) });
        const profD   = await profR.json();
        result.profilesRaw  = JSON.stringify(profD).slice(0, 500);
        const page = Array.isArray(profD) ? profD
          : (profD.data || profD.profiles || profD.data?.profiles || []);
        result.profileCount = page.length;
      }
    } else {
      const profR = await fetch(`${ML6}/api/v1/profile?offset=0&count=5`, { signal: AbortSignal.timeout(4000) });
      const profD = await profR.json();
      result.profilesRaw  = JSON.stringify(profD).slice(0, 500);
      const page = Array.isArray(profD) ? profD
        : (profD.data || profD.profiles || profD.data?.profiles || []);
      result.profileCount = page.length;
    }
  } catch (e) {
    result.ml6Running = false;
    result.error = e.message;
  }

  res.json(result);
});

const PORT = process.env.PORT || 3000;

startAutoSync();
startDailyReset();
startFastSync();
startSessionKeepAlive();
startHealthCheck();
// startLoopJob() — desativado; loops antigos foram arquivados, novos usam Job Engine
startInsightAutoSync();
// Stories vivem 24h — o ciclo precisa passar dentro dessa janela, senão a
// audiência some junto com o story e nunca chega ao painel.
startStoryInsightAutoSync();
startTokenRefreshJob();
startRepostJob();
startProxyHealthCheck();

// Limpa vídeos processados antigos a cada 6 horas
setInterval(() => cleanProcessedFiles(24), 6 * 60 * 60 * 1000);

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
