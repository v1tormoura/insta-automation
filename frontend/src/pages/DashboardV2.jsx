import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Bell, BookOpen, CheckCircle2, XCircle, Clock, Eye, Heart, Camera,
  LayoutDashboard, Layers, LogOut, Menu, Plus, RefreshCw, Search, Send,
  Settings, Shield, Star, TrendingUp, Users, Zap, ArrowUp, ArrowDown,
  BarChart3, Target, Download, AlertTriangle,
} from 'lucide-react';
import {
  Area, AreaChart, Bar, BarChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid,
  PieChart as RechartPie, Pie, Cell,
} from 'recharts';

const T={bg:'#07101e',cyan:'#00d4ff',cyan2:'#00aacc',green:'#10b981',red:'#f43f5e',amber:'#f59e0b',purple:'#8b5cf6',indigo:'#6366f1',text:'#e2edfd',text2:'#7f9ab5',text3:'#3a5268'};
const chartData=Array.from({length:24},(_,i)=>({h:`${i}h`,stories:Math.floor(20+Math.sin(i*.5)*15+Math.random()*10),posts:Math.floor(12+Math.cos(i*.4)*8+Math.random()*6)}));
const weekData=['Seg','Ter','Qua','Qui','Sex','Sab','Dom'].map(d=>({d,pub:Math.floor(30+Math.random()*50)}));
const pieData=[{name:'Stories',value:58,color:'#00d4ff'},{name:'Posts',value:28,color:'#8b5cf6'},{name:'Reel',value:14,color:'#6366f1'}];
const accounts=[
  {id:1,username:'@vzdsflix',av:'VZ',followers:'128K',status:'online',stories:14,posts:3,health:98},
  {id:2,username:'@thinkflix',av:'TF',followers:'89.2K',status:'online',stories:9,posts:2,health:91},
  {id:3,username:'@devstream',av:'DS',followers:'54.1K',status:'warning',stories:6,posts:1,health:73},
  {id:4,username:'@motionclip',av:'MC',followers:'210K',status:'online',stories:21,posts:5,health:99},
  {id:5,username:'@codevibes',av:'CV',followers:'32.8K',status:'offline',stories:0,posts:0,health:0},
];
const jobs=[
  {id:1,type:'Story',account:'@vzdsflix',status:'success',time:'2 min',link:true},
  {id:2,type:'Post',account:'@thinkflix',status:'success',time:'8 min',link:false},
  {id:3,type:'Story',account:'@devstream',status:'error',time:'14 min',link:false},
  {id:4,type:'Campanha',account:'4 contas',status:'running',time:'23 min',link:true},
  {id:5,type:'Post',account:'@motionclip',status:'success',time:'31 min',link:false},
];
const navItems=[
  {icon:LayoutDashboard,label:'Dashboard',active:true},
  {icon:Users,label:'Contas',active:false},
  {icon:Send,label:'Stories',active:false},
  {icon:BookOpen,label:'Posts',active:false},
  {icon:Layers,label:'Campanhas',active:false},
  {icon:BarChart3,label:'Performance',active:false},
  {icon:Zap,label:'Automacao',active:false},
  {icon:Target,label:'Viral Hunter',active:false},
  {icon:TrendingUp,label:'Top Posts',active:false},
];
const cmds=[
  {icon:Send,label:'Publicar Story',group:'Publicar',key:'S'},
  {icon:BookOpen,label:'Novo Post',group:'Publicar',key:'P'},
  {icon:Layers,label:'Nova Campanha',group:'Publicar',key:'C'},
  {icon:Users,label:'Gerenciar Contas',group:'Navegar',key:''},
  {icon:BarChart3,label:'Ver Metricas',group:'Navegar',key:''},
  {icon:RefreshCw,label:'Reconectar Contas',group:'Acoes',key:''},
  {icon:Download,label:'Exportar Relatorio',group:'Acoes',key:''},
  {icon:Shield,label:'Health Check',group:'Sistema',key:''},
];

function Dot({s}){const c={online:'#10b981',warning:'#f59e0b',offline:'#f43f5e',running:'#00d4ff'};return(<span style={{position:'relative',display:'inline-flex',alignItems:'center'}}><span style={{width:8,height:8,borderRadius:'50%',background:c[s]||'#3a5268',display:'inline-block'}}/>{s==='running'&&<span style={{position:'absolute',inset:0,borderRadius:'50%',background:'#00d4ff',opacity:.5,animation:'pulse 1.5s ease-in-out infinite'}}/>}</span>);}

function Mc({icon:Icon,label,value,sub,trend,color='#00d4ff',delay=0}){
  const[count,setCount]=useState(0);
  useEffect(()=>{const n=parseFloat(String(value).replace(/[^0-9.]/g,''));let s=0;const step=n/40;const t=setTimeout(()=>{const iv=setInterval(()=>{s=Math.min(s+step,n);setCount(s);if(s>=n)clearInterval(iv);},20);return()=>clearInterval(iv);},delay*120);return()=>clearTimeout(t);},[value,delay]);
  const fmt=(v,o)=>{if(String(o).includes('K'))return v>=1000?`${(v/1000).toFixed(1)}K`:Math.floor(v).toString();if(String(o).includes('%'))return`${Math.floor(v)}%`;return Math.floor(v).toLocaleString('pt-BR');};
  return(<motion.div initial={{opacity:0,y:20}}animate={{opacity:1,y:0}}transition={{delay:delay*.08,duration:.5}}whileHover={{y:-2}}style={{background:'oklch(0.16 0.05 235 / 0.90)',border:'1px solid oklch(1 0 0 / 0.07)',borderRadius:16,padding:'20px 22px',position:'relative',overflow:'hidden',cursor:'default'}}>
    <div style={{position:'absolute',top:0,left:'15%',right:'15%',height:1,background:`linear-gradient(90deg,transparent,${color}44,transparent)`}}/>
    <div style={{position:'absolute',top:-30,right:-30,width:100,height:100,borderRadius:'50%',background:`radial-gradient(circle,${color}14 0%,transparent 70%)`,pointerEvents:'none'}}/>
    <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',marginBottom:12}}>
      <div style={{width:36,height:36,borderRadius:10,background:`${color}18`,border:`1px solid ${color}30`,display:'grid',placeItems:'center'}}><Icon size={16} style={{color}}/></div>
      {trend!==undefined&&(<span style={{display:'flex',alignItems:'center',gap:3,fontSize:11,fontWeight:600,color:trend>=0?'#10b981':'#f43f5e',background:trend>=0?'#10b98118':'#f43f5e18',padding:'3px 8px',borderRadius:20}}>{trend>=0?<ArrowUp size={10}/>:<ArrowDown size={10}/>}{Math.abs(trend)}%</span>)}
    </div>
    <div style={{fontSize:26,fontWeight:700,color:'#e2edfd',letterSpacing:'-.5px',lineHeight:1}}>{fmt(count,value)}</div>
    <div style={{fontSize:12,color:'#7f9ab5',marginTop:4}}>{label}</div>
    {sub&&<div style={{fontSize:11,color:'#3a5268',marginTop:2}}>{sub}</div>}
  </motion.div>);
}

function CmdPalette({open,onClose}){
  const[q,setQ]=useState('');const[sel,setSel]=useState(0);const ref=useRef();
  useEffect(()=>{if(open){setTimeout(()=>ref.current?.focus(),80);setQ('');setSel(0);}},[open]);
  const filtered=cmds.filter(c=>c.label.toLowerCase().includes(q.toLowerCase()));
  const groups=[...new Set(filtered.map(c=>c.group))];
  return(<AnimatePresence>{open&&(<motion.div initial={{opacity:0}}animate={{opacity:1}}exit={{opacity:0}}onClick={onClose}style={{position:'fixed',inset:0,background:'rgba(7,16,30,.78)',backdropFilter:'blur(6px)',zIndex:9999,display:'flex',alignItems:'flex-start',justifyContent:'center',paddingTop:'15vh'}}>
    <motion.div initial={{opacity:0,scale:.96,y:-10}}animate={{opacity:1,scale:1,y:0}}exit={{opacity:0,scale:.96,y:-10}}transition={{duration:.16}}onClick={e=>e.stopPropagation()}style={{width:560,background:'oklch(0.14 0.05 235 / 0.98)',border:'1px solid oklch(1 0 0 / 0.12)',borderRadius:18,overflow:'hidden',boxShadow:'0 32px 80px rgba(0,0,0,.5),0 0 0 1px #00d4ff22,0 0 80px #00d4ff10'}}>
      <div style={{display:'flex',alignItems:'center',gap:10,padding:'14px 18px',borderBottom:'1px solid oklch(1 0 0 / 0.07)'}}><Search size={16} style={{color:'#7f9ab5'}}/><input ref={ref} value={q} onChange={e=>{setQ(e.target.value);setSel(0);}}placeholder="Buscar acao..."style={{flex:1,background:'none',border:'none',outline:'none',color:'#e2edfd',fontSize:15,fontFamily:'inherit'}}/><kbd style={{fontSize:10,color:'#3a5268',background:'oklch(1 0 0 / 0.06)',padding:'3px 6px',borderRadius:6,border:'1px solid oklch(1 0 0 / 0.1)'}}>ESC</kbd></div>
      <div style={{maxHeight:360,overflowY:'auto',padding:'8px 0'}}>
        {groups.map(group=>(<div key={group}><div style={{fontSize:10,fontWeight:700,color:'#3a5268',padding:'8px 18px 4px',textTransform:'uppercase',letterSpacing:'.08em'}}>{group}</div>
          {filtered.filter(c=>c.group===group).map((cmd,idx)=>(<div key={cmd.label}style={{display:'flex',alignItems:'center',gap:12,padding:'9px 18px',cursor:'pointer',background:sel===idx?'oklch(1 0 0 / 0.05)':'transparent'}}onMouseEnter={()=>setSel(idx)}>
            <div style={{width:28,height:28,borderRadius:8,background:'oklch(1 0 0 / 0.06)',display:'grid',placeItems:'center'}}><cmd.icon size={13} style={{color:'#7f9ab5'}}/></div>
            <span style={{flex:1,fontSize:13,color:'#e2edfd'}}>{cmd.label}</span>
            {cmd.key&&<kbd style={{fontSize:10,color:'#3a5268',background:'oklch(1 0 0 / 0.06)',padding:'2px 6px',borderRadius:5,border:'1px solid oklch(1 0 0 / 0.1)'}}>{cmd.key}</kbd>}
          </div>))}
        </div>))}
      </div>
    </motion.div>
  </motion.div>)}</AnimatePresence>);
}

function Notifs({open,onClose}){
  const ns=[
    {icon:CheckCircle2,title:'Campanha concluida',sub:'@vzdsflix - 14 stories',time:'2m',c:'#10b981'},
    {icon:AlertTriangle,title:'Conta desconectada',sub:'@codevibes - Reconectar',time:'14m',c:'#f59e0b'},
    {icon:TrendingUp,title:'Pico de alcance',sub:'@motionclip - +340% hoje',time:'1h',c:'#00d4ff'},
    {icon:Star,title:'Post viral',sub:'@thinkflix - 2.1K curtidas',time:'3h',c:'#8b5cf6'},
    {icon:XCircle,title:'Falha de publicacao',sub:'@devstream - Tentar novamente',time:'5h',c:'#f43f5e'},
  ];
  return(<AnimatePresence>{open&&(<><motion.div initial={{opacity:0}}animate={{opacity:1}}exit={{opacity:0}}onClick={onClose}style={{position:'fixed',inset:0,zIndex:800}}/>
    <motion.div initial={{opacity:0,scale:.95,y:-8}}animate={{opacity:1,scale:1,y:0}}exit={{opacity:0,scale:.95,y:-8}}transition={{duration:.15}}style={{position:'fixed',top:64,right:24,width:360,zIndex:900,background:'oklch(0.14 0.05 235 / 0.98)',border:'1px solid oklch(1 0 0 / 0.1)',borderRadius:16,boxShadow:'0 24px 60px rgba(0,0,0,.4)',overflow:'hidden'}}>
      <div style={{padding:'14px 16px',borderBottom:'1px solid oklch(1 0 0 / 0.07)',display:'flex',justifyContent:'space-between',alignItems:'center'}}><span style={{fontSize:13,fontWeight:600,color:'#e2edfd'}}>Notificacoes</span><span style={{fontSize:11,color:'#00d4ff',cursor:'pointer'}}>Marcar lidas</span></div>
      {ns.map((n,i)=>(<motion.div key={i}initial={{x:20,opacity:0}}animate={{x:0,opacity:1}}transition={{delay:i*.05}}whileHover={{background:'oklch(1 0 0 / 0.03)'}}style={{display:'flex',gap:12,padding:'12px 16px',borderBottom:'1px solid oklch(1 0 0 / 0.05)',cursor:'pointer'}}>
        <div style={{width:32,height:32,borderRadius:10,background:`${n.c}18`,display:'grid',placeItems:'center',flexShrink:0}}><n.icon size={14} style={{color:n.c}}/></div>
        <div style={{flex:1,minWidth:0}}><div style={{fontSize:12,fontWeight:600,color:'#e2edfd'}}>{n.title}</div><div style={{fontSize:11,color:'#7f9ab5',marginTop:2,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{n.sub}</div></div>
        <div style={{fontSize:10,color:'#3a5268',flexShrink:0}}>{n.time}</div>
      </motion.div>))}
    </motion.div></>)}</AnimatePresence>);
}

function TT({active,payload,label}){if(!active||!payload?.length)return null;return(<div style={{background:'oklch(0.16 0.05 235 / 0.98)',border:'1px solid oklch(1 0 0 / 0.12)',borderRadius:10,padding:'10px 14px',fontSize:12}}><div style={{color:'#7f9ab5',marginBottom:6,fontWeight:600}}>{label}</div>{payload.map(p=>(<div key={p.dataKey}style={{display:'flex',justifyContent:'space-between',gap:16}}><span style={{color:'#7f9ab5'}}>{p.name||p.dataKey}</span><span style={{fontWeight:700,color:p.color}}>{p.value?.toLocaleString('pt-BR')}</span></div>))}</div>);}

export default function DashboardV2(){
  const[sidebarOpen,setSidebarOpen]=useState(true);
  const[cmdOpen,setCmdOpen]=useState(false);
  const[notifOpen,setNotifOpen]=useState(false);
  const[activeTab,setActiveTab]=useState('24h');
  const[filter,setFilter]=useState('all');
  const[sq,setSq]=useState('');
  useEffect(()=>{const h=e=>{if((e.metaKey||e.ctrlKey)&&e.key==='k'){e.preventDefault();setCmdOpen(v=>!v);}if(e.key==='Escape'){setCmdOpen(false);setNotifOpen(false);}};window.addEventListener('keydown',h);return()=>window.removeEventListener('keydown',h);},[]);
  const fa=accounts.filter(a=>{if(filter!=='all'&&a.status!==filter)return false;if(sq&&!a.username.includes(sq))return false;return true;});
  const SW=sidebarOpen?220:64;
  const colors=[T.cyan,T.purple,T.indigo,T.green,T.amber];
  return(
    <div style={{display:'flex',height:'100vh',background:'#07101e',color:'#e2edfd',fontFamily:"'Geist',sans-serif",overflow:'hidden'}}>
      <CmdPalette open={cmdOpen} onClose={()=>setCmdOpen(false)}/>
      <Notifs open={notifOpen} onClose={()=>setNotifOpen(false)}/>
      <motion.aside animate={{width:SW}}transition={{duration:.25,ease:[.21,.47,.32,.98]}}style={{flexShrink:0,height:'100vh',background:'oklch(0.13 0.045 235 / 0.95)',borderRight:'1px solid oklch(1 0 0 / 0.06)',display:'flex',flexDirection:'column',overflow:'hidden',backdropFilter:'blur(20px)'}}>
        <div style={{padding:'18px 16px',borderBottom:'1px solid oklch(1 0 0 / 0.06)',display:'flex',alignItems:'center',gap:10,flexShrink:0}}>
          <div style={{width:32,height:32,borderRadius:10,flexShrink:0,background:'linear-gradient(135deg,#00d4ff,#8b5cf6)',display:'grid',placeItems:'center',boxShadow:'0 0 20px #00d4ff40'}}><Camera size={16} style={{color:'#fff'}}/></div>
          <AnimatePresence>{sidebarOpen&&(<motion.div initial={{opacity:0,x:-10}}animate={{opacity:1,x:0}}exit={{opacity:0,x:-10}}transition={{duration:.18}}style={{overflow:'hidden'}}><div style={{fontSize:14,fontWeight:700,color:'#e2edfd',whiteSpace:'nowrap'}}>InstaFlow</div><div style={{fontSize:10,color:'#3a5268',whiteSpace:'nowrap'}}>SaaS Automacao</div></motion.div>)}</AnimatePresence>
        </div>
        <nav style={{flex:1,padding:'12px 8px',overflowY:'auto',overflowX:'hidden'}}>
          {navItems.map(item=>(<motion.div key={item.label}whileHover={{x:2}}style={{display:'flex',alignItems:'center',gap:10,padding:'9px 10px',borderRadius:10,marginBottom:2,cursor:'pointer',background:item.active?'#00d4ff14':'transparent',border:item.active?'1px solid #00d4ff30':'1px solid transparent',transition:'all .15s',whiteSpace:'nowrap'}}>
            <item.icon size={16} style={{color:item.active?'#00d4ff':'#7f9ab5',flexShrink:0}}/>
            <AnimatePresence>{sidebarOpen&&(<motion.span initial={{opacity:0}}animate={{opacity:1}}exit={{opacity:0}}style={{fontSize:13,color:item.active?'#e2edfd':'#7f9ab5',fontWeight:item.active?600:400}}>{item.label}</motion.span>)}</AnimatePresence>
            {sidebarOpen&&item.active&&<motion.div style={{marginLeft:'auto',width:5,height:5,borderRadius:'50%',background:'#00d4ff'}}/>}
          </motion.div>))}
        </nav>
        <div style={{padding:'12px 8px',borderTop:'1px solid oklch(1 0 0 / 0.06)'}}>
          {[{icon:Settings,label:'Configuracoes'},{icon:LogOut,label:'Sair'}].map(item=>(<motion.div key={item.label}whileHover={{x:2}}style={{display:'flex',alignItems:'center',gap:10,padding:'9px 10px',borderRadius:10,cursor:'pointer',whiteSpace:'nowrap'}}><item.icon size={16} style={{color:'#3a5268',flexShrink:0}}/><AnimatePresence>{sidebarOpen&&<motion.span initial={{opacity:0}}animate={{opacity:1}}exit={{opacity:0}}style={{fontSize:13,color:'#3a5268'}}>{item.label}</motion.span>}</AnimatePresence></motion.div>))}
        </div>
      </motion.aside>
      <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden',minWidth:0}}>
        <div style={{height:56,flexShrink:0,background:'oklch(0.13 0.045 235 / 0.92)',borderBottom:'1px solid oklch(1 0 0 / 0.06)',display:'flex',alignItems:'center',gap:12,padding:'0 20px',backdropFilter:'blur(20px)'}}>
          <button onClick={()=>setSidebarOpen(v=>!v)}style={{background:'none',border:'none',cursor:'pointer',color:'#7f9ab5',display:'grid',placeItems:'center',padding:4,borderRadius:8}}><Menu size={16}/></button>
          <motion.button whileHover={{borderColor:'#00d4ff40'}}onClick={()=>setCmdOpen(true)}style={{flex:1,maxWidth:320,height:34,display:'flex',alignItems:'center',gap:10,background:'oklch(1 0 0 / 0.04)',border:'1px solid oklch(1 0 0 / 0.08)',borderRadius:10,padding:'0 12px',cursor:'pointer',transition:'border-color .2s',textAlign:'left'}}>
            <Search size={13} style={{color:'#3a5268'}}/><span style={{flex:1,fontSize:13,color:'#3a5268'}}>Buscar ou Ctrl+K...</span><kbd style={{fontSize:10,color:'#3a5268',background:'oklch(1 0 0 / 0.06)',padding:'2px 6px',borderRadius:5,border:'1px solid oklch(1 0 0 / 0.1)',whiteSpace:'nowrap'}}>Ctrl+K</kbd>
          </motion.button>
          <div style={{marginLeft:'auto',display:'flex',alignItems:'center',gap:8}}>
            <motion.button whileHover={{scale:1.05}}whileTap={{scale:.95}}onClick={()=>setNotifOpen(v=>!v)}style={{position:'relative',width:34,height:34,borderRadius:10,background:'oklch(1 0 0 / 0.05)',border:'1px solid oklch(1 0 0 / 0.08)',cursor:'pointer',display:'grid',placeItems:'center',color:'#7f9ab5'}}><Bell size={14}/><span style={{position:'absolute',top:6,right:6,width:7,height:7,borderRadius:'50%',background:'#f43f5e',border:'1.5px solid oklch(0.13 0.045 235)'}}/></motion.button>
            <div style={{width:32,height:32,borderRadius:10,background:'linear-gradient(135deg,#00d4ff,#8b5cf6)',display:'grid',placeItems:'center',fontSize:12,fontWeight:700,color:'#fff',cursor:'pointer'}}>VM</div>
          </div>
        </div>
        <div style={{flex:1,overflowY:'auto',padding:'24px'}}>
          <motion.div initial={{opacity:0,y:-10}}animate={{opacity:1,y:0}}style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',marginBottom:24}}>
            <div><h1 style={{fontSize:22,fontWeight:700,color:'#e2edfd',margin:0,letterSpacing:'-.4px'}}>Bom dia, Vitor!</h1><p style={{fontSize:13,color:'#7f9ab5',marginTop:4,margin:0}}>{accounts.filter(a=>a.status==='online').length} contas ativas agora</p></div>
            <div style={{display:'flex',gap:8}}>
              <motion.button whileHover={{scale:1.02}}whileTap={{scale:.98}}style={{display:'flex',alignItems:'center',gap:6,padding:'8px 14px',background:'oklch(1 0 0 / 0.05)',border:'1px solid oklch(1 0 0 / 0.1)',borderRadius:10,color:'#7f9ab5',fontSize:13,cursor:'pointer',fontFamily:'inherit'}}><RefreshCw size={13}/>Atualizar</motion.button>
              <motion.button whileHover={{scale:1.02,boxShadow:'0 0 20px #00d4ff40'}}whileTap={{scale:.98}}style={{display:'flex',alignItems:'center',gap:6,padding:'8px 16px',background:'linear-gradient(135deg,#00d4ff,#00aacc)',border:'none',borderRadius:10,color:'#07101e',fontSize:13,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}><Plus size={14}/>Nova Campanha</motion.button>
            </div>
          </motion.div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:14,marginBottom:24}}>
            <Mc icon={Send} label="Stories hoje" value="147" trend={12} color={T.cyan} delay={0}/>
            <Mc icon={BookOpen} label="Posts ativos" value="39" trend={5} color={T.purple} delay={1}/>
            <Mc icon={Eye} label="Alcance total" value="284K" trend={24} color={T.green} delay={2}/>
            <Mc icon={Heart} label="Engajamento" value="8.3%" trend={-2} color={T.amber} delay={3}/>
            <Mc icon={Users} label="Contas online" value="4" sub="de 5 conectadas" color={T.indigo} delay={4}/>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 280px',gap:14,marginBottom:24}}>
            <motion.div initial={{opacity:0,y:20}}animate={{opacity:1,y:0}}transition={{delay:.3}}style={{background:'oklch(0.16 0.05 235 / 0.90)',border:'1px solid oklch(1 0 0 / 0.07)',borderRadius:16,padding:'20px',position:'relative',overflow:'hidden'}}>
              <div style={{position:'absolute',top:0,left:'15%',right:'15%',height:1,background:'linear-gradient(90deg,transparent,#00d4ff44,transparent)'}}/>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
                <div><div style={{fontSize:14,fontWeight:600,color:'#e2edfd'}}>Publicacoes 24h</div><div style={{fontSize:11,color:'#7f9ab5'}}>Stories + Posts</div></div>
                <div style={{display:'flex',gap:4}}>{['24h','7d','30d'].map(t=>(<button key={t}onClick={()=>setActiveTab(t)}style={{padding:'4px 10px',borderRadius:8,fontSize:11,fontWeight:600,cursor:'pointer',fontFamily:'inherit',background:activeTab===t?'#00d4ff20':'oklch(1 0 0 / 0.04)',border:activeTab===t?'1px solid #00d4ff40':'1px solid oklch(1 0 0 / 0.08)',color:activeTab===t?'#00d4ff':'#7f9ab5',transition:'all .15s'}}>{t}</button>))}</div>
              </div>
              <ResponsiveContainer width="100%" height={160}><AreaChart data={chartData}margin={{top:5,right:5,bottom:-20,left:-20}}>
                <defs><linearGradient id="g1" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#00d4ff" stopOpacity={.25}/><stop offset="95%" stopColor="#00d4ff" stopOpacity={0}/></linearGradient><linearGradient id="g2" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#8b5cf6" stopOpacity={.2}/><stop offset="95%" stopColor="#8b5cf6" stopOpacity={0}/></linearGradient></defs>
                <XAxis dataKey="h" tick={{fontSize:9,fill:'#3a5268'}}axisLine={false}tickLine={false}interval={3}/>
                <YAxis tick={{fontSize:9,fill:'#3a5268'}}axisLine={false}tickLine={false}/>
                <CartesianGrid stroke="oklch(1 0 0 / 0.04)"strokeDasharray="3 3"/>
                <Tooltip content={<TT/>}/>
                <Area type="monotone" dataKey="stories" stroke="#00d4ff" strokeWidth={2} fill="url(#g1)" name="Stories"/>
                <Area type="monotone" dataKey="posts" stroke="#8b5cf6" strokeWidth={2} fill="url(#g2)" name="Posts"/>
              </AreaChart></ResponsiveContainer>
            </motion.div>
            <motion.div initial={{opacity:0,y:20}}animate={{opacity:1,y:0}}transition={{delay:.35}}style={{background:'oklch(0.16 0.05 235 / 0.90)',border:'1px solid oklch(1 0 0 / 0.07)',borderRadius:16,padding:'20px',position:'relative',overflow:'hidden'}}>
              <div style={{position:'absolute',top:0,left:'15%',right:'15%',height:1,background:'linear-gradient(90deg,transparent,#8b5cf644,transparent)'}}/>
              <div style={{fontSize:14,fontWeight:600,color:'#e2edfd',marginBottom:4}}>Publicacoes semana</div>
              <div style={{fontSize:11,color:'#7f9ab5',marginBottom:16}}>Posts por dia</div>
              <ResponsiveContainer width="100%" height={160}><BarChart data={weekData}margin={{top:5,right:5,bottom:-20,left:-20}}barCategoryGap="30%">
                <XAxis dataKey="d" tick={{fontSize:9,fill:'#3a5268'}}axisLine={false}tickLine={false}/>
                <YAxis tick={{fontSize:9,fill:'#3a5268'}}axisLine={false}tickLine={false}/>
                <CartesianGrid stroke="oklch(1 0 0 / 0.04)"strokeDasharray="3 3"vertical={false}/>
                <Tooltip content={<TT/>}/>
                <Bar dataKey="pub" fill="#8b5cf6" radius={[4,4,0,0]} name="Publicacoes"/>
              </BarChart></ResponsiveContainer>
            </motion.div>
            <motion.div initial={{opacity:0,y:20}}animate={{opacity:1,y:0}}transition={{delay:.4}}style={{background:'oklch(0.16 0.05 235 / 0.90)',border:'1px solid oklch(1 0 0 / 0.07)',borderRadius:16,padding:'20px',display:'flex',flexDirection:'column'}}>
              <div style={{fontSize:14,fontWeight:600,color:'#e2edfd',marginBottom:4}}>Tipos de conteudo</div>
              <div style={{fontSize:11,color:'#7f9ab5',marginBottom:12}}>Distribuicao do mes</div>
              <ResponsiveContainer width="100%" height={120}><RechartPie><Pie data={pieData}cx="50%"cy="50%"innerRadius={35}outerRadius={55}paddingAngle={3}dataKey="value">{pieData.map((e,i)=><Cell key={i}fill={e.color}/>)}</Pie><Tooltip content={<TT/>}/></RechartPie></ResponsiveContainer>
              <div style={{display:'flex',flexDirection:'column',gap:6,marginTop:8}}>{pieData.map(d=>(<div key={d.name}style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}><div style={{display:'flex',alignItems:'center',gap:6}}><div style={{width:8,height:8,borderRadius:2,background:d.color}}/><span style={{fontSize:11,color:'#7f9ab5'}}>{d.name}</span></div><span style={{fontSize:11,fontWeight:700,color:'#e2edfd'}}>{d.value}%</span></div>))}</div>
            </motion.div>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 340px',gap:14}}>
            <motion.div initial={{opacity:0,y:20}}animate={{opacity:1,y:0}}transition={{delay:.45}}style={{background:'oklch(0.16 0.05 235 / 0.90)',border:'1px solid oklch(1 0 0 / 0.07)',borderRadius:16,overflow:'hidden'}}>
              <div style={{padding:'16px 20px',borderBottom:'1px solid oklch(1 0 0 / 0.07)',display:'flex',alignItems:'center',gap:10}}>
                <div style={{fontSize:14,fontWeight:600,color:'#e2edfd'}}>Contas Conectadas</div>
                <span style={{fontSize:11,background:'#00d4ff18',color:'#00d4ff',padding:'2px 8px',borderRadius:20,fontWeight:600}}>{accounts.length}</span>
                <div style={{marginLeft:'auto',display:'flex',gap:6}}>
                  {['all','online','warning','offline'].map(f=>(<button key={f}onClick={()=>setFilter(f)}style={{padding:'3px 10px',borderRadius:8,fontSize:10,fontWeight:600,cursor:'pointer',fontFamily:'inherit',textTransform:'capitalize',background:filter===f?'#00d4ff20':'oklch(1 0 0 / 0.04)',border:filter===f?'1px solid #00d4ff40':'1px solid oklch(1 0 0 / 0.08)',color:filter===f?'#00d4ff':'#7f9ab5'}}>{f==='all'?'Todas':f}</button>))}
                  <div style={{display:'flex',alignItems:'center',gap:6,background:'oklch(1 0 0 / 0.04)',border:'1px solid oklch(1 0 0 / 0.08)',borderRadius:8,padding:'3px 10px'}}><Search size={11} style={{color:'#3a5268'}}/><input value={sq}onChange={e=>setSq(e.target.value)}placeholder="buscar..."style={{background:'none',border:'none',outline:'none',fontSize:11,color:'#7f9ab5',width:70,fontFamily:'inherit'}}/></div>
                </div>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'2fr 1fr 1fr 1fr 80px',padding:'8px 20px',borderBottom:'1px solid oklch(1 0 0 / 0.05)'}}>
                {['Conta','Status','Stories','Posts','Health'].map(h=>(<div key={h}style={{fontSize:10,fontWeight:600,color:'#3a5268',textTransform:'uppercase',letterSpacing:'.06em',cursor:'pointer',display:'flex',alignItems:'center',gap:4}}>{h}<ArrowUp size={8} style={{opacity:.4}}/></div>))}
              </div>
              {fa.map((acc,i)=>(<motion.div key={acc.id}initial={{opacity:0,x:-10}}animate={{opacity:1,x:0}}transition={{delay:.5+i*.06}}whileHover={{background:'oklch(1 0 0 / 0.025)'}}style={{display:'grid',gridTemplateColumns:'2fr 1fr 1fr 1fr 80px',padding:'12px 20px',borderBottom:'1px solid oklch(1 0 0 / 0.04)',alignItems:'center',transition:'background .15s',cursor:'pointer'}}>
                <div style={{display:'flex',alignItems:'center',gap:10}}>
                  <div style={{width:32,height:32,borderRadius:10,flexShrink:0,background:`linear-gradient(135deg,${colors[i%5]}40,${colors[(i+1)%5]}40)`,display:'grid',placeItems:'center',fontSize:11,fontWeight:700,color:'#e2edfd'}}>{acc.av}</div>
                  <div><div style={{fontSize:13,fontWeight:600,color:'#e2edfd'}}>{acc.username}</div><div style={{fontSize:10,color:'#3a5268'}}>{acc.followers}</div></div>
                </div>
                <div style={{display:'flex',alignItems:'center',gap:6}}><Dot s={acc.status}/><span style={{fontSize:11,color:'#7f9ab5',textTransform:'capitalize'}}>{acc.status}</span></div>
                <div style={{fontSize:13,color:'#e2edfd',fontWeight:600}}>{acc.stories}</div>
                <div style={{fontSize:13,color:'#e2edfd',fontWeight:600}}>{acc.posts}</div>
                <div>{acc.health>0?(<div><div style={{marginBottom:3}}><span style={{fontSize:10,color:acc.health>80?'#10b981':acc.health>50?'#f59e0b':'#f43f5e',fontWeight:700}}>{acc.health}%</span></div><div style={{height:4,background:'oklch(1 0 0 / 0.08)',borderRadius:4,overflow:'hidden'}}><motion.div initial={{width:0}}animate={{width:`${acc.health}%`}}transition={{delay:.6+i*.1,duration:.6,ease:'easeOut'}}style={{height:'100%',background:acc.health>80?'#10b981':acc.health>50?'#f59e0b':'#f43f5e',borderRadius:4}}/></div></div>):<span style={{fontSize:10,color:'#3a5268'}}>offline</span>}</div>
              </motion.div>))}
              {fa.length===0&&<div style={{textAlign:'center',padding:'32px 20px',color:'#3a5268',fontSize:13}}>Nenhuma conta encontrada</div>}
            </motion.div>
            <motion.div initial={{opacity:0,y:20}}animate={{opacity:1,y:0}}transition={{delay:.5}}style={{background:'oklch(0.16 0.05 235 / 0.90)',border:'1px solid oklch(1 0 0 / 0.07)',borderRadius:16,overflow:'hidden'}}>
              <div style={{padding:'16px 20px',borderBottom:'1px solid oklch(1 0 0 / 0.07)',display:'flex',justifyContent:'space-between',alignItems:'center'}}><div style={{fontSize:14,fontWeight:600,color:'#e2edfd'}}>Jobs Recentes</div><span style={{fontSize:11,color:'#00d4ff',cursor:'pointer'}}>Ver todos</span></div>
              <div style={{padding:'8px 0'}}>
                {jobs.map((job,i)=>(<motion.div key={job.id}initial={{opacity:0,x:10}}animate={{opacity:1,x:0}}transition={{delay:.55+i*.07}}whileHover={{background:'oklch(1 0 0 / 0.025)'}}style={{display:'flex',alignItems:'center',gap:12,padding:'11px 20px',borderBottom:'1px solid oklch(1 0 0 / 0.04)',cursor:'pointer',transition:'background .15s'}}>
                  <div style={{width:32,height:32,borderRadius:10,flexShrink:0,display:'grid',placeItems:'center',background:job.status==='success'?'#10b98118':job.status==='error'?'#f43f5e18':job.status==='running'?'#00d4ff18':'#f59e0b18'}}>
                    {job.status==='success'?<CheckCircle2 size={14} style={{color:'#10b981'}}/>:job.status==='error'?<XCircle size={14} style={{color:'#f43f5e'}}/>:job.status==='running'?<RefreshCw size={14} style={{color:'#00d4ff',animation:'spin 1s linear infinite'}}/>:<Clock size={14} style={{color:'#f59e0b'}}/>}
                  </div>
                  <div style={{flex:1,minWidth:0}}><div style={{fontSize:12,fontWeight:600,color:'#e2edfd',display:'flex',alignItems:'center',gap:6}}>{job.type}{job.link&&<span style={{fontSize:9,background:'#00d4ff18',color:'#00d4ff',padding:'1px 5px',borderRadius:4}}>+Link</span>}</div><div style={{fontSize:11,color:'#7f9ab5',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{job.account}</div></div>
                  <div style={{fontSize:10,color:'#3a5268',flexShrink:0}}>{job.time}</div>
                </motion.div>))}
              </div>
              <div style={{padding:'16px 20px',borderTop:'1px solid oklch(1 0 0 / 0.07)'}}>
                <div style={{fontSize:11,fontWeight:600,color:'#3a5268',textTransform:'uppercase',letterSpacing:'.06em',marginBottom:10}}>Acoes Rapidas</div>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
                  {[{icon:Send,label:'Story',color:'#00d4ff',action:()=>setCmdOpen(true)},{icon:BookOpen,label:'Post',color:'#8b5cf6',action:()=>{}},{icon:Layers,label:'Campanha',color:'#6366f1',action:()=>{}},{icon:RefreshCw,label:'Reconectar',color:'#f59e0b',action:()=>{}}].map(btn=>(<motion.button key={btn.label}whileHover={{scale:1.02,y:-1}}whileTap={{scale:.97}}onClick={btn.action}style={{display:'flex',alignItems:'center',gap:6,padding:'8px 10px',background:`${btn.color}10`,border:`1px solid ${btn.color}28`,borderRadius:10,color:btn.color,fontSize:12,fontWeight:600,cursor:'pointer',fontFamily:'inherit',transition:'all .15s'}}><btn.icon size={13}/>{btn.label}</motion.button>))}
                </div>
              </div>
            </motion.div>
          </div>
          <div style={{height:24}}/>
        </div>
      </div>
      <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}@keyframes pulse{0%,100%{transform:scale(1);opacity:.5}50%{transform:scale(2);opacity:0}}::-webkit-scrollbar{width:4px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:oklch(1 0 0 / 0.08);border-radius:4px}`}</style>
    </div>
  );
}