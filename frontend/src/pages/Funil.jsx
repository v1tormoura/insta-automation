import { useCallback, useEffect, useMemo, useState } from 'react';
import { Copy, Check, Link2, Trash2, Plus, Webhook, RefreshCw, ChevronDown, ChevronRight } from 'lucide-react';
import PageShell from '../components/PageShell';
import api from '../services/api';
import { avisar } from '../services/avisos';
import { useServerEvents } from '../services/useServerEvents';

/**
 * Funil — do Instagram ao bot e à compra.
 *
 *   Link rastreado (bio/legenda) → clique → o bot avisa: entrou → clicou em
 *   comprar (checkout/PIX) → comprou. O código do link vai no ?start= do bot e
 *   volta nos eventos, ligando cada lead à conta de origem.
 *
 * Gráfico: barras horizontais de UMA cor (é magnitude por etapa), número e
 * conversão escritos ao lado; a tabela por origem é a vista em texto.
 */

const PERIODOS = [[7, '7 dias'], [30, '30 dias'], [90, '90 dias']];
const ETAPAS = [
  ['cliques', 'Clicaram no link', 'no Instagram (bio, legenda)'],
  ['entrou', 'Entraram no bot', 'deram start'],
  ['checkout', 'Clicaram em comprar', 'checkout / PIX gerado'],
  ['comprou', 'Compraram', 'pagamento aprovado'],
];
const FILTROS = [['', 'Todos'], ['entrou', 'Entraram e não clicaram'], ['checkout', 'Clicaram e não compraram'], ['comprou', 'Compraram']];
const ROTULO_ETAPA = { entrou: 'Entrou', checkout: 'Clicou em comprar', comprou: 'Comprou' };
const fmt = n => Number(n || 0).toLocaleString('pt-BR');
const real = n => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '—');
const quando = d => new Date(d).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

function Copiar({ texto, rotulo = 'Copiar' }) {
  const [ok, setOk] = useState(false);
  return (
    <button type="button" className="btn btn-ghost btn-sm" style={{ gap: 5, flexShrink: 0 }}
      onClick={() => { navigator.clipboard?.writeText(texto).catch(() => {}); setOk(true); setTimeout(() => setOk(false), 1500); }}>
      {ok ? <Check size={13} /> : <Copy size={13} />} {ok ? 'Copiado' : rotulo}
    </button>
  );
}

const cartao = { padding: 'var(--mf-4)', minWidth: 0 };
const tituloDeCartao = t => <div style={{ fontSize: 'var(--mf-t-sm)', fontWeight: 700, color: 'var(--mf-text)', marginBottom: 'var(--mf-3)' }}>{t}</div>;

export default function Funil() {
  const [dias, setDias] = useState(30);
  const [resumo, setResumo] = useState(null);
  const [filtro, setFiltro] = useState('checkout');
  const [leads, setLeads] = useState(null);
  const [config, setConfig] = useState(null);
  const [links, setLinks] = useState([]);
  const [contas, setContas] = useState([]);
  const [novo, setNovo] = useState({ destino: '', accountId: '', rotulo: '' });
  const [eventos, setEventos] = useState([]);
  const [aberto, setAberto] = useState(null);

  const carregar = useCallback(() => {
    api.get('/funil/resumo', { params: { dias } }).then(r => setResumo(r.data)).catch(() => setResumo(null));
    api.get('/funil/leads', { params: { dias, etapa: filtro } }).then(r => setLeads(r.data)).catch(() => setLeads({ leads: [], total: 0 }));
    api.get('/funil/eventos').then(r => setEventos(r.data.eventos || [])).catch(() => {});
    api.get('/funil/links').then(r => setLinks(r.data.links || [])).catch(() => {});
  }, [dias, filtro]);

  useEffect(() => { carregar(); }, [carregar]);
  useEffect(() => {
    api.get('/funil/config').then(r => setConfig(r.data)).catch(() => {});
    api.get('/accounts', { params: { limit: 500 } }).then(r => setContas(r.data?.accounts || [])).catch(() => {});
  }, []);
  useServerEvents(['funil'], () => carregar());

  const e = resumo?.etapas || {};
  const maximo = Math.max(1, ...ETAPAS.map(([k]) => e[k] || 0));

  async function criarLink() {
    try {
      const { data } = await api.post('/funil/links', novo);
      navigator.clipboard?.writeText(data.url).catch(() => {});
      avisar('success', 'Link criado e copiado', 'Cole na bio ou na legenda da conta.');
      setNovo(n => ({ ...n, rotulo: '', accountId: '' }));
      carregar();
    } catch (err) { avisar('error', 'Não foi possível', err.response?.data?.error || err.message); }
  }
  async function apagarLink(id) {
    await api.delete(`/funil/links/${id}`).catch(() => {});
    carregar();
  }
  async function novoToken() {
    if (!window.confirm('Gerar uma URL nova? A antiga para de funcionar — atualize no bot.')) return;
    const { data } = await api.post('/funil/config/novo-token');
    setConfig(c => ({ ...c, webhook: data.webhook }));
  }

  const origens = useMemo(() => resumo?.origens || [], [resumo]);

  return (
    <PageShell icon={<Webhook size={18} />} title="Funil" subtitle="Do Instagram ao bot e à compra — quem entrou, quem clicou em comprar e quem pagou"
      actions={
        <div role="group" aria-label="Período" style={{ display: 'inline-flex', gap: 2, padding: 3, borderRadius: 'var(--mf-r-md)', background: 'var(--mf-surface-2)', border: '1px solid var(--mf-border)' }}>
          {PERIODOS.map(([d, r]) => (
            <button key={d} type="button" aria-pressed={dias === d} onClick={() => setDias(d)}
              style={{ height: 28, padding: '0 12px', border: 'none', borderRadius: 'var(--mf-r-sm)', cursor: 'pointer', fontSize: 'var(--mf-t-micro)', fontWeight: 700,
                background: dias === d ? 'var(--mf-primary-500)' : 'transparent', color: dias === d ? 'var(--mf-bg)' : 'var(--mf-text-3)' }}>{r}</button>
          ))}
        </div>
      }>

      <div style={{ display: 'grid', gap: 'var(--mf-4)', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 540px), 1fr))', alignItems: 'start' }}>
        {/* Etapas */}
        <section className="mf-card" style={cartao} data-funil-etapas>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 'var(--mf-3)' }}>
            <span style={{ fontSize: 'var(--mf-t-sm)', fontWeight: 700, color: 'var(--mf-text)' }}>Etapas</span>
            <span style={{ flex: 1 }} />
            <span style={{ fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text-3)' }}>Receita</span>
            <span style={{ fontSize: 'var(--mf-t-h2)', fontWeight: 800, color: 'var(--mf-text)', fontVariantNumeric: 'tabular-nums' }}>{real(resumo?.receita)}</span>
          </div>
          <div style={{ display: 'grid', gap: 12 }}>
            {ETAPAS.map(([k, rot, sub], i) => {
              const v = e[k] || 0;
              const anterior = i ? e[ETAPAS[i - 1][0]] || 0 : null;
              return (
                <div key={k} title={`${rot}: ${fmt(v)}`}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
                    <span style={{ fontSize: 'var(--mf-t-xs)', fontWeight: 650, color: 'var(--mf-text)' }}>{rot}</span>
                    <span style={{ fontSize: 'var(--mf-t-nano)', color: 'var(--mf-text-3)' }}>{sub}</span>
                    <span style={{ flex: 1 }} />
                    {anterior != null && (
                      <span style={{ fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text-3)' }}>
                        {v > anterior ? 'inclui quem entrou sem o link' : `${pct(v, anterior)} da etapa anterior`}
                      </span>
                    )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ flex: 1, height: 22, borderRadius: 4, background: 'color-mix(in oklch, var(--mf-border) 50%, transparent)', overflow: 'hidden' }}>
                      <div style={{ width: v ? `${Math.max(2, (v / maximo) * 100)}%` : 0, height: '100%', borderRadius: 4, background: 'var(--mf-primary-500)', transition: 'width .3s' }} />
                    </div>
                    <span style={{ minWidth: 52, textAlign: 'right', fontSize: 'var(--mf-t-body)', fontWeight: 800, color: 'var(--mf-text)', fontVariantNumeric: 'tabular-nums' }}>{fmt(v)}</span>
                  </div>
                </div>
              );
            })}
          </div>
          <div style={{ fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text-3)', marginTop: 'var(--mf-3)', lineHeight: 1.6 }}>
            Conversão total: <strong style={{ color: 'var(--mf-text)' }}>{pct(e.comprou, e.entrou)}</strong> de quem entrou no bot comprou.
            {resumo?.ultimoEvento ? ` Último evento: ${quando(resumo.ultimoEvento)}.` : ' Nenhum evento ainda — configure o webhook abaixo.'}
          </div>
        </section>

        {/* Por origem */}
        <section className="mf-card" style={cartao}>
          {tituloDeCartao('De onde vem')}
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--mf-t-xs)' }}>
              <thead>
                <tr style={{ color: 'var(--mf-text-3)', fontSize: 'var(--mf-t-nano)', textTransform: 'uppercase', letterSpacing: '.06em' }}>
                  {['Origem', 'Cliques', 'Entraram', 'Comprar', 'Compras', 'Conv.', 'Receita'].map((h, i) => (
                    <th key={h} style={{ textAlign: i ? 'right' : 'left', padding: '6px 8px', fontWeight: 700, whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {origens.length === 0 && <tr><td colSpan={7} style={{ padding: 'var(--mf-5)', textAlign: 'center', color: 'var(--mf-text-3)' }}>Sem dados no período.</td></tr>}
                {origens.map(o => (
                  <tr key={o.origem} style={{ borderTop: '1px solid var(--mf-border-subtle)', fontVariantNumeric: 'tabular-nums' }}>
                    <td style={{ padding: '8px', fontWeight: 650, color: 'var(--mf-text)' }}>{o.origem}</td>
                    {[o.cliques, o.entrou, o.checkout, o.comprou].map((v, i) => <td key={i} style={{ padding: 8, textAlign: 'right', color: 'var(--mf-text-2)' }}>{fmt(v)}</td>)}
                    <td style={{ padding: 8, textAlign: 'right', color: 'var(--mf-text-2)' }}>{pct(o.comprou, o.entrou)}</td>
                    <td style={{ padding: 8, textAlign: 'right', fontWeight: 700, color: 'var(--mf-text)' }}>{real(o.receita)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Leads */}
        <section className="mf-card" style={{ ...cartao, gridColumn: '1 / -1' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 'var(--mf-3)' }}>
            <span style={{ fontSize: 'var(--mf-t-sm)', fontWeight: 700, color: 'var(--mf-text)' }}>Leads</span>
            <span style={{ fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text-3)' }}>{leads ? `${fmt(leads.total)} pessoa(s)` : ''}</span>
            <span style={{ flex: 1 }} />
            <div role="group" aria-label="Etapa" style={{ display: 'inline-flex', gap: 2, padding: 3, flexWrap: 'wrap', borderRadius: 'var(--mf-r-md)', background: 'var(--mf-surface-2)', border: '1px solid var(--mf-border)' }}>
              {FILTROS.map(([id, r]) => (
                <button key={id || 'todos'} type="button" aria-pressed={filtro === id} onClick={() => setFiltro(id)}
                  style={{ height: 28, padding: '0 10px', border: 'none', borderRadius: 'var(--mf-r-sm)', cursor: 'pointer', fontSize: 'var(--mf-t-micro)', fontWeight: 700,
                    background: filtro === id ? 'var(--mf-surface-3)' : 'transparent', color: filtro === id ? 'var(--mf-text)' : 'var(--mf-text-3)' }}>{r}</button>
              ))}
            </div>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--mf-t-xs)', minWidth: 720 }}>
              <thead>
                <tr style={{ color: 'var(--mf-text-3)', fontSize: 'var(--mf-t-nano)', textTransform: 'uppercase', letterSpacing: '.06em' }}>
                  {['Pessoa', 'Contato', 'Parou em', 'Origem', 'Plano / valor', 'Última ação'].map(h => <th key={h} style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 700 }}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {leads?.leads?.length === 0 && <tr><td colSpan={6} style={{ padding: 'var(--mf-5)', textAlign: 'center', color: 'var(--mf-text-3)' }}>Ninguém nesta etapa no período.</td></tr>}
                {(leads?.leads || []).map((l, i) => (
                  <tr key={l.lead || i} style={{ borderTop: '1px solid var(--mf-border-subtle)' }}>
                    <td style={{ padding: 8, color: 'var(--mf-text)', fontWeight: 650 }}>{l.nome || (l.username ? `@${l.username}` : l.lead || '—')}
                      {l.username && l.nome && <div style={{ fontSize: 'var(--mf-t-nano)', color: 'var(--mf-text-3)', fontWeight: 500 }}>@{l.username}</div>}</td>
                    <td style={{ padding: 8, color: 'var(--mf-text-2)' }}>{[l.email, l.telefone].filter(Boolean).join(' · ') || '—'}</td>
                    <td style={{ padding: 8 }}>
                      <span style={{ padding: '2px 8px', borderRadius: 'var(--mf-r-full)', fontSize: 'var(--mf-t-nano)', fontWeight: 700, background: 'var(--mf-surface-3)', color: 'var(--mf-text)' }}>
                        {l.etapa === 'comprou' ? '✓ ' : ''}{ROTULO_ETAPA[l.etapa]}
                      </span>
                    </td>
                    <td style={{ padding: 8, color: 'var(--mf-text-2)' }}>{l.origem || '—'}</td>
                    <td style={{ padding: 8, color: 'var(--mf-text-2)' }}>{[l.plano, l.valor != null ? real(l.valor) : ''].filter(Boolean).join(' · ') || '—'}</td>
                    <td style={{ padding: 8, color: 'var(--mf-text-3)', whiteSpace: 'nowrap' }}>{quando(l.ultimo)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Links rastreados */}
        <section className="mf-card" style={cartao}>
          {tituloDeCartao('Links rastreados')}
          <div style={{ fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text-3)', lineHeight: 1.6, marginBottom: 'var(--mf-3)' }}>
            Um link por conta (ou por post). Ele conta o clique e abre o bot com <code>?start=código</code> — é assim que cada lead fica ligado à conta de onde veio.
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
          <div style={{ display: 'grid', gap: 6 }}>
            {links.map(l => (
              <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 'var(--mf-r-sm)', background: 'var(--mf-surface-2)', flexWrap: 'wrap' }}>
                <Link2 size={14} style={{ color: 'var(--mf-text-3)', flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 160 }}>
                  <div style={{ fontSize: 'var(--mf-t-xs)', fontWeight: 650, color: 'var(--mf-text)' }}>
                    {l.username ? `@${l.username}` : 'Sem conta'}{l.rotulo ? ` · ${l.rotulo}` : ''} <span style={{ color: 'var(--mf-text-3)', fontWeight: 500 }}>· {fmt(l.cliques)} clique(s)</span>
                  </div>
                  <div className="mf-trunc" style={{ fontSize: 'var(--mf-t-nano)', color: 'var(--mf-text-3)' }} title={l.destinoFinal}>{l.url}</div>
                </div>
                <Copiar texto={l.url} />
                <button type="button" className="btn btn-ghost btn-sm" aria-label="Apagar link" onClick={() => apagarLink(l.id)}><Trash2 size={13} /></button>
              </div>
            ))}
          </div>
        </section>

        {/* Webhook */}
        <section className="mf-card" style={cartao}>
          {tituloDeCartao('Webhook do bot')}
          <div style={{ fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text-3)', lineHeight: 1.6, marginBottom: 'var(--mf-3)' }}>
            Cole esta URL no campo de webhook / notificação do seu bot (ApexVIP, SharkBot, checkout, n8n). O Nexora lê o evento pelo conteúdo
            (start, checkout, PIX, aprovado…). Se o bot deixar uma URL por evento, use <code>?etapa=entrou</code>, <code>?etapa=checkout</code> ou <code>?etapa=comprou</code> no fim.
          </div>
          {config && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '8px 10px', borderRadius: 'var(--mf-r-sm)', background: 'var(--mf-surface-2)', border: '1px solid var(--mf-border)' }}>
              <code className="mf-trunc" style={{ flex: 1, minWidth: 0, fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text)' }} data-webhook-url>{config.webhook}</code>
              <Copiar texto={config.webhook} />
              <button type="button" className="btn btn-ghost btn-sm" onClick={novoToken} title="Gerar URL nova (a antiga para de funcionar)"><RefreshCw size={13} /></button>
            </div>
          )}
          <div style={{ fontSize: 'var(--mf-t-nano)', fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--mf-text-3)', margin: 'var(--mf-4) 0 6px' }}>Últimos eventos recebidos</div>
          {eventos.length === 0 && <div style={{ fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text-3)' }}>Nenhum ainda. Faça um teste no bot e ele aparece aqui na hora.</div>}
          <div style={{ display: 'grid', gap: 4 }}>
            {eventos.map(ev => (
              <div key={ev.id} style={{ borderRadius: 'var(--mf-r-sm)', background: 'var(--mf-surface-2)' }}>
                <button type="button" onClick={() => setAberto(a => (a === ev.id ? null : ev.id))}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', color: 'var(--mf-text-2)', fontSize: 'var(--mf-t-micro)' }}>
                  {aberto === ev.id ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  <strong style={{ color: 'var(--mf-text)' }}>{ROTULO_ETAPA[ev.etapa] || 'Outro'}</strong>
                  <span className="mf-trunc" style={{ flex: 1 }}>{ev.evento || '—'}{ev.nome ? ` · ${ev.nome}` : ''}{ev.codigo ? ` · ${ev.codigo}` : ''}</span>
                  <span style={{ color: 'var(--mf-text-3)', whiteSpace: 'nowrap' }}>{quando(ev.criadoEm)}</span>
                </button>
                {aberto === ev.id && (
                  <pre style={{ margin: 0, padding: '8px 10px', maxHeight: 220, overflow: 'auto', fontSize: 11, color: 'var(--mf-text-2)', borderTop: '1px solid var(--mf-border-subtle)' }}>
                    {JSON.stringify(ev.bruto, null, 2)}
                  </pre>
                )}
              </div>
            ))}
          </div>
        </section>
      </div>
    </PageShell>
  );
}
