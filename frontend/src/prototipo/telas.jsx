/**
 * Telas do protótipo. Dados fictícios, zero chamada de rede.
 *
 * Cada tela existe para provar uma decisão do design system em uso real —
 * densidade, hierarquia, estado vazio, carregamento, tabela no celular — e não
 * para ficar bonita numa captura de tela.
 */
import { useState } from 'react';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import {
  Users, Send, Megaphone, Cpu, BarChart3, Settings, Plus, Filter,
  Search, Upload, Image as ImageIcon, Play, RefreshCw, Zap, Eye, Palette,
} from 'lucide-react';

import { PageHeader, Botao, Card, KpiCard, Selo, Vazio, Skel, KpiSkeleton, Progresso, Avatar, Etapas } from './ui';
import { KPIS, SERIE, CONTAS, JOBS, CAMPANHAS, ATIVIDADE, ETAPAS_CAMPANHA, MODULOS } from './dados';

/* Estilo comum do tooltip dos gráficos — o padrão do recharts é claro e
   destoa por completo de uma interface escura. */
const TOOLTIP = {
  contentStyle: {
    background: 'var(--mf-surface-2)',
    border: '1px solid var(--mf-border-strong)',
    borderRadius: 10, fontSize: 12, boxShadow: 'var(--mf-shadow-2)',
  },
  labelStyle: { color: 'var(--mf-text-3)', fontSize: 11, marginBottom: 4 },
};

const eixo = { stroke: 'var(--mf-text-3)', fontSize: 11, tickLine: false, axisLine: false };

/* ═══════════════════════════════════════════════════════════════════════════
   DASHBOARD
   ═══════════════════════════════════════════════════════════════════════════ */
export function Dashboard() {
  const [carregando, setCarregando] = useState(false);

  const recarregar = () => {
    setCarregando(true);
    setTimeout(() => setCarregando(false), 1400);
  };

  return (
    <>
      <PageHeader
        titulo="Dashboard" modulo="metricas"
        sub="Visão geral das contas, publicações e automações"
        acoes={
          <>
            <Botao onClick={recarregar} carregando={carregando}>
              {!carregando && <RefreshCw size={14} />} Atualizar
            </Botao>
            <Botao variante="primary"><Plus size={14} /> Nova campanha</Botao>
          </>
        }
      />

      {/* KPIs — o esqueleto tem a MESMA forma do card final, então nada salta
          de posição quando o dado chega. */}
      <div className="mf-grid mf-grid--kpi mf-sec">
        {carregando
          ? KPIS.map(k => <KpiSkeleton key={k.id} />)
          : KPIS.map((k, i) => (
              <KpiCard key={k.id} label={k.label} valor={k.bruto} delta={k.delta}
                vs={k.vs} modulo={k.modulo}
                serie={SERIE.map(s => (i % 2 ? s.publicacoes : s.alcance))}
                icone={[<BarChart3 size={14} key="a" />, <Users size={14} key="b" />,
                        <Send size={14} key="c" />, <Eye size={14} key="d" />][i]} />
            ))}
      </div>

      {/* Analytics 2:1 + atividade */}
      <div className="mf-split mf-sec mf-reveal">
        <Card titulo="Alcance nos últimos 14 dias" sub="Somatório de todas as contas conectadas"
          acoes={<Selo tom="info">tempo real</Selo>} destaque>
          <div style={{ height: 260 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={SERIE} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
                <defs>
                  <linearGradient id="mfArea" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%"   stopColor="var(--mf-mod-metricas)" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="var(--mf-mod-metricas)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--mf-border)" vertical={false} />
                <XAxis dataKey="dia" {...eixo} />
                <YAxis {...eixo} width={46} />
                <Tooltip {...TOOLTIP} />
                <Area type="monotone" dataKey="alcance" stroke="var(--mf-mod-metricas)"
                  strokeWidth={2} fill="url(#mfArea)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card titulo="Atividade" sub="Últimos eventos">
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--mf-3)' }}>
            {ATIVIDADE.map((a, i) => (
              <li key={i} className="mf-row" style={{ alignItems: 'flex-start', gap: 'var(--mf-3)' }}>
                <span className="mf-badge__dot" style={{
                  marginTop: 6, flexShrink: 0,
                  color: `var(--mf-${a.tom === 'success' ? 'success' : a.tom === 'warning' ? 'warning' : a.tom === 'danger' ? 'danger' : 'info'}-500)`,
                }} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 'var(--mf-t-sm)' }}>{a.txt}</div>
                  <div style={{ fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text-3)' }}>{a.t}</div>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      {/* Contas + jobs, mesma linha */}
      <div className="mf-split mf-reveal mf-defer">
        <Card titulo="Contas" sub={`${CONTAS.length} cadastradas`}
          acoes={<Botao tamanho="sm" variante="ghost">Ver todas</Botao>} semCorpo>
          <div className="mf-table-wrap">
            <table className="mf-table mf-table--stack">
              <thead><tr><th>Conta</th><th>Seguidores</th><th>Status</th><th>Saúde</th></tr></thead>
              <tbody>
                {CONTAS.slice(0, 4).map(c => (
                  <tr key={c.id}>
                    <td data-label="Conta">
                      <div className="mf-row">
                        <Avatar nome={c.nome} tamanho={28} />
                        <span className="mf-trunc">@{c.user}</span>
                      </div>
                    </td>
                    <td data-label="Seguidores" className="mf-mono">{c.segs.toLocaleString('pt-BR')}</td>
                    <td data-label="Status"><Selo estado={c.status} /></td>
                    <td data-label="Saúde" style={{ minWidth: 90 }}><Progresso valor={c.saude} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card titulo="Jobs" sub="Execuções em andamento">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--mf-4)' }}>
            {JOBS.slice(0, 3).map(j => (
              <div key={j.id} style={{ minWidth: 0 }}>
                <div className="mf-row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
                  <span className="mf-trunc" style={{ fontSize: 'var(--mf-t-sm)', fontWeight: 600 }}>{j.nome}</span>
                  <Selo estado={j.status} />
                </div>
                <Progresso valor={j.progresso} />
              </div>
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   CONTAS
   ═══════════════════════════════════════════════════════════════════════════ */
export function Contas() {
  const [busca, setBusca] = useState('');
  const lista = CONTAS.filter(c => `${c.user} ${c.nome}`.toLowerCase().includes(busca.toLowerCase()));

  return (
    <>
      <PageHeader titulo="Contas" modulo="contas"
        sub="Central de gerenciamento — conexão, saúde e saída de IP"
        acoes={<Botao variante="primary"><Plus size={14} /> Conectar conta</Botao>} />

      <div className="mf-row mf-sec" style={{ gap: 'var(--mf-2)', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
          <Search size={14} style={{ position: 'absolute', left: 11, top: 11, color: 'var(--mf-text-3)' }} />
          <input className="mf-input" style={{ paddingLeft: 32 }} placeholder="Buscar conta…"
            value={busca} onChange={e => setBusca(e.target.value)} />
        </div>
        <Botao><Filter size={14} /> Filtros</Botao>
      </div>

      {lista.length === 0 ? (
        <Card>
          <Vazio modulo="contas" icone={<Users size={24} />}
            titulo="Nenhuma conta encontrada"
            descricao="Nenhuma conta bate com essa busca. Ajuste o termo ou conecte uma conta nova."
            acao={<Botao variante="primary" tamanho="sm">Conectar conta</Botao>} />
        </Card>
      ) : (
        <div className="mf-grid mf-grid--cards">
          {lista.map(c => (
            <article key={c.id} className="mf-card mf-card--hover" style={{ '--mf-mod': MODULOS.contas }}>
              <div className="mf-card__body" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--mf-4)' }}>
                <div className="mf-row" style={{ justifyContent: 'space-between' }}>
                  <div className="mf-row" style={{ minWidth: 0 }}>
                    <Avatar nome={c.nome} />
                    <div style={{ minWidth: 0 }}>
                      <div className="mf-trunc" style={{ fontWeight: 650, fontSize: 'var(--mf-t-sm)' }}>@{c.user}</div>
                      <div className="mf-trunc" style={{ fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text-3)' }}>{c.nome}</div>
                    </div>
                  </div>
                  <Selo estado={c.status} />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 'var(--mf-2)' }}>
                  {[['Seguidores', c.segs.toLocaleString('pt-BR')], ['Posts', c.posts], ['Última', c.ultima]].map(([r, v]) => (
                    <div key={r} style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text-3)' }}>{r}</div>
                      <div className="mf-mono mf-trunc" style={{ fontSize: 'var(--mf-t-sm)', fontWeight: 600 }}>{v}</div>
                    </div>
                  ))}
                </div>

                <Progresso valor={c.saude} rotulo="Saúde da sessão" />

                <div className="mf-row" style={{ justifyContent: 'space-between' }}>
                  <span className="mf-mono" style={{ fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text-3)' }}>IP {c.ip}</span>
                  <Botao tamanho="sm" variante="ghost">Gerenciar</Botao>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   PUBLICAR
   ═══════════════════════════════════════════════════════════════════════════ */
export function Publicar() {
  const [fase, setFase] = useState('idle');
  const FASES = { idle: 'Publicar agora', preparando: 'Preparando mídia…', processando: 'Enviando…', ok: 'Publicado ✓' };

  /* A publicação é a ação mais cara da interface: mostrar cada etapa é o que
     impede o usuário de clicar duas vezes achando que não funcionou. */
  const publicar = () => {
    setFase('preparando');
    setTimeout(() => setFase('processando'), 900);
    setTimeout(() => setFase('ok'), 2200);
    setTimeout(() => setFase('idle'), 4200);
  };

  return (
    <>
      <PageHeader titulo="Publicar" modulo="publicar"
        sub="Envie para várias contas com intervalo humanizado"
        acoes={<Botao variante="ghost">Salvar rascunho</Botao>} />

      <div className="mf-split">
        <div className="mf-col">
          <Card titulo="Mídia" sub="Arraste os arquivos ou escolha da biblioteca">
            <div style={{
              border: '1.5px dashed var(--mf-border-strong)', borderRadius: 'var(--mf-r-lg)',
              padding: 'var(--mf-10) var(--mf-6)', textAlign: 'center',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--mf-3)',
            }}>
              <Upload size={26} style={{ color: 'var(--mf-text-3)' }} />
              <div style={{ fontWeight: 650 }}>Arraste vídeos ou imagens</div>
              <div className="mf-muted" style={{ fontSize: 'var(--mf-t-xs)' }}>MP4, MOV, JPG ou PNG · até 100 MB</div>
              <Botao tamanho="sm">Escolher arquivos</Botao>
            </div>

            <div className="mf-grid" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(min(100%,120px),1fr))', marginTop: 'var(--mf-4)' }}>
              {[['reel-agosto.mp4', '00:28 · 1080×1920'], ['capa-01.jpg', '1080×1350']].map(([n, m], i) => (
                <div key={n} className="mf-card" style={{ padding: 'var(--mf-2)' }}>
                  <div style={{
                    aspectRatio: '3/4', borderRadius: 'var(--mf-r-sm)', display: 'grid', placeItems: 'center',
                    background: 'var(--mf-surface-3)', color: 'var(--mf-text-3)',
                  }}>{i === 0 ? <Play size={20} /> : <ImageIcon size={20} />}</div>
                  <div className="mf-trunc" style={{ fontSize: 'var(--mf-t-micro)', marginTop: 6 }}>{n}</div>
                  <div className="mf-trunc mf-muted mf-mono" style={{ fontSize: 'var(--mf-t-micro)' }}>{m}</div>
                </div>
              ))}
            </div>
          </Card>

          <Card titulo="Legenda">
            <div className="mf-field">
              <textarea className="mf-input" rows={4} style={{ height: 'auto', padding: 'var(--mf-3)', resize: 'vertical' }}
                defaultValue="Chegou a novidade que você pediu 🔥 {username}" />
              <div className="mf-row" style={{ justifyContent: 'space-between' }}>
                <div className="mf-row" style={{ gap: 'var(--mf-2)' }}>
                  <Botao tamanho="sm" variante="ghost">Biblioteca</Botao>
                  <Botao tamanho="sm" variante="ghost"><Zap size={12} /> Gerar com IA</Botao>
                </div>
                <span className="mf-mono mf-muted" style={{ fontSize: 'var(--mf-t-micro)' }}>46 / 2200</span>
              </div>
            </div>
          </Card>
        </div>

        <div className="mf-col">
          <Card titulo="Contas" sub="3 de 5 selecionadas">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--mf-2)' }}>
              {CONTAS.slice(0, 5).map((c, i) => (
                <label key={c.id} className="mf-row" style={{
                  padding: 'var(--mf-2)', borderRadius: 'var(--mf-r-md)', cursor: 'pointer',
                  background: i < 3 ? 'oklch(1 0 0 / 0.04)' : 'transparent',
                }}>
                  <input type="checkbox" defaultChecked={i < 3} style={{ accentColor: 'var(--mf-primary-500)' }} />
                  <Avatar nome={c.nome} tamanho={26} />
                  <span className="mf-trunc" style={{ fontSize: 'var(--mf-t-sm)' }}>@{c.user}</span>
                </label>
              ))}
            </div>
          </Card>

          <Card titulo="Intervalo">
            <div className="mf-field">
              <label className="mf-label">Entre publicações</label>
              <input className="mf-input" type="range" min="1" max="60" defaultValue="4" style={{ padding: 0, accentColor: 'var(--mf-primary-500)' }} />
              <p className="mf-muted" style={{ fontSize: 'var(--mf-t-xs)', margin: 0 }}>
                2 a 5 min entre contas, com ordem sorteada a cada rodada.
              </p>
            </div>
          </Card>

          <Botao variante="primary" onClick={publicar}
            carregando={fase === 'preparando' || fase === 'processando'}
            disabled={fase === 'ok'}
            style={{ width: '100%', height: 42 }}>
            {FASES[fase]}
          </Botao>
        </div>
      </div>
    </>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   CAMPANHAS
   ═══════════════════════════════════════════════════════════════════════════ */
export function Campanhas() {
  const [etapa, setEtapa] = useState(2);

  return (
    <>
      <PageHeader titulo="Campanhas" modulo="campanhas"
        sub="Distribuição planejada entre contas e conteúdos"
        acoes={<Botao variante="primary"><Plus size={14} /> Nova campanha</Botao>} />

      <Card titulo="Nova campanha" sub="O usuário sempre sabe onde está e o que falta" className="mf-sec">
        <Etapas etapas={ETAPAS_CAMPANHA} atual={etapa} />
        <div className="mf-row" style={{ justifyContent: 'space-between', marginTop: 'var(--mf-4)' }}>
          <Botao tamanho="sm" onClick={() => setEtapa(e => Math.max(0, e - 1))} disabled={etapa === 0}>Voltar</Botao>
          <span className="mf-muted" style={{ fontSize: 'var(--mf-t-xs)' }}>
            {etapa + 1} de {ETAPAS_CAMPANHA.length} · até 24 publicações
          </span>
          <Botao tamanho="sm" variante="primary"
            onClick={() => setEtapa(e => Math.min(ETAPAS_CAMPANHA.length - 1, e + 1))}
            disabled={etapa === ETAPAS_CAMPANHA.length - 1}>Continuar</Botao>
        </div>
      </Card>

      <div style={{ height: 'var(--mf-6)' }} />

      <Card titulo="Campanhas ativas" semCorpo>
        <div className="mf-table-wrap">
          <table className="mf-table mf-table--stack">
            <thead>
              <tr><th>Campanha</th><th>Contas</th><th>Conteúdos</th><th>Progresso</th><th>Status</th></tr>
            </thead>
            <tbody>
              {CAMPANHAS.map(c => (
                <tr key={c.id}>
                  <td data-label="Campanha"><span style={{ fontWeight: 600 }}>{c.nome}</span></td>
                  <td data-label="Contas" className="mf-mono">{c.contas}</td>
                  <td data-label="Conteúdos" className="mf-mono">{c.conteudos}</td>
                  <td data-label="Progresso" style={{ minWidth: 120 }}>
                    <Progresso valor={Math.round((c.feitas / c.publicacoes) * 100)}
                      rotulo={`${c.feitas}/${c.publicacoes}`} />
                  </td>
                  <td data-label="Status"><Selo estado={c.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   JOBS
   ═══════════════════════════════════════════════════════════════════════════ */
export function Jobs() {
  return (
    <>
      <PageHeader titulo="Jobs" modulo="jobs" sub="Execuções, filas e rodadas em andamento"
        acoes={<Botao><RefreshCw size={14} /> Atualizar</Botao>} />

      <div className="mf-grid mf-grid--kpi mf-sec">
        {[['Em execução', '1', 'jobs'], ['Na fila', '3', 'jobs'], ['Concluídos hoje', '18', 'metricas'], ['Com erro', '1', 'campanhas']]
          .map(([l, v, m]) => (
            <article key={l} className="mf-card" style={{ '--mf-mod': MODULOS[m] }}>
              <div className="mf-kpi">
                <div className="mf-kpi__top">
                  <span className="mf-kpi__label">{l}</span>
                  <span className="mf-kpi__ico"><Cpu size={14} /></span>
                </div>
                <div className="mf-kpi__value">{v}</div>
              </div>
            </article>
          ))}
      </div>

      <Card titulo="Execuções" semCorpo>
        <div className="mf-table-wrap">
          <table className="mf-table mf-table--stack">
            <thead>
              <tr><th>Job</th><th>Tipo</th><th>Contas</th><th>Progresso</th><th>Status</th><th>Próxima</th></tr>
            </thead>
            <tbody>
              {JOBS.map(j => (
                <tr key={j.id}>
                  <td data-label="Job">
                    <div style={{ fontWeight: 600 }}>{j.nome}</div>
                    <div className="mf-mono mf-muted" style={{ fontSize: 'var(--mf-t-micro)' }}>{j.id}</div>
                  </td>
                  <td data-label="Tipo">{j.tipo}</td>
                  <td data-label="Contas" className="mf-mono">{j.contas}</td>
                  <td data-label="Progresso" style={{ minWidth: 120 }}><Progresso valor={j.progresso} /></td>
                  <td data-label="Status"><Selo estado={j.status} /></td>
                  <td data-label="Próxima" className="mf-mono mf-muted">{j.proxima}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   MÉTRICAS
   ═══════════════════════════════════════════════════════════════════════════ */
export function Metricas() {
  return (
    <>
      <PageHeader titulo="Métricas" modulo="metricas" sub="Alcance, publicações e desempenho por conta"
        acoes={<Botao><Filter size={14} /> Últimos 30 dias</Botao>} />

      <div className="mf-grid mf-grid--kpi mf-sec">
        {KPIS.map((k, i) => (
          <KpiCard key={k.id} label={k.label} valor={k.bruto} delta={k.delta} vs={k.vs}
            modulo={k.modulo} serie={SERIE.map(s => (i % 2 ? s.publicacoes : s.alcance))} />
        ))}
      </div>

      <div className="mf-split mf-sec mf-reveal mf-defer">
        <Card titulo="Publicações por dia">
          <div style={{ height: 240 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={SERIE} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--mf-border)" vertical={false} />
                <XAxis dataKey="dia" {...eixo} />
                <YAxis {...eixo} width={34} />
                <Tooltip {...TOOLTIP} cursor={{ fill: 'oklch(1 0 0 / 0.04)' }} />
                <Bar dataKey="publicacoes" fill="var(--mf-mod-publicar)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card titulo="Por conta" sub="Alcance no período">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--mf-4)' }}>
            {CONTAS.slice(0, 4).map(c => (
              <div key={c.id} style={{ minWidth: 0 }}>
                <div className="mf-row" style={{ justifyContent: 'space-between', marginBottom: 5 }}>
                  <span className="mf-trunc" style={{ fontSize: 'var(--mf-t-sm)' }}>@{c.user}</span>
                  <span className="mf-mono" style={{ fontSize: 'var(--mf-t-xs)' }}>{(c.segs * 4.2 / 1000).toFixed(1)}K</span>
                </div>
                <Progresso valor={Math.min(100, Math.round(c.segs / 45))} />
              </div>
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   CONFIGURAÇÕES
   ═══════════════════════════════════════════════════════════════════════════ */
export function Configuracoes() {
  return (
    <>
      <PageHeader titulo="Configurações" modulo="sistema" sub="Preferências do sistema e integrações"
        acoes={<Botao variante="primary">Salvar</Botao>} />

      <div className="mf-split">
        <div className="mf-col">
          <Card titulo="Publicação" sub="Regras aplicadas a toda a automação">
            <div className="mf-col">
              <div className="mf-field">
                <label className="mf-label">Intervalo mínimo entre publicações</label>
                <input className="mf-input" defaultValue="3 minutos" />
              </div>
              <div className="mf-field">
                <label className="mf-label">Ordem das contas</label>
                <select className="mf-select" defaultValue="sorteada">
                  <option value="sorteada">Sorteada a cada rodada</option>
                  <option value="fixa">Fixa, como cadastrada</option>
                </select>
              </div>
              <div className="mf-field">
                <label className="mf-label">Limite diário por conta</label>
                <input className="mf-input" defaultValue="12" />
              </div>
            </div>
          </Card>

          <Card titulo="Integrações">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--mf-3)' }}>
              {[['API Meta', 'conectado'], ['Serviço instagrapi', 'conectado'], ['Geração por IA', 'desconectado']].map(([n, s]) => (
                <div key={n} className="mf-row" style={{ justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 'var(--mf-t-sm)' }}>{n}</span>
                  <Selo estado={s} />
                </div>
              ))}
            </div>
          </Card>
        </div>

        <Card titulo="Aparência">
          <div className="mf-col">
            <div className="mf-field">
              <label className="mf-label">Densidade</label>
              <select className="mf-select" defaultValue="confortavel">
                <option value="compacta">Compacta</option>
                <option value="confortavel">Confortável</option>
              </select>
            </div>
            <p className="mf-muted" style={{ fontSize: 'var(--mf-t-xs)', margin: 0, lineHeight: 1.6 }}>
              A identidade inteira vem dos design tokens. Mudar a cor da marca aqui
              repercute em barra lateral, botões, gráficos e selos ao mesmo tempo —
              sem tocar em componente nenhum.
            </p>
            <div className="mf-row" style={{ gap: 'var(--mf-2)', flexWrap: 'wrap' }}>
              {['primary-500', 'accent-500', 'flare-500', 'success-500', 'warning-500', 'danger-500'].map(t => (
                <div key={t} title={`--mf-${t}`} style={{
                  width: 34, height: 34, borderRadius: 'var(--mf-r-md)',
                  background: `var(--mf-${t})`, border: '1px solid var(--mf-border)',
                }} />
              ))}
            </div>
          </div>
        </Card>
      </div>
    </>
  );
}

export const TELAS = {
  dashboard:  { titulo: 'Dashboard',     modulo: 'metricas',  icone: BarChart3, Comp: Dashboard },
  contas:     { titulo: 'Contas',        modulo: 'contas',    icone: Users,     Comp: Contas },
  publicar:   { titulo: 'Publicar',      modulo: 'publicar',  icone: Send,      Comp: Publicar },
  campanhas:  { titulo: 'Campanhas',     modulo: 'campanhas', icone: Megaphone, Comp: Campanhas },
  jobs:       { titulo: 'Jobs',          modulo: 'jobs',      icone: Cpu,       Comp: Jobs },
  metricas:   { titulo: 'Métricas',      modulo: 'metricas',  icone: BarChart3, Comp: Metricas },
  config:     { titulo: 'Configurações', modulo: 'sistema',   icone: Settings,  Comp: Configuracoes },
  sistema:    { titulo: 'Design System',  modulo: 'sistema',   icone: Palette,   Comp: Sistema },
};

/* ═══════════════════════════════════════════════════════════════════════════
   DESIGN SYSTEM — o mostruário
   Existe para a aprovação não depender de imaginar: os tokens e os estados
   aparecem aqui como são, e mudam junto quando o tema ou a densidade muda.
   ═══════════════════════════════════════════════════════════════════════════ */
export function Sistema() {
  const CORES = [
    ['primary-500', 'Marca'], ['accent-500', 'Acento'], ['flare-500', 'Destaque'],
    ['success-500', 'Sucesso'], ['warning-500', 'Atenção'], ['danger-500', 'Erro'],
    ['info-500', 'Info'], ['mod-contas', 'Contas'], ['mod-publicar', 'Publicar'],
    ['mod-campanhas', 'Campanhas'], ['mod-jobs', 'Jobs'], ['mod-metricas', 'Métricas'],
  ];
  const TIPOS = [
    ['--mf-t-display', 'Display', 'Alcance total'],
    ['--mf-t-h1', 'Título', 'Central de controle'],
    ['--mf-t-h2', 'Seção', 'Campanhas ativas'],
    ['--mf-t-body', 'Corpo', 'Texto padrão da interface'],
    ['--mf-t-sm', 'Pequeno', 'Rótulos e apoio'],
    ['--mf-t-micro', 'Micro', 'ETIQUETAS E METADADOS'],
  ];

  return (
    <>
      <PageHeader titulo="Design System" modulo="sistema"
        sub="Tokens, componentes e estados — a fonte única da identidade" />

      <Card titulo="Paleta" sub="Trocar um token repercute em toda a interface" className="mf-sec">
        <div className="mf-grid" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(min(100%,140px),1fr))' }}>
          {CORES.map(([t, n]) => (
            <div key={t} className="mf-swatch">
              <div className="mf-swatch__chip" style={{ background: `var(--mf-${t})` }} />
              <div className="mf-swatch__n">{n}</div>
              <div className="mf-swatch__v">--mf-{t}</div>
            </div>
          ))}
        </div>
      </Card>

      <div style={{ height: 'var(--mf-6)' }} />

      <div className="mf-split mf-sec">
        <Card titulo="Tipografia" sub="Geist · escala fluida com clamp()">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--mf-4)' }}>
            {TIPOS.map(([v, n, ex]) => (
              <div key={v} style={{ minWidth: 0 }}>
                <div className="mf-mono mf-muted" style={{ fontSize: 'var(--mf-t-micro)' }}>{n} · {v}</div>
                <div className="mf-trunc" style={{ fontSize: `var(${v})`, fontWeight: 650, letterSpacing: '-0.02em' }}>{ex}</div>
              </div>
            ))}
          </div>
        </Card>

        <Card titulo="Estados">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--mf-4)' }}>
            <div className="mf-row" style={{ flexWrap: 'wrap', gap: 'var(--mf-2)' }}>
              {['conectado', 'processando', 'atencao', 'desconectado', 'agendado', 'publicado', 'pausado', 'erro']
                .map(e => <Selo key={e} estado={e} />)}
            </div>
            <div className="mf-row" style={{ flexWrap: 'wrap', gap: 'var(--mf-2)' }}>
              <Botao variante="primary">Primário</Botao>
              <Botao>Secundário</Botao>
              <Botao variante="ghost">Fantasma</Botao>
              <Botao variante="danger">Destrutivo</Botao>
              <Botao carregando>Carregando</Botao>
              <Botao disabled>Desativado</Botao>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--mf-2)' }}>
              <Skel h={12} w="70%" /><Skel h={12} w="45%" /><Skel h={12} w="60%" />
            </div>
          </div>
        </Card>
      </div>

      <Card titulo="Estado vazio" sub="Sempre com contexto e próximo passo">
        <Vazio modulo="campanhas" icone={<Megaphone size={24} />}
          titulo="Nenhuma campanha criada"
          descricao="Crie sua primeira campanha para distribuir conteúdo entre várias contas com intervalo humanizado."
          acao={<Botao variante="primary" tamanho="sm"><Plus size={14} /> Criar campanha</Botao>} />
      </Card>
    </>
  );
}
