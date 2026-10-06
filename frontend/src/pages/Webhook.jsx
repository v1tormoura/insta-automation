import { useCallback, useEffect, useMemo, useState } from 'react';
import { Copy, Check, Link2, Trash2, Plus, Webhook as IconeWebhook, RefreshCw, ChevronDown, ChevronRight,
  MousePointerClick, UserPlus, ShoppingCart, BadgeCheck, Wallet, Search, Radio } from 'lucide-react';
import PageShell from '../components/PageShell';
import api from '../services/api';
import { avisar } from '../services/avisos';
import { useServerEvents } from '../services/useServerEvents';
import { fmtNum, real, pct, quandoFoi, quando } from '../services/formatoWebhook';

/**
 * Webhook — o que o bot de vendas (ApexVIP, SharkBot, checkout…) conta para o
 * Nexora: quem entrou, quem clicou em comprar e quem pagou, e de qual conta
 * do Instagram veio. Três abas: os números, as pessoas, e a configuração.
 *
 * Gráficos: uma cor só (magnitude); número sempre escrito; tooltip no hover.
 */

const PERIODOS = [[7, '7 dias'], [30, '30 dias'], [90, '90 dias']];
const ABAS = [['visao', 'Visão geral'], ['leads', 'Leads'], ['config', 'Configuração']];
const FILTROS = [['', 'Todos'], ['entrou', 'Não clicaram'], ['checkout', 'Não pagaram'], ['comprou', 'Compraram']];
const ROTULO_ETAPA = { entrou: 'Entrou no bot', checkout: 'Clicou em comprar', comprou: 'Comprou' };

function Segmentado({ opcoes, valor, onMudar, rotulo }) {
  return (
    <div role="group" aria-label={rotulo} style={{ display: 'inline-flex', gap: 2, padding: 3, flexWrap: 'wrap', borderRadius: 'var(--mf-r-md)', background: 'var(--mf-surface-2)', border: '1px solid var(--mf-border)' }}>
      {opcoes.map(([v, r]) => (
        <button key={String(v)} type="button" aria-pressed={valor === v} onClick={() => onMudar(v)}
          style={{ height: 28, padding: '0 12px', border: 'none', borderRadius: 'var(--mf-r-sm)', cursor: 'pointer', fontSize: 'var(--mf-t-micro)', fontWeight: 700,
            background: valor === v ? 'var(--mf-primary-500)' : 'transparent', color: valor === v ? 'var(--mf-bg)' : 'var(--mf-text-3)' }}>{r}</button>
      ))}
    </div>
  );
}

function Copiar({ texto, rotulo = 'Copiar' }) {
  const [ok, setOk] = useState(false);
  return (
    <button type="button" className="btn btn-ghost btn-sm" style={{ gap: 5, flexShrink: 0 }}
      onClick={() => { navigator.clipboard?.writeText(texto).catch(() => {}); setOk(true); setTimeout(() => setOk(false), 1500); }}>
      {ok ? <Check size={13} /> : <Copy size={13} />} {ok ? 'Copiado' : rotulo}
    </button>
  );
}

function Cartao({ titulo, direita, children, style }) {
  return (
    <section className="mf-card" style={{ padding: 'var(--mf-4)', minWidth: 0, ...style }}>
      {titulo && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 'var(--mf-3)', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 'var(--mf-t-sm)', fontWeight: 700, color: 'var(--mf-text)' }}>{titulo}</span>
          <span style={{ flex: 1 }} />
          {direita}
        </div>
      )}
      {children}
    </section>
  );
}

/** KPI: ícone, número grande, legenda e uma linha de contexto. */
function Kpi({ Icone, rotulo, valor, contexto, destaque }) {
  return (
    <div className="mf-card" data-kpi style={{ padding: '14px 16px', minWidth: 0,
      ...(destaque ? { background: 'color-mix(in oklch, var(--mf-primary-500) 8%, var(--mf-surface-1))', borderColor: 'color-mix(in oklch, var(--mf-primary-500) 35%, transparent)' } : {}) }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ width: 28, height: 28, borderRadius: 'var(--mf-r-sm)', display: 'grid', placeItems: 'center', flexShrink: 0,
          background: 'color-mix(in oklch, var(--mf-primary-500) 14%, transparent)', color: 'var(--mf-primary-500)' }}><Icone size={15} /></span>
        <span style={{ fontSize: 'var(--mf-t-nano)', fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--mf-text-3)' }}>{rotulo}</span>
      </div>
      <div style={{ fontSize: 'var(--mf-t-h1)', fontWeight: 800, color: 'var(--mf-text)', fontVariantNumeric: 'tabular-nums', marginTop: 8, lineHeight: 1.1 }}>{valor}</div>
      <div style={{ fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text-3)', marginTop: 4, minHeight: 16 }}>{contexto}</div>
    </div>
  );
}

/** Receita por dia: barras de uma cor; o hover mostra o dia inteiro. */
function ReceitaPorDia({ serie }) {
  const [sobre, setSobre] = useState(null);
  const max = Math.max(1, ...serie.map(d => d.receita));
  const ponto = sobre != null ? serie[sobre] : null;
  const total = serie.reduce((s, d) => s + d.receita, 0);
  const diaCurto = d => new Date(`${d}T12:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  return (
    <div>
      <div style={{ minHeight: 34, fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text-3)', marginBottom: 6 }}>
        {ponto ? <>
          <strong style={{ color: 'var(--mf-text)' }}>{diaCurto(ponto.dia)}</strong> · {real(ponto.receita)} · {fmtNum(ponto.comprou)} venda(s) · {fmtNum(ponto.entrou)} lead(s) · {fmtNum(ponto.checkout)} clicaram em comprar
        </> : <>Total no período: <strong style={{ color: 'var(--mf-text)' }}>{real(total)}</strong> — passe o mouse nas barras para ver o dia.</>}
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: serie.length > 20 ? 2 : 4, height: 150, borderBottom: '1px solid var(--mf-border)' }}
        onMouseLeave={() => setSobre(null)}>
        {serie.map((d, i) => (
          <div key={d.dia} onMouseEnter={() => setSobre(i)} title={`${diaCurto(d.dia)}: ${real(d.receita)} · ${d.comprou} venda(s)`}
            style={{ flex: 1, height: '100%', display: 'flex', alignItems: 'flex-end', cursor: 'default' }}>
            <div style={{ width: '100%', height: d.receita ? `${Math.max(3, (d.receita / max) * 100)}%` : 2, borderRadius: '4px 4px 0 0',
              background: d.receita ? 'var(--mf-primary-500)' : 'var(--mf-border)', opacity: sobre == null || sobre === i ? 1 : .45, transition: 'opacity .15s' }} />
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--mf-t-nano)', color: 'var(--mf-text-3)', marginTop: 4 }}>
        <span>{serie[0] ? diaCurto(serie[0].dia) : ''}</span><span>hoje</span>
      </div>
    </div>
  );
}

export default function Webhook() {
  const [aba, setAba] = useState('visao');
  const [dias, setDias] = useState(30);
  const [resumo, setResumo] = useState(null);
  const [filtro, setFiltro] = useState('checkout');
  const [busca, setBusca] = useState('');
  const [leads, setLeads] = useState(null);
  const [config, setConfig] = useState(null);
  const [links, setLinks] = useState([]);
  const [contas, setContas] = useState([]);
  const [novo, setNovo] = useState({ destino: '', accountId: '', rotulo: '' });
  const [eventos, setEventos] = useState([]);
  const [conteudo, setConteudo] = useState(null);
  const [aberto, setAberto] = useState(null);

  const carregar = useCallback(() => {
    api.get('/funil/resumo', { params: { dias } }).then(r => setResumo(r.data)).catch(() => setResumo(null));
    api.get('/funil/leads', { params: { dias, etapa: filtro } }).then(r => setLeads(r.data)).catch(() => setLeads({ leads: [], total: 0 }));
    api.get('/funil/eventos').then(r => setEventos(r.data.eventos || [])).catch(() => {});
    api.get('/funil/links').then(r => setLinks(r.data.links || [])).catch(() => {});
    api.get('/funil/por-conteudo', { params: { dias } }).then(r => setConteudo(r.data)).catch(() => setConteudo(null));
  }, [dias, filtro]);

  useEffect(() => { carregar(); }, [carregar]);
  useEffect(() => {
    api.get('/funil/config').then(r => setConfig(r.data)).catch(() => {});
    api.get('/accounts', { params: { limit: 500 } }).then(r => setContas(r.data?.accounts || [])).catch(() => {});
  }, []);
  useServerEvents(['funil'], () => carregar());

  const e = resumo?.etapas || {};
  const semDados = resumo && !resumo.ultimoEvento;
  const origens = resumo?.origens || [];
  const leadsVisiveis = useMemo(() => {
    const t = busca.trim().toLowerCase();
    const l = leads?.leads || [];
    return t ? l.filter(x => [x.nome, x.username, x.email, x.telefone, x.origem, x.plano].some(v => String(v || '').toLowerCase().includes(t))) : l;
  }, [leads, busca]);

  async function criarLink() {
    try {
      const { data } = await api.post('/funil/links', novo);
      navigator.clipboard?.writeText(data.url).catch(() => {});
      avisar('success', 'Link criado e copiado', 'Cole na bio ou na legenda da conta.');
      setNovo(n => ({ ...n, rotulo: '', accountId: '' }));
      carregar();
    } catch (err) { avisar('error', 'Não foi possível', err.response?.data?.error || err.message); }
  }
  async function apagarLink(id) { await api.delete(`/funil/links/${id}`).catch(() => {}); carregar(); }
  async function novoToken() {
    if (!window.confirm('Gerar uma URL nova? A antiga para de funcionar — atualize no bot.')) return;
    const { data } = await api.post('/funil/config/novo-token');
    setConfig(c => ({ ...c, webhook: data.webhook }));
  }

  const etapas = [
    ['cliques', 'Clicaram no link', 'bio / legenda'],
    ['entrou', 'Entraram no bot', 'start'],
    ['checkout', 'Clicaram em comprar', 'checkout / PIX'],
    ['comprou', 'Compraram', 'pagamento aprovado'],
  ];
  const maxEtapa = Math.max(1, ...etapas.map(([k]) => e[k] || 0));

  return (
    <PageShell icon={<IconeWebhook size={18} />} title="Webhook"
      subtitle="O que o seu bot de vendas conta: quem entrou, quem clicou em comprar, quem pagou — e de qual conta veio"
      actions={<Segmentado rotulo="Período" opcoes={PERIODOS} valor={dias} onMudar={setDias} />}>

      {/* Abas + status do webhook */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 'var(--mf-4)', borderBottom: '1px solid var(--mf-border)' }}>
        <div role="tablist" style={{ display: 'flex', gap: 4 }}>
          {ABAS.map(([id, r]) => (
            <button key={id} type="button" role="tab" aria-selected={aba === id} onClick={() => setAba(id)}
              style={{ padding: '10px 14px', marginBottom: -1, cursor: 'pointer', background: 'none', border: 'none',
                borderBottom: `2px solid ${aba === id ? 'var(--mf-primary-500)' : 'transparent'}`,
                color: aba === id ? 'var(--mf-text)' : 'var(--mf-text-3)', fontSize: 'var(--mf-t-sm)', fontWeight: aba === id ? 700 : 550 }}>
              {r}
            </button>
          ))}
        </div>
        <span style={{ flex: 1 }} />
        <span data-status-webhook style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text-3)', paddingBottom: 6 }}>
          <Radio size={13} style={{ color: resumo?.ultimoEvento ? 'var(--mf-success-500)' : 'var(--mf-text-3)' }} />
          {resumo?.ultimoEvento ? `Recebendo · último evento ${quandoFoi(resumo.ultimoEvento)}` : 'Aguardando o primeiro evento'}
        </span>
      </div>

      {/* ── Visão geral ── */}
      {aba === 'visao' && (
        <div style={{ display: 'grid', gap: 'var(--mf-4)' }}>
          {semDados && (
            <div className="mf-card" style={{ padding: 'var(--mf-4)', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 'var(--mf-t-sm)', color: 'var(--mf-text-2)', flex: 1, minWidth: 220 }}>
                Nenhum evento recebido ainda. Cole a URL do webhook no seu bot e faça um teste.
              </span>
              <button type="button" className="btn-primary" onClick={() => setAba('config')}>Configurar</button>
            </div>
          )}

          <div style={{ display: 'grid', gap: 'var(--mf-3)', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
            <Kpi Icone={MousePointerClick} rotulo="Cliques no link" valor={fmtNum(e.cliques)} contexto="links rastreados" />
            <Kpi Icone={UserPlus} rotulo="Leads" valor={fmtNum(e.entrou)} contexto={`${fmtNum(resumo?.hoje?.entrou)} hoje`} />
            <Kpi Icone={ShoppingCart} rotulo="Clicaram em comprar" valor={fmtNum(e.checkout)} contexto={`${pct(e.checkout, e.entrou)} dos leads`} />
            <Kpi Icone={BadgeCheck} rotulo="Vendas" valor={fmtNum(e.comprou)} contexto={`${pct(e.comprou, e.checkout)} de quem clicou em comprar`} />
            <Kpi Icone={Wallet} rotulo="Receita" valor={real(resumo?.receita)} contexto={e.comprou ? `ticket médio ${real(resumo?.ticketMedio)}` : 'sem vendas no período'} destaque />
          </div>

          <div style={{ display: 'grid', gap: 'var(--mf-4)', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 460px), 1fr))', alignItems: 'start' }}>
            <Cartao titulo="Funil" direita={<span style={{ fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text-3)' }}>conversão total <strong style={{ color: 'var(--mf-text)' }}>{pct(e.comprou, e.entrou)}</strong></span>}>
              <div style={{ display: 'grid', gap: 14 }} data-funil-etapas>
                {etapas.map(([k, rot, sub], i) => {
                  const v = e[k] || 0;
                  const ant = i ? e[etapas[i - 1][0]] || 0 : null;
                  return (
                    <div key={k} title={`${rot}: ${fmtNum(v)}`}>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 5 }}>
                        <span style={{ fontSize: 'var(--mf-t-xs)', fontWeight: 650, color: 'var(--mf-text)' }}>{rot}</span>
                        <span style={{ fontSize: 'var(--mf-t-nano)', color: 'var(--mf-text-3)' }}>{sub}</span>
                        <span style={{ flex: 1 }} />
                        {ant != null && <span style={{ fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text-3)' }}>{v > ant ? 'inclui quem veio sem o link' : `${pct(v, ant)} da anterior`}</span>}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ flex: 1, height: 18, borderRadius: 4, background: 'color-mix(in oklch, var(--mf-border) 50%, transparent)', overflow: 'hidden' }}>
                          <div style={{ width: v ? `${Math.max(2, (v / maxEtapa) * 100)}%` : 0, height: '100%', borderRadius: 4, background: 'var(--mf-primary-500)', transition: 'width .3s' }} />
                        </div>
                        <span style={{ minWidth: 48, textAlign: 'right', fontSize: 'var(--mf-t-body)', fontWeight: 800, color: 'var(--mf-text)', fontVariantNumeric: 'tabular-nums' }}>{fmtNum(v)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Cartao>

            <Cartao titulo="Receita por dia">
              <ReceitaPorDia serie={resumo?.serie || []} />
            </Cartao>
          </div>

          <Cartao titulo="Que Reel vendeu"
            direita={<span style={{ fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text-3)' }}>
              estimado · última publicação da conta antes da pessoa entrar (até {conteudo?.janelaH || 72}h)
              {conteudo?.cobertura != null ? ` · ${conteudo.cobertura}% dos leads atribuídos` : ''}
            </span>}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--mf-t-xs)', minWidth: 760 }} data-reels-que-venderam>
                <thead>
                  <tr style={{ color: 'var(--mf-text-3)', fontSize: 'var(--mf-t-nano)', textTransform: 'uppercase', letterSpacing: '.06em' }}>
                    {['Reel', 'Envio / etiqueta', 'Alcance', 'Leads', 'Vendas', 'Receita', 'R$ / mil alcance'].map((t, i) => (
                      <th key={t} style={{ textAlign: i > 1 ? 'right' : 'left', padding: '6px 10px', fontWeight: 700, whiteSpace: 'nowrap' }}>{t}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {!(conteudo?.reels?.length) && (
                    <tr><td colSpan={7} style={{ padding: 'var(--mf-5)', textAlign: 'center', color: 'var(--mf-text-3)' }}>
                      Nenhum lead atribuído a um Reel ainda. Precisa do link rastreado <strong>com a conta escolhida</strong> na bio, e de publicações feitas pelo Nexora.
                    </td></tr>
                  )}
                  {(conteudo?.reels || []).slice(0, 15).map(r => (
                    <tr key={r.igMediaId} style={{ borderTop: '1px solid var(--mf-border-subtle)', fontVariantNumeric: 'tabular-nums' }}>
                      <td style={{ padding: 8 }}>
                        <a href={r.permalink || undefined} target="_blank" rel="noreferrer" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none', color: 'inherit', minWidth: 0 }}>
                          <span style={{ width: 34, height: 48, borderRadius: 6, overflow: 'hidden', flexShrink: 0, background: 'var(--mf-surface-3)' }}>
                            {r.thumbnailUrl && <img alt="" loading="lazy" src={`${import.meta.env.VITE_API_URL || 'http://localhost:3000'}/image-proxy?url=${encodeURIComponent(r.thumbnailUrl)}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                          </span>
                          <span style={{ minWidth: 0 }}>
                            <span style={{ display: 'block', fontWeight: 650, color: 'var(--mf-text)' }}>{r.username ? `@${r.username}` : 'conta'}</span>
                            <span style={{ display: 'block', fontSize: 'var(--mf-t-nano)', color: 'var(--mf-text-3)' }}>{quando(r.publicadoEm)}</span>
                          </span>
                        </a>
                      </td>
                      <td style={{ padding: 8, color: 'var(--mf-text-2)' }}>
                        <div className="mf-trunc" style={{ maxWidth: 200 }}>{r.jobName || '—'}</div>
                        {r.rotulo && <span style={{ fontSize: 'var(--mf-t-nano)', padding: '1px 7px', borderRadius: 'var(--mf-r-full)', background: 'var(--mf-surface-3)', color: 'var(--mf-text)' }}>{r.rotulo}</span>}
                      </td>
                      <td style={{ padding: 8, textAlign: 'right', color: 'var(--mf-text-2)' }}>{fmtNum(r.alcance)}</td>
                      <td style={{ padding: 8, textAlign: 'right', color: 'var(--mf-text-2)' }}>{fmtNum(r.leads)}</td>
                      <td style={{ padding: 8, textAlign: 'right', color: 'var(--mf-text-2)' }}>{fmtNum(r.vendas)}</td>
                      <td style={{ padding: 8, textAlign: 'right', fontWeight: 800, color: 'var(--mf-text)' }}>{real(r.receita)}</td>
                      <td style={{ padding: 8, textAlign: 'right', color: 'var(--mf-text-2)' }}>{r.receitaPor1k != null ? real(r.receitaPor1k) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {conteudo?.semAtribuicao?.leads > 0 && (
              <div style={{ fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text-3)', marginTop: 8 }}>
                Sem atribuição: {fmtNum(conteudo.semAtribuicao.leads)} lead(s), {fmtNum(conteudo.semAtribuicao.vendas)} venda(s), {real(conteudo.semAtribuicao.receita)} — entraram sem link de conta ou sem publicação nas {conteudo.janelaH}h anteriores.
              </div>
            )}
          </Cartao>

          <Cartao titulo="De onde vem" direita={<span style={{ fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text-3)' }}>por conta / link rastreado</span>}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--mf-t-xs)', minWidth: 620 }}>
                <thead>
                  <tr style={{ color: 'var(--mf-text-3)', fontSize: 'var(--mf-t-nano)', textTransform: 'uppercase', letterSpacing: '.06em' }}>
                    {['Origem', 'Cliques', 'Leads', 'Clicaram comprar', 'Vendas', 'Conversão', 'Receita'].map((h, i) => (
                      <th key={h} style={{ textAlign: i ? 'right' : 'left', padding: '6px 10px', fontWeight: 700, whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {origens.length === 0 && <tr><td colSpan={7} style={{ padding: 'var(--mf-5)', textAlign: 'center', color: 'var(--mf-text-3)' }}>Sem dados no período.</td></tr>}
                  {origens.map(o => (
                    <tr key={o.origem} style={{ borderTop: '1px solid var(--mf-border-subtle)', fontVariantNumeric: 'tabular-nums' }}>
                      <td style={{ padding: 10, fontWeight: 650, color: o.origem === 'Sem origem' ? 'var(--mf-text-3)' : 'var(--mf-text)' }}>{o.origem}</td>
                      {[o.cliques, o.entrou, o.checkout, o.comprou].map((v, i) => <td key={i} style={{ padding: 10, textAlign: 'right', color: 'var(--mf-text-2)' }}>{fmtNum(v)}</td>)}
                      <td style={{ padding: 10, textAlign: 'right', color: 'var(--mf-text-2)' }}>{pct(o.comprou, o.entrou)}</td>
                      <td style={{ padding: 10, textAlign: 'right', fontWeight: 700, color: 'var(--mf-text)' }}>{real(o.receita)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Cartao>
        </div>
      )}

      {/* ── Leads ── */}
      {aba === 'leads' && (
        <Cartao>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 'var(--mf-3)' }}>
            <Segmentado rotulo="Etapa" opcoes={FILTROS} valor={filtro} onMudar={setFiltro} />
            <span style={{ flex: 1 }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 10px', height: 34, borderRadius: 'var(--mf-r-md)', background: 'var(--mf-surface-2)', border: '1px solid var(--mf-border)', minWidth: 220 }}>
              <Search size={14} style={{ color: 'var(--mf-text-3)' }} />
              <input value={busca} onChange={ev => setBusca(ev.target.value)} placeholder="Buscar nome, @, e-mail, origem…" aria-label="Buscar lead"
                style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: 'var(--mf-text)', fontSize: 'var(--mf-t-xs)' }} />
            </div>
          </div>
          <div style={{ fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text-3)', marginBottom: 8 }}>
            {fmtNum(leadsVisiveis.length)} pessoa(s){filtro === 'checkout' ? ' — clicaram em comprar e não pagaram: o melhor público para remarketing.' : ''}
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--mf-t-xs)', minWidth: 760 }}>
              <thead>
                <tr style={{ color: 'var(--mf-text-3)', fontSize: 'var(--mf-t-nano)', textTransform: 'uppercase', letterSpacing: '.06em' }}>
                  {['Pessoa', 'Contato', 'Etapa', 'Origem', 'Plano / valor', 'Última ação'].map(h => <th key={h} style={{ textAlign: 'left', padding: '6px 10px', fontWeight: 700 }}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {leadsVisiveis.length === 0 && <tr><td colSpan={6} style={{ padding: 'var(--mf-6)', textAlign: 'center', color: 'var(--mf-text-3)' }}>Ninguém aqui no período.</td></tr>}
                {leadsVisiveis.map((l, i) => (
                  <tr key={l.lead || i} style={{ borderTop: '1px solid var(--mf-border-subtle)' }}>
                    <td style={{ padding: 10 }}>
                      <div style={{ color: 'var(--mf-text)', fontWeight: 650 }}>{l.nome || (l.username ? `@${l.username}` : l.lead || '—')}</div>
                      {l.username && l.nome && <div style={{ fontSize: 'var(--mf-t-nano)', color: 'var(--mf-text-3)' }}>@{l.username}</div>}
                    </td>
                    <td style={{ padding: 10, color: 'var(--mf-text-2)' }}>{[l.email, l.telefone].filter(Boolean).join(' · ') || '—'}</td>
                    <td style={{ padding: 10 }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 9px', borderRadius: 'var(--mf-r-full)', fontSize: 'var(--mf-t-nano)', fontWeight: 700,
                        background: 'var(--mf-surface-3)', color: 'var(--mf-text)' }}>
                        {l.etapa === 'comprou' && <Check size={11} />}{ROTULO_ETAPA[l.etapa]}
                      </span>
                    </td>
                    <td style={{ padding: 10, color: 'var(--mf-text-2)' }}>{l.origem || '—'}</td>
                    <td style={{ padding: 10, color: 'var(--mf-text-2)' }}>{[l.plano, l.valor != null ? real(l.valor) : ''].filter(Boolean).join(' · ') || '—'}</td>
                    <td style={{ padding: 10, color: 'var(--mf-text-3)', whiteSpace: 'nowrap' }}>{quando(l.ultimo)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Cartao>
      )}

      {/* ── Configuração ── */}
      {aba === 'config' && (
        <div style={{ display: 'grid', gap: 'var(--mf-4)', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 460px), 1fr))', alignItems: 'start' }}>
          <Cartao titulo="URL do webhook">
            <ol style={{ margin: '0 0 var(--mf-3)', paddingLeft: 18, fontSize: 'var(--mf-t-xs)', color: 'var(--mf-text-2)', lineHeight: 1.8 }}>
              <li>Copie a URL abaixo e cole no campo <strong>URL do Webhook</strong> do seu bot.</li>
              <li>Marque os eventos <strong>Novo Lead</strong>, <strong>Pagamento Criado</strong> e <strong>Pagamento Aprovado</strong>. Secret pode ficar vazio.</li>
              <li>Faça um teste no bot — o evento aparece aqui embaixo na hora.</li>
            </ol>
            {config && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '8px 10px', borderRadius: 'var(--mf-r-sm)', background: 'var(--mf-surface-2)', border: '1px solid var(--mf-border)' }}>
                <code className="mf-trunc" style={{ flex: 1, minWidth: 0, fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text)' }} data-webhook-url>{config.webhook}</code>
                <Copiar texto={config.webhook} />
                <button type="button" className="btn btn-ghost btn-sm" onClick={novoToken} title="Gerar URL nova (a antiga para de funcionar)" aria-label="Gerar URL nova"><RefreshCw size={13} /></button>
              </div>
            )}
            <div style={{ fontSize: 'var(--mf-t-nano)', color: 'var(--mf-text-3)', marginTop: 8, lineHeight: 1.6 }}>
              Se o bot pedir uma URL por evento, acrescente <code>?etapa=entrou</code>, <code>?etapa=checkout</code> ou <code>?etapa=comprou</code> no fim.
            </div>

            <div style={{ fontSize: 'var(--mf-t-nano)', fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--mf-text-3)', margin: 'var(--mf-4) 0 6px' }}>Últimos eventos recebidos</div>
            {eventos.length === 0 && <div style={{ fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text-3)' }}>Nenhum ainda.</div>}
            <div style={{ display: 'grid', gap: 4 }}>
              {eventos.map(ev => (
                <div key={ev.id} style={{ borderRadius: 'var(--mf-r-sm)', background: 'var(--mf-surface-2)' }}>
                  <button type="button" onClick={() => setAberto(a => (a === ev.id ? null : ev.id))}
                    style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '7px 9px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', color: 'var(--mf-text-2)', fontSize: 'var(--mf-t-micro)' }}>
                    {aberto === ev.id ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    <strong style={{ color: 'var(--mf-text)' }}>{ROTULO_ETAPA[ev.etapa] || 'Outro'}</strong>
                    <span className="mf-trunc" style={{ flex: 1 }}>{ev.evento || '—'}{ev.nome ? ` · ${ev.nome}` : ''}</span>
                    <span style={{ color: 'var(--mf-text-3)', whiteSpace: 'nowrap' }}>{quandoFoi(ev.criadoEm)}</span>
                  </button>
                  {aberto === ev.id && (
                    <pre style={{ margin: 0, padding: '8px 10px', maxHeight: 240, overflow: 'auto', fontSize: 11, color: 'var(--mf-text-2)', borderTop: '1px solid var(--mf-border-subtle)' }}>
                      {JSON.stringify(ev.bruto, null, 2)}
                    </pre>
                  )}
                </div>
              ))}
            </div>
          </Cartao>

          <Cartao titulo="Links rastreados">
            <div style={{ fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text-3)', lineHeight: 1.6, marginBottom: 'var(--mf-3)' }}>
              Um link por conta (bio) ou por post. Ele abre o bot com <code>?start=código</code> — é assim que cada lead fica ligado à conta de onde veio.
            </div>
            <div style={{ display: 'grid', gap: 8, marginBottom: 'var(--mf-3)' }}>
              <input className="inp" value={novo.destino} onChange={ev => setNovo(n => ({ ...n, destino: ev.target.value }))} placeholder="Link do bot — https://t.me/seubot" aria-label="Link do bot" />
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <select className="inp" value={novo.accountId} onChange={ev => setNovo(n => ({ ...n, accountId: ev.target.value }))} aria-label="Conta" style={{ flex: '1 1 160px' }}>
                  <option value="">Conta (opcional)</option>
                  {contas.map(c => <option key={c.id} value={c.id}>@{c.username}</option>)}
                </select>
                <input className="inp" value={novo.rotulo} onChange={ev => setNovo(n => ({ ...n, rotulo: ev.target.value }))} placeholder="Nome (ex.: bio, reel 12)" aria-label="Nome do link" style={{ flex: '1 1 140px' }} />
                <button type="button" className="btn-primary" onClick={criarLink} disabled={!novo.destino.trim()} style={{ gap: 6 }}><Plus size={14} /> Criar link</button>
              </div>
            </div>
            {links.length === 0 && <div style={{ fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text-3)' }}>Nenhum link ainda.</div>}
            <div style={{ display: 'grid', gap: 6 }}>
              {links.map(l => (
                <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 'var(--mf-r-sm)', background: 'var(--mf-surface-2)', flexWrap: 'wrap' }}>
                  <Link2 size={14} style={{ color: 'var(--mf-text-3)', flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 160 }}>
                    <div style={{ fontSize: 'var(--mf-t-xs)', fontWeight: 650, color: 'var(--mf-text)' }}>
                      {l.username ? `@${l.username}` : 'Sem conta'}{l.rotulo ? ` · ${l.rotulo}` : ''} <span style={{ color: 'var(--mf-text-3)', fontWeight: 500 }}>· {fmtNum(l.cliques)} clique(s)</span>
                    </div>
                    <div className="mf-trunc" style={{ fontSize: 'var(--mf-t-nano)', color: 'var(--mf-text-3)' }} title={l.destinoFinal}>{l.url}</div>
                  </div>
                  <Copiar texto={l.url} />
                  <button type="button" className="btn btn-ghost btn-sm" aria-label="Apagar link" onClick={() => apagarLink(l.id)}><Trash2 size={13} /></button>
                </div>
              ))}
            </div>
          </Cartao>
        </div>
      )}
    </PageShell>
  );
}
