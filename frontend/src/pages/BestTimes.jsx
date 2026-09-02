import { useEffect, useState, useRef, useCallback } from 'react';
import { motion, AnimatePresence, useInView } from 'framer-motion';
import api from '../services/api';
import PageShell from '../components/PageShell';
import { EsqueletoLista, Bloco } from '../components/Estados';

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
      <div style={{display:'flex',gap:2,alignItems:'flex-end',height:80,padding:'0 2px'}}>
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
                    ? 'linear-gradient(180deg,var(--mf-primary-500),color-mix(in oklch, var(--mf-primary-500) 55%, transparent))'
                    : isHigh
                      ? 'color-mix(in oklch, var(--mf-primary-500) 45%, transparent)'
                      : `oklch(0.65 0.16 196/${0.09+pct*0.22})`,
                  boxShadow: isPeak ? '0 0 12px color-mix(in oklch, var(--mf-primary-500) 60%, transparent),0 0 24px color-mix(in oklch, var(--mf-primary-500) 18%, transparent)' : isHov ? '0 0 6px color-mix(in oklch, var(--mf-primary-500) 20%, transparent)' : 'none',
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
                      background:'var(--mf-bg)',
                      border:`1px solid ${isPeak?'color-mix(in oklch, var(--mf-primary-500) 40%, transparent)':'oklch(1 0 0/0.1)'}`,
                      borderRadius: 'var(--mf-r-sm)',padding:'4px 8px',
                      fontSize: 'var(--mf-t-nano)',whiteSpace:'nowrap',zIndex:20,
                      pointerEvents:'none',
                      boxShadow:'0 8px 24px rgba(0,0,0,.4)',
                    }}
                  >
                    <div style={{fontWeight:800,color:isPeak?'var(--mf-mod, var(--mf-accent-500))':'var(--mf-text)',fontSize: 'var(--mf-t-xs)',fontVariantNumeric:'tabular-nums'}}>{padH(h.hour)}:00</div>
                    <div style={{color:'var(--mf-text-3)',marginTop:2}}>
                      {h.avgEngagement>0?`eng. ${h.avgEngagement}`:'sem dados'}
                      {h.count>0&&` · ${h.count} post${h.count>1?'s':''}`}
                    </div>
                    {isPeak&&<div style={{color:'var(--mf-mod, var(--mf-accent-500))',fontSize: 'var(--mf-t-nano)',marginTop:3,fontWeight:700,letterSpacing:'.04em'}}>★ MELHOR HORÁRIO</div>}
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
      <div style={{display:'flex',justifyContent:'space-between',marginTop:6,padding:'0 2px'}}>
        {['00h','04h','08h','12h','16h','20h','23h'].map(h=>(
          <span key={h} style={{fontSize: 'var(--mf-t-nano)',color:'var(--mf-text-3)',fontFamily:'var(--mf-mono)'}}>{h}</span>
        ))}
      </div>
    </div>
  );
}

/* ─── HeatRow ─────────────────────────────────────── */
function HeatRow({ hours, peakHour }) {
  const maxV=Math.max(...hours.map(h=>h.avgEngagement),1);
  return (
    <div style={{display:'grid',gridTemplateColumns:'repeat(24,1fr)',gap:2,minWidth:240}}>
      {hours.map(h=>{
        const i=h.avgEngagement/maxV;
        const isPeak=h.hour===peakHour;
        return (
          <div key={h.hour} title={`${padH(h.hour)}h · eng.${h.avgEngagement}`} style={{
            height:6,borderRadius: 'var(--mf-r-xs)',
            background: isPeak?'var(--mf-mod, var(--mf-accent-500))':h.count===0?'oklch(1 0 0/0.05)':`oklch(0.68 0.18 196/${0.06+i*0.45})`,
            boxShadow: isPeak?'0 0 6px color-mix(in oklch, var(--mf-primary-500) 70%, transparent)':'none',
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
        background:'color-mix(in oklch, var(--mf-surface-1) 92%, transparent)',
        border:'1px solid oklch(1 0 0/0.08)',
        borderRadius: 'var(--mf-r-xl)',overflow:'hidden',
        backdropFilter:'blur(20px) saturate(160%)',
        boxShadow:'0 2px 12px rgba(0,0,0,.08)',
        transition:'box-shadow .2s',
      }}
    >
      {/* Top accent line */}
      <div style={{height:2,background:`linear-gradient(90deg,oklch(0.72 0.19 196/${0.15+idx*0.1}),transparent)`}}/>

      {/* Header */}
      <div style={{padding:'16px 24px 16px',display:'flex',gap:16,alignItems:'flex-start'}}>
        {/* Avatar */}
        <div style={{flexShrink:0,position:'relative'}}>
          <div style={{
            width:58,height:58,borderRadius: 'var(--mf-r-full)',overflow:'hidden',
            border:'2px solid color-mix(in oklch, var(--mf-primary-500) 25%, transparent)',
            background:'var(--mf-bg)',
            boxShadow:'0 0 0 4px color-mix(in oklch, var(--mf-primary-500) 6%, transparent)',
          }}>
            {src
              ?<img src={src} alt="" style={{width:'100%',height:'100%',objectFit:'cover'}} onError={e=>{e.target.style.display='none';}}/>
              :<div style={{width:'100%',height:'100%',display:'flex',alignItems:'center',justifyContent:'center',fontWeight:900,fontSize: 'var(--mf-t-h1)',color:'var(--mf-mod, var(--mf-accent-500))'}}>{a.username?.[0]?.toUpperCase()}</div>
            }
          </div>
        </div>

        {/* Info */}
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontWeight:800,fontSize: 'var(--mf-t-h2)',color:'var(--mf-text)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',letterSpacing:-.2}}>
            @{a.username}
          </div>
          {a.name&&a.name!==a.username&&(
            <div style={{fontSize: 'var(--mf-t-micro)',color:'var(--mf-text-3)',marginTop:1}}>{a.name}</div>
          )}
          <div style={{display:'flex',gap:12,marginTop:7,flexWrap:'wrap'}}>
            {a.followers!=null&&(
              <span style={{fontSize: 'var(--mf-t-micro)',color:'var(--mf-text-3)'}}>
                <span style={{fontWeight:700,color:'var(--mf-text)',fontFamily:'var(--mf-mono)'}}>{fmtK(a.followers)}</span> seguidores
              </span>
            )}
            <span style={{fontSize: 'var(--mf-t-micro)',color:'var(--mf-text-3)'}}>
              <span style={{fontWeight:700,color:'var(--mf-text)',fontFamily:'var(--mf-mono)'}}>{totalPosts}</span> posts analisados
            </span>
          </div>
        </div>

        {/* Peak callout */}
        <div style={{
          flexShrink:0,textAlign:'center',
          background:'color-mix(in oklch, var(--mf-primary-500) 7%, transparent)',
          border:'1px solid color-mix(in oklch, var(--mf-primary-500) 18%, transparent)',
          borderRadius: 'var(--mf-r-lg)',padding:'12px 16px',
          position:'relative',overflow:'hidden',
        }}>
          <div style={{
            position:'absolute',inset:0,
            background:'radial-gradient(circle at 50% 0%,color-mix(in oklch, var(--mf-primary-500) 8%, transparent),transparent 70%)',
            pointerEvents:'none',
          }}/>
          <div style={{fontSize: 'var(--mf-t-nano)',color:'var(--mf-text-3)',fontWeight:700,textTransform:'uppercase',letterSpacing:'.06em',marginBottom:5}}>Melhor hora</div>
          <div style={{fontSize: 'var(--mf-t-display)',fontWeight:900,color:'var(--mf-mod, var(--mf-accent-500))',lineHeight:1,fontVariantNumeric:'tabular-nums',letterSpacing:-1}}>
            {padH(a.peakHour)}h
          </div>
          <div style={{fontSize: 'var(--mf-t-nano)',color:'var(--mf-text-3)',marginTop:5}}>eng. {peakEng}</div>
          {isPeakNow&&(
            <div style={{display:'flex',alignItems:'center',justifyContent:'center',gap:4,marginTop:5}}>
              <span style={{width:5,height:5,borderRadius: 'var(--mf-r-full)',background:'var(--mf-success-500)',display:'inline-block',animation:'bt-pulse 1.4s infinite'}}/>
              <span style={{fontSize: 'var(--mf-t-nano)',color:'var(--mf-success-500)',fontWeight:700}}>AGORA</span>
            </div>
          )}
        </div>
      </div>

      {/* Quick metrics */}
      <div style={{margin:'0 22px',padding:'8px 12px',borderRadius: 'var(--mf-r-md)',background:'color-mix(in oklch, var(--mf-bg) 50%, transparent)',display:'flex',gap:0,marginBottom:14}}>
        {[
          {label:'Janela ideal',value:bestWindow,color:'var(--mf-mod-publicar)'},
          {label:'Pico eng.',value:String(peakEng),color:'var(--mf-mod, var(--mf-accent-500))'},
          {label:'Posts',value:String(totalPosts),color:'var(--mf-text-2)'},
        ].map((m,i)=>(
          <div key={m.label} style={{flex:1,textAlign:'center',borderRight:i<2?'1px solid oklch(1 0 0/0.07)':'none',padding:'2px 8px'}}>
            <div style={{fontWeight:700,fontSize: 'var(--mf-t-sm)',color:m.color,fontVariantNumeric:'tabular-nums'}}>{m.value}</div>
            <div style={{fontSize: 'var(--mf-t-nano)',color:'var(--mf-text-3)',textTransform:'uppercase',letterSpacing:'.05em',marginTop:2}}>{m.label}</div>
          </div>
        ))}
      </div>

      {/* Bar chart */}
      <div style={{padding:'0 24px 4px'}}>
        <HourBars hours={a.hours} peakHour={a.peakHour}/>
      </div>

      {/* Heat row */}
      <div style={{padding:'8px 24px 12px', overflowX:'auto'}}>
        <HeatRow hours={a.hours} peakHour={a.peakHour}/>
      </div>

      {/* Top hours footer */}
      <div style={{borderTop:'1px solid oklch(1 0 0/0.07)',padding:'8px 24px',display:'flex',gap:7,flexWrap:'wrap',alignItems:'center'}}>
        <span style={{fontSize: 'var(--mf-t-nano)',color:'var(--mf-text-3)',fontWeight:700,textTransform:'uppercase',letterSpacing:'.06em',marginRight:2}}>Top:</span>
        {topHours.map((h,i)=>(
          <span key={h.hour} style={{
            fontSize: 'var(--mf-t-micro)',fontWeight:700,padding:'2px 8px',borderRadius: 'var(--mf-r-xl)',
            background:i===0?'color-mix(in oklch, var(--mf-primary-500) 14%, transparent)':'color-mix(in oklch, var(--mf-bg) 70%, transparent)',
            color:i===0?'var(--mf-mod, var(--mf-accent-500))':'var(--mf-text-3)',
            border:`1px solid ${i===0?'color-mix(in oklch, var(--mf-primary-500) 30%, transparent)':'oklch(1 0 0/0.07)'}`,
            boxShadow:i===0?'0 0 8px color-mix(in oklch, var(--mf-primary-500) 15%, transparent)':'none',
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
        background:'linear-gradient(145deg,var(--mf-surface-1),var(--mf-bg))',
        border:'1px solid oklch(1 0 0/0.08)',
        borderRadius: 'var(--mf-r-xl)',padding:'24px 24px 24px',
        marginBottom:20,
        boxShadow:'0 4px 32px rgba(0,0,0,.12)',
      }}
    >
      {/* Background glow orbs */}
      <div style={{position:'absolute',top:-80,right:-60,width:260,height:260,borderRadius: 'var(--mf-r-full)',background:'color-mix(in oklch, var(--mf-primary-500) 5%, transparent)',filter:'blur(50px)',pointerEvents:'none'}}/>
      <div style={{position:'absolute',bottom:-60,left:-40,width:180,height:180,borderRadius: 'var(--mf-r-full)',background:'color-mix(in oklch, var(--mf-primary-500) 4%, transparent)',filter:'blur(40px)',pointerEvents:'none'}}/>

      <div style={{display:'flex',gap:28,alignItems:'stretch',flexWrap:'wrap',position:'relative'}}>
        {/* Feature KPI */}
        <div style={{display:'flex',flexDirection:'column',justifyContent:'center',minWidth:140}}>
          <div style={{fontSize: 'var(--mf-t-nano)',fontWeight:700,color:'var(--mf-text-3)',textTransform:'uppercase',letterSpacing:'.08em',marginBottom:8}}>
            Pico global
          </div>
          <div style={{display:'flex',alignItems:'baseline',gap:4}}>
            <div style={{fontSize:56,fontWeight:900,color:'var(--mf-mod, var(--mf-accent-500))',lineHeight:1,fontVariantNumeric:'tabular-nums',letterSpacing:-2,textShadow:'0 0 40px color-mix(in oklch, var(--mf-primary-500) 40%, transparent)'}}>
              {padH(peakNum)}
            </div>
            <div style={{fontSize: 'var(--mf-t-h1)',fontWeight:700,color:'var(--mf-mod, var(--mf-accent-500))',opacity:.7}}>h</div>
          </div>
          {isPeakNow?(
            <div style={{display:'inline-flex',alignItems:'center',gap:5,marginTop:8,padding:'4px 8px',borderRadius: 'var(--mf-r-xl)',background:'color-mix(in oklch, var(--mf-success-500) 10%, transparent)',border:'1px solid color-mix(in oklch, var(--mf-success-500) 25%, transparent)',width:'fit-content'}}>
              <span style={{width:5,height:5,borderRadius: 'var(--mf-r-full)',background:'var(--mf-success-500)',display:'inline-block',animation:'bt-pulse 1.4s infinite'}}/>
              <span style={{fontSize: 'var(--mf-t-nano)',color:'var(--mf-success-500)',fontWeight:700}}>AGORA É O PICO</span>
            </div>
          ):(
            <div style={{fontSize: 'var(--mf-t-nano)',color:'var(--mf-text-3)',marginTop:6}}>hora de maior engajamento</div>
          )}
        </div>

        {/* Divider */}
        <div style={{width:1,background:'oklch(1 0 0/0.07)',alignSelf:'stretch',flexShrink:0}}/>

        {/* Stats grid */}
        <div style={{flex:1,display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(110px,1fr))',gap:'14px 20px',alignContent:'center'}}>
          {[
            {label:'Janela ideal',  value:globalWindow,  color:'var(--mf-mod-publicar)', icon:'⏰'},
            {label:'Contas',        value:`${accNum}`,   color:'var(--mf-text)', icon:'📱'},
            {label:'Confiança',     value:`${confNum}%`, color:'var(--mf-success-500)',     icon:'✓'},
            {label:'Fonte',         value:'API oficial', color:'var(--mf-text-3)', icon:'🔗'},
          ].map(s=>(
            <div key={s.label}>
              <div style={{fontSize: 'var(--mf-t-nano)',color:'var(--mf-text-3)',fontWeight:700,textTransform:'uppercase',letterSpacing:'.06em',marginBottom:5,display:'flex',alignItems:'center',gap:4}}>
                <span style={{fontSize: 'var(--mf-t-micro)'}}>{s.icon}</span>{s.label}
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
            marginTop:18,padding:'8px 16px',
            borderRadius: 'var(--mf-r-md)',
            background:'color-mix(in oklch, var(--mf-primary-500) 6%, transparent)',
            border:'1px solid color-mix(in oklch, var(--mf-primary-500) 14%, transparent)',
            display:'flex',alignItems:'center',gap:10,
          }}
        >
          <span style={{fontSize: 'var(--mf-t-body)',flexShrink:0}}>💡</span>
          <span style={{fontSize: 'var(--mf-t-xs)',color:'var(--mf-text-2)',lineHeight:1.55}}>{insight}</span>
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
        style={{display:'flex',alignItems:'center',gap:6,padding:'8px 12px',borderRadius: 'var(--mf-r-sm)',fontSize: 'var(--mf-t-sm)'}}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
          style={{animation:refreshing?'bt-spin 1s linear infinite':'none'}}>
          <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0118.8-4.3M22 12.5a10 10 0 01-18.8 4.2"/>
        </svg>
        Atualizar
      </button>
      <div style={{display:'flex',gap:2,background:'color-mix(in oklch, var(--mf-bg) 60%, transparent)',border:'1px solid oklch(1 0 0/0.07)',borderRadius: 'var(--mf-r-md)',padding:3}}>
        {PERIODS.map(([p,l])=>(
          <button key={p} onClick={()=>setPeriod(p)} style={{
            height:26,padding:'0 12px',borderRadius: 'var(--mf-r-sm)',fontSize: 'var(--mf-t-xs)',fontWeight:600,
            border:'none',cursor:'pointer',transition:'all .15s',
            background:period===p?'var(--mf-mod, var(--mf-accent-500))':'transparent',
            color:period===p?'var(--mf-bg)':'var(--mf-text-3)',
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
            <div key={i} style={{height:280,borderRadius: 'var(--mf-r-xl)',background:'color-mix(in oklch, var(--mf-surface-1) 50%, transparent)',border:'1px solid oklch(1 0 0/0.06)',animation:'bt-pulse 1.6s ease-in-out infinite'}}/>
          ))}
        </div>
      )}

      {error&&(
        <div style={{background:'color-mix(in oklch, var(--mf-danger-500) 9%, transparent)',border:'1px solid oklch(0.38 0.12 15/0.35)',borderRadius: 'var(--mf-r-md)',padding:'12px 16px',color:'var(--mf-danger-500)',fontSize: 'var(--mf-t-sm)'}}>
          {error}
        </div>
      )}

      {!loading&&!error&&accounts.length===0&&(
        <div style={{textAlign:'center',padding:'80px 16px',background:'color-mix(in oklch, var(--mf-surface-1) 50%, transparent)',border:'1px solid oklch(1 0 0/0.07)',borderRadius: 'var(--mf-r-xl)'}}>
          <div style={{fontSize: 'var(--mf-t-display)',marginBottom:14,opacity:.5}}>
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" style={{display:'block',margin:'0 auto'}}><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          </div>
          <div style={{fontWeight:700,fontSize: 'var(--mf-t-h2)',color:'var(--mf-text)',marginBottom:7}}>Sem dados suficientes</div>
          <div style={{fontSize: 'var(--mf-t-sm)',color:'var(--mf-text-3)'}}>Sincronize os insights das contas para análise dos melhores horários.</div>
        </div>
      )}

      {loading && (
        <div style={{display:'flex',flexDirection:'column',gap:14}}>
          <Bloco style={{height:150,borderRadius:'var(--mf-r-lg)'}} />
          <EsqueletoLista itens={4} />
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
