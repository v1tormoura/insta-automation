import './App.css';

import { Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'sonner';
import MainLayout from './layouts/MainLayout';
import Dashboard from './pages/Dashboard';
import Accounts from './pages/Accounts';
import Posts from './pages/Posts';
import Scheduler from './pages/Scheduler';
import Logs from './pages/Logs';
import Settings from './pages/Settings';
import Legends from './pages/Legends';
import Sessions from './pages/Sessions';
import Health from './pages/Health';
import Proxies from './pages/Proxies';
import Stories from './pages/Stories';
import Warmup from './pages/Warmup';
import Loop from './pages/Loop';
import JobManager from './pages/JobManager';
import OAuthCallback from './pages/OAuthCallback';
import TopPosts from './pages/TopPosts';
import BestTimes from './pages/BestTimes';
import SmartRepost from './pages/SmartRepost';
import Promo from './pages/Promo';
import Ranking from './pages/Ranking';
import Faturamento from './pages/Faturamento';
import Performance from './pages/Performance';
import Limpador from './pages/Limpador';
import MediaLibrary from './pages/MediaLibrary';
import OAuthAccounts from './pages/OAuthAccounts';
import VideoTemplates from './pages/VideoTemplates';
import VideoTemplateEditor from './pages/VideoTemplateEditor';
import VideoBatches from './pages/VideoBatches';
import VideoBatchDetail from './pages/VideoBatchDetail';
import VideoEditorPage from './pages/VideoEditorPage';
import Login from './pages/Login';
import Termos from './pages/Termos';
import Privacidade from './pages/Privacidade';
import ApiMeta from './pages/ApiMeta';
import { isAuthenticated } from './services/auth';

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
          background: 'rgba(10,20,38,.96)',
          border: '1px solid rgba(0,212,255,.2)',
          color: '#e2edfd',
          backdropFilter: 'blur(16px)',
          fontSize: '13px',
        },
      }}
    />
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/termos" element={<Termos />} />
      <Route path="/privacidade" element={<Privacidade />} />
      <Route path="/oauth-callback" element={<OAuthCallback />} />

      <Route path="/*" element={
        <PrivateRoute>
          <MainLayout>
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
              <Route path="/top-posts"      element={<TopPosts />} />
              <Route path="/best-times"     element={<BestTimes />} />
              <Route path="/smart-repost"   element={<SmartRepost />} />
              <Route path="/promo"          element={<Promo />} />
              <Route path="/ranking"        element={<Ranking />} />
              <Route path="/faturamento"    element={<Faturamento />} />
              <Route path="/performance"    element={<Performance />} />
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
          </MainLayout>
        </PrivateRoute>
      } />
    </Routes>
    </>
  );
}
