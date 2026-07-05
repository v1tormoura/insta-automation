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
const app = express();

connectDB();

app.get('/image-proxy', async (req, res) => {
  try {
    const imageUrl = req.query.url;
    if (!imageUrl) return res.status(400).send('URL obrigatoria');
    const response = await fetch(imageUrl);
    res.set('Content-Type', response.headers.get('content-type') || 'image/jpeg');
    response.body.pipe(res);
  } catch (err) {
    res.status(500).send('Erro ao carregar imagem');
  }
});

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static('uploads'));
app.use('/events', require('./routes/eventsRoutes'));
app.use('/dashboard', dashboardRoutes);
app.use('/logs', require('./routes/logRoutes'));
app.use('/settings', require('./routes/settingsRoutes'));
app.use('/sessions', require('./routes/sessionRoutes'));
app.use('/health', require('./routes/healthRoutes'));

app.use('/accounts', require('./routes/accountRoutes'));
app.use('/api/oauth', require('./routes/oauthRoutes'));
app.use('/oauth', require('./routes/oauthRoutes'));
app.use('/posts', require('./routes/postRoutes'));
app.use('/legends', require('./routes/legendRoutes'));
app.use('/media', require('./routes/mediaRoutes'));
app.use('/api/stories', require('./routes/storyRoutes'));
app.use('/warmup', require('./routes/warmupRoutes'));
app.use('/profile-edit', require('./routes/profileEditRoutes'));

app.get('/', (req, res) => {
  res.send(`<!DOCTYPE html><html><head><meta name="facebook-domain-verification" content="a0yvnt1zew8fyuboqj8eug81flhr72" /></head><body>API rodando</body></html>`);
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

// Limpa vídeos processados antigos a cada 6 horas
setInterval(() => cleanProcessedFiles(24), 6 * 60 * 60 * 1000);

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
