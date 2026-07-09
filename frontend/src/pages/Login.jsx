import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { setToken } from '../services/auth';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error,    setError]    = useState('');
  const [loading,  setLoading]  = useState(false);
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res  = await fetch(`${API}/auth/login`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Erro ao entrar'); return; }
      setToken(data.token);
      navigate('/');
    } catch {
      setError('Servidor inacessível');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--bg)', fontFamily: 'var(--font)',
    }}>
      <div style={{
        width: 360, background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 16, padding: '40px 36px', boxShadow: '0 8px 40px rgba(0,0,0,.4)',
      }}>
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 32 }}>
          <img src="/instaflow-app-icon.svg" alt="logo" style={{ width: 36, height: 36 }} />
          <div>
            <div style={{ fontWeight: 700, fontSize: 18, color: 'var(--text)' }}>InstaFlow</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Automação Pro</div>
          </div>
        </div>

        <h2 style={{ margin: '0 0 6px', fontSize: 20, color: 'var(--text)' }}>Entrar</h2>
        <p style={{ margin: '0 0 28px', fontSize: 13, color: 'var(--text-muted)' }}>
          Acesso restrito — apenas usuários autorizados.
        </p>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>USUÁRIO</label>
            <input
              type="text" value={username} onChange={e => setUsername(e.target.value)}
              placeholder="admin" autoFocus required
              style={{
                background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8,
                padding: '10px 14px', color: 'var(--text)', fontSize: 14, outline: 'none',
              }}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>SENHA</label>
            <input
              type="password" value={password} onChange={e => setPassword(e.target.value)}
              placeholder="••••••••" required
              style={{
                background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8,
                padding: '10px 14px', color: 'var(--text)', fontSize: 14, outline: 'none',
              }}
            />
          </div>

          {error && (
            <div style={{
              background: 'rgba(239,68,68,.12)', border: '1px solid rgba(239,68,68,.3)',
              borderRadius: 8, padding: '10px 14px', color: '#f87171', fontSize: 13,
            }}>
              {error}
            </div>
          )}

          <button type="submit" disabled={loading} style={{
            marginTop: 6, padding: '11px', borderRadius: 8, border: 'none', cursor: 'pointer',
            background: 'var(--accent)', color: '#fff', fontWeight: 600, fontSize: 14,
            opacity: loading ? 0.7 : 1,
          }}>
            {loading ? 'Entrando...' : 'Entrar'}
          </button>
        </form>
      </div>
    </div>
  );
}
