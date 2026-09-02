import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard, Users, Send, BookOpen, Layers,
  BarChart3, Settings, LogOut, Search, Bell,
  TrendingUp, ArrowUpRight, ArrowDownRight,
  Camera, Play, Plus, MoreHorizontal,
  CheckCircle2, Clock, XCircle, Sparkles, Target, Zap,
  Eye
} from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip as RechartsTooltip, ResponsiveContainer,
  BarChart, Bar, Cell, CartesianGrid
} from 'recharts';
import { NumberTicker } from '../components/magicui/number-ticker';
import { BlurFade } from '../components/magicui/blur-fade';

// --- MOCK DATA ---
const chartData = Array.from({length: 14}, (_, i) => ({
  date: `Dia ${i+1}`,
  stories: Math.floor(100 + Math.sin(i)*50 + i*15),
  posts: Math.floor(40 + Math.cos(i)*20 + i*5),
}));

const activityFeed = [
  { id: 1, type: 'success', title: 'Campanha "Black Friday" concluída', time: 'Há 2 min', icon: CheckCircle2, color: 'var(--mf-success-500)' },
  { id: 2, type: 'warning', title: 'Conta @thinkflix instável', time: 'Há 15 min', icon: Zap, color: 'var(--mf-warning-500)' },
  { id: 3, type: 'info', title: 'Novo pico de engajamento', time: 'Há 1 hora', icon: TrendingUp, color: 'var(--mf-mod-contas)' },
  { id: 4, type: 'error', title: 'Falha de postagem em @devstream', time: 'Há 3 horas', icon: XCircle, color: 'var(--mf-danger-500)' },
];

const connectedAccounts = [
  { id: 1, handle: '@vzdsflix', followers: '128.4K', health: 98, status: 'online', trend: '+2.4%' },
  { id: 2, handle: '@thinkflix', followers: '89.2K', health: 92, status: 'online', trend: '+1.1%' },
  { id: 3, handle: '@motionclip', followers: '210.5K', health: 100, status: 'online', trend: '+5.7%' },
  { id: 4, handle: '@devstream', followers: '54.1K', health: 64, status: 'warning', trend: '-0.4%' },
];

// --- REUSABLE COMPONENTS ---

// Glassmorphism Card
const GlassCard = ({ children, className = '', delay = 0, noPad = false }) => (
  <BlurFade delay={delay} yOffset={20}>
    <div 
      className={`relative overflow-hidden rounded-3xl backdrop-blur-xl border shadow-2xl transition-all hover:border-white/10 ${className}`}
      style={{ 
        background: 'color-mix(in oklch, var(--mf-surface-1) 85%, transparent)', 
        borderColor: 'var(--mf-border-subtle)',
        boxShadow: '0 20px 40px -10px rgba(0,0,0,0.5)',
        padding: noPad ? 0 : '24px'
      }}
    >
      <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-white/15 to-transparent" />
      <div className="absolute -top-32 -right-32 w-64 h-64 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />
      {children}
    </div>
  </BlurFade>
);

// Animated Metric Value
const MetricCard = ({ title, value, prefix = "", suffix = "", trend, icon: Icon, color, delay }) => (
  <GlassCard delay={delay} className="group">
    <div className="flex justify-between items-start mb-6">
      <div 
        className="w-12 h-12 rounded-2xl flex items-center justify-center transition-transform group-hover:scale-110 group-hover:rotate-3"
        style={{ background: `${color}15`, border: `1px solid ${color}30` }}
      >
        <Icon size={20} style={{ color }} />
      </div>
      <div 
        className="px-2.5 py-1 rounded-full flex items-center gap-1 text-xs font-bold"
        style={{ 
          background: trend > 0 ? '#10b98115' : '#f43f5e15', 
          color: trend > 0 ? 'var(--mf-success-500)' : 'var(--mf-danger-500)' 
        }}
      >
        {trend > 0 ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
        {Math.abs(trend)}%
      </div>
    </div>
    
    <div>
      <div className="text-sm font-medium mb-1" style={{ color: 'var(--text2, var(--mf-text-2))' }}>{title}</div>
      <div className="text-4xl font-extrabold tracking-tight text-white flex items-baseline gap-1">
        {prefix}
        <NumberTicker value={value} />
        <span className="text-xl text-white/50">{suffix}</span>
      </div>
    </div>
  </GlassCard>
);

// Custom Chart Tooltip
const ChartTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border backdrop-blur-xl p-4 shadow-2xl" style={{ background: 'color-mix(in oklch, var(--mf-surface-1) 95%, transparent)', borderColor: 'var(--mf-border)' }}>
      <div className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--mf-text-2)' }}>{label}</div>
      <div className="flex flex-col gap-2">
        {payload.map((entry, index) => (
          <div key={index} className="flex items-center justify-between gap-6">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full" style={{ background: entry.color }} />
              <span className="text-sm text-white/80">{entry.name}</span>
            </div>
            <span className="text-sm font-bold text-white">{entry.value.toLocaleString('pt-BR')}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

// --- MAIN DASHBOARD ---
function DashboardV2() {
  const [activeTab, setActiveTab] = useState('overview');
  
  return (
    <div className="flex h-screen overflow-hidden font-sans" style={{ background: 'var(--mf-bg)' }}>
      
      {/* LEFT SIDEBAR - BENTO STYLE MINIMAL */}
      <motion.aside 
        initial={{ x: -100, opacity: 0 }} 
        animate={{ x: 0, opacity: 1 }} 
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        className="w-[84px] h-full flex flex-col items-center py-6 border-r relative z-10"
        style={{ background: '#050b14', borderColor: 'var(--mf-border-subtle)' }}
      >
        <div className="w-12 h-12 rounded-2xl flex items-center justify-center mb-8 relative group cursor-pointer"
             style={{ background: 'linear-gradient(135deg, var(--mf-mod-contas), var(--mf-mod-publicar))', boxShadow: '0 0 24px color-mix(in oklch, var(--mf-mod-contas) 30%, transparent)' }}>
          <Sparkles size={20} className="text-white relative z-10" />
          <div className="absolute inset-0 bg-white/20 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity" />
        </div>
        
        <nav className="flex flex-col gap-4 flex-1 w-full items-center">
          {[
            { icon: LayoutDashboard, id: 'overview' },
            { icon: Users, id: 'accounts' },
            { icon: Send, id: 'campaigns' },
            { icon: BarChart3, id: 'analytics' },
            { icon: Layers, id: 'library' },
          ].map((item) => (
            <div 
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className="relative w-12 h-12 flex items-center justify-center rounded-xl cursor-pointer group transition-colors"
              style={{ color: activeTab === item.id ? 'var(--mf-mod-contas)' : 'var(--mf-text-2)' }}
            >
              {activeTab === item.id && (
                <motion.div 
                  layoutId="sidebar-active"
                  className="absolute inset-0 rounded-xl"
                  style={{ background: '#00d4ff15', border: '1px solid #00d4ff30' }}
                  transition={{ type: "spring", stiffness: 300, damping: 24 }}
                />
              )}
              <item.icon size={22} className="relative z-10 group-hover:scale-110 transition-transform" />
            </div>
          ))}
        </nav>
        
        <div className="w-12 h-12 flex items-center justify-center rounded-xl cursor-pointer text-white/50 hover:text-white transition-colors">
          <Settings size={22} />
        </div>
      </motion.aside>

      {/* MAIN CONTENT AREA */}
      <main className="flex-1 h-full overflow-y-auto overflow-x-hidden relative">
        {/* Background glow effects */}
        <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-[var(--mf-mod-contas)]/10 blur-[120px] rounded-full pointer-events-none" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[50%] bg-[var(--mf-mod-publicar)]/10 blur-[120px] rounded-full pointer-events-none" />
        
        <div className="max-w-[1440px] mx-auto p-8 relative z-10">
          
          {/* HEADER */}
          <BlurFade delay={0.1}>
            <header className="flex justify-between items-center mb-10">
              <div>
                <h1 className="text-4xl font-black text-white tracking-tight mb-2">
                  Visão Global
                  <span className="text-transparent bg-clip-text bg-gradient-to-r from-[var(--mf-mod-contas)] to-[var(--mf-mod-publicar)] ml-2">V2</span>
                </h1>
                <p className="text-sm font-medium" style={{ color: 'var(--mf-text-2)' }}>Monitoramento em tempo real da infraestrutura</p>
              </div>
              
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-3 px-4 py-2.5 rounded-2xl bg-white/5 border border-white/10 text-white/70 hover:bg-white/10 hover:text-white transition-colors cursor-text w-64 backdrop-blur-md">
                  <Search size={16} />
                  <span className="text-sm font-medium">Buscar comandos (⌘K)</span>
                </div>
                
                <button className="w-11 h-11 rounded-2xl flex items-center justify-center bg-white/5 border border-white/10 text-white hover:bg-white/10 transition-all relative">
                  <Bell size={18} />
                  <span className="absolute top-3 right-3 w-2 h-2 bg-rose-500 rounded-full animate-pulse" />
                </button>
                
                <div className="w-11 h-11 rounded-2xl flex items-center justify-center font-bold text-sm text-white cursor-pointer hover:scale-105 transition-transform shadow-lg"
                     style={{ background: 'linear-gradient(135deg, var(--mf-mod-publicar), var(--mf-info-500))' }}>
                  VM
                </div>
              </div>
            </header>
          </BlurFade>

          {/* BENTO GRID - 1ST ROW (METRICS) */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
            <MetricCard title="Alcance Total" value={2.8} suffix="M" trend={14.2} icon={Eye} color="var(--mf-mod-contas)" delay={0.2} />
            <MetricCard title="Stories Publicados" value={1458} trend={5.1} icon={Send} color="var(--mf-mod-publicar)" delay={0.3} />
            <MetricCard title="Taxa de Sucesso" value={98.4} suffix="%" trend={0.8} icon={Target} color="var(--mf-success-500)" delay={0.4} />
            <MetricCard title="Ações na Fila" value={342} trend={-12.5} icon={Layers} color="var(--mf-warning-500)" delay={0.5} />
          </div>

          {/* BENTO GRID - 2ND ROW (CHARTS & ACCOUNTS) */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
            
            {/* MAIN CHART (SPAN 2) */}
            <GlassCard delay={0.6} className="lg:col-span-2 flex flex-col">
              <div className="flex justify-between items-center mb-8">
                <div>
                  <h2 className="text-xl font-bold text-white tracking-tight">Desempenho de Tráfego</h2>
                  <p className="text-xs font-medium mt-1" style={{ color: 'var(--mf-text-2)' }}>Volume de posts x stories nos últimos 14 dias</p>
                </div>
                <div className="flex p-1 rounded-xl bg-black/30 border border-white/5">
                  {['7D', '14D', '30D'].map(t => (
                    <button key={t} className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${t === '14D' ? 'bg-[var(--mf-mod-contas)]/20 text-[var(--mf-mod-contas)] shadow-sm' : 'text-white/50 hover:text-white'}`}>
                      {t}
                    </button>
                  ))}
                </div>
              </div>
              
              <div className="flex-1 min-h-[280px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="colorStories" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="var(--mf-mod-contas)" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="var(--mf-mod-contas)" stopOpacity={0}/>
                      </linearGradient>
                      <linearGradient id="colorPosts" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="var(--mf-mod-publicar)" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="var(--mf-mod-publicar)" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fontSize: 'var(--mf-t-micro)', fill: 'var(--mf-text-2)' }} dy={10} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 'var(--mf-t-micro)', fill: 'var(--mf-text-2)' }} />
                    <CartesianGrid strokeDasharray="4 4" stroke="var(--mf-border-subtle)" vertical={false} />
                    <RechartsTooltip content={<ChartTooltip />} cursor={{ stroke: 'var(--mf-border)', strokeWidth: 2, strokeDasharray: '4 4' }} />
                    <Area type="monotone" dataKey="stories" name="Stories" stroke="var(--mf-mod-contas)" strokeWidth={3} fillOpacity={1} fill="url(#colorStories)" />
                    <Area type="monotone" dataKey="posts" name="Posts" stroke="var(--mf-mod-publicar)" strokeWidth={3} fillOpacity={1} fill="url(#colorPosts)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </GlassCard>

            {/* ACTIVITY FEED */}
            <GlassCard delay={0.7} className="flex flex-col">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-lg font-bold text-white tracking-tight">Atividade do Sistema</h2>
                <button className="text-xs font-bold text-[var(--mf-mod-contas)] hover:text-white transition-colors">Ver tudo</button>
              </div>
              
              <div className="flex-1 flex flex-col gap-4 overflow-y-auto pr-2" style={{ scrollbarWidth: 'none' }}>
                {activityFeed.map((item, i) => (
                  <motion.div 
                    key={item.id}
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.8 + (i * 0.1) }}
                    className="flex gap-4 items-start p-3 rounded-2xl hover:bg-white/5 transition-colors cursor-pointer group"
                  >
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 shadow-inner group-hover:scale-110 transition-transform"
                         style={{ background: `${item.color}15`, border: `1px solid ${item.color}30` }}>
                      <item.icon size={16} style={{ color: item.color }} />
                    </div>
                    <div>
                      <h4 className="text-sm font-semibold text-white/90 group-hover:text-white leading-tight mb-1">{item.title}</h4>
                      <p className="text-xs font-medium" style={{ color: 'var(--mf-text-2)' }}>{item.time}</p>
                    </div>
                  </motion.div>
                ))}
              </div>
              
              <button className="mt-4 w-full py-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white text-sm font-bold transition-all flex justify-center items-center gap-2 shadow-lg">
                <Settings size={16} /> Gerenciar Alertas
              </button>
            </GlassCard>

          </div>

          {/* BENTO GRID - 3RD ROW (TABLE) */}
          <GlassCard delay={0.8} noPad>
            <div className="p-6 border-b border-white/5 flex justify-between items-center bg-black/20">
              <div className="flex items-center gap-3">
                <h2 className="text-xl font-bold text-white tracking-tight">Status das Contas</h2>
                <div className="px-2.5 py-1 rounded-full bg-[var(--mf-mod-contas)]/10 text-[var(--mf-mod-contas)] text-xs font-bold border border-[var(--mf-mod-contas)]/20">
                  {connectedAccounts.length} Ativas
                </div>
              </div>
              <button className="px-5 py-2.5 rounded-xl text-sm font-bold text-black flex items-center gap-2 hover:scale-105 transition-transform shadow-[0_0_20px_color-mix(in_oklch,_var(--mf-mod-contas)_40%,_transparent)]"
                      style={{ background: 'linear-gradient(135deg, var(--mf-mod-contas), var(--mf-primary-600))' }}>
                <Plus size={16} /> Conectar Conta
              </button>
            </div>
            
            <div className="w-full overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr>
                    <th className="px-6 py-4 text-xs font-bold uppercase tracking-widest text-[var(--mf-text-2)]">Conta</th>
                    <th className="px-6 py-4 text-xs font-bold uppercase tracking-widest text-[var(--mf-text-2)]">Status</th>
                    <th className="px-6 py-4 text-xs font-bold uppercase tracking-widest text-[var(--mf-text-2)]">Saúde (API)</th>
                    <th className="px-6 py-4 text-xs font-bold uppercase tracking-widest text-[var(--mf-text-2)]">Crescimento</th>
                    <th className="px-6 py-4 text-xs font-bold uppercase tracking-widest text-[var(--mf-text-2)] text-right">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {connectedAccounts.map((acc, i) => (
                    <motion.tr 
                      key={acc.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 1 + (i * 0.1) }}
                      className="border-b border-white/5 hover:bg-white/[0.02] transition-colors group cursor-pointer"
                    >
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-4">
                          <div className="w-10 h-10 rounded-xl flex items-center justify-center font-bold text-white text-xs shadow-inner"
                               style={{ background: `linear-gradient(135deg, ${['var(--mf-mod-contas)','var(--mf-mod-publicar)','var(--mf-success-500)','var(--mf-warning-500)'][i%4]}40, transparent)` }}>
                            {acc.handle.substring(1,3).toUpperCase()}
                          </div>
                          <div>
                            <div className="font-bold text-white text-sm group-hover:text-[var(--mf-mod-contas)] transition-colors">{acc.handle}</div>
                            <div className="text-xs font-medium text-[var(--mf-text-2)]">{acc.followers} seguidores</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold"
                              style={{ 
                                background: acc.status === 'online' ? '#10b98115' : '#f59e0b15',
                                color: acc.status === 'online' ? 'var(--mf-success-500)' : 'var(--mf-warning-500)',
                                border: `1px solid ${acc.status === 'online' ? '#10b98130' : '#f59e0b30'}`
                              }}>
                          <span className={`w-1.5 h-1.5 rounded-full ${acc.status === 'online' ? 'bg-[var(--mf-success-500)] animate-pulse' : 'bg-[var(--mf-warning-500)]'}`} />
                          {acc.status === 'online' ? 'Online' : 'Instável'}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <span className="text-sm font-bold text-white w-8">{acc.health}%</span>
                          <div className="w-24 h-2 rounded-full bg-white/10 overflow-hidden">
                            <motion.div 
                              initial={{ width: 0 }} 
                              animate={{ width: `${acc.health}%` }} 
                              transition={{ duration: 1, delay: 1.2 + (i * 0.1) }}
                              className="h-full rounded-full"
                              style={{ background: acc.health > 80 ? 'var(--mf-success-500)' : acc.health > 50 ? 'var(--mf-warning-500)' : 'var(--mf-danger-500)' }}
                            />
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`text-sm font-bold ${acc.trend.startsWith('+') ? 'text-[var(--mf-success-500)]' : 'text-[var(--mf-danger-500)]'}`}>
                          {acc.trend}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <button className="p-2 rounded-lg text-[var(--mf-text-2)] hover:text-white hover:bg-white/10 transition-colors">
                          <MoreHorizontal size={18} />
                        </button>
                      </td>
                    </motion.tr>
                  ))}
                </tbody>
              </table>
            </div>
          </GlassCard>

          <div className="h-20" /> {/* Bottom padding */}
        </div>
      </main>
    </div>
  );
}
class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { hasError: false, error: null }; }
  static getDerivedStateFromError(error) { return { hasError: true, error }; }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{padding: 50, color: "red", background: "#000", height: "100vh", width: "100vw"}}>
          <h2>Ocorreu um erro ao renderizar o DashboardV2:</h2>
          <pre style={{whiteSpace: "pre-wrap"}}>{this.state.error?.toString()}</pre>
          <pre style={{whiteSpace: "pre-wrap", marginTop: 20}}>{this.state.error?.stack}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function DashboardV2Wrapper() {
  return (
    <ErrorBoundary>
      <DashboardV2 />
    </ErrorBoundary>
  );
}

