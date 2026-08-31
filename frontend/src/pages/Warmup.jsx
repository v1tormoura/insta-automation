import { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import api from '../services/api';
import PageShell from '../components/PageShell';
import { EsqueletoLista } from '../components/Estados';

/* ─── constants ─────────────────────────────────── */
const DEFAULT_COMMENTS = [
  '🔥🔥🔥','❤️','Incrível!','Muito bom!','👏👏','Perfeito!',
  'Que lindo!','😍','Top demais!','💯','Amei!','👌',
  'Sensacional!','🙌','Maravilhoso!','Show!','💪','Que demais!',
];

const ACTIONS = [
  { value:'likes',        label:'Curtir comentários', icon:'❤️', color:'var(--mf-danger-500)', api:'oficial' },
  { value:'comments',     label:'Responder posts',    icon:'💬', color:'var(--mf-info-500)', api:'oficial' },
  { value:'scroll_reels', label:'Rolar Reels',        icon:'🎬', color:'var(--mf-mod-publicar)', api:'privada' },
  { value:'like_posts',   label:'Curtir Explorar',    icon:'🔍', color:'var(--mf-success-500)', api:'privada' },
];

const INTENSITY = [
  { v:'leve',      label:'Leve',      color:'var(--mf-success-500)', desc:'1–3 ações/ciclo' },
  { v:'medio',     label:'Médio',     color:'var(--mf-warning-500)', desc:'3–6 ações/ciclo' },
  { v:'agressivo', label:'Agressivo', color:'var(--mf-danger-500)', desc:'6–10 ações/ciclo' },
];

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000';
const avatarSrc = av => av ? (av.startsWith('http') ? `${API_BASE}/image-proxy?url=${encodeURIComponent(av)}` : `${API_BASE}${av}`) : null;
const BAD_HEALTH = ['restrita','banida','token_invalido','sessao_expirada','desconectada'];
const LOG_COLOR  = { like:'var(--mf-danger-500)',comment:'var(--mf-info-500)',follow:'var(--mf-success-500)',scroll:'var(--mf-mod-publicar)',cycle_start:'var(--mf-warning-500)',cycle_done:'var(--mf-success-500)',error:'var(--mf-danger-500)' };
const LOG_ICON   = { like:'❤️',comment:'💬',follow:'➕',scroll:'🎬',cycle_start:'🔥',cycle_done:'✅',error:'❌' };

function defaultCfg() {
  return { intensity:'leve', actions:['likes'], intervalMinutes:30, maxDurationHours:2, maxLikes:6, maxComments:2, commentList:DEFAULT_COMMENTS.join('\n') };
}

function fmtNum(v) { const n=Number(v||0); return n>=1e6?(n/1e6).toFixed(1)+'M':n>=1e3?(n/1e3).toFixed(1)+'K':String(n); }

function timeAgo(d) {
  const m=Math.floor((Date.now()-new Date(d).getTime())/60000);
  if(m<1) return 'agora'; if(m<60) return `${m}min`; const h=Math.floor(m/60);
  if(h<24) return `${h}h`; return `${Math.floor(h/24)}d`;
}

function healthMeta(s) {
  if(s==='restrita')        return {label:'Restrita',       color:'var(--mf-warning-500)',bg:'color-mix(in oklch, var(--mf-warning-500) 10%, transparent)'};
  if(s==='banida')          return {label:'Banida',         color:'var(--mf-danger-500)',bg:'color-mix(in oklch, var(--mf-danger-500) 10%, transparent)'};
  if(s==='token_invalido')  return {label:'Token expirado', color:'var(--mf-danger-500)',bg:'color-mix(in oklch, var(--mf-danger-500) 10%, transparent)'};
  if(s==='sessao_expirada') return {label:'Sessão expirada',color:'var(--mf-warning-500)',bg:'color-mix(in oklch, var(--mf-warning-500) 10%, transparent)'};
  if(s==='desconectada')    return {label:'Desconectada',   color:'var(--mf-text-3)',bg:'color-mix(in oklch, var(--mf-text-3) 10%, transparent)'};
  return {label:'Saudável',color:'var(--mf-success-500)',bg:'color-mix(in oklch, var(--mf-success-500) 10%, transparent)'};
}

/* ─── AnimCounter ─────────────────────────────────── */
function useAnimCounter(target, delay=0) {
  const [v,setV]=useState(0);
  useEffect(()=>{
    setV(0);
    const t0=setTimeout(()=>{
      const s0=performance.now(),dur=900;
      const tick=now=>{
        const p=Math.min((now-s0)/dur,1);
        setV(Math.round((1-(1-p)**3)*target));
        if(p<1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    },delay);
    return()=>clearTimeout(t0);
  },[target]);
  return v;
}

/* ─── KpiTile ─────────────────────────────────────── */
function KpiTile({label,value,sub,color,bg,border,delay=0,icon}) {
  return (
    <motion.div initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} transition={{delay,duration:.3,ease:[.22,1,.36,1]}}
      style={{background:bg,border:`1px solid ${border}`,borderRadius: 'var(--mf-r-lg)',padding:'16px 16px',backdropFilter:'blur(12px)'}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:6}}>
        <div style={{fontSize: 'var(--mf-t-display)',fontWeight:800,color,lineHeight:1,fontVariantNumeric:'tabular-nums'}}>{value}</div>
        {icon&&<span style={{fontSize: 'var(--mf-t-h1)',opacity:.8}}>{icon}</span>}
      </div>
      <div style={{fontSize: 'var(--mf-t-nano)',color:'var(--mf-text-3)',fontWeight:700,textTransform:'uppercase',letterSpacing:'.05em'}}>{label}</div>
      {sub&&<div style={{fontSize: 'var(--mf-t-nano)',color:'var(--mf-text-3)',marginTop:3,opacity:.7}}>{sub}</div>}
    </motion.div>
  );
}

/* ─── AccountCard ────────────────────────────────── */
function AccountCard({ account, cfg, expanded, onExpand, onStart, onStop, onOpenLogin, onLogout, updateCfg, toggleAction }) {
  const isActive=account.warmupActive;
  const src=avatarSrc(account.avatar);
  const hlth=healthMeta(account.healthStatus);
  const intCfg=INTENSITY.find(i=>i.v===cfg.intensity)||INTENSITY[0];
  const needsPrivate=cfg.actions?.some(a=>['scroll_reels','like_posts'].includes(a));
  const tokenDaysLeft=account.tokenExpiresAt?Math.ceil((new Date(account.tokenExpiresAt)-Date.now())/86400000):null;
  const tokenExpiry=account.tokenExpiresAt?new Date(account.tokenExpiresAt).toLocaleDateString('pt-BR',{day:'2-digit',month:'short'}):null;

  const labelStyle={fontSize: 'var(--mf-t-nano)',color:'var(--mf-text-3)',fontWeight:700,textTransform:'uppercase',letterSpacing:'.05em',marginBottom:5};
  const inputStyle={width:'100%',boxSizing:'border-box',padding:'8px 12px',borderRadius: 'var(--mf-r-sm)',border:'1px solid var(--border)',background:'var(--bg3)',color:'var(--mf-text)',fontSize: 'var(--mf-t-xs)'};

  return (
    <motion.div
      initial={{opacity:0,y:12}} animate={{opacity:1,y:0}}
      transition={{duration:.3,ease:[.22,1,.36,1]}}
      style={{
        borderRadius: 'var(--mf-r-xl)',overflow:'hidden',
        border:`1px solid ${isActive?'color-mix(in oklch, var(--mf-success-500) 35%, transparent)':'oklch(1 0 0/0.08)'}`,
        background:'var(--bg2)',
        boxShadow: isActive
          ? '0 0 0 1px color-mix(in oklch, var(--mf-success-500) 8%, transparent),0 8px 40px color-mix(in oklch, var(--mf-success-500) 10%, transparent)'
          : '0 2px 12px rgba(0,0,0,.06)',
        transition:'border-color .3s,box-shadow .3s',
      }}
    >
      {/* Active top bar */}
      {isActive&&(
        <div style={{height:3,background:'linear-gradient(90deg,var(--mf-success-500),var(--mf-success-500),var(--mf-success-500))',backgroundSize:'200% 100%',animation:'wm-slide 2.5s linear infinite'}}/>
      )}

      {/* ── Main row ── */}
      <div style={{padding:'16px 16px 12px'}}>
        <div style={{display:'flex',gap:16,alignItems:'flex-start',flexWrap:'wrap'}}>

          {/* Avatar */}
          <div style={{position:'relative',flexShrink:0}}>
            <div style={{
              width:80,height:80,borderRadius: 'var(--mf-r-full)',overflow:'hidden',
              border:`2.5px solid ${isActive?'var(--mf-success-500)':'oklch(1 0 0/0.1)'}`,
              background:'var(--bg3)',
              boxShadow: isActive?'0 0 0 5px color-mix(in oklch, var(--mf-success-500) 8%, transparent),0 0 20px color-mix(in oklch, var(--mf-success-500) 20%, transparent)':'none',
              transition:'all .3s',
            }}>
              {src
                ?<img src={src} alt="" style={{width:'100%',height:'100%',objectFit:'cover'}} onError={e=>{e.target.style.display='none';}}/>
                :<div style={{width:'100%',height:'100%',display:'flex',alignItems:'center',justifyContent:'center',fontWeight:900,fontSize: 'var(--mf-t-display)',color:'var(--mf-mod, var(--mf-accent-500))'}}>{account.username?.[0]?.toUpperCase()}</div>
              }
            </div>
            {/* Online dot */}
            <div style={{
              position:'absolute',bottom:4,right:4,width:16,height:16,borderRadius: 'var(--mf-r-full)',
              background:isActive?'var(--mf-success-500)':'var(--mf-border-strong)',
              border:'2.5px solid var(--bg2)',
              boxShadow:isActive?'0 0 0 3px color-mix(in oklch, var(--mf-success-500) 12%, transparent),0 0 8px color-mix(in oklch, var(--mf-success-500) 40%, transparent)':'none',
              transition:'all .25s',
            }}/>
          </div>

          {/* Info */}
          <div style={{flex:1,minWidth:0}}>
            <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap',marginBottom:6}}>
              <span style={{fontWeight:800,fontSize: 'var(--mf-t-h2)',color:'var(--mf-text)',letterSpacing:-.3}}>@{account.username}</span>
              {isActive&&(
                <span style={{display:'inline-flex',alignItems:'center',gap:4,padding:'2px 8px',borderRadius: 'var(--mf-r-xl)',background:'color-mix(in oklch, var(--mf-success-500) 10%, transparent)',border:'1px solid color-mix(in oklch, var(--mf-success-500) 25%, transparent)',fontSize: 'var(--mf-t-nano)',color:'var(--mf-success-500)',fontWeight:700}}>
                  <span style={{width:5,height:5,borderRadius: 'var(--mf-r-full)',background:'var(--mf-success-500)',display:'inline-block',animation:'wm-pulse 1.4s infinite'}}/>
                  🔥 {intCfg.label}
                </span>
              )}
              <span style={{padding:'2px 8px',borderRadius: 'var(--mf-r-xl)',fontSize: 'var(--mf-t-nano)',fontWeight:700,color:hlth.color,background:hlth.bg,border:`1px solid ${hlth.color}30`}}>
                ● {hlth.label}
              </span>
              {account.hasSession&&(
                <span style={{padding:'2px 8px',borderRadius: 'var(--mf-r-xl)',fontSize: 'var(--mf-t-nano)',fontWeight:700,color:'var(--mf-mod-publicar)',background:'color-mix(in oklch, var(--mf-mod-publicar) 10%, transparent)',border:'1px solid color-mix(in oklch, var(--mf-mod-publicar) 25%, transparent)'}}>
                  🔐 API Privada
                </span>
              )}
            </div>
            {account.name&&account.name!==account.username&&(
              <div style={{fontSize: 'var(--mf-t-xs)',color:'var(--mf-text-3)',marginBottom:8}}>{account.name}</div>
            )}

            {/* Stats */}
            <div style={{display:'flex',maxWidth:'100%',borderRadius: 'var(--mf-r-md)',overflow:'hidden',background:'var(--bg3)',border:'1px solid var(--border)',marginBottom:10}}>
              {[
                {label:'Seguid.',value:account.followers},
                {label:'Seguindo',value:account.following},
                {label:'Posts',value:account.postsCount},
              ].map((s,i)=>(
                <div key={s.label} style={{padding:'8px 12px',textAlign:'center',borderRight:i<2?'1px solid var(--border)':'none'}}>
                  <div style={{fontWeight:700,fontSize: 'var(--mf-t-sm)',color:'var(--mf-text)',fontVariantNumeric:'tabular-nums'}}>{fmtNum(s.value)}</div>
                  <div style={{fontSize: 'var(--mf-t-nano)',color:'var(--mf-text-3)',textTransform:'uppercase',letterSpacing:'.04em',marginTop:1}}>{s.label}</div>
                </div>
              ))}
            </div>

            {/* Active actions row */}
            {isActive&&cfg.actions?.length>0&&(
              <div style={{display:'flex',gap:5,flexWrap:'wrap',alignItems:'center'}}>
                {cfg.actions.map(a=>{
                  const ac=ACTIONS.find(x=>x.value===a);
                  return ac?(
                    <span key={a} style={{fontSize: 'var(--mf-t-nano)',fontWeight:700,padding:'2px 8px',borderRadius: 'var(--mf-r-xl)',background:`${ac.color}14`,color:ac.color,border:`1px solid ${ac.color}25`}}>
                      {ac.icon} {ac.label}
                    </span>
                  ):null;
                })}
                <span style={{fontSize: 'var(--mf-t-nano)',color:'var(--mf-text-3)',marginLeft:4}}>⏱ {cfg.intervalMinutes}min</span>
              </div>
            )}

            {/* Token expiry */}
            {tokenExpiry&&(
              <div style={{display:'flex',alignItems:'center',gap:5,marginTop:8,fontSize: 'var(--mf-t-micro)',color:tokenDaysLeft<7?'var(--mf-warning-500)':'var(--mf-text-3)'}}>
                🔑 Token {tokenExpiry}
                {tokenDaysLeft<30&&<span style={{fontWeight:700,color:tokenDaysLeft<7?'var(--mf-danger-500)':'var(--mf-warning-500)'}}>{tokenDaysLeft<0?'· EXPIRADO':`· ${tokenDaysLeft}d`}</span>}
              </div>
            )}
          </div>

          {/* Buttons */}
          <div style={{display:'flex',flexDirection:'column',gap:7,flexShrink:0}}>
            {isActive?(
              <motion.button whileHover={{scale:1.03}} whileTap={{scale:.97}} onClick={()=>onStop(account._id)} style={{
                padding:'8px 12px',borderRadius: 'var(--mf-r-md)',cursor:'pointer',whiteSpace:'nowrap',
                background:'color-mix(in oklch, var(--mf-danger-500) 10%, transparent)',color:'var(--mf-danger-500)',fontWeight:700,fontSize: 'var(--mf-t-xs)',
                border:'1px solid color-mix(in oklch, var(--mf-danger-500) 30%, transparent)',
                transition:'box-shadow .15s',
              }}
                onMouseEnter={e=>e.currentTarget.style.boxShadow='0 0 14px color-mix(in oklch, var(--mf-danger-500) 20%, transparent)'}
                onMouseLeave={e=>e.currentTarget.style.boxShadow='none'}
              >⏹ Parar</motion.button>
            ):(
              <motion.button whileHover={{scale:1.03}} whileTap={{scale:.97}} onClick={()=>onStart(account._id)} style={{
                padding:'8px 12px',borderRadius: 'var(--mf-r-md)',cursor:'pointer',whiteSpace:'nowrap',
                background:'linear-gradient(135deg,color-mix(in oklch, var(--mf-success-500) 15%, transparent),rgba(22,163,74,.08))',
                color:'var(--mf-success-500)',fontWeight:700,fontSize: 'var(--mf-t-xs)',
                border:'1px solid color-mix(in oklch, var(--mf-success-500) 40%, transparent)',
                transition:'box-shadow .15s',
              }}
                onMouseEnter={e=>e.currentTarget.style.boxShadow='0 0 16px color-mix(in oklch, var(--mf-success-500) 20%, transparent)'}
                onMouseLeave={e=>e.currentTarget.style.boxShadow='none'}
              >🔥 Iniciar</motion.button>
            )}
            <motion.button whileHover={{scale:1.03}} whileTap={{scale:.97}} onClick={()=>onExpand()} style={{
              padding:'8px 12px',borderRadius: 'var(--mf-r-md)',border:'1px solid var(--border)',
              background:'var(--bg3)',color:'var(--mf-text-3)',cursor:'pointer',fontSize: 'var(--mf-t-micro)',fontWeight:600,
              transition:'all .15s',
            }}>
              {expanded?'▲ Fechar':'⚙ Config'}
            </motion.button>
          </div>
        </div>
      </div>

      {/* ── Config panel ── */}
      <AnimatePresence>
        {expanded&&(
          <motion.div
            initial={{height:0,opacity:0}} animate={{height:'auto',opacity:1}} exit={{height:0,opacity:0}}
            transition={{duration:.22,ease:[.22,1,.36,1]}}
            style={{overflow:'hidden'}}
          >
            <div style={{borderTop:'1px solid oklch(1 0 0/0.07)',padding:'16px 16px',display:'flex',flexDirection:'column',gap:14}}>

              {/* API badges */}
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
                <div style={{borderRadius: 'var(--mf-r-md)',padding:'8px 12px',border:'1px solid color-mix(in oklch, var(--mf-primary-500) 20%, transparent)',background:'color-mix(in oklch, var(--mf-primary-500) 5%, transparent)',display:'flex',alignItems:'center',gap:8}}>
                  <span style={{fontSize: 'var(--mf-t-body)'}}>🔗</span>
                  <div>
                    <div style={{fontSize: 'var(--mf-t-micro)',fontWeight:700,color:'var(--mf-primary-300)'}}>API Oficial</div>
                    <div style={{fontSize: 'var(--mf-t-nano)',color:'var(--mf-text-3)',marginTop:1}}>Sem senha adicional</div>
                  </div>
                </div>
                <div style={{borderRadius: 'var(--mf-r-md)',padding:'8px 12px',border:`1px solid ${account.hasSession?'color-mix(in oklch, var(--mf-success-500) 20%, transparent)':'color-mix(in oklch, var(--mf-mod-publicar) 20%, transparent)'}`,background:account.hasSession?'color-mix(in oklch, var(--mf-success-500) 5%, transparent)':'color-mix(in oklch, var(--mf-mod-publicar) 5%, transparent)',display:'flex',alignItems:'center',gap:8}}>
                  <span style={{fontSize: 'var(--mf-t-body)'}}>{account.hasSession?'✅':'🔐'}</span>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize: 'var(--mf-t-micro)',fontWeight:700,color:account.hasSession?'var(--mf-success-500)':'var(--mf-mod-publicar)'}}>{account.hasSession?'Sessão ativa':'API Privada'}</div>
                    <div style={{fontSize: 'var(--mf-t-nano)',color:'var(--mf-text-3)',marginTop:1}}>Reels e Explorar</div>
                  </div>
                  {account.hasSession?(
                    <button onClick={()=>onLogout(account._id)} style={{fontSize: 'var(--mf-t-nano)',padding:'2px 8px',borderRadius: 'var(--mf-r-xs)',border:'1px solid color-mix(in oklch, var(--mf-danger-500) 25%, transparent)',background:'color-mix(in oklch, var(--mf-danger-500) 7%, transparent)',color:'var(--mf-danger-500)',cursor:'pointer',flexShrink:0}}>Sair</button>
                  ):(
                    <button onClick={()=>onOpenLogin({accountId:account._id,username:account.username})} style={{fontSize: 'var(--mf-t-nano)',padding:'2px 8px',borderRadius: 'var(--mf-r-xs)',border:'1px solid color-mix(in oklch, var(--mf-mod-publicar) 25%, transparent)',background:'color-mix(in oklch, var(--mf-mod-publicar) 10%, transparent)',color:'var(--mf-mod-publicar)',cursor:'pointer',flexShrink:0}}>Login</button>
                  )}
                </div>
              </div>

              {/* Intensity */}
              <div>
                <div style={labelStyle}>Intensidade</div>
                <div style={{display:'flex',gap:6}}>
                  {INTENSITY.map(({v,label,color,desc})=>(
                    <button key={v} onClick={()=>updateCfg(account._id,'intensity',v)} title={desc} style={{
                      flex:1,padding:'8px 0',borderRadius: 'var(--mf-r-sm)',cursor:'pointer',fontWeight:700,fontSize: 'var(--mf-t-micro)',
                      border:`1px solid ${cfg.intensity===v?color:'var(--border)'}`,
                      background:cfg.intensity===v?`${color}18`:'var(--bg3)',
                      color:cfg.intensity===v?color:'var(--mf-text-3)',
                      transition:'all .15s',
                    }}>{label}</button>
                  ))}
                </div>
                <div style={{fontSize: 'var(--mf-t-nano)',color:'var(--mf-text-3)',marginTop:4}}>{INTENSITY.find(i=>i.v===cfg.intensity)?.desc}</div>
              </div>

              {/* Actions */}
              <div>
                <div style={labelStyle}>Ações</div>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:6}}>
                  {ACTIONS.map(a=>{
                    const on=cfg.actions?.includes(a.value);
                    const noSession=a.api==='privada'&&!account.hasSession;
                    return (
                      <button key={a.value} onClick={()=>toggleAction(account._id,a.value)} style={{
                        padding:'8px 8px',borderRadius: 'var(--mf-r-sm)',cursor:'pointer',fontWeight:700,fontSize: 'var(--mf-t-micro)',
                        background:on?`${a.color}18`:'var(--bg3)',
                        color:on?a.color:'var(--mf-text-3)',
                        border:`1px solid ${on?a.color:'var(--border)'}`,
                        transition:'all .15s',textAlign:'left',
                        display:'flex',alignItems:'center',gap:7,
                      }}>
                        <span style={{fontSize: 'var(--mf-t-sm)'}}>{a.icon}</span>
                        <div>
                          <div>{a.label}</div>
                          <div style={{fontSize: 'var(--mf-t-nano)',fontWeight:400,color:noSession&&on?'var(--mf-warning-500)':'var(--mf-text-3)',opacity:.8}}>
                            {a.api==='privada'?(noSession?'⚠ requer sessão':'✓ sessão ativa'):'API Oficial'}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
                {needsPrivate&&!account.hasSession&&(
                  <div style={{marginTop:8,padding:'8px 12px',borderRadius: 'var(--mf-r-sm)',background:'color-mix(in oklch, var(--mf-warning-500) 7%, transparent)',border:'1px solid color-mix(in oklch, var(--mf-warning-500) 22%, transparent)',fontSize: 'var(--mf-t-nano)',color:'var(--mf-warning-500)'}}>
                    ⚠ Clique em <strong>Login</strong> acima para ativar as ações de API Privada.
                  </div>
                )}
              </div>

              {/* Limits */}
              <div style={{display:'flex',gap:10}}>
                {cfg.actions?.includes('likes')&&(
                  <div style={{flex:1}}>
                    <div style={labelStyle}>Max curtidas</div>
                    <input type="number" min={1} max={100} value={cfg.maxLikes} onChange={e=>updateCfg(account._id,'maxLikes',Number(e.target.value))} style={inputStyle}/>
                  </div>
                )}
                {cfg.actions?.includes('comments')&&(
                  <div style={{flex:1}}>
                    <div style={labelStyle}>Max comentários</div>
                    <input type="number" min={1} max={50} value={cfg.maxComments} onChange={e=>updateCfg(account._id,'maxComments',Number(e.target.value))} style={inputStyle}/>
                  </div>
                )}
              </div>

              {/* Comment list */}
              {cfg.actions?.includes('comments')&&(
                <div>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:5}}>
                    <div style={labelStyle}>Comentários (um por linha)</div>
                    <span style={{fontSize: 'var(--mf-t-nano)',color:'var(--mf-mod, var(--mf-accent-500))',fontWeight:600}}>{cfg.commentList.split('\n').filter(s=>s.trim()).length} cadastrados</span>
                  </div>
                  <textarea value={cfg.commentList} onChange={e=>updateCfg(account._id,'commentList',e.target.value)} rows={5}
                    style={{...inputStyle,resize:'vertical',fontFamily:'inherit',lineHeight:1.5,fontSize: 'var(--mf-t-xs)'}}/>
                </div>
              )}

              {/* Interval */}
              <div>
                <div style={{...labelStyle,marginBottom:8}}>
                  Intervalo: <span style={{color:'var(--mf-mod, var(--mf-accent-500))',fontWeight:800}}>{cfg.intervalMinutes} min</span>
                </div>
                <input type="range" min={10} max={120} step={5} value={cfg.intervalMinutes}
                  onChange={e=>updateCfg(account._id,'intervalMinutes',Number(e.target.value))}
                  style={{width:'100%',accentColor:'var(--mf-mod, var(--mf-accent-500))'}}/>
                <div style={{display:'flex',justifyContent:'space-between',fontSize: 'var(--mf-t-nano)',color:'var(--mf-text-3)',marginTop:2}}>
                  <span>10 min</span><span>120 min</span>
                </div>
              </div>

              {/* Duration */}
              <div>
                <div style={{...labelStyle,marginBottom:8}}>
                  Duração máxima: <span style={{color:cfg.maxDurationHours===0?'var(--mf-warning-500)':'var(--mf-mod, var(--mf-accent-500))',fontWeight:800}}>
                    {cfg.maxDurationHours===0?'Sem limite':`${cfg.maxDurationHours}h`}
                  </span>
                </div>
                <input type="range" min={0} max={12} step={1} value={cfg.maxDurationHours}
                  onChange={e=>updateCfg(account._id,'maxDurationHours',Number(e.target.value))}
                  style={{width:'100%',accentColor:cfg.maxDurationHours===0?'var(--mf-warning-500)':'var(--mf-mod, var(--mf-accent-500))'}}/>
                <div style={{display:'flex',justifyContent:'space-between',fontSize: 'var(--mf-t-nano)',color:'var(--mf-text-3)',marginTop:2}}>
                  <span>Sem limite</span><span>12h</span>
                </div>
              </div>

              {/* CTA */}
              <motion.button whileHover={{scale:1.01}} whileTap={{scale:.99}} onClick={()=>onStart(account._id)} style={{
                width:'100%',padding:'12px 0',borderRadius: 'var(--mf-r-md)',border:'none',cursor:'pointer',
                background:account.warmupActive?'linear-gradient(135deg,var(--mf-warning-500),#d97706)':'linear-gradient(135deg,var(--mf-success-500),var(--mf-success-500))',
                color:'var(--mf-text)',fontWeight:700,fontSize: 'var(--mf-t-sm)',
                boxShadow:account.warmupActive?'0 4px 18px color-mix(in oklch, var(--mf-warning-500) 25%, transparent)':'0 4px 18px color-mix(in oklch, var(--mf-success-500) 25%, transparent)',
              }}>
                {account.warmupActive?'🔄 Atualizar configuração':'🔥 Iniciar aquecimento'}
              </motion.button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

/* ─── Login Modal ─────────────────────────────────── */
function LoginModal({ loginModal, loginPwd, setLoginPwd, loginBusy, onSubmit, onClose }) {
  return (
    <motion.div
      initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}}
      onClick={e=>e.target===e.currentTarget&&onClose()}
      style={{position:'fixed',inset:0,zIndex:1000,background:'rgba(0,0,0,.65)',backdropFilter:'blur(10px)',display:'flex',alignItems:'center',justifyContent:'center',padding:20}}
    >
      <motion.div
        initial={{scale:.93,y:20,opacity:0}} animate={{scale:1,y:0,opacity:1}} exit={{scale:.93,y:20,opacity:0}}
        transition={{type:'spring',damping:22,stiffness:280}}
        style={{background:'color-mix(in oklch, var(--mf-surface-1) 98%, transparent)',border:'1px solid oklch(0.65 0.18 280/0.3)',borderRadius: 'var(--mf-r-xl)',width:'100%',maxWidth:400,
          /* A largura já cedia. Sem teto de altura, um modal mais alto que
             a tela leva o botão de confirmar para fora do alcance. */
          maxHeight:'calc(100vh - 40px)',overflowY:'auto',boxShadow:'0 32px 80px rgba(0,0,0,.5)'}}
      >
        <div style={{padding:'16px 24px 16px',borderBottom:'1px solid oklch(1 0 0/0.07)',display:'flex',alignItems:'center',gap:12}}>
          <div style={{width:42,height:42,borderRadius: 'var(--mf-r-md)',background:'color-mix(in oklch, var(--mf-mod-publicar) 12%, transparent)',border:'1px solid color-mix(in oklch, var(--mf-mod-publicar) 30%, transparent)',display:'flex',alignItems:'center',justifyContent:'center',fontSize: 'var(--mf-t-h1)',flexShrink:0}}>🔐</div>
          <div>
            <div style={{fontWeight:800,fontSize: 'var(--mf-t-body)',color:'var(--mf-text)'}}>Login API Privada</div>
            <div style={{fontSize: 'var(--mf-t-xs)',color:'var(--mf-text-3)',marginTop:1}}>@{loginModal.username}</div>
          </div>
          <button onClick={onClose} style={{marginLeft:'auto',background:'none',border:'none',color:'var(--mf-text-3)',cursor:'pointer',fontSize: 'var(--mf-t-h1)',lineHeight:1,flexShrink:0}}>×</button>
        </div>
        <div style={{padding:'16px 24px 16px'}}>
          <div style={{padding:'8px 12px',borderRadius: 'var(--mf-r-md)',background:'color-mix(in oklch, var(--mf-warning-500) 7%, transparent)',border:'1px solid color-mix(in oklch, var(--mf-warning-500) 20%, transparent)',fontSize: 'var(--mf-t-micro)',color:'var(--mf-warning-500)',lineHeight:1.6,marginBottom:16}}>
            ⚠ A senha ativa o scroll de reels e curtidas no feed. Recomendado usar 2FA no Instagram.
          </div>
          <label style={{display:'block',fontSize: 'var(--mf-t-nano)',color:'var(--mf-text-3)',fontWeight:700,textTransform:'uppercase',letterSpacing:'.06em',marginBottom:6}}>Senha do Instagram</label>
          <input type="password" value={loginPwd} onChange={e=>setLoginPwd(e.target.value)} onKeyDown={e=>e.key==='Enter'&&onSubmit()} placeholder="Digite a senha..." autoFocus
            style={{width:'100%',boxSizing:'border-box',padding:'12px 12px',borderRadius: 'var(--mf-r-md)',border:'1px solid oklch(0.65 0.18 280/0.3)',background:'var(--mf-bg)',color:'var(--mf-text)',fontSize: 'var(--mf-t-sm)',outline:'none'}}/>
          <div style={{display:'flex',gap:8,marginTop:14}}>
            <button onClick={onClose} style={{flex:1,padding:'8px 0',borderRadius: 'var(--mf-r-md)',border:'1px solid var(--border)',background:'var(--bg3)',color:'var(--mf-text-3)',cursor:'pointer',fontWeight:600,fontSize: 'var(--mf-t-sm)'}}>Cancelar</button>
            <motion.button whileHover={{scale:1.02}} whileTap={{scale:.98}} onClick={onSubmit} disabled={loginBusy||!loginPwd.trim()} style={{
              flex:2,padding:'8px 0',borderRadius: 'var(--mf-r-md)',border:'none',
              background:loginBusy||!loginPwd.trim()?'color-mix(in oklch, var(--mf-mod-publicar) 15%, transparent)':'linear-gradient(135deg,var(--mf-primary-500),var(--mf-mod-publicar))',
              color:loginBusy||!loginPwd.trim()?'color-mix(in oklch, var(--mf-mod-publicar) 40%, transparent)':'var(--mf-text)',
              cursor:loginBusy||!loginPwd.trim()?'not-allowed':'pointer',
              fontWeight:700,fontSize: 'var(--mf-t-sm)',
              display:'flex',alignItems:'center',justifyContent:'center',gap:8,
            }}>
              {loginBusy?(
                <><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{animation:'wm-spin 1s linear infinite'}}><path d="M21 12a9 9 0 11-6.219-8.56"/></svg>Conectando...</>
              ):'🔐 Conectar sessão'}
            </motion.button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

/* ─── Main ───────────────────────────────────────── */
export default function Warmup() {
  const [accounts,   setAccounts]   = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [configs,    setConfigs]    = useState({});
  const [expanded,   setExpanded]   = useState(null);
  const [logs,       setLogs]       = useState([]);
  const [loginModal, setLoginModal] = useState(null);
  const [loginPwd,   setLoginPwd]   = useState('');
  const [loginBusy,  setLoginBusy]  = useState(false);

  const loadLogs = useCallback(async()=>{
    try { const r=await api.get('/warmup/logs',{params:{limit:80}}); setLogs(r.data||[]); } catch {}
  },[]);

  async function load() {
    try {
      const res=await api.get('/warmup');
      const data=res.data;
      setAccounts(data);
      const cfgs={};
      data.forEach(a=>{
        cfgs[a._id]={
          intensity:a.warmupIntensity||'leve',
          actions:a.warmupActions?.length?a.warmupActions:['likes'],
          intervalMinutes:a.warmupInterval||30,
          maxDurationHours:a.warmupMaxDuration??2,
          maxLikes:a.warmupMaxLikes||6,
          maxComments:a.warmupMaxComments||2,
          commentList:(a.warmupComments?.length?a.warmupComments:DEFAULT_COMMENTS).join('\n'),
        };
      });
      setConfigs(cfgs);
    } catch(err){console.error(err);}
    finally{setLoading(false);}
  }

  useEffect(()=>{
    load(); loadLogs();
    const t=setInterval(loadLogs,10000);
    return()=>clearInterval(t);
  },[loadLogs]);

  function updateCfg(id,key,value){ setConfigs(prev=>({...prev,[id]:{...prev[id],[key]:value}})); }
  function toggleAction(id,action){
    const cur=configs[id]?.actions||[];
    updateCfg(id,'actions',cur.includes(action)?cur.filter(a=>a!==action):[...cur,action]);
  }

  async function startWarmup(id){
    const cfg=configs[id]; if(!cfg?.actions?.length) return toast.warning('Selecione ao menos uma ação.');
    const comments=cfg.commentList.split('\n').map(s=>s.trim()).filter(Boolean);
    try{ await api.post(`/warmup/${id}/start`,{...cfg,commentList:comments,maxDurationHours:cfg.maxDurationHours||0}); toast.success('Aquecimento iniciado!'); load(); loadLogs(); }
    catch(err){ toast.error(err.response?.data?.error||err.message); }
  }

  async function stopWarmup(id){
    try{ await api.post(`/warmup/${id}/stop`); toast.success('Aquecimento pausado.'); load(); }
    catch(err){ toast.error(err.response?.data?.error||err.message); }
  }

  async function handlePrivateLogin(){
    if(!loginPwd.trim()) return toast.warning('Digite a senha.');
    setLoginBusy(true);
    try{
      await api.post(`/warmup/${loginModal.accountId}/login`,{password:loginPwd});
      toast.success(`Sessão ativa para @${loginModal.username}!`);
      setLoginModal(null); setLoginPwd(''); load();
    }catch(err){ toast.error(err.response?.data?.error||'Falha ao conectar.'); }
    finally{ setLoginBusy(false); }
  }

  async function handleLogout(id){
    try{ await api.post(`/warmup/${id}/logout`); toast.success('Sessão desconectada.'); load(); }catch{}
  }

  const activeCount  = accounts.filter(a=>a.warmupActive).length;
  const healthyCount = accounts.filter(a=>!BAD_HEALTH.includes(a.healthStatus)).length;
  const totalLogs    = logs.length;

  const n0=useAnimCounter(accounts.length,0);
  const n1=useAnimCounter(activeCount,60);
  const n2=useAnimCounter(healthyCount,120);
  const n3=useAnimCounter(totalLogs,80);

  const pageIcon=(
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8.5 14.5A2.5 2.5 0 0011 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 11-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 002.5 2.5z"/>
    </svg>
  );

  const pageActions=(
    <>
      {activeCount>0&&(
        <span style={{display:'inline-flex',alignItems:'center',gap:5,padding:'4px 8px',borderRadius: 'var(--mf-r-sm)',background:'color-mix(in oklch, var(--mf-success-500) 8%, transparent)',border:'1px solid color-mix(in oklch, var(--mf-success-500) 20%, transparent)',fontSize: 'var(--mf-t-micro)',color:'var(--mf-success-500)',fontWeight:700,fontFamily:'var(--mf-mono)'}}>
          <span style={{width:6,height:6,borderRadius: 'var(--mf-r-full)',background:'var(--mf-success-500)',display:'inline-block',animation:'wm-pulse 1.5s infinite'}}/>
          {activeCount} aquecendo
        </span>
      )}
      <button onClick={()=>{load();loadLogs();}} className="btn-ghost" style={{display:'flex',alignItems:'center',gap:6,padding:'8px 12px',borderRadius: 'var(--mf-r-sm)',fontSize: 'var(--mf-t-sm)'}}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0118.8-4.3M22 12.5a10 10 0 01-18.8 4.2"/></svg>
        Atualizar
      </button>
    </>
  );

  if(loading) return (
    <PageShell icon={pageIcon} title="Aquecimento de Contas" subtitle="Centro de controle de aquecimento orgânico" accent="green">
      <div style={{display:'flex',flexDirection:'column',gap:14}}>
        {[1,2,3].map(i=><div key={i} style={{height:140,borderRadius: 'var(--mf-r-xl)',background:'color-mix(in oklch, var(--mf-surface-1) 50%, transparent)',animation:'wm-pulse-bg 1.6s ease-in-out infinite'}}/>)}
      </div>
    </PageShell>
  );

  return (
    <PageShell icon={pageIcon} title="Aquecimento de Contas" subtitle="Centro de controle de aquecimento orgânico para evitar shadowban" accent="green" actions={pageActions}>
      <style>{`
        @keyframes wm-pulse{0%,100%{opacity:1}50%{opacity:.35}}
        @keyframes wm-pulse-bg{0%,100%{opacity:.5}50%{opacity:.25}}
        @keyframes wm-spin{to{transform:rotate(360deg)}}
        @keyframes wm-slide{0%{background-position:0% 0}100%{background-position:200% 0}}
      `}</style>

      {/* ── KPI row ── */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))',gap:10,marginBottom:20}}>
        <KpiTile label="Total contas"    value={n0} color="var(--mf-text)"  bg="color-mix(in oklch, var(--mf-surface-1) 50%, transparent)" border="oklch(1 0 0/0.08)" delay={0}    icon="📱"/>
        <KpiTile label="Aquecendo"       value={n1} color="var(--mf-success-500)"      bg="color-mix(in oklch, var(--mf-success-500) 6%, transparent)"       border="color-mix(in oklch, var(--mf-success-500) 20%, transparent)" delay={.05}  icon="🔥" sub={activeCount>0?accounts.filter(a=>a.warmupActive).map(a=>`@${a.username}`).join(', '):undefined}/>
        <KpiTile label="Contas saudáveis"value={n2} color="var(--mf-mod, var(--mf-accent-500))"  bg="color-mix(in oklch, var(--mf-surface-1) 50%, transparent)" border="color-mix(in oklch, var(--mf-mod-contas) 15%, transparent)" delay={.1}  icon="✅"/>
        <KpiTile label="Ações no log"    value={n3} color="var(--mf-mod-publicar)"      bg="color-mix(in oklch, var(--mf-mod-publicar) 6%, transparent)"     border="color-mix(in oklch, var(--mf-mod-publicar) 15%, transparent)" delay={.15} icon="📋"/>
      </div>

      {/* ── Status banner ── */}
      {accounts.length>0&&(
        <motion.div initial={{opacity:0,y:6}} animate={{opacity:1,y:0}} transition={{delay:.2,duration:.3}}
          style={{
            marginBottom:20,padding:'12px 16px',borderRadius: 'var(--mf-r-lg)',
            background:activeCount>0?'color-mix(in oklch, var(--mf-success-500) 6%, transparent)':'color-mix(in oklch, var(--mf-surface-1) 60%, transparent)',
            border:`1px solid ${activeCount>0?'color-mix(in oklch, var(--mf-success-500) 25%, transparent)':'oklch(1 0 0/0.07)'}`,
            display:'flex',alignItems:'center',gap:14,backdropFilter:'blur(12px)',
          }}
        >
          <div style={{fontSize: 'var(--mf-t-display)',flexShrink:0}}>{activeCount>0?'🔥':'💤'}</div>
          <div style={{flex:1}}>
            <div style={{fontWeight:700,fontSize: 'var(--mf-t-body)',color:activeCount>0?'var(--mf-success-500)':'var(--mf-text)',marginBottom:2}}>
              {activeCount>0?`${activeCount} conta${activeCount>1?'s':''} aquecendo agora`:'Nenhuma conta em aquecimento'}
            </div>
            <div style={{fontSize: 'var(--mf-t-xs)',color:'var(--mf-text-3)'}}>
              {activeCount>0
                ?`Ações orgânicas ativas · logs atualizando a cada 10s`
                :'Inicie o aquecimento para evitar shadowban e melhorar o alcance'}
            </div>
          </div>
          {activeCount>0&&<span style={{display:'inline-flex',alignItems:'center',gap:5,fontSize: 'var(--mf-t-micro)',color:'var(--mf-success-500)',fontWeight:700}}><span style={{width:7,height:7,borderRadius: 'var(--mf-r-full)',background:'var(--mf-success-500)',boxShadow:'0 0 8px var(--mf-success-500)',display:'inline-block',animation:'wm-pulse 1.4s infinite'}}/>ATIVO</span>}
        </motion.div>
      )}

      {/* ── Account cards ── */}
      {loading?(
        <EsqueletoLista itens={4} />
      ):accounts.length===0?(
        <div style={{textAlign:'center',padding:'60px 0',color:'var(--mf-text-3)'}}>Nenhuma conta. Adicione contas primeiro.</div>
      ):(
        <div style={{display:'flex',flexDirection:'column',gap:12}}>
          {accounts.map(account=>(
            <AccountCard
              key={account._id}
              account={account}
              cfg={configs[account._id]||defaultCfg()}
              expanded={expanded===account._id}
              onExpand={()=>setExpanded(expanded===account._id?null:account._id)}
              onStart={startWarmup}
              onStop={stopWarmup}
              onOpenLogin={m=>{setLoginModal(m);setLoginPwd('');}}
              onLogout={handleLogout}
              updateCfg={updateCfg}
              toggleAction={toggleAction}
            />
          ))}
        </div>
      )}

      {/* ── Tips ── */}
      {accounts.length>0&&(
        <motion.div initial={{opacity:0}} animate={{opacity:1}} transition={{delay:.4}}
          style={{marginTop:16,padding:'12px 16px',borderRadius: 'var(--mf-r-lg)',background:'color-mix(in oklch, var(--mf-surface-1) 60%, transparent)',border:'1px solid oklch(1 0 0/0.07)',display:'flex',gap:12,backdropFilter:'blur(12px)'}}>
          <span style={{fontSize: 'var(--mf-t-h1)',flexShrink:0}}>💡</span>
          <div style={{fontSize: 'var(--mf-t-xs)',color:'var(--mf-text-2)',lineHeight:1.7}}>
            <strong>Leve</strong> para contas novas · <strong>Médio</strong> para contas estabelecidas · <strong>Agressivo</strong> apenas para contas experientes.
            API Privada (Reels e Explorar) requer login com senha e simula navegação orgânica no app.
          </div>
        </motion.div>
      )}

      {/* ── Activity log ── */}
      <div style={{marginTop:20,background:'color-mix(in oklch, var(--mf-surface-1) 90%, transparent)',border:'1px solid oklch(1 0 0/0.08)',borderRadius: 'var(--mf-r-xl)',overflow:'hidden',backdropFilter:'blur(20px)'}}>
        <div style={{padding:'12px 16px',borderBottom:'1px solid oklch(1 0 0/0.07)',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
          <div style={{display:'flex',alignItems:'center',gap:9}}>
            <span style={{fontWeight:700,fontSize: 'var(--mf-t-body)',color:'var(--mf-text)'}}>Log de Atividade</span>
            {logs.length>0&&<span style={{fontSize: 'var(--mf-t-micro)',fontWeight:700,padding:'2px 8px',borderRadius: 'var(--mf-r-xl)',background:'color-mix(in oklch, var(--mf-bg) 60%, transparent)',color:'var(--mf-text-3)',fontFamily:'var(--mf-mono)'}}>{logs.length}</span>}
            {activeCount>0&&(
              <span style={{display:'inline-flex',alignItems:'center',gap:4,fontSize: 'var(--mf-t-nano)',color:'var(--mf-success-500)',fontWeight:700}}>
                <span style={{width:5,height:5,borderRadius: 'var(--mf-r-full)',background:'var(--mf-success-500)',display:'inline-block',animation:'wm-pulse 1.5s infinite'}}/>
                10s
              </span>
            )}
          </div>
          <button onClick={loadLogs} className="btn-ghost" style={{fontSize: 'var(--mf-t-micro)',padding:'4px 8px',borderRadius: 'var(--mf-r-sm)'}}>↺</button>
        </div>

        {logs.length===0?(
          <div style={{padding:'32px 16px',textAlign:'center',color:'var(--mf-text-3)',fontSize: 'var(--mf-t-sm)'}}>
            <div style={{fontSize: 'var(--mf-t-display)',marginBottom:10,opacity:.5}}>🔥</div>
            Nenhuma ação registrada. Inicie o aquecimento para ver os logs.
          </div>
        ):(
          <div style={{maxHeight:500,overflowY:'auto'}}>
            {logs.map((entry,i)=>(
              <motion.div key={entry._id||i}
                initial={{opacity:0,x:-6}} animate={{opacity:1,x:0}}
                transition={{delay:Math.min(i*0.02,0.3),duration:.2}}
                style={{
                  padding:'8px 16px',
                  borderBottom:i<logs.length-1?'1px solid oklch(1 0 0/0.05)':'none',
                  display:'flex',alignItems:'flex-start',gap:12,
                  background:entry.status==='error'?'color-mix(in oklch, var(--mf-danger-500) 3%, transparent)':'transparent',
                  transition:'background .15s',
                }}
                onMouseEnter={e=>e.currentTarget.style.background=entry.status==='error'?'color-mix(in oklch, var(--mf-danger-500) 6%, transparent)':'color-mix(in oklch, var(--mf-bg) 30%, transparent)'}
                onMouseLeave={e=>e.currentTarget.style.background=entry.status==='error'?'color-mix(in oklch, var(--mf-danger-500) 3%, transparent)':'transparent'}
              >
                {/* Icon */}
                <div style={{width:30,height:30,borderRadius: 'var(--mf-r-full)',flexShrink:0,display:'flex',alignItems:'center',justifyContent:'center',background:`${LOG_COLOR[entry.action]||'var(--mf-text-3)'}14`,fontSize: 'var(--mf-t-sm)'}}>
                  {LOG_ICON[entry.action]||'•'}
                </div>
                {/* Content */}
                <div style={{flex:1,minWidth:0}}>
                  <div style={{display:'flex',alignItems:'center',gap:7,flexWrap:'wrap'}}>
                    <span style={{fontSize: 'var(--mf-t-micro)',fontWeight:700,color:'var(--mf-mod, var(--mf-accent-500))',flexShrink:0}}>@{entry.username}</span>
                    <span style={{fontSize: 'var(--mf-t-xs)',color:entry.status==='error'?'var(--mf-danger-500)':'var(--mf-text)',lineHeight:1.4}}>{entry.detail}</span>
                  </div>
                  {entry.targetUser&&<div style={{fontSize: 'var(--mf-t-nano)',color:'var(--mf-text-3)',marginTop:2}}>→ @{entry.targetUser}</div>}
                </div>
                {/* Time */}
                <div style={{flexShrink:0,fontSize: 'var(--mf-t-nano)',color:'var(--mf-text-3)',fontFamily:'var(--mf-mono)',whiteSpace:'nowrap'}}>{timeAgo(entry.createdAt)}</div>
              </motion.div>
            ))}
          </div>
        )}
      </div>

      {/* ── Login Modal ── */}
      <AnimatePresence>
        {loginModal&&(
          <LoginModal
            loginModal={loginModal}
            loginPwd={loginPwd}
            setLoginPwd={setLoginPwd}
            loginBusy={loginBusy}
            onSubmit={handlePrivateLogin}
            onClose={()=>{setLoginModal(null);setLoginPwd('');}}
          />
        )}
      </AnimatePresence>
    </PageShell>
  );
}
