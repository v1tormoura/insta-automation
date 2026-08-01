import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { setToken } from '../services/auth';
import { Meteors } from '../components/magicui/meteors';
import { BlurFade } from '../components/magicui/blur-fade';
import { AnimatedGradientText } from '../components/magicui/animated-gradient-text';

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
  { text: 'Suporta 50+ contas simultâneas',    d: 'M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 7a4 4 0 100 8 4 4 0 000-8zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75' },
  { text: 'Agendamento inteligente de posts',   d: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01' },
  { text: 'Métricas e insights em tempo real',  d: 'M18 20V10M12 20V4M6 20v-6' },
  { text: 'Online 24/7 no servidor dedicado',   d: 'M3 15a4 4 0 004 4h9a5 5 0 10-4.9-6H7a4 4 0 00-4 4z' },
];

const ease = [0.21, 0.47, 0.32, 0.98];

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
      minHeight: '100vh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      background: 'var(--bg)', fontFamily: 'var(--font)',
      padding: 16, boxSizing: 'border-box',
      position: 'relative', overflow: 'hidden',
    }}>
      {/* Background grid */}
      <div style={{
        position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none',
        backgroundImage: 'linear-gradient(rgba(0,180,255,.025) 1px,transparent 1px),linear-gradient(90deg,rgba(0,180,255,.025) 1px,transparent 1px)',
        backgroundSize: '48px 48px',
      }} />
      {/* Ambient blobs */}
      <div style={{ position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none', overflow: 'hidden' }}>
        <div style={{ position:'absolute', width:560, height:560, left:'50%', top:'50%', transform:'translate(-60%,-55%)', background:'radial-gradient(circle,rgba(0,180,255,.1),transparent 68%)', borderRadius:'50%', filter:'blur(40px)' }} />
        <div style={{ position:'absolute', width:400, height:400, right:'-100px', bottom:'-80px', background:'radial-gradient(circle,rgba(99,102,241,.07),transparent 70%)', borderRadius:'50%', filter:'blur(40px)' }} />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 24, scale: .98 }}
        animate={{ opacity: 1, y: 0,  scale: 1   }}
        transition={{ duration: .55, ease }}
        style={{
          position: 'relative', zIndex: 1,
          display: 'flex', width: '100%', maxWidth: 860,
          background: 'rgba(10,20,38,.92)',
          border: '1px solid rgba(255,255,255,.07)',
          borderRadius: 18, overflow: 'hidden',
          boxShadow: '0 32px 80px rgba(0,0,0,.65), 0 0 0 1px rgba(0,180,255,.04) inset',
          backdropFilter: 'blur(24px)',
        }}
      >
        {/* Brand panel */}
        <div className="login-brand-panel" style={{
          width: '42%', position: 'relative', overflow: 'hidden',
          background: 'rgba(0,180,255,.03)',
          borderRight: '1px solid rgba(255,255,255,.06)',
          display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
          padding: '44px 36px', boxSizing: 'border-box',
        }}>
          <Meteors number={14} />

          <div style={{ position: 'relative', zIndex: 1 }}>
            <BlurFade delay={0.1}>
              <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:36 }}>
                <img src="/mouraflow-icon.svg" alt="MouraFlow" style={{ width:38, height:38, objectFit:'contain' }} />
                <div>
                  <div style={{ color:'var(--text)', fontWeight:800, fontSize:18, lineHeight:1, letterSpacing:'-.3px' }}>MouraFlow</div>
                  <div style={{ color:'var(--text3)', fontSize:11, marginTop:3 }}>Automação Pro</div>
                </div>
              </div>
            </BlurFade>

            <BlurFade delay={0.2}>
              <AnimatedGradientText className="block mb-2" style={{ display:'block', marginBottom:8 }}>
                <span style={{ fontSize:13, fontWeight:600, letterSpacing:'.04em' }}>INSTAGRAM AUTOMATION</span>
              </AnimatedGradientText>
              <h2 style={{ color:'var(--text)', fontSize:22, fontWeight:800, margin:'0 0 10px', lineHeight:1.25, letterSpacing:'-.4px' }}>
                Automatize seu Instagram<br/>em escala.
              </h2>
              <p style={{ color:'var(--text2)', fontSize:13, margin:'0 0 32px', lineHeight:1.7 }}>
                Gerencie dezenas de contas, agende publicações e acompanhe métricas em tempo real.
              </p>
            </BlurFade>

            <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
              {FEATURES.map(({ text, d }, i) => (
                <BlurFade key={text} delay={0.28 + i * 0.07} inView>
                  <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                    <div style={{
                      width:30, height:30,
                      background:'rgba(0,180,255,.07)',
                      border:'1px solid rgba(0,180,255,.14)',
                      borderRadius:8, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0,
                    }}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--cyan)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d={d}/>
                      </svg>
                    </div>
                    <span style={{ color:'var(--text2)', fontSize:13 }}>{text}</span>
                  </div>
                </BlurFade>
              ))}
            </div>
          </div>

          <BlurFade delay={0.6} style={{ position:'relative', zIndex:1 }}>
            <div style={{ display:'flex', alignItems:'center', gap:6, marginTop:24 }}>
              <div style={{ width:6, height:6, background:'var(--green)', borderRadius:'50%', boxShadow:'0 0 7px var(--green)' }} />
              <span style={{ color:'var(--text3)', fontSize:11 }}>Todos os sistemas operacionais</span>
            </div>
          </BlurFade>
        </div>

        {/* Form panel */}
        <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', padding:'44px 40px', boxSizing:'border-box' }}>
          <div style={{ width:'100%', maxWidth:320 }}>
            <BlurFade delay={0.15}>
              <div style={{ marginBottom:28 }}>
                <div style={{
                  display:'inline-flex', alignItems:'center', gap:6,
                  background:'rgba(0,180,255,.07)', border:'1px solid rgba(0,180,255,.16)',
                  borderRadius:20, padding:'4px 12px', marginBottom:20,
                }}>
                  <span style={{ color:'var(--cyan)', display:'flex' }}><LockIcon /></span>
                  <span style={{ color:'var(--cyan)', fontSize:11, fontWeight:600 }}>Acesso restrito</span>
                </div>
                <h2 style={{ color:'var(--text)', fontSize:23, fontWeight:800, margin:'0 0 6px', letterSpacing:'-.4px' }}>Bem-vindo de volta</h2>
                <p style={{ color:'var(--text2)', fontSize:13, margin:0, lineHeight:1.6 }}>Entre com suas credenciais de acesso.</p>
              </div>
            </BlurFade>

            <BlurFade delay={0.25}>
              <form onSubmit={handleSubmit} style={{ display:'flex', flexDirection:'column', gap:14 }}>
                <div>
                  <label style={{ display:'block', color:'var(--text3)', fontSize:10, fontWeight:700, letterSpacing:'.08em', textTransform:'uppercase', marginBottom:7 }}>USUÁRIO</label>
                  <div style={{ position:'relative' }}>
                    <span style={{ position:'absolute', left:12, top:'50%', transform:'translateY(-50%)', color:'var(--text3)', pointerEvents:'none', display:'flex' }}>
                      <UserIcon />
                    </span>
                    <input
                      type="text" value={username} onChange={e => setUsername(e.target.value)}
                      placeholder="admin" autoFocus required
                      style={{
                        width:'100%', background:'rgba(255,255,255,.04)',
                        border:'1px solid var(--border)',
                        borderRadius:9, padding:'11px 12px 11px 36px',
                        color:'var(--text)', fontSize:14, outline:'none',
                        boxSizing:'border-box', transition:'border-color .18s, box-shadow .18s',
                        fontFamily:'var(--font)',
                      }}
                      onFocus={e => { e.target.style.borderColor='var(--border2)'; e.target.style.boxShadow='var(--glow-sm)'; }}
                      onBlur={e  => { e.target.style.borderColor='var(--border)';  e.target.style.boxShadow='none'; }}
                    />
                  </div>
                </div>

                <div>
                  <label style={{ display:'block', color:'var(--text3)', fontSize:10, fontWeight:700, letterSpacing:'.08em', textTransform:'uppercase', marginBottom:7 }}>SENHA</label>
                  <div style={{ position:'relative' }}>
                    <span style={{ position:'absolute', left:12, top:'50%', transform:'translateY(-50%)', color:'var(--text3)', pointerEvents:'none', display:'flex' }}>
                      <LockIcon />
                    </span>
                    <input
                      type={showPass ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)}
                      placeholder="••••••••" required
                      style={{
                        width:'100%', background:'rgba(255,255,255,.04)',
                        border:'1px solid var(--border)',
                        borderRadius:9, padding:'11px 40px 11px 36px',
                        color:'var(--text)', fontSize:14, outline:'none',
                        boxSizing:'border-box', transition:'border-color .18s, box-shadow .18s',
                        fontFamily:'var(--font)',
                      }}
                      onFocus={e => { e.target.style.borderColor='var(--border2)'; e.target.style.boxShadow='var(--glow-sm)'; }}
                      onBlur={e  => { e.target.style.borderColor='var(--border)';  e.target.style.boxShadow='none'; }}
                    />
                    <button type="button" onClick={() => setShowPass(v => !v)} style={{
                      position:'absolute', right:10, top:'50%', transform:'translateY(-50%)',
                      background:'none', border:'none', cursor:'pointer', color:'var(--text3)', display:'flex', padding:4,
                    }}>
                      <EyeIcon open={showPass} />
                    </button>
                  </div>
                </div>

                <AnimatePresence>
                  {error && (
                    <motion.div
                      initial={{ opacity:0, y:-4 }} animate={{ opacity:1, y:0 }} exit={{ opacity:0, y:-4 }}
                      transition={{ duration:.2 }}
                      style={{
                        background:'rgba(244,63,94,.08)', border:'1px solid rgba(244,63,94,.22)',
                        borderRadius:8, padding:'10px 14px', color:'#f87171', fontSize:13,
                      }}
                    >
                      {error}
                    </motion.div>
                  )}
                </AnimatePresence>

                <motion.button
                  type="submit"
                  disabled={loading}
                  whileHover={loading ? {} : { scale: 1.01, boxShadow: '0 0 28px rgba(0,212,255,.45)' }}
                  whileTap={loading ? {} : { scale: 0.98 }}
                  style={{
                    marginTop:4, padding:'12px 16px', borderRadius:9, border:'none',
                    cursor: loading ? 'not-allowed' : 'pointer',
                    background: 'linear-gradient(135deg, var(--cyan2), var(--cyan))',
                    color:'#040e1c', fontWeight:700, fontSize:14,
                    display:'flex', alignItems:'center', justifyContent:'center', gap:8,
                    opacity: loading ? 0.65 : 1,
                    boxShadow:'0 0 18px rgba(0,212,255,.28)',
                    transition:'opacity .18s',
                    fontFamily:'var(--font)',
                  }}
                >
                  {loading ? (
                    <>
                      <svg style={{ animation:'spin .8s linear infinite' }} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M21 12a9 9 0 11-9-9"/></svg>
                      Entrando...
                    </>
                  ) : (
                    <>
                      Entrar
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
                    </>
                  )}
                </motion.button>
              </form>
            </BlurFade>

            <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:6, marginTop:20 }}>
              <div style={{ width:6, height:6, background:'var(--green)', borderRadius:'50%', boxShadow:'0 0 6px var(--green)' }} />
              <span style={{ color:'var(--text3)', fontSize:12 }}>Conexão segura via HTTPS</span>
            </div>
          </div>
        </div>
      </motion.div>

      {/* Footer legal */}
      <motion.div
        initial={{ opacity:0 }} animate={{ opacity:1 }} transition={{ delay:.5, duration:.4 }}
        style={{ position:'relative', zIndex:1, marginTop:24, textAlign:'center', lineHeight:1.7 }}
      >
        <div style={{ fontSize:11, color:'var(--text3)' }}>
          MouraFlow é um serviço operado por{' '}
          <strong style={{ color:'var(--text2)' }}>67.761.040 VITOR MARCELO MOURA DA SILVA</strong>
        </div>
        <div style={{ fontSize:11, color:'var(--text3)' }}>CNPJ: 67.761.040/0001-27</div>
        <div style={{ marginTop:6, fontSize:11 }}>
          <a href="/termos"     style={{ color:'var(--indigo)', textDecoration:'none' }}>Termos de Uso</a>
          <span style={{ color:'var(--text4)', margin:'0 6px' }}>·</span>
          <a href="/privacidade" style={{ color:'var(--indigo)', textDecoration:'none' }}>Política de Privacidade</a>
          <span style={{ color:'var(--text4)', margin:'0 6px' }}>·</span>
          <a href="mailto:contato@instaflow.pro" style={{ color:'var(--indigo)', textDecoration:'none' }}>Contato</a>
        </div>
      </motion.div>

      <style>{`.login-brand-panel{display:flex!important}@media(max-width:600px){.login-brand-panel{display:none!important}}@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}
