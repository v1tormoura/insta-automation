import './App.css';

import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'sonner';
import MainLayout from './layouts/MainLayout';
import { LimiteDeRota } from './components/LimiteDeErro';
/* Cada tela vira um pedaço separado do bundle, carregado na primeira visita.
   Antes era um arquivo só de 2 MB — e foi ele que travou na rede instável do
   dia 19: a pessoa esperava o bundle inteiro baixar para ver o
   painel. Login e as páginas públicas ficam no bundle principal: são a
   primeira coisa que aparece, e são pequenas. */
const Dashboard           = lazy(() => import('./pages/Dashboard'));
const Accounts            = lazy(() => import('./pages/Accounts'));
const Posts               = lazy(() => import('./pages/Posts'));
const Scheduler           = lazy(() => import('./pages/Scheduler'));
const Logs                = lazy(() => import('./pages/Logs'));
const Legends             = lazy(() => import('./pages/Legends'));
const Health              = lazy(() => import('./pages/Health'));
const Stories             = lazy(() => import('./pages/Stories'));
const Loop                = lazy(() => import('./pages/Loop'));
const JobManager          = lazy(() => import('./pages/JobManager'));
const Campaigns           = lazy(() => import('./pages/Campaigns'));
const CampaignWizard      = lazy(() => import('./pages/CampaignWizard'));
const ConfigNotificacoes  = lazy(() => import('./pages/ConfigNotificacoes'));
const CampaignDetail      = lazy(() => import('./pages/CampaignDetail'));
import OAuthCallback from './pages/OAuthCallback';
const ConectarGuiado      = lazy(() => import('./pages/ConectarGuiado'));
const TopPosts            = lazy(() => import('./pages/TopPosts'));
const Ranking             = lazy(() => import('./pages/Ranking'));
const Performance         = lazy(() => import('./pages/Performance'));
const MetricasDosPerfis   = lazy(() => import('./pages/MetricasDosPerfis'));
const MinhaConta          = lazy(() => import('./pages/MinhaConta'));
const MediaLibrary        = lazy(() => import('./pages/MediaLibrary'));
const OAuthAccounts       = lazy(() => import('./pages/OAuthAccounts'));
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
          FORA do PrivateRoute de propósito: ela abre no navegador onde a
          conta do Instagram está logada, e ali a pessoa não está logada no
          painel. Não expõe nada novo: usa só `/oauth/url`, que já é pública. */}
      <Route path="/conectar" element={<ConectarGuiado />} />

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
              <Route path="/legends"      element={<Legends />} />
              <Route path="/health"       element={<Health />} />
              <Route path="/stories"      element={<Stories />} />
              <Route path="/loop"         element={<Loop />} />
              <Route path="/jobs"         element={<JobManager />} />
              {/* /campaigns/nova antes de /campaigns/:id — senão "nova" seria lido como id */}
              <Route path="/campaigns"      element={<Campaigns />} />
              <Route path="/campaigns/nova" element={<CampaignWizard />} />
              <Route path="/settings/notificacoes" element={<ConfigNotificacoes />} />
              <Route path="/campaigns/:id"  element={<CampaignDetail />} />
              <Route path="/top-posts"      element={<TopPosts />} />
              <Route path="/ranking"        element={<Ranking />} />
              <Route path="/performance"    element={<Performance />} />
              <Route path="/metricas-perfis" element={<MetricasDosPerfis />} />
              <Route path="/minha-conta"    element={<MinhaConta />} />
              <Route path="/api-meta"       element={<ApiMeta />} />
              <Route path="/oauth-contas"   element={<OAuthAccounts />} />
              <Route path="/biblioteca"          element={<MediaLibrary />} />
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
