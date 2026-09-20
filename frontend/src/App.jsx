import './App.css';

import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'sonner';
import MainLayout from './layouts/MainLayout';
import { LimiteDeRota } from './components/LimiteDeErro';
/* Cada tela vira um pedaço separado do bundle, carregado na primeira visita.
   Antes era um arquivo só de 2 MB — e foi ele que travou na rede instável do
   dia 19: a pessoa esperava o editor de vídeo inteiro baixar para ver o
   painel. Login e as páginas públicas ficam no bundle principal: são a
   primeira coisa que aparece, e são pequenas. */
const Dashboard           = lazy(() => import('./pages/Dashboard'));
const DashboardV2         = lazy(() => import('./pages/DashboardV2'));
const PrototipoApp        = lazy(() => import('./prototipo/PrototipoApp'));
const DesignPreview       = lazy(() => import('./prototipo-v2/DesignPreview'));
const Accounts            = lazy(() => import('./pages/Accounts'));
const Posts               = lazy(() => import('./pages/Posts'));
const Scheduler           = lazy(() => import('./pages/Scheduler'));
const Logs                = lazy(() => import('./pages/Logs'));
const Settings            = lazy(() => import('./pages/Settings'));
const Legends             = lazy(() => import('./pages/Legends'));
const Sessions            = lazy(() => import('./pages/Sessions'));
const Health              = lazy(() => import('./pages/Health'));
const Proxies             = lazy(() => import('./pages/Proxies'));
const Stories             = lazy(() => import('./pages/Stories'));
const Warmup              = lazy(() => import('./pages/Warmup'));
const Loop                = lazy(() => import('./pages/Loop'));
const JobManager          = lazy(() => import('./pages/JobManager'));
const Campaigns           = lazy(() => import('./pages/Campaigns'));
const CampaignWizard      = lazy(() => import('./pages/CampaignWizard'));
const ConfigNotificacoes  = lazy(() => import('./pages/ConfigNotificacoes'));
const CampaignDetail      = lazy(() => import('./pages/CampaignDetail'));
import OAuthCallback from './pages/OAuthCallback';
const ConectarGuiado      = lazy(() => import('./pages/ConectarGuiado'));
const TopPosts            = lazy(() => import('./pages/TopPosts'));
const BestTimes           = lazy(() => import('./pages/BestTimes'));
const SmartRepost         = lazy(() => import('./pages/SmartRepost'));
const Promo               = lazy(() => import('./pages/Promo'));
const Ranking             = lazy(() => import('./pages/Ranking'));
const Faturamento         = lazy(() => import('./pages/Faturamento'));
const Performance         = lazy(() => import('./pages/Performance'));
const MetricasDosPerfis   = lazy(() => import('./pages/MetricasDosPerfis'));
const MinhaConta          = lazy(() => import('./pages/MinhaConta'));
const Limpador            = lazy(() => import('./pages/Limpador'));
const MediaLibrary        = lazy(() => import('./pages/MediaLibrary'));
const OAuthAccounts       = lazy(() => import('./pages/OAuthAccounts'));
const VideoTemplates      = lazy(() => import('./pages/VideoTemplates'));
const VideoTemplateEditor = lazy(() => import('./pages/VideoTemplateEditor'));
const VideoBatches        = lazy(() => import('./pages/VideoBatches'));
const VideoBatchDetail    = lazy(() => import('./pages/VideoBatchDetail'));
const VideoEditorPage     = lazy(() => import('./pages/VideoEditorPage'));
import Login from './pages/Login';
import Termos from './pages/Termos';
import Privacidade from './pages/Privacidade';
const ApiMeta             = lazy(() => import('./pages/ApiMeta'));
import { isAuthenticated } from './services/auth';

/* O que aparece entre clicar no menu e o pedaço da tela chegar. Discreto de
   propósito: em conexão boa dura menos de 200 ms e nem se nota. */
function CarregandoTela() {
  return (
    <div style={{ minHeight: '40vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--mf-text-3)', fontSize: 'var(--mf-t-xs)', fontFamily: 'var(--mf-mono)', letterSpacing: '.06em', textTransform: 'uppercase' }}>
      carregando…
    </div>
  );
}

function PrivateRoute({ children }) {
  return isAuthenticated() ? children : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <>
    <Toaster
      position="bottom-right"
      theme="dark"
      richColors
      toastOptions={{
        style: {
          background: 'var(--mf-surface-1)',
          border: '1px solid color-mix(in_oklch,var(--mf-mod,var(--mf-accent-500))_20%,transparent)',
          color: '#e2edfd',
          backdropFilter: 'blur(16px)',
          fontSize: '13px',
        },
      }}
    />
    <Suspense fallback={<CarregandoTela />}>
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/termos" element={<Termos />} />
      <Route path="/privacidade" element={<Privacidade />} />
      <Route path="/oauth-callback" element={<OAuthCallback />} />
      {/* Página guiada — o destino do "Copiar link guiado".
          FORA do PrivateRoute de propósito: ela abre no navegador do perfil
          (multilogin), onde a pessoa não está logada no painel e nem deveria
          estar — o ponto daquele perfil é ser só aquela conta do Instagram.
          Não expõe nada novo: usa só `/oauth/url`, que já é rota pública. */}
      <Route path="/conectar" element={<ConectarGuiado />} />

      <Route path="/v2" element={<DashboardV2 />} />

      {/* Protótipo do redesign — rota isolada, dados ficticios, sem backend.
          Fica fora do PrivateRoute e do MainLayout de proposito: ele traz a
          propria casca, e assim nada da interface atual interfere na avaliacao. */}
      <Route path="/prototipo" element={<PrototipoApp />} />
      {/* Direção nova, em avaliação. Escopada em [data-mf2]: não afeta
          nenhuma outra rota. Sai quando a migração terminar. */}
      <Route path="/design-preview" element={<DesignPreview />} />

      <Route path="/*" element={
        <PrivateRoute>
          <MainLayout>
            {/* O limite fica DENTRO do layout, não em volta dele: assim uma
                tela que quebra perde só a área de conteúdo, e a barra
                lateral continua servindo para navegar para outro lugar.
                Em volta do layout, o erro levaria a navegação junto e o
                usuário ficaria sem saída além de recarregar.

                A chave amarrada ao caminho reinicia o limite a cada
                navegação — sem ela, uma tela que falhou deixaria o erro
                preso na tela seguinte, que talvez esteja perfeita. */}
            <LimiteDeRota titulo="Esta tela encontrou um erro">
            <Suspense fallback={<CarregandoTela />}>
            <Routes>
              <Route path="/"             element={<Dashboard />} />
              <Route path="/accounts"     element={<Accounts />} />
              <Route path="/posts"        element={<Posts />} />
              <Route path="/scheduler"    element={<Scheduler />} />
              <Route path="/logs"         element={<Logs />} />
              <Route path="/settings"     element={<Settings />} />
              <Route path="/legends"      element={<Legends />} />
              <Route path="/sessions"     element={<Sessions />} />
              <Route path="/health"       element={<Health />} />
              <Route path="/proxies"      element={<Proxies />} />
              <Route path="/stories"      element={<Stories />} />
              <Route path="/warmup"       element={<Warmup />} />
              <Route path="/loop"         element={<Loop />} />
              <Route path="/jobs"         element={<JobManager />} />
              {/* /campaigns/nova antes de /campaigns/:id — senão "nova" seria lido como id */}
              <Route path="/campaigns"      element={<Campaigns />} />
              <Route path="/campaigns/nova" element={<CampaignWizard />} />
              {/* Rota TEMPORÁRIA da fase de redesign: vitrine das oito propostas
                  de identidade. Não aplica nada — só permite comparar e marcar.
                  Sai junto com a decisão. */}
              {/* Sob /settings de propósito: esse prefixo já é roteado no nginx
                  no bloco compartilhado, então um F5 aqui devolve o app em vez
                  de JSON. Rota nova fora dos prefixos conhecidos daria 405. */}
              <Route path="/settings/notificacoes" element={<ConfigNotificacoes />} />
              <Route path="/campaigns/:id"  element={<CampaignDetail />} />
              <Route path="/top-posts"      element={<TopPosts />} />
              <Route path="/best-times"     element={<BestTimes />} />
              <Route path="/smart-repost"   element={<SmartRepost />} />
              <Route path="/promo"          element={<Promo />} />
              <Route path="/ranking"        element={<Ranking />} />
              <Route path="/faturamento"    element={<Faturamento />} />
              <Route path="/performance"    element={<Performance />} />
              <Route path="/metricas-perfis" element={<MetricasDosPerfis />} />
              <Route path="/minha-conta"    element={<MinhaConta />} />
              <Route path="/limpador"       element={<Limpador />} />
              <Route path="/api-meta"       element={<ApiMeta />} />
              <Route path="/oauth-contas"   element={<OAuthAccounts />} />
              <Route path="/biblioteca"          element={<MediaLibrary />} />
              <Route path="/video-editor"            element={<VideoEditorPage />} />
              <Route path="/video-templates"         element={<VideoTemplates />} />
              <Route path="/video-templates/new"     element={<VideoTemplateEditor />} />
              <Route path="/video-templates/:id/edit" element={<VideoTemplateEditor />} />
              <Route path="/video-batches"           element={<VideoBatches />} />
              <Route path="/video-batches/:id"       element={<VideoBatchDetail />} />
            </Routes>
            </Suspense>
            </LimiteDeRota>
          </MainLayout>
        </PrivateRoute>
      } />
    </Routes>
    </Suspense>
    </>
  );
}
