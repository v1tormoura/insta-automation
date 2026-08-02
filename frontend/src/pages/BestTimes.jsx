import { useEffect, useState, useRef, useCallback } from 'react';
import { motion, AnimatePresence, useInView } from 'framer-motion';
import api from '../services/api';
import PageShell from '../components/PageShell';

/* ─── constants ─────────────────────────────────── */
const PERIODS = [['7d','7 dias'],['30d','30 dias'],['90d','90 dias']];
const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000';

/* ─── utils ──────────────────────────────────────── */
const fmtK = v => { const n=Number(v||0); return n>=1e6?(n/1e6).toFixed(1)+'M':n>=1e3?(n/1e3).toFixed(1)+'K':String(n); };
const avatarSrc = av => av ? (av.startsWith('http') ? `${API_BASE}/image-proxy?url=${encodeURIComponent(av)}` : `${API_BASE}${av}`) : null;
const padH = h => String(h).padStart(2,'0');

function getBestWindow(hours) {
  if (!hours?.length) return '—';
  let best = { s:0, sum:0 };
  for (let i=0;i<=22;i++) {
    const sum=(hours[i]?.avgEngagement||0)+(hours[i+1]?.avgEngagement||0);
    if(sum>best.sum) best={s:i,sum};
  }
  return `${padH(best.s)}h–${padH(best.s+2)}h`;
}

function getConfidence(accounts) {
  const total=accounts.reduce((s,a)=>s+(a.hours||[]).reduce((ss,h)=>ss+h.count,0),0);
  return total>500?98:total>200?88:total>100?75:total>30?61:42;
}

function generateInsight(accounts, globalPeak, period) {
  if (!accounts?.length) return null;
  const peakStr=`${padH(globalPeak)}h`;
  const morningN=accounts.filter(a=>a.peakHour>=6&&a.peakHour<=11).length;
  const eveningN=accounts.filter(a=>a.peakHour>=18&&a.peakHour<=22).length;
  const totalPosts=accounts.reduce((s,a)=>s+(a.hours||[]).reduce((ss,h)=>ss+h.count,0),0);
  const periodLabel=PERIODS.find(([p])=>p===period)?.[1]??period;
  if(morningN>accounts.length/2)
    return `${morningN} de ${accounts.length} contas têm pico matutino — foco na janela das ${peakStr}.`;
  if(eveningN>accounts.length/2)
    return `Audiência mais ativa à noite em ${eveningN} contas — prime time às ${peakStr}.`;
  return `Pico consolidado às ${peakStr} a partir de ${totalPosts} posts analisados nos últimos ${periodLabel}.`;
}

/* ─── AnimCounter ─────────────────────────────────── */
function useAnimCounter(target, delay=0) {
  const [v,setV]=useState(0);
  useEffect(()=>{
    setV(0);
    const t0=setTimeout(()=>{
      const s0=performance.now(), dur=900;
      const tick=now=>{
        const p=Math.min((now-s0)/dur,1);
        setV(Math.round((1-(1-p)**3)*target));
        if(p<1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    },delay);
    return ()=>clearTimeout(t0);
  },[target]);
  return v;
}

/* ─── HourBars ────────────────────────────────────── */
function HourBars({ hours, peakHour }) {
  const [hov,setHov]=useState(null);
  const ref=useRef(null);
  const inView=useInView(ref,{once:true,margin:'-40px'});
  const maxV=Math.max(...hours.map(h=>h.avgEngagement),1);
  const avgV=hours.reduce((s,h)=>s+h.avgEngagement,0)/hours.length;

  return (
    <div ref={ref} style={{position:'relative',userSelect:'none'}}>
      <div style={{display:'flex',gap:2,alignItems:'flex-end',height:80,padding:'0 1px'}}>
        {hours.map(h=>{
          const pct=Math.max(h.avgEngagement/maxV,h.count>0?0.04:0.02);
          const isPeak=h.hour===peakHour;
          const isHigh=h.avgEngagement>avgV*1.4;
          const isHov=hov===h.hour;
          return (
            <div key={h.hour}
              onMouseEnter={()=>setHov(h.hour)}
              onMouseLeave={()=>setHov(null)}
              style={{flex:1,position:'relative',height:'100%',display:'flex',alignItems:'flex-end',cursor:'default'}}
            >
              <motion.div
                initial={{scaleY:0}} animate={{scaleY:inView?1:0}}
                transition={{delay:0.04+h.hour*0.016,duration:0.5,ease:[0.22,1,0.36,1]}}
                style={{transformOrigin:'bottom',width:'100%',height:`${pct*100}%`}}
              >
                <div style={{
                  width:'100%',height:'100%',borderRadius:'3px 3px 0 0',
                  background: isPeak
                    ? 'linear-gradient(180deg,oklch(0.82 0.19 196),oklch(0.65 0.19 196/0.55))'
                    : isHigh
                      ? 'oklch(0.70 0.18 196/0.45)'
                      : `oklch(0.65 0.16 196/${0.09+pct*0.22})`,
                  boxShadow: isPeak ? '0 0 12px oklch(0.72 0.19 196/0.6),0 0 24px oklch(0.72 0.19 196/0.18)' : isHov ? '0 0 6px oklch(0.72 0.19 196/0.2)' : 'none',
                  transition:'box-shadow .15s',
                  opacity:h.count===0?0.22:1,
                }}/>
              </motion.div>

              <AnimatePresence>
                {(isHov||isPeak)&&(
                  <motion.div key="tip"
                    initial={{opacity:0,y:5,scale:.94}} animate={{opacity:1,y:0,scale:1}} exit={{opacity:0,y:5,scale:.94}}
                    transition={{duration:.12}}
                    style={{
                      position:'absolute',bottom:'calc(100% + 8px)',
                      left:'50%',transform:'translateX(-50%)',
                      background:'oklch(0.10 0.04 235)',
                      border:`1px solid ${isPeak?'oklch(0.72 0.19 196/0.4)':'oklch(1 0 0/0.1)'}`,
                      borderRadius:8,padding:'6px 10px',
                      fontSize:10,whiteSpace:'nowrap',zIndex:20,
                      pointerEvents:'none',
                      boxShadow:'0 8px 24px rgba(0,0,0,.4)',
                    }}
                  >
                    <div style={{fontWeight:800,color:isPeak?'var(--cyan)':'var(--text)',fontSize:12,fontVariantNumeric:'tabular-nums'}}>{padH(h.hour)}:00</div>
                    <div style={{color:'var(--text3)',marginTop:2}}>
                      {h.avgEngagement>0?`eng. ${h.avgEngagement}`:'sem dados'}
                      {h.count>0&&` · ${h.count} post${h.count>1?'s':''}`}
                    </div>
                    {isPeak&&<div style={{color:'var(--cyan)',fontSize:9,marginTop:3,fontWeight:700,letterSpacing:'.04em'}}>★ MELHOR HORÁRIO</div>}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>

      {/* average reference line */}
      {maxV>0&&<div style={{
        position:'absolute',bottom:`${(avgV/maxV)*80}px`,
        left:1,right:1,height:1,
        background:'oklch(1 0 0/0.07)',pointerEvents:'none',
        borderTop:'1px dashed oklch(1 0 0/0.08)',
      }}/>}

      {/* x-axis */}
      <div style={{display:'flex',justifyContent:'space-between',marginTop:6,padding:'0 1px'}}>
        {['00h','04h','08h','12h','16h','20h','23h'].map(h=>(
          <span key={h} style={{fontSize:9,color:'var(--text3)',fontFamily:'var(--font-mono)'}}>{h}</span>
        ))}
      </div>
    </div>
  );
}

/* ─── HeatRow ─────────────────────────────────────── */
function HeatRow({ hours, peakHour }) {
  const maxV=Math.max(...hours.map(h=>h.avgEngagement),1);
  return (
    <div style={{display:'grid',gridTemplateColumns:'repeat(24,1fr)',gap:2}}>
      {hours.map(h=>{
        const i=h.avgEngagement/maxV;
        const isPeak=h.hour===peakHour;
        return (
          <div key={h.hour} title={`${padH(h.hour)}h · eng.${h.avgEngagement}`} style={{
            height:6,borderRadius:2,
            background: isPeak?'var(--cyan)':h.count===0?'oklch(1 0 0/0.05)':`oklch(0.68 0.18 196/${0.06+i*0.45})`,
            boxShadow: isPeak?'0 0 6px oklch(0.72 0.19 196/0.7)':'none',
            transition:'transform .15s',cursor:'default',
          }}/>
        );
      })}
    </div>
  );
}

/* ─── AccountCard ────────────────────────────────── */
function AccountCard({ a, idx }) {
  const src=avatarSrc(a.avatar);
  const totalPosts=a.hours.reduce((s,h)=>s+h.count,0);
  const peakEng=a.hours.find(h=>h.hour===a.peakHour)?.avgEngagement||0;
  const isPeakNow=new Date().getHours()===a.peakHour;
  const topHours=[...a.hours].filter(h=>h.count>0).sort((x,y)=>y.avgEngagement-x.avgEngagement).slice(0,5);
  const bestWindow=getBestWindow(a.hours);

  return (
    <motion.div
      initial={{opacity:0,y:16}} animate={{opacity:1,y:0}}
      transition={{delay:idx*0.06+0.1,duration:.35,ease:[0.22,1,0.36,1]}}
      whileHover={{y:-2,transition:{duration:.18}}}
      style={{
        background:'oklch(0.15 0.05 235/0.92)',
        border:'1px solid oklch(1 0 0/0.08)',
        borderRadius:18,overflow:'hidden',
        backdropFilter:'blur(20px) saturate(160%)',
        boxShadow:'0 2px 12px rgba(0,0,0,.08)',
        transition:'box-shadow .2s',
      }}
    >
      {/* Top accent line */}
      <div style={{height:2,background:`linear-gradient(90deg,oklch(0.72 0.19 196/${0.15+idx*0.1}),transparent)`}}/>

      {/* Header */}
      <div style={{padding:'20px 22px 16px',display:'flex',gap:16,alignItems:'flex-start'}}>
        {/* Avatar */}
        <div style={{flexShrink:0,position:'relative'}}>
          <div style={{
            width:58,height:58,borderRadius:'50%',overflow:'hidden',
            border:'2px solid oklch(0.72 0.19 196/0.25)',
            background:'oklch(0.11 0.04 235)',
            boxShadow:'0 0 0 4px oklch(0.72 0.19 196/0.06)',
          }}>
            {src
              ?<img src={src} alt="" style={{width:'100%',height:'100%',objectFit:'cover'}} onError={e=>{e.target.style.display='none';}}/>
              :<div style={{width:'100%',height:'100%',display:'flex',alignItems:'center',justifyContent:'center',fontWeight:900,fontSize:22,color:'var(--cyan)'}}>{a.username?.[0]?.toUpperCase()}</div>
            }
          </div>
        </div>

        {/* Info */}
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontWeight:800,fontSize:15,color:'var(--text)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',letterSpacing:-.2}}>
            @{a.username}
          </div>
          {a.name&&a.name!==a.username&&(
            <div style={{fontSize:11,color:'var(--text3)',marginTop:1}}>{a.name}</div>
          )}
          <div style={{display:'flex',gap:12,marginTop:7,flexWrap:'wrap'}}>
            {a.followers!=null&&(
              <span style={{fontSize:11,color:'var(--text3)'}}>
                <span style={{fontWeight:700,color:'var(--text)',fontFamily:'var(--font-mono)'}}>{fmtK(a.followers)}</span> seguidores
              </span>
            )}
            <span style={{fontSize:11,color:'var(--text3)'}}>
              <span style={{fontWeight:700,color:'var(--text)',fontFamily:'var(--font-mono)'}}>{totalPosts}</span> posts analisados
            </span>
          </div>
        </div>

        {/* Peak callout */}
        <div style={{
          flexShrink:0,textAlign:'center',
          background:'oklch(0.72 0.19 196/0.07)',
          border:'1px solid oklch(0.72 0.19 196/0.18)',
          borderRadius:14,padding:'12px 18px',
          position:'relative',overflow:'hidden',
        }}>
          <div style={{
            position:'absolute',inset:0,
            background:'radial-gradient(circle at 50% 0%,oklch(0.72 0.19 196/0.08),transparent 70%)',
            pointerEvents:'none',
          }}/>
          <div style={{fontSize:10,color:'var(--text3)',fontWeight:700,textTransform:'uppercase',letterSpacing:'.06em',marginBottom:5}}>Melhor hora</div>
          <div style={{fontSize:30,fontWeight:900,color:'var(--cyan)',lineHeight:1,fontVariantNumeric:'tabular-nums',letterSpacing:-1}}>
            {padH(a.peakHour)}h
          </div>
          <div style={{fontSize:10,color:'var(--text3)',marginTop:5}}>eng. {peakEng}</div>
          {isPeakNow&&(
            <div style={{display:'flex',alignItems:'center',justifyContent:'center',gap:4,marginTop:5}}>
              <span style={{width:5,height:5,borderRadius:'50%',background:'#22c55e',display:'inline-block',animation:'bt-pulse 1.4s infinite'}}/>
              <span style={{fontSize:9,color:'#22c55e',fontWeight:700}}>AGORA</span>
            </div>
          )}
        </div>
      </div>

      {/* Quick metrics */}
      <div style={{margin:'0 22px',padding:'10px 14px',borderRadius:10,background:'oklch(0.10 0.04 235/0.5)',display:'flex',gap:0,marginBottom:14}}>
        {[
          {label:'Janela ideal',value:bestWindow,color:'#a78bfa'},
          {label:'Pico eng.',value:String(peakEng),color:'var(--cyan)'},
          {label:'Posts',value:String(totalPosts),color:'var(--text2)'},
        ].map((m,i)=>(
          <div key={m.label} style={{flex:1,textAlign:'center',borderRight:i<2?'1px solid oklch(1 0 0/0.07)':'none',padding:'2px 8px'}}>
            <div style={{fontWeight:700,fontSize:13,color:m.color,fontVariantNumeric:'tabular-nums'}}>{m.value}</div>
            <div style={{fontSize:9,color:'var(--text3)',textTransform:'uppercase',letterSpacing:'.05em',marginTop:2}}>{m.label}</div>
          </div>
        ))}
      </div>

      {/* Bar chart */}
      <div style={{padding:'0 22px 6px'}}>
        <HourBars hours={a.hours} peakHour={a.peakHour}/>
      </div>

      {/* Heat row */}
      <div style={{padding:'8px 22px 14px'}}>
        <HeatRow hours={a.hours} peakHour={a.peakHour}/>
      </div>

      {/* Top hours footer */}
      <div style={{borderTop:'1px solid oklch(1 0 0/0.07)',padding:'10px 22px',display:'flex',gap:7,flexWrap:'wrap',alignItems:'center'}}>
        <span style={{fontSize:9,color:'var(--text3)',fontWeight:700,textTransform:'uppercase',letterSpacing:'.06em',marginRight:2}}>Top:</span>
        {topHours.map((h,i)=>(
          <span key={h.hour} style={{
            fontSize:11,fontWeight:700,padding:'3px 10px',borderRadius:20,
            background:i===0?'oklch(0.72 0.19 196/0.14)':'oklch(0.11 0.04 235/0.7)',
            color:i===0?'var(--cyan)':'var(--text3)',
            border:`1px solid ${i===0?'oklch(0.72 0.19 196/0.3)':'oklch(1 0 0/0.07)'}`,
            boxShadow:i===0?'0 0 8px oklch(0.72 0.19 196/0.15)':'none',
          }}>
            {padH(h.hour)}h {i===0&&'★'}
          </span>
        ))}
      </div>
    </motion.div>
  );
}

/* ─── HeroCard ───────────────────────────────────── */
function HeroCard({ data, period }) {
  const accounts   = data?.accounts||[];
  const globalPeak = data?.globalPeak??null;
  const confidence = getConfidence(accounts);
  const insight    = generateInsight(accounts,globalPeak,period);
  const isPeakNow  = globalPeak!==null && new Date().getHours()===globalPeak;

  // compute global best window from aggregated hours
  const globalHours = Array.from({length:24},(_,hr)=>{
    const engValues=accounts.flatMap(a=>{
      const h=a.hours?.find(x=>x.hour===hr);
      return h&&h.count>0?[h.avgEngagement]:[];
    });
    return {hour:hr,avgEngagement:engValues.length?engValues.reduce((s,v)=>s+v,0)/engValues.length:0};
  });
  const globalWindow=getBestWindow(globalHours);

  const peakNum  = useAnimCounter(globalPeak??0,0);
  const confNum  = useAnimCounter(confidence,120);
  const accNum   = useAnimCounter(accounts.length,60);

  if(!accounts.length) return null;

  return (
    <motion.div
      initial={{opacity:0,y:12}} animate={{opacity:1,y:0}}
      transition={{duration:.4,ease:[0.22,1,0.36,1]}}
      style={{
        position:'relative',overflow:'hidden',
        background:'linear-gradient(145deg,oklch(0.14 0.055 235),oklch(0.11 0.04 240))',
        border:'1px solid oklch(1 0 0/0.08)',
        borderRadius:20,padding:'28px 28px 22px',
        marginBottom:20,
        boxShadow:'0 4px 32px rgba(0,0,0,.12)',
      }}
    >
      {/* Background glow orbs */}
      <div style={{position:'absolute',top:-80,right:-60,width:260,height:260,borderRadius:'50%',background:'oklch(0.72 0.19 196/0.05)',filter:'blur(50px)',pointerEvents:'none'}}/>
      <div style={{position:'absolute',bottom:-60,left:-40,width:180,height:180,borderRadius:'50%',background:'oklch(0.65 0.18 280/0.04)',filter:'blur(40px)',pointerEvents:'none'}}/>

      <div style={{display:'flex',gap:28,alignItems:'stretch',flexWrap:'wrap',position:'relative'}}>
        {/* Feature KPI */}
        <div style={{display:'flex',flexDirection:'column',justifyContent:'center',minWidth:140}}>
          <div style={{fontSize:10,fontWeight:700,color:'var(--text3)',textTransform:'uppercase',letterSpacing:'.08em',marginBottom:8}}>
            Pico global
          </div>
          <div style={{display:'flex',alignItems:'baseline',gap:4}}>
            <div style={{fontSize:56,fontWeight:900,color:'var(--cyan)',lineHeight:1,fontVariantNumeric:'tabular-nums',letterSpacing:-2,textShadow:'0 0 40px oklch(0.72 0.19 196/0.4)'}}>
              {padH(peakNum)}
            </div>
            <div style={{fontSize:22,fontWeight:700,color:'var(--cyan)',opacity:.7}}>h</div>
          </div>
          {isPeakNow?(
            <div style={{display:'inline-flex',alignItems:'center',gap:5,marginTop:8,padding:'4px 10px',borderRadius:20,background:'rgba(34,197,94,.1)',border:'1px solid rgba(34,197,94,.25)',width:'fit-content'}}>
              <span style={{width:5,height:5,borderRadius:'50%',background:'#22c55e',display:'inline-block',animation:'bt-pulse 1.4s infinite'}}/>
              <span style={{fontSize:10,color:'#22c55e',fontWeight:700}}>AGORA É O PICO</span>
            </div>
          ):(
            <div style={{fontSize:10,color:'var(--text3)',marginTop:6}}>hora de maior engajamento</div>
          )}
        </div>

        {/* Divider */}
        <div style={{width:1,background:'oklch(1 0 0/0.07)',alignSelf:'stretch',flexShrink:0}}/>

        {/* Stats grid */}
        <div style={{flex:1,display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(110px,1fr))',gap:'14px 20px',alignContent:'center'}}>
          {[
            {label:'Janela ideal',  value:globalWindow,  color:'#a78bfa', icon:'⏰'},
            {label:'Contas',        value:`${accNum}`,   color:'var(--text)', icon:'📱'},
            {label:'Confiança',     value:`${confNum}%`, color:'#22c55e',     icon:'✓'},
            {label:'Fonte',         value:'API oficial', color:'var(--text3)', icon:'🔗'},
          ].map(s=>(
            <div key={s.label}>
              <div style={{fontSize:9,color:'var(--text3)',fontWeight:700,textTransform:'uppercase',letterSpacing:'.06em',marginBottom:5,display:'flex',alignItems:'center',gap:4}}>
                <span style={{fontSize:11}}>{s.icon}</span>{s.label}
              </div>
              <div style={{fontSize:s.value.length>5?16:20,fontWeight:800,color:s.color,fontVariantNumeric:'tabular-nums',lineHeight:1.1}}>
                {s.value}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Insight banner */}
      {insight&&(
        <motion.div
          initial={{opacity:0,y:6}} animate={{opacity:1,y:0}} transition={{delay:.3,duration:.3}}
          style={{
            marginTop:18,padding:'10px 16px',
            borderRadius:10,
            background:'oklch(0.72 0.19 196/0.06)',
            border:'1px solid oklch(0.72 0.19 196/0.14)',
            display:'flex',alignItems:'center',gap:10,
          }}
        >
          <span style={{fontSize:14,flexShrink:0}}>💡</span>
          <span style={{fontSize:12,color:'var(--text2)',lineHeight:1.55}}>{insight}</span>
        </motion.div>
      )}
    </motion.div>
  );
}

/* ─── Main ───────────────────────────────────────── */
export default function BestTimes() {
  const [data,       setData]       = useState(null);
  const [period,     setPeriod]     = useState('30d');
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error,      setError]      = useState('');

  const fetchData = useCallback((isRefresh=false) => {
    if(isRefresh) setRefreshing(true); else setLoading(true);
    setError('');
    api.get(`/analytics/best-times?period=${period}`)
      .then(r=>setData(r.data))
      .catch(e=>setError(e.response?.data?.error||e.message))
      .finally(()=>{setLoading(false);setRefreshing(false);});
  },[period]);

  useEffect(()=>{fetchData();},[fetchData]);

  const accounts   = data?.accounts||[];
  const periodLabel= PERIODS.find(([p])=>p===period)?.[1]??period;

  const pageIcon=(
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
    </svg>
  );

  const pageActions=(
    <div style={{display:'flex',gap:8,alignItems:'center'}}>
      <button onClick={()=>fetchData(true)} className="btn-ghost" disabled={refreshing||loading}
        style={{display:'flex',alignItems:'center',gap:6,padding:'7px 12px',borderRadius:8,fontSize:'.83rem'}}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
          style={{animation:refreshing?'bt-spin 1s linear infinite':'none'}}>
          <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0118.8-4.3M22 12.5a10 10 0 01-18.8 4.2"/>
        </svg>
        Atualizar
      </button>
      <div style={{display:'flex',gap:2,background:'oklch(0.10 0.03 235/0.6)',border:'1px solid oklch(1 0 0/0.07)',borderRadius:9,padding:3}}>
        {PERIODS.map(([p,l])=>(
          <button key={p} onClick={()=>setPeriod(p)} style={{
            height:26,padding:'0 12px',borderRadius:7,fontSize:'.75rem',fontWeight:600,
            border:'none',cursor:'pointer',transition:'all .15s',
            background:period===p?'var(--cyan)':'transparent',
            color:period===p?'#040e1c':'var(--text3)',
          }}>{l}</button>
        ))}
      </div>
    </div>
  );

  return (
    <PageShell icon={pageIcon} title="Melhores Horários" subtitle={`Horário ideal de postagem por conta — baseado em ${accounts.length} conta${accounts.length!==1?'s':''} · ${periodLabel}`} accent="cyan" actions={pageActions}>
      <style>{`
        @keyframes bt-pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.4;transform:scale(.85)}}
        @keyframes bt-spin{to{transform:rotate(360deg)}}
        @keyframes bt-fade-up{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
      `}</style>

      {/* Loading skeleton */}
      {loading&&(
        <div style={{display:'flex',flexDirection:'column',gap:16}}>
          {[1,2].map(i=>(
            <div key={i} style={{height:280,borderRadius:18,background:'oklch(0.14 0.04 235/0.5)',border:'1px solid oklch(1 0 0/0.06)',animation:'bt-pulse 1.6s ease-in-out infinite'}}/>
          ))}
        </div>
      )}

      {error&&(
        <div style={{background:'oklch(0.18 0.06 15/0.4)',border:'1px solid oklch(0.38 0.12 15/0.35)',borderRadius:12,padding:'14px 18px',color:'#f87171',fontSize:13}}>
          {error}
        </div>
      )}

      {!loading&&!error&&accounts.length===0&&(
        <div style={{textAlign:'center',padding:'80px 20px',background:'oklch(0.15 0.05 235/0.5)',border:'1px solid oklch(1 0 0/0.07)',borderRadius:20}}>
          <div style={{fontSize:40,marginBottom:14,opacity:.5}}>
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" style={{display:'block',margin:'0 auto'}}><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          </div>
          <div style={{fontWeight:700,fontSize:16,color:'var(--text)',marginBottom:7}}>Sem dados suficientes</div>
          <div style={{fontSize:13,color:'var(--text3)'}}>Sincronize os insights das contas para análise dos melhores horários.</div>
        </div>
      )}

      {!loading&&accounts.length>0&&(
        <>
          <HeroCard data={data} period={period}/>
          <div style={{display:'flex',flexDirection:'column',gap:14}}>
            {accounts.map((a,i)=>(
              <AccountCard key={String(a.accountId)} a={a} idx={i}/>
            ))}
          </div>
        </>
      )}
    </PageShell>
  );
}
