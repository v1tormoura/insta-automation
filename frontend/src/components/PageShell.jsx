import { motion } from 'framer-motion';

/**
 * PageShell — header consistente para todas as páginas.
 *
 * Props:
 *  icon       — elemento React (ícone Lucide)
 *  title      — string, título da página
 *  subtitle   — string, descrição breve
 *  accent     — 'cyan' | 'purple' | 'gold' | 'green' (cor do icon badge)
 *  actions    — ReactNode (botões de ação no canto direito)
 *  children   — conteúdo abaixo do header
 */

const ACCENT = {
  cyan:   { bg:'rgba(0,212,255,.1)',   border:'rgba(0,212,255,.2)',   color:'#00d4ff',  glow:'rgba(0,212,255,.35)'   },
  purple: { bg:'rgba(139,92,246,.1)',  border:'rgba(139,92,246,.2)',  color:'#a78bfa',  glow:'rgba(139,92,246,.35)'  },
  gold:   { bg:'rgba(251,191,36,.1)',  border:'rgba(251,191,36,.2)',  color:'#fbbf24',  glow:'rgba(251,191,36,.35)'  },
  green:  { bg:'rgba(16,185,129,.1)',  border:'rgba(16,185,129,.2)',  color:'#10b981',  glow:'rgba(16,185,129,.35)'  },
  pink:   { bg:'rgba(236,72,153,.1)',  border:'rgba(236,72,153,.2)',  color:'#f472b6',  glow:'rgba(236,72,153,.35)'  },
  orange: { bg:'rgba(249,115,22,.1)',  border:'rgba(249,115,22,.2)',  color:'#fb923c',  glow:'rgba(249,115,22,.35)'  },
};

export default function PageShell({ icon, title, subtitle, accent = 'cyan', actions, children }) {
  const a = ACCENT[accent] || ACCENT.cyan;

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', minHeight:0 }}>
      {/* ── Sticky header ── */}
      <motion.div
        initial={{ opacity:0, y:-8 }}
        animate={{ opacity:1, y:0 }}
        transition={{ duration:.3, ease:[.4,0,.2,1] }}
        style={{
          display:'flex', alignItems:'center', gap:14,
          padding:'14px 22px',
          borderBottom:'1px solid oklch(1 0 0 / 0.06)',
          background:'oklch(0.10 0.03 235 / 0.90)',
          backdropFilter:'blur(20px)',
          WebkitBackdropFilter:'blur(20px)',
          flexShrink:0, position:'sticky', top:0, zIndex:20,
        }}
      >
        {/* icon badge */}
        {icon && (
          <div style={{
            width:36, height:36, borderRadius:10, flexShrink:0,
            background:a.bg, border:`1px solid ${a.border}`,
            display:'flex', alignItems:'center', justifyContent:'center',
            boxShadow:`0 0 16px ${a.glow}`,
          }}>
            {/* clone icon with accent color */}
            <span style={{ color:a.color, display:'flex' }}>{icon}</span>
          </div>
        )}

        {/* title + subtitle */}
        <div style={{ flex:1, minWidth:0 }}>
          <h1 style={{
            fontSize:16, fontWeight:700, color:'var(--text)',
            letterSpacing:'-.3px', lineHeight:1.2,
            whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis',
          }}>{title}</h1>
          {subtitle && (
            <p style={{
              fontFamily:'var(--font-mono)', fontSize:10, color:'var(--text3)',
              marginTop:3, letterSpacing:'.04em',
              whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis',
            }}>{subtitle}</p>
          )}
        </div>

        {/* actions slot */}
        {actions && (
          <div style={{ display:'flex', alignItems:'center', gap:8, flexShrink:0 }}>
            {actions}
          </div>
        )}
      </motion.div>

      {/* ── Page content ── */}
      <div style={{ flex:1, overflow:'auto', padding:'20px 22px', display:'flex', flexDirection:'column', gap:16 }}>
        {children}
      </div>
    </div>
  );
}
