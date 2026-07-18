import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { setToken } from '../services/auth';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3000';

const LockIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/>
  </svg>
);
const UserIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/>
  </svg>
);
const EyeIcon = ({ open }) => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    {open
      ? <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></>
      : <><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></>
    }
  </svg>
);

const FEATURES = [
  { text: 'Suporta 50+ contas simultâneas',     d: 'M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 7a4 4 0 100 8 4 4 0 000-8zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75' },
  { text: 'Agendamento inteligente de posts',    d: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01' },
  { text: 'Métricas e insights em tempo real',   d: 'M18 20V10M12 20V4M6 20v-6' },
  { text: 'Online 24/7 no servidor dedicado',    d: 'M3 15a4 4 0 004 4h9a5 5 0 10-4.9-6H7a4 4 0 00-4 4z' },
];

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
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
      background: 'var(--bg)', fontFamily: 'var(--font)', padding: 16, boxSizing: 'border-box',
    }}>
      <div style={{
        display: 'flex', width: '100%', maxWidth: 840,
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 18, overflow: 'hidden',
        boxShadow: '0 24px 64px rgba(0,0,0,.5)',
      }}>

        {/* Painel esquerdo */}
        <div className="login-brand-panel" style={{
          width: '42%', background: 'rgba(255,255,255,.03)',
          borderRight: '1px solid var(--border)',
          display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
          padding: '44px 36px', boxSizing: 'border-box',
        }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 36 }}>
              <img src="/mouraflow-icon.svg" alt="MouraFlow" style={{ width: 38, height: 38, objectFit: 'contain' }} />
              <div>
                <div style={{ color: 'var(--text)', fontWeight: 700, fontSize: 17, lineHeight: 1 }}>MouraFlow</div>
                <div style={{ color: 'var(--text-muted)', fontSize: 11, marginTop: 2 }}>Automação Pro</div>
              </div>
            </div>

            <h2 style={{ color: 'var(--text)', fontSize: 21, fontWeight: 700, margin: '0 0 8px', lineHeight: 1.3 }}>
              Automatize seu Instagram<br/>em escala.
            </h2>
            <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '0 0 32px', lineHeight: 1.7 }}>
              Gerencie dezenas de contas, agende publicações e acompanhe métricas em tempo real.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {FEATURES.map(({ text, d }) => (
                <div key={text} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{
                    width: 28, height: 28, background: 'rgba(59,130,246,.1)',
                    borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                  }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d={d}/>
                    </svg>
                  </div>
                  <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>{text}</span>
                </div>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 24 }}>
            <div style={{ width: 6, height: 6, background: '#22c55e', borderRadius: '50%' }} />
            <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>Todos os sistemas operacionais · instaflow.pro</span>
          </div>
        </div>

        {/* Painel direito — formulário */}
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '44px 40px', boxSizing: 'border-box' }}>
          <div style={{ width: '100%', maxWidth: 320 }}>

            <div style={{ marginBottom: 28 }}>
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                background: 'rgba(59,130,246,.1)', border: '1px solid rgba(59,130,246,.2)',
                borderRadius: 20, padding: '4px 12px', marginBottom: 20,
              }}>
                <span style={{ color: 'var(--accent)' }}><LockIcon /></span>
                <span style={{ color: 'var(--accent)', fontSize: 11, fontWeight: 600 }}>Acesso restrito</span>
              </div>
              <h2 style={{ color: 'var(--text)', fontSize: 22, fontWeight: 700, margin: '0 0 6px' }}>Bem-vindo de volta</h2>
              <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: 0 }}>Entre com suas credenciais de acesso.</p>
            </div>

            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <label style={{ display: 'block', color: 'var(--accent)', fontSize: 11, fontWeight: 600, letterSpacing: '.06em', marginBottom: 7 }}>USUÁRIO</label>
                <div style={{ position: 'relative' }}>
                  <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none', display: 'flex' }}>
                    <UserIcon />
                  </span>
                  <input
                    type="text" value={username} onChange={e => setUsername(e.target.value)}
                    placeholder="admin" autoFocus required
                    style={{
                      width: '100%', background: 'var(--bg)', border: '1px solid var(--border)',
                      borderRadius: 9, padding: '11px 12px 11px 36px', color: 'var(--text)',
                      fontSize: 14, outline: 'none', boxSizing: 'border-box',
                    }}
                  />
                </div>
              </div>

              <div>
                <label style={{ display: 'block', color: 'var(--accent)', fontSize: 11, fontWeight: 600, letterSpacing: '.06em', marginBottom: 7 }}>SENHA</label>
                <div style={{ position: 'relative' }}>
                  <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none', display: 'flex' }}>
                    <LockIcon />
                  </span>
                  <input
                    type={showPass ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)}
                    placeholder="••••••••" required
                    style={{
                      width: '100%', background: 'var(--bg)', border: '1px solid var(--border)',
                      borderRadius: 9, padding: '11px 40px 11px 36px', color: 'var(--text)',
                      fontSize: 14, outline: 'none', boxSizing: 'border-box',
                    }}
                  />
                  <button type="button" onClick={() => setShowPass(v => !v)} style={{
                    position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                    background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', padding: 4,
                  }}>
                    <EyeIcon open={showPass} />
                  </button>
                </div>
              </div>

              {error && (
                <div style={{
                  background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.25)',
                  borderRadius: 8, padding: '10px 14px', color: '#f87171', fontSize: 13,
                }}>
                  {error}
                </div>
              )}

              <button type="submit" disabled={loading} style={{
                marginTop: 4, padding: 12, borderRadius: 9, border: 'none',
                cursor: loading ? 'not-allowed' : 'pointer',
                background: 'var(--accent)', color: '#fff', fontWeight: 600, fontSize: 14,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                opacity: loading ? 0.7 : 1,
              }}>
                {loading ? 'Entrando...' : (
                  <>
                    Entrar
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
                  </>
                )}
              </button>
            </form>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 20 }}>
              <div style={{ width: 6, height: 6, background: '#22c55e', borderRadius: '50%' }} />
              <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>Conexão segura via HTTPS</span>
            </div>
          </div>
        </div>
      </div>

      <style>{`.login-brand-panel { display: flex !important; } @media (max-width: 600px) { .login-brand-panel { display: none !important; } }`}</style>
    </div>
  );
}
