import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import api from '../services/api';
import Toast from '../components/Toast';
import PageShell from '../components/PageShell';
import { EsqueletoTabela } from '../components/Estados';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000';

const BADGE = {
  online:      { bg:'color-mix(in oklch, var(--mf-success-500) 13%, transparent)', color:'var(--mf-success-500)', border:'oklch(0.38 0.12 150 / 0.35)', label:'Online' },
  offline:     { bg:'color-mix(in oklch, var(--mf-danger-500) 13%, transparent)',  color:'var(--mf-danger-500)', border:'oklch(0.38 0.12 15 / 0.35)',  label:'Offline' },
  nao_testado: { bg:'color-mix(in oklch, var(--mf-surface-1) 60%, transparent)', color:'var(--mf-text-3)', border:'color-mix(in oklch, var(--mf-surface-3) 35%, transparent)', label:'Não testado' },
};

export default function Proxies() {
  const [accounts, setAccounts] = useState([]);
  const [toast, setToast]       = useState(null);
  const [testing, setTesting]   = useState(null);
  const [proxyModal, setProxyModal]     = useState(false);
  const [proxyAccount, setProxyAccount] = useState(null);
  const [proxyValue, setProxyValue]     = useState('');
  const [bulkModal, setBulkModal] = useState(false);
  const [bulkText, setBulkText]   = useState('');
  const [bulkSubstituir, setBulkSubstituir] = useState(false);
  const [bulkRelatorio, setBulkRelatorio]   = useState(null);
  const [bulkAplicando, setBulkAplicando]   = useState(false);
  const [pool, setPool] = useState({ resumo: null, itens: [] });
  const [testandoPool, setTestandoPool] = useState(false);

  function showToast(type, title, message) { setToast({ type, title, message }); setTimeout(() => setToast(null), 3500); }

  const [primeiraCarga, setPrimeiraCarga] = useState(true);

  async function loadAccounts() {
    try { const res = await api.get('/accounts?limit=200'); setAccounts(Array.isArray(res.data.accounts) ? res.data.accounts : Array.isArray(res.data) ? res.data : []); }
    catch (err) { showToast('error', 'Erro', err.response?.data?.error || 'Erro ao carregar contas.'); }
    finally { setPrimeiraCarga(false); }
  }

  /* O pool é a lista de proxies ainda não atribuídos a ninguém. Sem esta
     tela, importar proxies com zero contas parecia não fazer nada: eles iam
     para o pool e a página, que só mostrava linhas por conta, ficava vazia. */
  async function loadPool() {
    try { const res = await api.get('/proxy/pool'); setPool(res.data || { resumo:null, itens:[] }); }
    catch { /* pool indisponível não derruba a tela de contas */ }
  }

  async function testarPool() {
    setTestandoPool(true);
    try {
      const res = await api.post('/proxy/pool/testar');
      await loadPool();
      const { ok = 0, ruins = 0, rotativos = 0 } = res.data || {};
      showToast(ok ? 'success' : 'error', 'Teste concluído',
        `${ok} funcionando · ${ruins} sem resposta · ${rotativos} trocando de IP`);
    } catch (err) { showToast('error', 'Erro', err.response?.data?.error || 'Falha ao testar.'); }
    finally { setTestandoPool(false); }
  }

  async function removerDoPool(url) {
    try {
      await api.delete('/proxy/pool', { data: { url } });
      await loadPool();
    } catch (err) { showToast('error', 'Erro', err.response?.data?.error || 'Falha ao remover.'); }
  }

  useEffect(() => {
    loadAccounts(); loadPool();
    const t = setInterval(() => { loadAccounts(); loadPool(); }, 30000);
    return () => clearInterval(t);
  }, []);

  function openProxyModal(account) { setProxyAccount(account); setProxyValue(account.proxy || ''); setProxyModal(true); }

  async function saveProxy() {
    try {
      if (!proxyAccount) return;
      await api.patch(`/accounts/${proxyAccount._id}/proxy`, { proxy: proxyValue });
      await loadAccounts(); setProxyModal(false); setProxyAccount(null); setProxyValue('');
      showToast('success', 'Proxy salvo', 'Proxy atualizado com sucesso.');
    } catch (err) { showToast('error', 'Erro', err.response?.data?.error || 'Erro ao salvar proxy.'); }
  }

  async function testProxy(account) {
    try {
      setTesting(account._id);
      const res = await api.post(`/accounts/${account._id}/proxy/test`);
      await loadAccounts();
      if (res.data.success) showToast('success', 'Proxy online', `IP detectado: ${res.data.ip}`);
      else showToast('error', 'Proxy offline', res.data.error || 'Falha no proxy.');
    } catch (err) { showToast('error', 'Erro', err.response?.data?.error || 'Erro ao testar proxy.'); }
    finally { setTesting(null); }
  }

  async function testAllProxies() {
    try { await api.post('/accounts/proxies/test-all'); showToast('success', 'Teste iniciado', 'Todos os proxies serão testados em segundo plano.'); }
    catch (err) { showToast('error', 'Erro', err.response?.data?.error || 'Erro ao testar proxies.'); }
  }

  async function applyBulkProxies() {
    if (!bulkText.trim()) return showToast('warning', 'Atenção', 'Cole pelo menos um proxy.');
    setBulkAplicando(true);
    setBulkRelatorio(null);
    try {
      // Cada proxy é testado duas vezes no servidor antes de ser gravado — a
      // resposta demora proporcionalmente ao tamanho da lista.
      const res = await api.post('/accounts/proxies/bulk-apply', {
        proxiesText: bulkText,
        substituir: bulkSubstituir,
      });
      await loadPool();
      await loadAccounts();
      // O modal NÃO fecha sozinho: o relatório é a parte útil — o que sobrou,
      // o que foi reprovado e quais contas continuaram sem proxy.
      setBulkRelatorio(res.data);
      showToast('success', 'Proxies aplicados', `${res.data.applied} conta(s) receberam proxy próprio.`);
    } catch (err) {
      const d = err.response?.data;
      if (d && (d.reprovados || d.invalidas)) setBulkRelatorio(d);
      showToast('error', 'Erro', d?.error || 'Erro ao aplicar proxies.');
    } finally {
      setBulkAplicando(false);
    }
  }

  function fmtDate(d) { if (!d) return 'Nunca'; return new Date(d).toLocaleString('pt-BR'); }

  const configured = accounts.filter(a => a.proxy).length;
  const online     = accounts.filter(a => a.proxy && a.proxyStatus === 'online').length;
  const offline    = accounts.filter(a => a.proxy && a.proxyStatus === 'offline').length;
  const notTested  = accounts.filter(a => a.proxy && a.proxyStatus === 'nao_testado').length;

  const STATS = [
    { label:'Contas',        value:accounts.length, color:'oklch(0.68 0.18 270)' },
    { label:'Configurados',  value:configured,      color:'oklch(0.72 0.19 196)' },
    { label:'Online',        value:online,          color:'oklch(0.72 0.18 150)' },
    { label:'Offline',       value:offline,         color:'oklch(0.63 0.2 15)'   },
    { label:'Não testados',  value:notTested,       color:'oklch(0.55 0.04 240)' },
  ];

  const pageIcon = (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0018 0V5"/><path d="M3 12a9 3 0 0018 0"/>
    </svg>
  );

  const pageActions = (
    <div style={{ display:'flex', gap:8 }}>
      <button className="btn-ghost" style={{ fontSize: 'var(--mf-t-xs)', padding:'4px 12px', borderRadius: 'var(--mf-r-sm)' }} onClick={() => setBulkModal(true)}>Importar proxies</button>
      <button className="btn-primary" style={{ fontSize: 'var(--mf-t-xs)', padding:'4px 12px', borderRadius: 'var(--mf-r-sm)' }} onClick={testAllProxies}>Testar todos</button>
    </div>
  );

  const cardStyle  = { background:'color-mix(in oklch, var(--mf-surface-1) 85%, transparent)', border:'1px solid var(--mf-border)', borderRadius: 'var(--mf-r-lg)', overflow:'hidden', backdropFilter:'blur(12px)' };
  const modalStyle = { position:'fixed', inset:0, background:'color-mix(in oklch, var(--mf-bg) 85%, transparent)', backdropFilter:'blur(6px)', display:'grid', placeItems:'center', zIndex:9999 };
  const modalBoxStyle = { background:'color-mix(in oklch, var(--mf-surface-1) 98%, transparent)', border:'1px solid var(--mf-border)', borderRadius: 'var(--mf-r-lg)', padding:'16px 24px',
    /* `minWidth: 380` sozinho estourava a tela de 320px em 60 pixels — o
       modal ficava mais largo que o aparelho e a página passava a rolar
       de lado. `min()` mantém os 380 onde cabem e cede onde não cabem.
       `maxHeight` + rolagem interna resolvem o eixo vertical: um modal
       mais alto que a viewport esconde o próprio botão de confirmar. */
    width:'min(380px, calc(100vw - 32px))', boxSizing:'border-box',
    maxHeight:'calc(100vh - 32px)', overflowY:'auto',
    boxShadow:'0 24px 60px oklch(0 0 0 / 0.6)' };
  const inputStyle = { width:'100%', height:40, padding:'0 12px', borderRadius: 'var(--mf-r-sm)', border:'1px solid var(--mf-border)', background:'color-mix(in oklch, var(--mf-bg) 80%, transparent)', color:'var(--mf-text)', fontSize: 'var(--mf-t-sm)', boxSizing:'border-box', outline:'none' };
  const thStyle    = { padding:'8px 12px', fontSize: 'var(--mf-t-nano)', fontWeight:700, color:'var(--mf-text-3)', textTransform:'uppercase', letterSpacing:'.07em', fontFamily:'var(--mf-mono)', borderBottom:'1px solid var(--mf-border)', textAlign:'left', background:'color-mix(in oklch, var(--mf-bg) 40%, transparent)' };
  const tdStyle    = { padding:'12px 12px', fontSize: 'var(--mf-t-xs)', color:'var(--mf-text-2)', borderBottom:'1px solid var(--mf-border-subtle)', verticalAlign:'middle' };

  function ProxyBadge({ status }) {
    const b = BADGE[status] || { bg:'color-mix(in oklch, var(--mf-surface-1) 60%, transparent)', color:'var(--mf-text-3)', border:'color-mix(in oklch, var(--mf-surface-3) 35%, transparent)', label:'—' };
    return <span style={{ fontSize: 'var(--mf-t-nano)', fontWeight:700, padding:'2px 8px', borderRadius: 'var(--mf-r-full)', background:b.bg, color:b.color, border:`1px solid ${b.border}` }}>{b.label}</span>;
  }

  return (
    <>
      <Toast toast={toast} onClose={() => setToast(null)} />
      <PageShell icon={pageIcon} title="Proxy Manager" subtitle="Gerencie proxies por conta, teste conexão e aplique em massa." accent="cyan" actions={pageActions}>

        {/* Stats */}
        <div className="resp-grid-5" style={{ marginBottom:14 }}>
          {STATS.map((s, i) => (
            <motion.div key={s.label} initial={{ opacity:0, y:8 }} animate={{ opacity:1, y:0 }} transition={{ duration:.2, delay:i*.04 }}
              style={{ ...cardStyle, padding:'12px 12px', textAlign:'center', borderTop:`2px solid ${s.color}` }}>
              <div style={{ fontSize: 'var(--mf-t-display)', fontWeight:900, color:s.color, letterSpacing:'-1px', fontVariantNumeric:'tabular-nums' }}>{s.value}</div>
              <div style={{ fontSize: 'var(--mf-t-nano)', color:'var(--mf-text-3)', marginTop:3, fontFamily:'var(--mf-mono)', textTransform:'uppercase', letterSpacing:'.04em' }}>{s.label}</div>
            </motion.div>
          ))}
        </div>

        {/* ── Pool de proxies ──────────────────────────────────────────────
            Fica ACIMA da tabela por conta de propósito: é aqui que os proxies
            chegam quando são importados, e é daqui que cada conta puxa o seu
            ao conectar. Quem importa com zero contas precisa ver que a lista
            entrou em algum lugar. */}
        <motion.div initial={{ opacity:0, y:10 }} animate={{ opacity:1, y:0 }} transition={{ duration:.25, delay:.06 }}
          style={{ ...cardStyle, marginBottom:14 }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:12, flexWrap:'wrap', padding:'12px 16px', borderBottom:'1px solid var(--mf-border)' }}>
            <div style={{ minWidth:0 }}>
              <h3 style={{ fontSize: 'var(--mf-t-body)', fontWeight:700, color:'var(--mf-text)', margin:0 }}>
                Pool de proxies
              </h3>
              <p style={{ fontSize: 'var(--mf-t-micro)', color:'var(--mf-text-3)', margin:'3px 0 0' }}>
                Cada conta reserva um destes ao conectar. Um proxy, uma conta.
              </p>
            </div>
            <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
              {pool.resumo && (
                <span className="mf-mono" style={{ fontSize: 'var(--mf-t-micro)', color:'var(--mf-text-3)' }}>
                  {pool.resumo.livres} livre(s) · {pool.resumo.reservados} em uso
                  {pool.resumo.ruins > 0 && ` · ${pool.resumo.ruins} sem resposta`}
                  {pool.resumo.rotativos > 0 && ` · ${pool.resumo.rotativos} trocando de IP`}
                </span>
              )}
              <button className="btn-ghost btn-sm" onClick={testarPool} disabled={testandoPool || !pool.itens.length}>
                {testandoPool ? 'Testando…' : 'Testar pool'}
              </button>
            </div>
          </div>

          {/* Pool esgotado é a única condição aqui que causa dano silencioso: a
              próxima conta a conectar não recebe proxy, sai pelo endereço
              global junto com as outras, e o Instagram lê várias contas no
              mesmo IP como automação. O número "0 livre(s)" acima já dizia
              isso, mas ninguém lê um contador procurando por um problema que
              não sabe que existe. */}
          {pool.resumo?.esgotado && (
            <div role="status" style={{ background:'var(--mf-warning-bg)',
              border:'1px solid oklch(0.80 0.16 78 / 0.3)', borderRadius:'var(--mf-r-md)',
              padding:'var(--mf-3) var(--mf-4)', marginBottom:'var(--mf-4)',
              fontSize:'var(--mf-t-sm)', color:'var(--mf-warning-500)' }}>
              <b>O pool acabou.</b> Os {pool.resumo.total} proxies estão todos reservados.
              A próxima conta a conectar vai sair pelo proxy global, dividindo IP com as
              demais — que é o padrão que o Instagram marca como automação. Importe mais
              proxies antes de adicionar contas.
            </div>
          )}

          {primeiraCarga && !pool.itens.length ? (
            <EsqueletoTabela linhas={4} colunas={5} />
          ) : pool.itens.length === 0 ? (
            <div style={{ padding:'24px 16px', textAlign:'center', color:'var(--mf-text-3)', fontSize: 'var(--mf-t-sm)', lineHeight:1.7 }}>
              Nenhum proxy no pool.<br />
              Use <strong style={{ color:'var(--mf-text-2)' }}>Importar proxies</strong> e cole a lista do fornecedor —
              um por linha. Eles ficam aqui até uma conta reservar.
            </div>
          ) : (
            <div style={{ overflowX:'auto' }}>
              <table style={{ width:'100%', borderCollapse:'collapse' }}>
                <thead>
                  <tr>
                    <th style={thStyle}>Endereço</th>
                    <th style={thStyle}>Situação</th>
                    <th style={thStyle}>IP de saída</th>
                    <th style={thStyle}>Conta</th>
                    <th style={{ ...thStyle, textAlign:'right' }}>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {pool.itens.map(item => (
                    <tr key={item.url}>
                      <td style={{ ...tdStyle, fontFamily:'var(--mf-mono)', fontSize: 'var(--mf-t-micro)' }}>{item.endereco}</td>
                      <td style={tdStyle}>
                        {item.rotativo ? (
                          <span style={{ fontSize: 'var(--mf-t-nano)', fontWeight:700, padding:'2px 8px', borderRadius: 'var(--mf-r-full)',
                            background:'var(--mf-warning-bg)', color:'var(--mf-warning-500)' }}
                            title="Troca de IP entre requisições — isso quebra o login do Instagram">
                            Troca de IP
                          </span>
                        ) : item.ok === true ? (
                          <span style={{ fontSize: 'var(--mf-t-nano)', fontWeight:700, padding:'2px 8px', borderRadius: 'var(--mf-r-full)',
                            background:'var(--mf-success-bg)', color:'var(--mf-success-500)' }}>Funcionando</span>
                        ) : item.ok === false ? (
                          <span style={{ fontSize: 'var(--mf-t-nano)', fontWeight:700, padding:'2px 8px', borderRadius: 'var(--mf-r-full)',
                            background:'var(--mf-danger-bg)', color:'var(--mf-danger-500)' }}
                            title={item.erro || 'Sem resposta'}>Sem resposta</span>
                        ) : (
                          <span style={{ fontSize: 'var(--mf-t-nano)', fontWeight:700, padding:'2px 8px', borderRadius: 'var(--mf-r-full)',
                            background:'var(--mf-border-subtle)', color:'var(--mf-text-3)' }}>Não testado</span>
                        )}
                      </td>
                      <td style={{ ...tdStyle, fontFamily:'var(--mf-mono)', fontSize: 'var(--mf-t-micro)' }}>{item.ip || '—'}</td>
                      <td style={tdStyle}>
                        {item.conta
                          ? <span style={{ color:'var(--mf-text)' }}>@{item.conta}</span>
                          : <span style={{ color:'var(--mf-text-3)' }}>livre</span>}
                      </td>
                      <td style={{ ...tdStyle, textAlign:'right' }}>
                        <button className="btn-ghost btn-sm" onClick={() => removerDoPool(item.url)}>Remover</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </motion.div>

        {/* Table card */}
        <motion.div initial={{ opacity:0, y:10 }} animate={{ opacity:1, y:0 }} transition={{ duration:.25, delay:.12 }} style={cardStyle}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'12px 16px', borderBottom:'1px solid var(--mf-border)' }}>
            <h3 style={{ fontSize: 'var(--mf-t-body)', fontWeight:700, color:'var(--mf-text)', margin:0 }}>Proxies por conta</h3>
            <span style={{ fontSize: 'var(--mf-t-nano)', color:'var(--mf-text-3)', fontFamily:'var(--mf-mono)' }}>Atualiza a cada 30s</span>
          </div>
          <div style={{ overflowX:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse' }}>
              <thead>
                <tr>
                  <th style={thStyle}>Conta</th>
                  <th style={thStyle}>Proxy</th>
                  <th style={thStyle}>Status</th>
                  <th style={thStyle}>Último teste</th>
                  <th style={thStyle}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((account, i) => (
                  <tr key={account._id} style={{ background: i % 2 === 0 ? 'transparent' : 'color-mix(in oklch, var(--mf-bg) 20%, transparent)' }}>
                    <td style={tdStyle}>
                      <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                        {account.avatar
                          ? <img src={`${API_BASE}${account.avatar}`} alt="" style={{ width:32, height:32, borderRadius: 'var(--mf-r-sm)', objectFit:'cover' }} />
                          : <div style={{ width:32, height:32, borderRadius: 'var(--mf-r-sm)', background:'oklch(0.68 0.18 270 / 0.15)', border:'1px solid oklch(0.68 0.18 270 / 0.25)', display:'grid', placeItems:'center', fontSize: 'var(--mf-t-sm)', fontWeight:700, color:'oklch(0.68 0.18 270)' }}>{account.username?.charAt(0)?.toUpperCase() || 'I'}</div>
                        }
                        <div>
                          <div style={{ fontWeight:700, color:'var(--mf-text)', fontSize: 'var(--mf-t-xs)' }}>@{account.username}</div>
                          <div style={{ fontSize: 'var(--mf-t-nano)', color:'var(--mf-text-3)' }}>{account.name || 'Sem nome'}</div>
                        </div>
                      </div>
                    </td>
                    <td style={tdStyle}>
                      <span style={{ fontFamily:'var(--mf-mono)', fontSize: 'var(--mf-t-micro)', color: account.proxy ? 'var(--mf-text)' : 'var(--mf-text-3)' }}>
                        {account.proxy || '—'}
                      </span>
                    </td>
                    <td style={tdStyle}>
                      {account.proxy
                        ? (
                          <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
                            <ProxyBadge status={account.proxyStatus} />
                            {account.proxyStatus === 'online' && account.proxyIp && (
                              <span style={{ fontFamily:'var(--mf-mono)', fontSize: 'var(--mf-t-micro)', fontWeight:700, color:'var(--mf-success-500)' }}>
                                {account.proxyIp}
                              </span>
                            )}
                          </div>
                        )
                        : <span style={{ color:'var(--mf-text-3)', fontSize: 'var(--mf-t-micro)' }}>—</span>
                      }
                    </td>
                    <td style={{ ...tdStyle, fontFamily:'var(--mf-mono)', fontSize: 'var(--mf-t-micro)' }}>{fmtDate(account.proxyLastCheck)}</td>
                    <td style={tdStyle}>
                      <div style={{ display:'flex', gap:6 }}>
                        <button className="btn-ghost" style={{ fontSize: 'var(--mf-t-micro)', padding:'4px 8px', borderRadius: 'var(--mf-r-sm)' }} onClick={() => openProxyModal(account)}>Editar</button>
                        <button className="btn-primary" style={{ fontSize: 'var(--mf-t-micro)', padding:'4px 8px', borderRadius: 'var(--mf-r-sm)', opacity: (!account.proxy || testing === account._id) ? .5 : 1 }}
                          onClick={() => testProxy(account)} disabled={testing === account._id || !account.proxy}>
                          {testing === account._id ? '...' : 'Testar'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!accounts.length && (
              <div style={{ textAlign:'center', padding:'32px 16px', color:'var(--mf-text-3)', fontSize: 'var(--mf-t-sm)' }}>Nenhuma conta encontrada.</div>
            )}
          </div>
        </motion.div>

        {/* Proxy edit modal */}
        {proxyModal && (
          <div style={modalStyle}>
            <div style={modalBoxStyle}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
                <h3 style={{ margin:0, fontSize: 'var(--mf-t-h2)', fontWeight:800 }}>Editar Proxy</h3>
                <button onClick={() => setProxyModal(false)} style={{ background:'none', border:'none', color:'var(--mf-text-3)', fontSize: 'var(--mf-t-h1)', cursor:'pointer', lineHeight:1 }}>×</button>
              </div>
              <p style={{ fontSize: 'var(--mf-t-xs)', color:'var(--mf-text-3)', marginBottom:14 }}>Conta: <strong style={{ color:'var(--mf-text)' }}>@{proxyAccount?.username}</strong></p>
              <label style={{ fontSize: 'var(--mf-t-micro)', color:'var(--mf-text-3)', display:'block', marginBottom:6, fontFamily:'var(--mf-mono)', textTransform:'uppercase', letterSpacing:'.05em' }}>Proxy URL</label>
              <input style={inputStyle} value={proxyValue} onChange={e => setProxyValue(e.target.value)} placeholder="http://usuario:senha@host:porta" />
              <div style={{ display:'flex', gap:8, justifyContent:'flex-end', marginTop:20 }}>
                <button className="btn-ghost" style={{ borderRadius: 'var(--mf-r-sm)', padding:'8px 16px' }} onClick={() => setProxyModal(false)}>Cancelar</button>
                <button className="btn-primary" style={{ borderRadius: 'var(--mf-r-sm)', padding:'8px 16px' }} onClick={saveProxy}>Salvar proxy</button>
              </div>
            </div>
          </div>
        )}

        {/* Bulk import modal */}
        {bulkModal && (
          <div style={modalStyle}>
            {/* `minWidth` venceria o `width: min(...)` do estilo base — em CSS,
                min-width tem prioridade sobre width — e o modal voltaria a ter
                440px numa tela de 320. O alargamento vai no `width`, que
                continua cedendo quando não cabe. */}
            <div style={{ ...modalBoxStyle, width:'min(440px, calc(100vw - 32px))' }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
                <h3 style={{ margin:0, fontSize: 'var(--mf-t-h2)', fontWeight:800 }}>Importar proxies em massa</h3>
                <button onClick={() => setBulkModal(false)} style={{ background:'none', border:'none', color:'var(--mf-text-3)', fontSize: 'var(--mf-t-h1)', cursor:'pointer', lineHeight:1 }}>×</button>
              </div>
              <p style={{ fontSize: 'var(--mf-t-xs)', color:'var(--mf-text-3)', marginBottom:6, lineHeight:1.6 }}>
                Um proxy por linha. Cada conta recebe um <strong>proxy exclusivo</strong> —
                repetir o mesmo IP em duas contas é o que se está tentando evitar.
              </p>
              <p style={{ fontSize: 'var(--mf-t-micro)', color:'var(--mf-text-3)', marginBottom:12, lineHeight:1.6 }}>
                Aceita <code>host:porta</code>, <code>host:porta:usuário:senha</code>,
                <code> usuário:senha@host:porta</code> e URL completa. Cada proxy é testado
                antes de ser gravado, então listas grandes demoram.
              </p>
              <textarea
                rows={7}
                value={bulkText}
                onChange={e => setBulkText(e.target.value)}
                placeholder={"1.2.3.4:9000:usuario:senha\nhttp://usuario:senha@host:porta"}
                style={{ ...inputStyle, height:'auto', padding:'8px 12px', resize:'vertical', lineHeight:1.6 }}
              />

              <label style={{ display:'flex', alignItems:'center', gap:7, marginTop:10, fontSize: 'var(--mf-t-micro)', color:'var(--mf-text-2)', cursor:'pointer' }}>
                <input type="checkbox" checked={bulkSubstituir} onChange={e => setBulkSubstituir(e.target.checked)} />
                Trocar também o proxy das contas que já têm um
              </label>

              {bulkRelatorio && (
                <div style={{ marginTop:14, padding:12, borderRadius: 'var(--mf-r-md)', background:'var(--mf-border-subtle)', border:'1px solid var(--mf-border)', fontSize: 'var(--mf-t-micro)', lineHeight:1.8 }}>
                  <div style={{ fontWeight:800, marginBottom:6 }}>Resultado</div>
                  <div>✅ {bulkRelatorio.atribuidos ?? 0} conta(s) receberam proxy exclusivo</div>
                  {bulkRelatorio.contasSemProxy > 0 && (
                    <div style={{ color:'var(--mf-warning-500)' }}>
                      ⚠️ {bulkRelatorio.contasSemProxy} conta(s) ficaram sem — faltou proxy na lista
                    </div>
                  )}
                  {bulkRelatorio.proxiesSobrando > 0 && (
                    <div style={{ color:'var(--mf-text-3)' }}>{bulkRelatorio.proxiesSobrando} proxy(s) sobraram</div>
                  )}
                  {bulkRelatorio.rotativos?.length > 0 && (
                    <div style={{ color:'var(--mf-warning-500)' }}>
                      ⚠️ {bulkRelatorio.rotativos.length} recusado(s) por trocar de IP entre requisições —
                      isso quebra o login do Instagram
                    </div>
                  )}
                  {bulkRelatorio.reprovados?.length > 0 && (
                    <div style={{ color:'var(--mf-danger-500)' }}>
                      ❌ {bulkRelatorio.reprovados.length} não responderam:{' '}
                      {bulkRelatorio.reprovados.slice(0, 3).map(r => r.url).join(', ')}
                      {bulkRelatorio.reprovados.length > 3 ? '…' : ''}
                    </div>
                  )}
                  {bulkRelatorio.invalidas?.length > 0 && (
                    <div style={{ color:'var(--mf-danger-500)' }}>
                      ❌ {bulkRelatorio.invalidas.length} linha(s) em formato não reconhecido
                    </div>
                  )}
                </div>
              )}

              <div style={{ display:'flex', gap:8, justifyContent:'flex-end', marginTop:16 }}>
                <button className="btn-ghost" style={{ borderRadius: 'var(--mf-r-sm)', padding:'8px 16px' }}
                  onClick={() => { setBulkModal(false); setBulkRelatorio(null); }}>
                  {bulkRelatorio ? 'Fechar' : 'Cancelar'}
                </button>
                <button className="btn-primary" style={{ borderRadius: 'var(--mf-r-sm)', padding:'8px 16px', opacity: bulkAplicando ? .6 : 1 }}
                  disabled={bulkAplicando} onClick={applyBulkProxies}>
                  {bulkAplicando ? 'Testando proxies…' : 'Aplicar proxies'}
                </button>
              </div>
            </div>
          </div>
        )}

      </PageShell>
    </>
  );
}
