import './App.css';

import { Routes, Route } from 'react-router-dom';
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
import MediaLibrary from './pages/MediaLibrary';
import Stories from './pages/Stories';

export default function App() {
  return (
    <MainLayout>
      <Routes>
        <Route path="/" element={<Dashboard />} />

        <Route path="/accounts" element={<Accounts />} />

        <Route path="/posts" element={<Posts />} />

        <Route path="/scheduler" element={<Scheduler />} />

        <Route path="/logs" element={<Logs />} />

        <Route path="/settings" element={<Settings />} />

        <Route path="/legends" element={<Legends />} />

        <Route path="/sessions" element={<Sessions />} />

        <Route path="/health" element={<Health />} />

        <Route path="/proxies" element={<Proxies />} />

        <Route path="/media-library" element={<MediaLibrary />} />

        <Route path="/stories" element={<Stories />} />
      </Routes>
    </MainLayout>
  );
}
