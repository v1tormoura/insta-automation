import './App.css';

import { lazy, Suspense, useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'sonner';
import './design/avisos.css';
import MainLayout from './layouts/MainLayout';
import { LimiteDeRota } from './components/LimiteDeErro';
/* Cada tela vira um pedaço separado do bundle, carregado na primeira visita.
   Antes era um arquivo só de 2 MB — e foi ele que travou na rede instável do
   dia 19: a pessoa esperava o bundle inteiro baixar para ver o
   painel. Login e as páginas públicas ficam no bundle principal: são a
   primeira coisa que aparece, e são pequenas. */
const telas = {
  Dashboard: () => import('./pages/Dashboard'),
  Accounts: () => import('./pages/Accounts'),
  Posts: () => import('./pages/Posts'),
  Scheduler: () => import('./pages/Scheduler'),
  Logs: () => import('./pages/Logs'),
  Legends: () => import('./pages/Legends'),
  Health: () => import('./pages/Health'),
  Stories: () => import('./pages/Stories'),
  Loop: () => import('./pages/Loop'),
  JobManager: () => import('./pages/JobManager'),
  ConfigNotificacoes: () => import('./pages/ConfigNotificacoes'),
  ConectarGuiado: () => import('./pages/ConectarGuiado'),
  TopPosts: () => import('./pages/TopPosts'),
  Performance: () => import('./pages/Performance'),
  MetricasDosPerfis: () => import('./pages/MetricasDosPerfis'),
  MinhaConta: () => import('./pages/MinhaConta'),
  MediaLibrary: () => import('./pages/MediaLibrary'),
  Variacoes: () => import('./pages/Variacoes'),
  Webhook: () => import('./pages/Webhook'),
  Atividade: () => import('./pages/Atividade'),
  OAuthAccounts: () => import('./pages/OAuthAccounts'),
  ApiMeta: () => import('./pages/ApiMeta'),
  Usuarios: () => import('./pages/Usuarios'),
};

const Dashboard = lazy(telas.Dashboard);
const Accounts = lazy(telas.Accounts);
const Posts = lazy(telas.Posts);
const Scheduler = lazy(telas.Scheduler);
const Logs = lazy(telas.Logs);
const Legends = lazy(telas.Legends);
const Health = lazy(telas.Health);
const Stories = lazy(telas.Stories);
const Loop = lazy(telas.Loop);
const JobManager = lazy(telas.JobManager);
const ConfigNotificacoes = lazy(telas.ConfigNotificacoes);
import OAuthCallback from './pages/OAuthCallback';
const ConectarGuiado = lazy(telas.ConectarGuiado);
const TopPosts = lazy(telas.TopPosts);
const Performance = lazy(telas.Performance);
const MetricasDosPerfis = lazy(telas.MetricasDosPerfis);
const MinhaConta = lazy(telas.MinhaConta);
const MediaLibrary = lazy(telas.MediaLibrary);
const Variacoes = lazy(telas.Variacoes);
const Webhook = lazy(telas.Webhook);
const Atividade = lazy(telas.Atividade);
const OAuthAccounts = lazy(telas.OAuthAccounts);
import Login from './pages/Login';
import Termos from './pages/Termos';
import Privacidade from './pages/Privacidade';
const ApiMeta = lazy(telas.ApiMeta);
const Usuarios = lazy(telas.Usuarios);
import { isAuthenticated, isAdmin } from './services/auth';

/* Depois que a primeira tela aparece, as outras são baixadas em segundo
   plano, uma de cada vez. Assim, clicar no menu não espera a rede: o pedaço
   da tela já está no navegador. Quem pediu economia de dados fica de fora. */
function useBaixarTelasEmSegundoPlano() {
  useEffect(() => {
    if (!isAuthenticated() || navigator.connection?.saveData) return undefined;
    let cancelado = false;
    const baixar = async () => {
      for (const carregar of Object.values(telas)) {
        if (cancelado) return;
        await carregar().catch(() => {});
      }
    };
    const quandoOcioso = window.requestIdleCallback || (fn => setTimeout(fn, 1500));
    const id = quandoOcioso(baixar, { timeout: 4000 });
    return () => { cancelado = true; (window.cancelIdleCallback || clearTimeout)(id); };
  }, []);
}

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

/** Telas só do admin: para os outros, o painel inicial. */
function SoAdmin({ children }) {
  return isAdmin() ? children : <Navigate to="/" replace />;
}

export default function App() {
  useBaixarTelasEmSegundoPlano();
  return (
    <>
    {/* `data-mf` dá aos avisos os tokens do tema; `contents` não cria caixa. */}
    <div data-mf style={{ display: 'contents' }}>
      <Toaster
        position="bottom-right"
        closeButton
        visibleToasts={4}
        offset={20}
        mobileOffset={{ bottom: 'calc(12px + env(safe-area-inset-bottom))', left: 12, right: 12 }}
        toastOptions={{ unstyled: false, classNames: { toast: 'mf-aviso' } }}
      />
    </div>
    <Suspense fallback={<CarregandoTela />}>
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/cadastro" element={<Login />} />
      <Route path="/redefinir-senha" element={<Login />} />
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
              <Route path="/campaigns/*"    element={<Navigate to="/" replace />} />
              <Route path="/settings/notificacoes" element={<ConfigNotificacoes />} />
              <Route path="/top-posts"      element={<TopPosts />} />
              <Route path="/ranking"        element={<Navigate to="/top-posts" replace />} />
              <Route path="/performance"    element={<Performance />} />
              <Route path="/metricas-perfis" element={<MetricasDosPerfis />} />
              <Route path="/minha-conta"    element={<MinhaConta />} />
              <Route path="/api-meta"       element={<SoAdmin><ApiMeta /></SoAdmin>} />
              <Route path="/usuarios"       element={<SoAdmin><Usuarios /></SoAdmin>} />
              <Route path="/oauth-contas"   element={<OAuthAccounts />} />
              <Route path="/biblioteca"          element={<MediaLibrary />} />
              <Route path="/importar"            element={<Navigate to="/variacoes" replace />} />
              <Route path="/variacoes"           element={<Variacoes />} />
              <Route path="/webhook"             element={<Webhook />} />
              <Route path="/atividade"           element={<Atividade />} />
              <Route path="/funil"               element={<Navigate to="/webhook" replace />} />
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
